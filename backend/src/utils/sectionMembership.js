/**
 * Section membership helpers for Chat and Messages.
 *
 * A user's HOME section lives on users.section, but that is not the whole story:
 * a user may also be given a role in another section (user_sections) and, when
 * their home role holds sections.swap and role_section_access lets them reach
 * that section, they can switch into it and work there.
 *
 * Chat and Messages therefore treat a user as present in a section when any of:
 *
 *   0. their home section is NULL, which is this app's marker for a cross-section
 *      user (persons who reach every section via sections.swap +
 *      role_section_access, or section admins whose record carries no single
 *      section). getAvailableSections() and sectionScope() already treat a NULL
 *      section as "every section, unconstrained", so chat and messages must too —
 *      otherwise such a user belongs to no section at all and is missing from
 *      every section-filtered list, in both directions,
 *   1. it is their home section, or
 *   2. they hold a per-section role there whose role grants a permission of the
 *      feature IN THAT SECTION (chat / channel_chat for chat, messages /
 *      channel_messages for messages) and they can actually switch into it, or
 *   3. their own role is scoped to several sections (MULTI_SECTION) and lists this
 *      one among them, granting a permission of the feature for it. Such a role
 *      belongs to each of its sections, so its holders belong there too.
 *
 * Without rule 2 a user with section-switch access never appeared in the other
 * section's chat/recipient lists, so nobody there could start a conversation
 * with them even though they could message everyone else.
 *
 * Rule 2 deliberately keys off permissions.section, the authoritative column for
 * which section a permission belongs to: a VAS role may not be used to appear in
 * Indirect Channel just because it holds a channel_* permission.
 */

const pool = require('../config/database');

// The permission modules that make up each feature, per section:
// VAS uses chat / messages, Indirect Channel mirrors them as channel_*.
const CHAT_MODULES = ['chat', 'channel_chat'];
const MESSAGE_MODULES = ['messages', 'channel_messages'];

const ALL_SECTIONS = ['VAS', 'INDIRECT_CHANNEL'];

const placeholders = (list) => list.map(() => '?').join(',');

/**
 * canReachSectionSql — SQL for "this role may switch into that section".
 *
 * Mirrors POST /api/auth/swap-section: the home role must hold sections.swap, and
 * when the role has any role_section_access rows they must include the section.
 * Exported params are attached by the caller.
 */
function canReachSectionSql(roleIdExpr, sectionExpr) {
  return `(
    EXISTS (
      SELECT 1 FROM role_permissions hrp
      JOIN permissions hp ON hp.id = hrp.permission_id
      WHERE hrp.role_id = ${roleIdExpr} AND hp.name = 'sections.swap'
    )
    AND (
      NOT EXISTS (SELECT 1 FROM role_section_access rsa WHERE rsa.role_id = ${roleIdExpr})
      OR EXISTS (
        SELECT 1 FROM role_section_access rsa2
        WHERE rsa2.role_id = ${roleIdExpr} AND rsa2.section = ${sectionExpr}
      )
    )
  )`;
}

/**
 * crossSectionMembershipSql — SQL for "this user works in one of `sections` for
 * `modules`": a per-section role assignment carrying a permission of the feature
 * for that same section, in a section the user can actually switch into.
 *
 * `alias` is the users table alias the predicate is evaluated against, so it can
 * be dropped into any query that joins users.
 */
function crossSectionMembershipSql(alias, sections, modules) {
  const sql = `EXISTS (
    SELECT 1
    FROM user_sections us
    JOIN role_permissions srp ON srp.role_id = us.role_id
    JOIN permissions sp ON sp.id = srp.permission_id
    WHERE us.user_id = ${alias}.id
      AND us.section IN (${placeholders(sections)})
      AND sp.section = us.section
      AND sp.module IN (${placeholders(modules)})
      AND ${canReachSectionSql(`${alias}.role_id`, 'us.section')}
  )`;
  return { sql, params: [...sections, ...modules] };
}

/**
 * multiSectionRoleMembershipSql — SQL for "this user's own role spans one of
 * `sections`": a MULTI_SECTION role belongs to every section listed for it in
 * role_section_access, and shows up in one of them for whichever features its
 * configured permissions cover for that section.
 */
function multiSectionRoleMembershipSql(alias, sections, modules) {
  const sql = `EXISTS (
    SELECT 1
    FROM role_section_access rsa
    JOIN roles mr ON mr.id = rsa.role_id AND mr.scope = 'MULTI_SECTION'
    JOIN role_permissions mrp ON mrp.role_id = rsa.role_id
    JOIN permissions mp ON mp.id = mrp.permission_id
    WHERE rsa.role_id = ${alias}.role_id
      AND rsa.section IN (${placeholders(sections)})
      AND mp.section = rsa.section
      AND mp.module IN (${placeholders(modules)})
  )`;
  return { sql, params: [...sections, ...modules] };
}

/**
 * memberOfSectionSql — SQL for "this user shows up in one of `sections` for the
 * feature": they are a cross-section user, it is their home section, they can cross
 * into it, or their role is scoped to it.
 *
 * Returns { sql, params } for use with pool.execute/pool.query.
 */
function memberOfSectionSql(alias, sections, modules) {
  const cross = crossSectionMembershipSql(alias, sections, modules);
  const multi = multiSectionRoleMembershipSql(alias, sections, modules);
  return {
    sql: `(${alias}.section IS NULL OR ${alias}.section IN (${placeholders(sections)}) OR ${cross.sql} OR ${multi.sql})`,
    params: [...sections, ...cross.params, ...multi.params],
  };
}

/**
 * reachableSections — the extra sections a user may operate in for a feature,
 * beyond the one they are currently in.
 *
 * Used to widen the caller's own scope: a user sitting in VAS who has been given
 * a role with chat permissions in Indirect Channel can chat there too.
 */
async function reachableSections(userId, modules) {
  const [rows] = await pool.execute(
    `SELECT DISTINCT us.section
     FROM user_sections us
     JOIN users u ON u.id = us.user_id
     WHERE us.user_id = ?
       AND EXISTS (
         SELECT 1 FROM role_permissions rp
         JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id = us.role_id
           AND p.section = us.section
           AND p.module IN (${placeholders(modules)})
       )
       AND ${canReachSectionSql('u.role_id', 'us.section')}`,
    [userId, ...modules]
  );
  return rows.map(r => r.section);
}

/**
 * allowedSectionsFor — the full set of sections a caller may see the feature in,
 * or null when they are unconstrained (cross-section / GLOBAL scope user).
 */
async function allowedSectionsFor(userId, currentSection, modules) {
  if (!currentSection) return null;
  const extra = await reachableSections(userId, modules);
  return [...new Set([currentSection, ...extra])];
}

module.exports = {
  CHAT_MODULES,
  MESSAGE_MODULES,
  ALL_SECTIONS,
  memberOfSectionSql,
  reachableSections,
  allowedSectionsFor,
};
