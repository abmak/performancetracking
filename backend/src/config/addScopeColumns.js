/**
 * Adds the two scope columns that make section membership explicit data instead of
 * a naming convention:
 *
 *   roles.scope         GLOBAL | VAS | INDIRECT_CHANNEL
 *   permissions.section VAS | INDIRECT_CHANNEL | SHARED
 *
 * roles.scope is the single source of truth for "who is the master admin":
 * GLOBAL means the role administers every section (users, roles, permissions,
 * audit). VAS / INDIRECT_CHANNEL confine the role to that section. Nothing in the
 * codebase keys master-admin behaviour off a role *name* any more.
 *
 * Backfill (first run only, so later edits made in the UI are never clobbered)
 *   permissions : channel_* modules -> INDIRECT_CHANNEL, 'sections' -> SHARED, else VAS
 *   roles       : 'Admin' -> GLOBAL; a role whose permissions are IC-only ->
 *                 INDIRECT_CHANNEL; everything else -> VAS
 *
 * Safe to re-run: the columns are created only when missing, and the backfill does
 * not run again once roles.scope exists.
 *
 *   node src/config/addScopeColumns.js
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

async function ensureColumn(connection, table, column, definition, log) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (rows[0].n > 0) {
    log(`ℹ️  ${table}.${column} already exists`);
    return false;
  }
  await connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  log(`✅ Added ${table}.${column}`);
  return true;
}

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
  });

  const log = (msg) => console.log(msg);
  log('✅ Connected to database');

  // ── 1. Columns ──────────────────────────────────────────────────────────
  await ensureColumn(
    connection, 'roles', 'scope',
    "ENUM('GLOBAL','VAS','INDIRECT_CHANNEL') NOT NULL DEFAULT 'VAS'",
    log
  );
  const scopeColumnAdded = await ensureColumn(
    connection, 'permissions', 'section',
    "ENUM('VAS','INDIRECT_CHANNEL','SHARED') NOT NULL DEFAULT 'VAS'",
    log
  );

  // ── 2. Backfill permissions.section (deterministic, safe to repeat) ─────
  const [permIc] = await connection.query(
    "UPDATE permissions SET section = 'INDIRECT_CHANNEL' WHERE module LIKE 'channel\\\\_%'"
  );
  const [permShared] = await connection.query(
    "UPDATE permissions SET section = 'SHARED' WHERE module = 'sections'"
  );
  const [permVas] = await connection.query(
    "UPDATE permissions SET section = 'VAS' WHERE module NOT LIKE 'channel\\\\_%' AND module <> 'sections'"
  );
  log(`✅ permissions.section — IC: ${permIc.affectedRows}, SHARED: ${permShared.affectedRows}, VAS: ${permVas.affectedRows}`);

  // ── 3. Backfill roles.scope (first run only) ────────────────────────────
  if (scopeColumnAdded) {
    const [roles] = await connection.query(`
      SELECT r.id, r.name,
             COALESCE(SUM(p.section = 'VAS'), 0)              AS vas_perms,
             COALESCE(SUM(p.section = 'INDIRECT_CHANNEL'), 0) AS ic_perms,
             COUNT(rp.id)                                     AS total_perms
      FROM roles r
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN permissions p ON p.id = rp.permission_id
      GROUP BY r.id, r.name
      ORDER BY r.id
    `);

    for (const role of roles) {
      const ic = Number(role.ic_perms) || 0;
      const scope = role.name === 'Admin' ? 'GLOBAL'           // the master admin
        : (ic > 0 && Number(role.vas_perms) === 0) ? 'INDIRECT_CHANNEL'
        : 'VAS';
      await connection.query('UPDATE roles SET scope = ? WHERE id = ?', [scope, role.id]);
    }

    const summary = roles
      .map(r => `${r.name}=${r.name === 'Admin' ? 'GLOBAL' : (Number(r.ic_perms) > 0 && Number(r.vas_perms) === 0 ? 'INDIRECT_CHANNEL' : 'VAS')}`)
      .join(', ');
    await connection.query(
      `INSERT INTO audit_trail (action, entity_type, entity_id, description, user_name)
       VALUES ('update', 'role', 0, ?, 'System')`,
      ['Added role scope + permission section columns; backfilled scopes: ' + summary]
    );
    log('✅ roles.scope backfilled and recorded in the audit trail');
  } else {
    log('ℹ️  roles.scope backfill skipped — existing values are left untouched');
  }

  // ── 4. Report the current state ─────────────────────────────────────────
  const [current] = await connection.query(`
    SELECT r.id, r.name, r.scope,
           COUNT(rp.id)                                      AS total_perms,
           COALESCE(SUM(p.section = 'VAS'), 0)               AS vas_perms,
           COALESCE(SUM(p.section = 'INDIRECT_CHANNEL'), 0)  AS ic_perms
    FROM roles r
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    GROUP BY r.id, r.name, r.scope
    ORDER BY r.scope, r.id
  `);
  log('\nRole scopes now in force:');
  current.forEach(c =>
    log(`   ${String(c.id).padStart(2)}  ${String(c.name).padEnd(22)} ${String(c.scope).padEnd(17)} ${c.total_perms} perms (VAS ${c.vas_perms} / IC ${c.ic_perms})`)
  );

  await connection.end();
  log('\n🎉 Migration complete!');
  process.exit(0);
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
