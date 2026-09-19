const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { rolePermissions } = require('../utils/rolePermissions');

const JWT_SECRET = process.env.JWT_SECRET || 'vas-revenue-tracker-secret-key-2026';

/**
 * authenticate — verifies JWT and attaches user + permissions to req.user
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query.token) {
      token = req.query.token;
    }
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const decoded = jwt.verify(token, JWT_SECRET);

    // Use role_id from JWT (section-specific after swap) instead of users table
    const jwtRoleId = decoded.role_id || null;
    const jwtSection = decoded.section || null;
    const jwtRoleName = decoded.role_name || null;

    // Get user info from DB
    const [users] = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.username, u.role_id as default_role_id,
              u.status, u.department, u.section, u.division, u.avatar_url,
              u.max_ai_questions_per_day
       FROM users u
       WHERE u.id = ? AND u.status = 'active'`,
      [decoded.id]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    const user = users[0];
    // Use JWT role_id (section-specific) or fall back to default
    const effectiveRoleId = jwtRoleId || user.default_role_id;

    // Resolve the effective role's name and scope. Scope is the authoritative
    // signal for section access: GLOBAL is the master admin (every section).
    let effectiveRoleName = jwtRoleName;
    let effectiveRoleScope = null;
    if (effectiveRoleId) {
      const [roleRows] = await pool.query('SELECT name, scope FROM roles WHERE id = ?', [effectiveRoleId]);
      effectiveRoleName = effectiveRoleName || roleRows[0]?.name || null;
      effectiveRoleScope = roleRows[0]?.scope || null;
    }

    // Get permissions based on effective (section-specific) role. A MULTI_SECTION
    // role is narrowed to the section this token carries, so one role confers
    // different rights in each of its sections.
    const perms = await rolePermissions(effectiveRoleId, {
      scope: effectiveRoleScope,
      section: jwtSection,
    });

    req.user = {
      ...user,
      role_id: effectiveRoleId,
      role_name: effectiveRoleName,
      role_scope: effectiveRoleScope,
      section: jwtSection,
      permissions: perms,
      permissionNames: perms.map(p => p.name),
    };

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * requirePermission(...permissionNames) — checks user has at least one of the listed permissions
 * Must be used AFTER authenticate middleware
 */
function requirePermission(...permissionNames) {
  return (req, res, next) => {
    if (!req.user || !req.user.permissionNames) {
      return res.status(403).json({ error: 'No permissions loaded' });
    }

    const hasPermission = permissionNames.some(name => req.user.permissionNames.includes(name));
    if (!hasPermission) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: permissionNames,
        message: `You need one of: ${permissionNames.join(', ')}`,
      });
    }

    next();
  };
}

/**
 * requireAllPermissions(...permissionNames) — checks user has ALL listed permissions
 */
function requireAllPermissions(...permissionNames) {
  return (req, res, next) => {
    if (!req.user || !req.user.permissionNames) {
      return res.status(403).json({ error: 'No permissions loaded' });
    }

    const missing = permissionNames.filter(name => !req.user.permissionNames.includes(name));
    if (missing.length > 0) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        missing,
        message: `Missing permissions: ${missing.join(', ')}`,
      });
    }

    next();
  };
}

/**
 * isMasterAdmin(req) — true when the caller's effective role carries GLOBAL scope.
 *
 * This is the single definition of "master admin". It is deliberately a property of
 * the ROLE (roles.scope), not of a user or a role name, so renaming roles never
 * changes who holds master-admin capability.
 */
function isMasterAdmin(req) {
  return req.user?.role_scope === 'GLOBAL';
}

/**
 * sectionScope(req) — the section a caller is confined to, or null when unconstrained.
 *
 * The master admin (GLOBAL-scope role) and cross-section users manage every section; a
 * section admin is confined to their own section. Used to stop one section's admin
 * from modifying another section's population.
 */
function sectionScope(req) {
  const user = req.user;
  if (!user) return null;
  // GLOBAL scope (the master admin) and cross-section users see every section
  if (isMasterAdmin(req) || !user.section) return null;
  return user.section;
}

module.exports = {
  authenticate,
  requirePermission,
  requireAllPermissions,
  sectionScope,
  isMasterAdmin,
};
