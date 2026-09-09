const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// GET audit trail
router.get('/', async (req, res) => {
  try {
    const { entity_type, action, start_date, end_date, page = 1, limit = 50 } = req.query;
    let query = 'SELECT * FROM audit_trail WHERE 1=1';
    const params = [];

    if (entity_type) {
      query += ' AND entity_type = ?';
      params.push(entity_type);
    }
    if (action) {
      query += ' AND action = ?';
      params.push(action);
    }
    if (start_date) {
      query += ' AND created_at >= ?';
      params.push(start_date);
    }
    if (end_date) {
      query += ' AND created_at <= ?';
      params.push(end_date);
    }

    const [countResult] = await pool.execute(
      query.replace('SELECT *', 'SELECT COUNT(*) as total'),
      params
    );

    query += ' ORDER BY created_at DESC';
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

module.exports = router;
