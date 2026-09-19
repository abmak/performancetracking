/**
 * addMultiSectionScope — lets one role belong to several sections at once.
 *
 * roles.scope gains the value MULTI_SECTION ("Different Sections" in the Roles UI):
 * the role belongs to every section listed for it in role_section_access. A user
 * holding such a role may enter each of those sections, and inside one of them
 * carries only the role's permissions that belong to that section (plus shared
 * ones) — so a single role grants different rights per section, driven entirely by
 * the permissions configured for it.
 *
 * role_section_access is reused as the role -> sections mapping: it already has the
 * right shape (role_id, section, unique key) and is the same table the master admin
 * edits for section access. Rows are only read as "the role's sections" when the
 * role's scope is MULTI_SECTION.
 *
 * Safe to re-run: the column is only altered while MULTI_SECTION is missing.
 *
 *   node src/config/addMultiSectionScope.js
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

const NEW_DEFINITION = "ENUM('GLOBAL','VAS','INDIRECT_CHANNEL','MULTI_SECTION') NOT NULL DEFAULT 'VAS'";

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

  const [cols] = await connection.query(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roles' AND COLUMN_NAME = 'scope'`
  );

  if (cols.length === 0) {
    log('❌ roles.scope does not exist — run src/config/addScopeColumns.js first');
    await connection.end();
    process.exit(1);
  }

  if (String(cols[0].COLUMN_TYPE).includes('MULTI_SECTION')) {
    log('ℹ️  roles.scope already supports MULTI_SECTION — nothing to do');
  } else {
    log(`   current: ${cols[0].COLUMN_TYPE}`);
    await connection.query(`ALTER TABLE roles MODIFY COLUMN scope ${NEW_DEFINITION}`);
    log(`✅ roles.scope now: ${NEW_DEFINITION}`);

    await connection.query(
      `INSERT INTO audit_trail (action, entity_type, entity_id, description, user_name)
       VALUES ('update', 'role', 0, ?, 'System')`,
      ['Added MULTI_SECTION to roles.scope so a role can span several sections']
    );
    log('✅ Recorded in the audit trail');
  }

  const [current] = await connection.query(
    `SELECT r.id, r.name, r.scope,
            (SELECT GROUP_CONCAT(rsa.section ORDER BY rsa.section)
               FROM role_section_access rsa WHERE rsa.role_id = r.id) AS sections
     FROM roles r ORDER BY r.scope, r.id`
  );
  log('\nRole scopes now in force:');
  current.forEach(c =>
    log(`   ${String(c.id).padStart(2)}  ${String(c.name).padEnd(24)} ${String(c.scope).padEnd(17)} ${c.sections || '—'}`)
  );

  await connection.end();
  log('\n🎉 Migration complete!');
  process.exit(0);
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
});
