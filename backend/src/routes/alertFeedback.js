const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// GET all feedback for a service (with reactions and replies)
router.get('/', async (req, res) => {
  try {
    const { service_name } = req.query;
    let query = `SELECT af.*, u.full_name as author_name, u.avatar_url as author_avatar,
      (SELECT COUNT(*) FROM feedback_reactions fr WHERE fr.feedback_id = af.id) as reaction_count,
      (SELECT COUNT(*) FROM feedback_replies frep WHERE frep.feedback_id = af.id) as reply_count
      FROM alert_feedback af LEFT JOIN users u ON af.created_by = u.id`;
    const params = [];
    if (service_name) {
      query += ' WHERE af.service_name = ?';
      params.push(service_name);
    }
    query += ' ORDER BY af.created_at DESC';
    const [rows] = await pool.execute(query, params);
    // Fetch per-type reaction counts for all feedbacks
    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      const ph = ids.map(() => '?').join(',');
      const [reactionRows] = await pool.execute(
        `SELECT feedback_id, reaction_type, COUNT(*) as cnt FROM feedback_reactions WHERE feedback_id IN (${ph}) GROUP BY feedback_id, reaction_type`, ids
      );
      // Attach reaction_types map to each row
      const reactionMap = {};
      reactionRows.forEach(rr => {
        if (!reactionMap[rr.feedback_id]) reactionMap[rr.feedback_id] = {};
        reactionMap[rr.feedback_id][rr.reaction_type] = rr.cnt;
      });
      rows.forEach(row => { row.reaction_types = reactionMap[row.id] || {}; });
    }
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET feedback summary counts per service
router.get('/summary', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT service_name, 
              COUNT(*) as total_feedback,
              SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count,
              SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END) as reviewed_count,
              SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_count,
              MAX(created_at) as latest_feedback
       FROM alert_feedback 
       GROUP BY service_name`
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET reactions for a feedback
router.get('/:id/reactions', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT fr.*, u.full_name as author_name, u.avatar_url as author_avatar FROM feedback_reactions fr
       LEFT JOIN users u ON fr.user_id = u.id WHERE fr.feedback_id = ?
       ORDER BY fr.created_at DESC`, [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST toggle reaction (add or remove)
router.post('/:id/reactions', async (req, res) => {
  try {
    const { reaction_type, user_id } = req.body;
    const feedback_id = req.params.id;
    // Check if already reacted with this type
    const [existing] = await pool.execute(
      'SELECT id FROM feedback_reactions WHERE feedback_id = ? AND user_id = ? AND reaction_type = ?',
      [feedback_id, user_id || 1, reaction_type]
    );
    if (existing.length > 0) {
      // Remove reaction (toggle off)
      await pool.execute('DELETE FROM feedback_reactions WHERE id = ?', [existing[0].id]);
      res.json({ action: 'removed', reaction_type });
    } else {
      // Remove any other reaction by same user on same feedback first
      await pool.execute('DELETE FROM feedback_reactions WHERE feedback_id = ? AND user_id = ?', [feedback_id, user_id || 1]);
      // Add new reaction
      await pool.execute(
        'INSERT INTO feedback_reactions (feedback_id, reaction_type, user_id) VALUES (?, ?, ?)',
        [feedback_id, reaction_type, user_id || 1]
      );
      res.json({ action: 'added', reaction_type });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET replies for a feedback
router.get('/:id/replies', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT frep.*, u.full_name as author_name, u.avatar_url as author_avatar FROM feedback_replies frep
       LEFT JOIN users u ON frep.user_id = u.id WHERE frep.feedback_id = ?
       ORDER BY frep.created_at ASC`, [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST add reply
router.post('/:id/replies', async (req, res) => {
  try {
    const { reply, user_id } = req.body;
    if (!reply || !reply.trim()) return res.status(400).json({ error: 'Reply text required' });
    const [result] = await pool.execute(
      'INSERT INTO feedback_replies (feedback_id, reply, user_id) VALUES (?, ?, ?)',
      [req.params.id, reply, user_id || 1]
    );
    const [newReply] = await pool.execute(
      `SELECT frep.*, u.full_name as author_name, u.avatar_url as author_avatar FROM feedback_replies frep
       LEFT JOIN users u ON frep.user_id = u.id WHERE frep.id = ?`, [result.insertId]
    );
    res.status(201).json(newReply[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create feedback
router.post('/', async (req, res) => {
  try {
    const { service_name, feedback, insight, created_by } = req.body;
    if (!service_name || !feedback) {
      return res.status(400).json({ error: 'service_name and feedback are required' });
    }
    const [result] = await pool.execute(
      'INSERT INTO alert_feedback (service_name, feedback, insight, created_by, status) VALUES (?, ?, ?, ?, ?)',
      [service_name, feedback, insight || null, created_by || null, 'active']
    );
    const [newFeedback] = await pool.execute(
      `SELECT af.*, u.full_name as author_name, u.avatar_url as author_avatar FROM alert_feedback af LEFT JOIN users u ON af.created_by = u.id WHERE af.id = ?`,
      [result.insertId]
    );
    res.status(201).json(newFeedback[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update feedback status
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { feedback, insight, status } = req.body;
    const updates = [];
    const params = [];
    if (feedback !== undefined) { updates.push('feedback = ?'); params.push(feedback); }
    if (insight !== undefined) { updates.push('insight = ?'); params.push(insight); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
    params.push(id);
    await pool.execute(`UPDATE alert_feedback SET ${updates.join(', ')} WHERE id = ?`, params);
    const [updated] = await pool.execute(
      `SELECT af.*, u.full_name as author_name, u.avatar_url as author_avatar FROM alert_feedback af LEFT JOIN users u ON af.created_by = u.id WHERE af.id = ?`, [id]
    );
    res.json(updated[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE feedback
router.delete('/:id', async (req, res) => {
  try {
    await pool.execute('DELETE FROM feedback_reactions WHERE feedback_id = ?', [req.params.id]);
    await pool.execute('DELETE FROM feedback_replies WHERE feedback_id = ?', [req.params.id]);
    await pool.execute('DELETE FROM alert_feedback WHERE id = ?', [req.params.id]);
    res.json({ message: 'Feedback deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
