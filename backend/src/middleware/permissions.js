const jwt = require('jsonwebtoken');
const pool = require('../config/database');

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

    // Get user with permissions
    const [users] = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.username, u.role_id, u.status,
              r.name as role_name
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.id
       WHERE u.id = ? AND u.status = 'active'`,
      [decoded.id]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    const user = users[0];

    // Get permissions
    const [perms] = await pool.query(
      `SELECT p.name, p.module, p.action FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       WHERE rp.role_id = ?`,
      [user.role_id || 0]
    );

    req.user = {
      ...user,
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

module.exports = { authenticate, requirePermission, requireAllPermissions };
