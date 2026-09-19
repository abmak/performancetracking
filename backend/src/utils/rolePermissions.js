/**
 * rolePermissions — the permissions a role actually confers in a given section.
 *
 * A single-section role (VAS / INDIRECT_CHANNEL) and a GLOBAL one carry all of
 * their permissions wherever the user happens to be. A MULTI_SECTION role is the
 * exception: it is configured with permissions for several sections at once, and
 * inside one of them only the permissions belonging to that section (plus shared
 * ones) apply. That is what makes one role grant different rights per section —
 * VAS permissions in VAS, channel_* permissions in Indirect Channel — from the
 * admin's permission selections alone.
 *
 * When no section is resolved (a cross-section user who has not chosen one yet)
 * nothing is filtered out, so the user is never left with an empty interface.
 */

const pool = require('../config/database');

async function rolePermissions(roleId, { scope, section } = {}) {
  const scoped = scope === 'MULTI_SECTION' && !!section;

  const sql = scoped
    ? `SELECT p.name, p.module, p.action FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       WHERE rp.role_id = ? AND (p.section = ? OR p.section = 'SHARED')`
    : `SELECT p.name, p.module, p.action FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       WHERE rp.role_id = ?`;

  const [rows] = await pool.execute(sql, scoped ? [roleId || 0, section] : [roleId || 0]);
  return rows;
}

/**
 * roleSections — the sections a role is scoped to. Only MULTI_SECTION roles answer
 * with their role_section_access rows; other scopes return null so callers keep
 * their existing single-section behaviour.
 */
async function roleSections(roleId, scope) {
  if (scope !== 'MULTI_SECTION') return null;
  const [rows] = await pool.execute(
    'SELECT section FROM role_section_access WHERE role_id = ?',
    [roleId || 0]
  );
  return rows.map(r => r.section);
}

module.exports = { rolePermissions, roleSections };
