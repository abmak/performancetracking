const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// GET all permissions grouped by module
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM permissions ORDER BY module, action');
    // Group by module
    const grouped = {};
    rows.forEach(p => {
      if (!grouped[p.module]) grouped[p.module] = [];
      grouped[p.module].push(p);
    });
    res.json({ all: rows, grouped });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create custom permission
router.post('/', async (req, res) => {
  try {
    const { name, description, module, action } = req.body;
    if (!name || !module || !action) {
      return res.status(400).json({ error: 'Name, module, and action are required' });
    }
    const [result] = await pool.query(
      'INSERT INTO permissions (name, description, module, action) VALUES (?, ?, ?, ?)',
      [name, description || null, module, action]
    );
    const [newPerm] = await pool.query('SELECT * FROM permissions WHERE id = ?', [result.insertId]);
    res.status(201).json(newPerm[0]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Permission name already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// DELETE permission (only if not assigned to any role)
router.delete('/:id', async (req, res) => {
  try {
    const [perm] = await pool.query('SELECT * FROM permissions WHERE id = ?', [req.params.id]);
    if (perm.length === 0) {
      return res.status(404).json({ error: 'Permission not found' });
    }
    const [roles] = await pool.query('SELECT COUNT(*) as cnt FROM role_permissions WHERE permission_id = ?', [req.params.id]);
    if (roles[0].cnt > 0) {
      return res.status(400).json({ error: `Cannot delete permission "${perm[0].name}" — assigned to ${roles[0].cnt} role(s). Remove from roles first.` });
    }
    await pool.query('DELETE FROM permissions WHERE id = ?', [req.params.id]);
    res.json({ message: 'Permission deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
