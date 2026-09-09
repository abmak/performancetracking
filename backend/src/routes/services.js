const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requirePermission } = require('../middleware/permissions');

// GET all services (with category name)
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT vs.*, vc.name as category_name, vc.color as category_color 
       FROM vas_services vs 
       LEFT JOIN vas_categories vc ON vs.category_id = vc.id 
       ORDER BY vs.created_at DESC`
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET single service with revenue summary
router.get('/:id', async (req, res) => {
  try {
    const [service] = await pool.execute(
      'SELECT * FROM vas_services WHERE id = ?',
      [req.params.id]
    );
    if (service.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    res.json(service[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create service
router.post('/', requirePermission('services.create'), async (req, res) => {
  try {
    const { name, code, description, category_id, category, status } = req.body;
    const [result] = await pool.execute(
      'INSERT INTO vas_services (name, code, description, category_id, status) VALUES (?, ?, ?, ?, ?)',
      [name, code, description, category_id || null, status || 'active']
    );

    // Audit trail
    await pool.execute(
      'INSERT INTO audit_trail (action, entity_type, entity_id, description, user_name) VALUES (?, ?, ?, ?, ?)',
      ['create', 'service', result.insertId, `Created service: ${name}`, req.body.user_name || 'System']
    );

    const [newService] = await pool.execute('SELECT * FROM vas_services WHERE id = ?', [result.insertId]);
    res.status(201).json(newService[0]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Service code already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// PUT update service
router.put('/:id', requirePermission('services.edit'), async (req, res) => {
  try {
    const { name, code, description, category_id, category, status } = req.body;
    
    // Get old value for audit
    const [old] = await pool.execute('SELECT * FROM vas_services WHERE id = ?', [req.params.id]);
    
    await pool.execute(
      'UPDATE vas_services SET name = ?, code = ?, description = ?, category_id = ?, status = ? WHERE id = ?',
      [name, code, description, category_id || null, status || 'active', req.params.id]
    );

    // Audit trail
    await pool.execute(
      'INSERT INTO audit_trail (action, entity_type, entity_id, description, user_name, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['update', 'service', req.params.id, `Updated service: ${name}`, req.body.user_name || 'System', JSON.stringify(old[0]), JSON.stringify(req.body)]
    );

    const [updated] = await pool.execute('SELECT * FROM vas_services WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE service (with target check)
router.delete('/:id', requirePermission('services.delete'), async (req, res) => {
  try {
    const [service] = await pool.execute('SELECT * FROM vas_services WHERE id = ?', [req.params.id]);
    if (service.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Check if service has any revenue targets
    const [targets] = await pool.execute(
      'SELECT COUNT(*) as cnt FROM revenue_targets WHERE service_id = ?',
      [req.params.id]
    );
    if (targets[0].cnt > 0) {
      return res.status(400).json({
        error: `Cannot delete "${service[0].name}" — it has ${targets[0].cnt} revenue target(s). Remove or reassign the targets first.`
      });
    }

    await pool.execute('DELETE FROM vas_services WHERE id = ?', [req.params.id]);

    // Audit trail
    await pool.execute(
      'INSERT INTO audit_trail (action, entity_type, entity_id, description, user_name) VALUES (?, ?, ?, ?, ?)',
      ['delete', 'service', req.params.id, `Deleted service: ${service[0].name}`, req.body?.user_name || 'System']
    );

    res.json({ message: 'Service deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
