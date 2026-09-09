const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { requirePermission } = require('../middleware/permissions');

// GET all revenue entries (monthly basis)
router.get('/', async (req, res) => {
  try {
    const { service_id, revenue_month, source, page = 1, limit = 50 } = req.query;
    let query = `
      SELECT ar.*, vs.name as service_name, vs.code as service_code
      FROM actual_revenue ar
      JOIN vas_services vs ON ar.service_id = vs.id
      WHERE 1=1
    `;
    const params = [];

    if (service_id) { query += ' AND ar.service_id = ?'; params.push(service_id); }
    if (revenue_month) { query += ' AND ar.revenue_month = ?'; params.push(revenue_month); }
    if (source) { query += ' AND ar.source = ?'; params.push(source); }

    const [countResult] = await pool.execute(
      query.replace('SELECT ar.*, vs.name as service_name, vs.code as service_code', 'SELECT COUNT(*) as total'),
      params
    );

    query += ' ORDER BY ar.created_at DESC';
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query += ` LIMIT ${parseInt(limit)} OFFSET ${offset}`;

    const [rows] = await pool.execute(query, params);
    res.json({
      data: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: countResult[0].total,
        pages: Math.ceil(countResult[0].total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create revenue entry (monthly basis)
router.post('/', requirePermission('revenue.create'), async (req, res) => {
  try {
    const { service_id, partner_name, amount, revenue_month, entered_by, notes } = req.body;
    const [result] = await pool.execute(
      'INSERT INTO actual_revenue (service_id, partner_name, amount, revenue_month, source, entered_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [service_id, partner_name || null, amount, revenue_month, 'manual', entered_by || null, notes || null]
    );

    // Audit trail
    await pool.execute(
      'INSERT INTO audit_trail (action, entity_type, entity_id, description, user_name, new_value) VALUES (?, ?, ?, ?, ?, ?)',
      ['create', 'revenue', result.insertId, `Manual revenue entry: ${amount} ETB for ${revenue_month}`, entered_by || 'System', JSON.stringify(req.body)]
    );

    const [newEntry] = await pool.execute(
      `SELECT ar.*, vs.name as service_name FROM actual_revenue ar
       JOIN vas_services vs ON ar.service_id = vs.id WHERE ar.id = ?`,
      [result.insertId]
    );
    res.status(201).json(newEntry[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update revenue entry
router.put('/:id', requirePermission('revenue.edit'), async (req, res) => {
  try {
    const { service_id, partner_name, amount, revenue_month, notes } = req.body;
    await pool.execute(
      'UPDATE actual_revenue SET service_id = ?, partner_name = ?, amount = ?, revenue_month = ?, notes = ? WHERE id = ?',
      [service_id, partner_name || null, amount, revenue_month, notes, req.params.id]
    );
    const [updated] = await pool.execute(
      `SELECT ar.*, vs.name as service_name FROM actual_revenue ar
       JOIN vas_services vs ON ar.service_id = vs.id WHERE ar.id = ?`,
      [req.params.id]
    );
    res.json(updated[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE revenue entry
router.delete('/:id', requirePermission('revenue.delete'), async (req, res) => {
  try {
    await pool.execute('DELETE FROM actual_revenue WHERE id = ?', [req.params.id]);
    res.json({ message: 'Revenue entry deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET monthly revenue summary
router.get('/summary', async (req, res) => {
  try {
    const { revenue_month } = req.query;
    let whereClause = '';
    const params = [];
    if (revenue_month) {
      whereClause = 'WHERE ar.revenue_month = ?';
      params.push(revenue_month);
    }
    const [rows] = await pool.execute(
      `SELECT 
        vs.id as service_id,
        vs.name as service_name,
        vs.code as service_code,
        COALESCE(SUM(ar.amount), 0) as total_revenue,
        COUNT(ar.id) as entry_count
       FROM vas_services vs
       LEFT JOIN actual_revenue ar ON vs.id = ar.service_id ${whereClause}
       WHERE vs.status = 'active'
       GROUP BY vs.id, vs.name, vs.code
       ORDER BY total_revenue DESC`,
      params
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET available months
router.get('/months', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT DISTINCT revenue_month, SUM(amount) as total_revenue, COUNT(*) as entry_count
       FROM actual_revenue
       GROUP BY revenue_month
       ORDER BY revenue_month DESC`
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
