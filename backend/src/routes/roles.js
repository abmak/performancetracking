const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requirePermission } = require('../middleware/permissions');

// GET all roles with permission count
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT r.*, 
        COUNT(rp.id) as permission_count,
        (SELECT COUNT(*) FROM users WHERE role_id = r.id) as user_count
      FROM roles r
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      GROUP BY r.id
      ORDER BY r.name
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET single role with its permissions
router.get('/:id', async (req, res) => {
  try {
    const [roles] = await pool.query('SELECT * FROM roles WHERE id = ?', [req.params.id]);
    if (roles.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }
    const [perms] = await pool.query(`
      SELECT p.* FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      WHERE rp.role_id = ?
      ORDER BY p.module, p.action
    `, [req.params.id]);
    
    res.json({ ...roles[0], permissions: perms });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create role
router.post('/', requirePermission('roles.create'), async (req, res) => {
  try {
    const { name, description, is_default, permission_ids } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Role name is required' });
    }
    const [result] = await pool.query(
      'INSERT INTO roles (name, description, is_default) VALUES (?, ?, ?)',
      [name, description || null, is_default ? 1 : 0]
    );
    
    // Assign permissions
    if (permission_ids && permission_ids.length > 0) {
      for (const pid of permission_ids) {
        await pool.query('INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [result.insertId, pid]);
      }
    }
    
    // Audit trail
    await pool.query(
      'INSERT INTO audit_trail (action, entity_type, entity_id, description, user_name, new_value) VALUES (?, ?, ?, ?, ?, ?)',
      ['create', 'role', result.insertId, `Created role: ${name}`, req.body.user_name || 'System', JSON.stringify(req.body)]
    );
    
    const [newRole] = await pool.query('SELECT * FROM roles WHERE id = ?', [result.insertId]);
    res.status(201).json(newRole[0]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Role name already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// PUT update role
router.put('/:id', requirePermission('roles.edit'), async (req, res) => {
  try {
    const { name, description, is_default, permission_ids } = req.body;
    const [old] = await pool.query('SELECT * FROM roles WHERE id = ?', [req.params.id]);
    if (old.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }
    
    await pool.query(
      'UPDATE roles SET name = ?, description = ?, is_default = ? WHERE id = ?',
      [name, description || null, is_default ? 1 : 0, req.params.id]
    );
    
    // Update permissions: delete all, re-insert
    if (permission_ids !== undefined) {
      await pool.query('DELETE FROM role_permissions WHERE role_id = ?', [req.params.id]);
      if (permission_ids.length > 0) {
        for (const pid of permission_ids) {
          await pool.query('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [req.params.id, pid]);
        }
      }
    }
    
    // Audit trail
    await pool.query(
      'INSERT INTO audit_trail (action, entity_type, entity_id, description, user_name, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['update', 'role', req.params.id, `Updated role: ${name}`, req.body.user_name || 'System', JSON.stringify(old[0]), JSON.stringify(req.body)]
    );
    
    const [updated] = await pool.query('SELECT * FROM roles WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Role name already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// DELETE role (only if no users assigned)
router.delete('/:id', requirePermission('roles.delete'), async (req, res) => {
  try {
    const [role] = await pool.query('SELECT * FROM roles WHERE id = ?', [req.params.id]);
    if (role.length === 0) {
      return res.status(404).json({ error: 'Role not found' });
    }
    if (role[0].is_default) {
      return res.status(400).json({ error: `Cannot delete default role "${role[0].name}". Unset default first.` });
    }
    
    // Check if any users have this role
    const [users] = await pool.query('SELECT COUNT(*) as cnt FROM users WHERE role_id = ?', [req.params.id]);
    if (users[0].cnt > 0) {
      return res.status(400).json({ error: `Cannot delete role "${role[0].name}" — ${users[0].cnt} user(s) are assigned to it. Reassign them first.` });
    }
    
    await pool.query('DELETE FROM role_permissions WHERE role_id = ?', [req.params.id]);
    await pool.query('DELETE FROM roles WHERE id = ?', [req.params.id]);
    
    // Audit trail
    await pool.query(
      'INSERT INTO audit_trail (action, entity_type, entity_id, description, user_name) VALUES (?, ?, ?, ?, ?)',
      ['delete', 'role', req.params.id, `Deleted role: ${role[0].name}`, req.body?.user_name || 'System']
    );
    
    res.json({ message: 'Role deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
