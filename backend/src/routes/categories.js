const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requirePermission } = require('../middleware/permissions');

// GET all categories with service count
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.*, COUNT(vs.id) as service_count 
      FROM vas_categories c 
      LEFT JOIN vas_services vs ON vs.category_id = c.id 
      GROUP BY c.id 
      ORDER BY c.name
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET single category
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM vas_categories WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create category
router.post('/', requirePermission('categories.create'), async (req, res) => {
  try {
    const { name, color, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }
    const [result] = await pool.query(
      'INSERT INTO vas_categories (name, color, description) VALUES (?, ?, ?)',
      [name, color || '#6B7280', description || null]
    );

    // Audit trail
    await pool.query(
      'INSERT INTO audit_trail (action, entity_type, entity_id, description, user_name) VALUES (?, ?, ?, ?, ?)',
      ['create', 'category', result.insertId, `Created category: ${name}`, req.body.user_name || 'System']
    );

    const [newCat] = await pool.query('SELECT * FROM vas_categories WHERE id = ?', [result.insertId]);
    res.status(201).json(newCat[0]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Category name already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// PUT update category
router.put('/:id', requirePermission('categories.edit'), async (req, res) => {
  try {
    const { name, color, description } = req.body;
    const [old] = await pool.query('SELECT * FROM vas_categories WHERE id = ?', [req.params.id]);
    if (old.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    await pool.query(
      'UPDATE vas_categories SET name = ?, color = ?, description = ? WHERE id = ?',
      [name, color || '#6B7280', description || null, req.params.id]
    );

    // Audit trail
    await pool.query(
      'INSERT INTO audit_trail (action, entity_type, entity_id, description, user_name, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['update', 'category', req.params.id, `Updated category: ${name}`, req.body.user_name || 'System', JSON.stringify(old[0]), JSON.stringify(req.body)]
    );

    const [updated] = await pool.query('SELECT * FROM vas_categories WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Category name already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// DELETE category (only if no services use it)
router.delete('/:id', requirePermission('categories.delete'), async (req, res) => {
  try {
    const [cat] = await pool.query('SELECT * FROM vas_categories WHERE id = ?', [req.params.id]);
    if (cat.length === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Check if any services use this category
    const [svcs] = await pool.query('SELECT COUNT(*) as cnt FROM vas_services WHERE category_id = ?', [req.params.id]);
    if (svcs[0].cnt > 0) {
      return res.status(400).json({ error: `Cannot delete category "${cat[0].name}" — ${svcs[0].cnt} service(s) are assigned to it. Reassign or remove those services first.` });
    }

    await pool.query('DELETE FROM vas_categories WHERE id = ?', [req.params.id]);

    // Audit trail
    await pool.query(
      'INSERT INTO audit_trail (action, entity_type, entity_id, description, user_name) VALUES (?, ?, ?, ?, ?)',
      ['delete', 'category', req.params.id, `Deleted category: ${cat[0].name}`, req.body?.user_name || 'System']
    );

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
