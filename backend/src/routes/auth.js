const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'vas-revenue-tracker-secret-key-2026';
const JWT_EXPIRY = '24h';
const RESET_EXPIRY_MINUTES = 30;

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user by email
    const [users] = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.username, u.password_hash, u.role_id, u.department, u.status, u.avatar_url,
              r.name as role_name
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.id
       WHERE u.email = ? OR u.username = ?`,
      [email, email]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = users[0];

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is inactive. Contact your administrator.' });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Update last_login
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

    // Get user permissions
    const [perms] = await pool.query(`
      SELECT p.name, p.module, p.action FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      WHERE rp.role_id = ?
    `, [user.role_id || 0]);

    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, username: user.username, role_id: user.role_id, role_name: user.role_name },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    // Audit trail
    await pool.query(
      'INSERT INTO audit_trail (action, entity_type, entity_id, description, user_name) VALUES (?, ?, ?, ?, ?)',
      ['login', 'user', user.id, `User logged in: ${user.full_name}`, user.username]
    );

    res.json({
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        username: user.username,
        role_id: user.role_id,
        role_name: user.role_name,
        department: user.department,
        avatar_url: user.avatar_url || null,
        permissions: perms,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Find user by email
    const [users] = await pool.query('SELECT id, full_name, email FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      // Don't reveal whether email exists
      return res.json({ message: 'If an account with that email exists, a password reset link has been sent.' });
    }

    const user = users[0];

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + RESET_EXPIRY_MINUTES * 60 * 1000);

    // Store reset token in users table
    await pool.query(
      'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
      [resetToken, resetExpires, user.id]
    );

    // In production, send email here. For now, return the token for testing.
    const resetUrl = `http://localhost:3001/reset-password?token=${resetToken}`;

    // Audit trail
    await pool.query(
      'INSERT INTO audit_trail (action, entity_type, entity_id, description, user_name) VALUES (?, ?, ?, ?, ?)',
      ['forgot_password', 'user', user.id, `Password reset requested for: ${user.email}`, user.username || user.email]
    );

    // TODO: In production, send email with resetUrl
    // For development, return the URL directly
    res.json({
      message: 'If an account with that email exists, a password reset link has been sent.',
      // Dev only — remove in production:
      _dev_reset_url: resetUrl,
      _dev_expires_at: resetExpires,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    // Find user by reset token
    const [users] = await pool.query(
      'SELECT id, full_name, email, reset_token_expires FROM users WHERE reset_token = ?',
      [token]
    );

    if (users.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const user = users[0];

    // Check expiry
    if (new Date(user.reset_token_expires) < new Date()) {
      return res.status(400).json({ error: 'Reset token has expired. Please request a new one.' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(new_password, salt);

    // Update password and clear reset token
    await pool.query(
      'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
      [hashedPassword, user.id]
    );

    // Audit trail
    await pool.query(
      'INSERT INTO audit_trail (action, entity_type, entity_id, description, user_name) VALUES (?, ?, ?, ?, ?)',
      ['reset_password', 'user', user.id, `Password reset completed for: ${user.email}`, user.email]
    );

    res.json({ message: 'Password has been reset successfully. You can now log in with your new password.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/auth/me — verify token and return current user
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const [users] = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.username, u.role_id, u.department, u.status, u.avatar_url,
              r.name as role_name
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.id
       WHERE u.id = ?`,
      [decoded.id]
    );

    if (users.length === 0 || users[0].status !== 'active') {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    const user = users[0];

    // Get permissions
    const [perms] = await pool.query(`
      SELECT p.name, p.module, p.action FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      WHERE rp.role_id = ?
    `, [user.role_id || 0]);

    res.json({
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        username: user.username,
        role_id: user.role_id,
        role_name: user.role_name,
        department: user.department,
        avatar_url: user.avatar_url || null,
        permissions: perms,
      },
    });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/auth/change-password — Change password while logged in ────────
router.post('/change-password', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const [users] = await pool.query('SELECT id, password_hash FROM users WHERE id = ?', [decoded.id]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isMatch = await bcrypt.compare(current_password, users[0].password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(new_password, salt);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hashedPassword, decoded.id]);

    await pool.query(
      'INSERT INTO audit_trail (action, entity_type, entity_id, description, user_name) VALUES (?, ?, ?, ?, ?)',
      ['change_password', 'user', decoded.id, 'User changed their password', decoded.username]
    );

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    res.status(500).json({ error: error.message });
  }
});

// ── POST /api/auth/upload-avatar — Upload profile picture (base64) ──────────
router.post('/upload-avatar', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const { avatar_data } = req.body; // base64 data URL

    if (!avatar_data) {
      return res.status(400).json({ error: 'Avatar data is required' });
    }

    await pool.query('UPDATE users SET avatar_url = ? WHERE id = ?', [avatar_data, decoded.id]);

    res.json({ message: 'Avatar updated', avatar_url: avatar_data });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    res.status(500).json({ error: error.message });
  }
});

// ── DELETE /api/auth/remove-avatar — Remove profile picture ─────────────────
router.delete('/remove-avatar', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    await pool.query('UPDATE users SET avatar_url = NULL WHERE id = ?', [decoded.id]);
    res.json({ message: 'Avatar removed' });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
