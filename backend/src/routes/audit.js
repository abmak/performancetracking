const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// GET audit trail
// The optional `section` param cross-references audit entries against the
// entities that belong to that section: users whose section matches, roles
// assigned to users in that section, and non-user/non-role entries (which
// default to VAS).
router.get('/', async (req, res) => {
  try {
    const { entity_type, action, start_date, end_date, section, page = 1, limit = 50 } = req.query;
    let query = 'SELECT at2.* FROM audit_trail at2 WHERE 1=1';
    const params = [];

    if (entity_type) {
      query += ' AND at2.entity_type = ?';
      params.push(entity_type);
    }
    if (action) {
      query += ' AND at2.action = ?';
      params.push(action);
    }
    if (start_date) {
      query += ' AND at2.created_at >= ?';
      params.push(start_date);
    }
    if (end_date) {
      query += ' AND at2.created_at <= ?';
      params.push(end_date);
    }

    // Section-based filtering: only applies when a section is requested and
    // the caller is not a super admin (who sees everything).
    if (section) {
      query += ` AND (
        (at2.entity_type IN ('user', 'user_section') AND at2.entity_id IN (
          SELECT u.id FROM users u WHERE u.section = ?
        ))
        OR (at2.entity_type = 'role' AND at2.entity_id IN (
          SELECT DISTINCT u.role_id FROM users u WHERE u.section = ? AND u.role_id IS NOT NULL
        ))
        OR (at2.entity_type NOT IN ('user', 'user_section', 'role') AND at2.entity_type NOT LIKE 'channel_%')
      )`;
      params.push(section, section);
    }

    const [countResult] = await pool.execute(
      query.replace('SELECT at2.*', 'SELECT COUNT(*) as total'),
      params
    );

    query += ' ORDER BY at2.created_at DESC';
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
