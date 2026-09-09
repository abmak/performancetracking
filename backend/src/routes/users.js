const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const { requirePermission } = require('../middleware/permissions');

// GET all users with role info
router.get('/', async (req, res) => {
  try {
    const { role_id, status, search } = req.query;
    let query = `
      SELECT u.id, u.full_name, u.email, u.username, u.role_id, u.department, u.section, u.division, u.phone, 
             u.status, u.last_login, u.created_at,
             COALESCE(u.max_ai_questions_per_day, 50) as max_ai_questions_per_day,
             r.name as role_name, r.description as role_description
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE 1=1
    `;
    const params = [];
    
    if (role_id) {
      query += ' AND u.role_id = ?';
      params.push(role_id);
    }
    if (status) {
      query += ' AND u.status = ?';
      params.push(status);
    }
    if (search) {
      query += ' AND (u.full_name LIKE ? OR u.email LIKE ? OR u.username LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    query += ' ORDER BY u.created_at DESC';
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET single user with role and permissions
router.get('/:id', async (req, res) => {
  try {
    const [users] = await pool.query(`
      SELECT u.id, u.full_name, u.email, u.username, u.role_id, u.department, u.section, u.division, u.phone,
             u.status, u.last_login, u.created_at,
             COALESCE(u.max_ai_questions_per_day, 50) as max_ai_questions_per_day,
             r.name as role_name
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = ?
    `, [req.params.id]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get user's role permissions
    const [perms] = await pool.query(`
      SELECT p.* FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      WHERE rp.role_id = ?
      ORDER BY p.module, p.action
    `, [users[0].role_id || 0]);
    
    res.json({ ...users[0], permissions: perms });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create user
router.post('/', requirePermission('users.create'), async (req, res) => {
  try {
    const { full_name, email, username, password_hash, role_id, department, section, division, phone, status, max_ai_questions_per_day } = req.body;
    if (!full_name || !email || !username || !password_hash) {
      return res.status(400).json({ error: 'Full name, email, username, and password are required' });
    }
    
    // Hash password with bcrypt before storing
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password_hash, salt);
    
    const [result] = await pool.query(
      'INSERT INTO users (full_name, email, username, password_hash, role_id, department, section, division, phone, status, max_ai_questions_per_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [full_name, email, username, hashedPassword, role_id || null, department || null, section || null, division || null, phone || null, status || 'active', max_ai_questions_per_day || 50]
    );
    
    // Audit trail
    await pool.query(
      'INSERT INTO audit_trail (action, entity_type, entity_id, description, user_name, new_value) VALUES (?, ?, ?, ?, ?, ?)',
      ['create', 'user', result.insertId, `Created user: ${full_name} (${username})`, req.body.created_by || 'System', JSON.stringify({ ...req.body, password_hash: '***' })]
    );
    
    const [newUser] = await pool.query(`
      SELECT u.id, u.full_name, u.email, u.username, u.role_id, u.department, u.section, u.division, u.phone, u.status, u.created_at,
             r.name as role_name
      FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = ?
    `, [result.insertId]);
    res.status(201).json(newUser[0]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Email or username already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// PUT update user
router.put('/:id', requirePermission('users.edit'), async (req, res) => {
  try {
    const { full_name, email, username, password_hash, role_id, department, section, division, phone, status, max_ai_questions_per_day } = req.body;
    const [old] = await pool.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (old.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // If password is provided, update it; otherwise keep existing
    if (password_hash && password_hash !== '***') {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password_hash, salt);
      await pool.query(
        'UPDATE users SET full_name = ?, email = ?, username = ?, password_hash = ?, role_id = ?, department = ?, section = ?, division = ?, phone = ?, status = ?, max_ai_questions_per_day = ? WHERE id = ?',
        [full_name, email, username, hashedPassword, role_id || null, department || null, section || null, division || null, phone || null, status || 'active', max_ai_questions_per_day || 50, req.params.id]
      );
    } else {
      await pool.query(
        'UPDATE users SET full_name = ?, email = ?, username = ?, role_id = ?, department = ?, section = ?, division = ?, phone = ?, status = ?, max_ai_questions_per_day = ? WHERE id = ?',
        [full_name, email, username, role_id || null, department || null, section || null, division || null, phone || null, status || 'active', max_ai_questions_per_day || 50, req.params.id]
      );
    }
    
    // Audit trail
    await pool.query(
      'INSERT INTO audit_trail (action, entity_type, entity_id, description, user_name, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['update', 'user', req.params.id, `Updated user: ${full_name}`, req.body.updated_by || 'System', JSON.stringify(old[0]), JSON.stringify({ ...req.body, password_hash: '***' })]
    );
    
    const [updated] = await pool.query(`
      SELECT u.id, u.full_name, u.email, u.username, u.role_id, u.department, u.phone, u.status, u.created_at,
             COALESCE(u.max_ai_questions_per_day, 50) as max_ai_questions_per_day,
             r.name as role_name
      FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = ?
    `, [req.params.id]);
    res.json(updated[0]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Email or username already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// DELETE user
router.delete('/:id', requirePermission('users.delete'), async (req, res) => {
  try {
    const [user] = await pool.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (user.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    // Prevent deleting the last admin
    if (user[0].role_id) {
      const [role] = await pool.query('SELECT name FROM roles WHERE id = ?', [user[0].role_id]);
      if (role.length > 0 && role[0].name === 'Admin') {
        const [adminCount] = await pool.query(`
          SELECT COUNT(*) as cnt FROM users u 
          JOIN roles r ON u.role_id = r.id 
          WHERE r.name = 'Admin' AND u.status = 'active'
        `);
        if (adminCount[0].cnt <= 1) {
          return res.status(400).json({ error: 'Cannot delete the last active admin user' });
        }
      }
    }
    
    await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    
    // Audit trail
    await pool.query(
      'INSERT INTO audit_trail (action, entity_type, entity_id, description, user_name) VALUES (?, ?, ?, ?, ?)',
      ['delete', 'user', req.params.id, `Deleted user: ${user[0].full_name} (${user[0].username})`, req.body?.user_name || 'System']
    );
    
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
