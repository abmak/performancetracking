const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Create notifications table if not exists
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      type VARCHAR(50) DEFAULT 'info',
      title VARCHAR(255),
      message TEXT,
      action_id INT,
      link VARCHAR(255),
      is_read TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id, is_read),
      INDEX idx_user_created (user_id, created_at)
    )
  `);
}
ensureTable().catch(() => {});

// Shared helper so other routes can raise notifications
async function createNotification({ user_id, type, title, message, action_id, link }) {
  if (!user_id) return;
  try {
    await pool.execute(
      'INSERT INTO notifications (user_id, type, title, message, action_id, link) VALUES (?, ?, ?, ?, ?, ?)',
      [user_id, type || 'info', title || '', message || '', action_id || null, link || '/actions']
    );
  } catch (e) { /* notification must never break the main flow */ }
}

// GET all notifications for a user (with unread count)
router.get('/', async (req, res) => {
  try {
    const user_id = parseInt(req.query.user_id, 10);
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const [rows] = await pool.execute(
      `SELECT n.*, a.title as action_title
       FROM notifications n
       LEFT JOIN action_notes a ON n.action_id = a.id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT 60`,
      [user_id]
    );
    const [unread] = await pool.execute(
      'SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0',
      [user_id]
    );
    res.json({ notifications: rows, unread: unread[0].cnt });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET unread count only
router.get('/unread-count', async (req, res) => {
  try {
    const user_id = parseInt(req.query.user_id, 10);
    if (!user_id) return res.json({ count: 0 });
    const [rows] = await pool.execute(
      'SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0',
      [user_id]
    );
    res.json({ count: rows[0].cnt });
  } catch (error) {
    res.json({ count: 0 });
  }
});

// PATCH mark one notification read
router.patch('/:id/read', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });
    await pool.execute(
      'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
      [req.params.id, user_id]
    );
    res.json({ message: 'marked read' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST mark all read for a user
router.post('/read-all', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });
    await pool.execute('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [user_id]);
    res.json({ message: 'all marked read' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
module.exports.createNotification = createNotification;