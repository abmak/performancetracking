const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for chat media uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/chat');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'chat-' + uniqueSuffix + ext);
  }
});
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB max
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_SIZE }, // 50MB max
  // Accept any file type (images, audio, documents, archives, etc.)
  fileFilter: (req, file, cb) => cb(null, true)
});

// Wrap multer so limit/type errors are returned as readable JSON instead of
// an opaque 500, letting the frontend alert the user about oversized files.
const uploadSingleFile = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large. Maximum allowed size is 50MB.' });
      }
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    next();
  });
};

// Chat media is served publicly from server.js (/api/chat/media) because browser
// <img>/<audio>/<a> tags cannot attach the Authorization header.

// ============ DIRECT MESSAGES ============

// GET conversations list (latest message per user)
router.get('/conversations', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });

    const [rows] = await pool.execute(
      `SELECT 
        u.id as user_id, u.full_name, u.email, u.phone,
        latest.message_text as last_message,
        latest.created_at as last_message_at,
        latest.sender_id as last_sender_id,
        SUM(CASE WHEN cm.receiver_id = ? AND cm.is_read = 0 THEN 1 ELSE 0 END) as unread_count
       FROM users u
       INNER JOIN chat_messages cm ON (
         (cm.sender_id = ? AND cm.receiver_id = u.id) OR
         (cm.sender_id = u.id AND cm.receiver_id = ?)
       )
       INNER JOIN chat_messages latest ON (
         latest.id = (
           SELECT MAX(cm2.id) FROM chat_messages cm2
           WHERE (cm2.sender_id = ? AND cm2.receiver_id = u.id)
              OR (cm2.sender_id = u.id AND cm2.receiver_id = ?)
         )
       )
       WHERE u.id != ? AND u.status = 'active'
       GROUP BY u.id, u.full_name, u.email, u.phone, latest.message_text, latest.created_at, latest.sender_id
       ORDER BY latest.created_at DESC`,
      [user_id, user_id, user_id, user_id, user_id, user_id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET messages between two users
router.get('/messages', async (req, res) => {
  try {
    const { user_id, other_user_id, limit = 50 } = req.query;
    if (!user_id || !other_user_id) return res.status(400).json({ error: 'user_id and other_user_id required' });

    const [rows] = await pool.execute(
      `SELECT cm.*, u.full_name as sender_name, u.avatar_url as sender_avatar
       FROM chat_messages cm
       JOIN users u ON cm.sender_id = u.id
       WHERE cm.is_deleted = 0
         AND ((cm.sender_id = ? AND cm.receiver_id = ?)
          OR (cm.sender_id = ? AND cm.receiver_id = ?))
       ORDER BY cm.created_at ASC
       LIMIT ${parseInt(limit)}`,
      [user_id, other_user_id, other_user_id, user_id]
    );

    // Mark as read
    await pool.execute(
      'UPDATE chat_messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ? AND is_read = 0',
      [other_user_id, user_id]
    );

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST send direct message
router.post('/send', async (req, res) => {
  try {
    const { sender_id, receiver_id, message_text, message_type = 'text', media_url } = req.body;
    if (!sender_id || !receiver_id) {
      return res.status(400).json({ error: 'sender_id and receiver_id required' });
    }

    const [result] = await pool.execute(
      'INSERT INTO chat_messages (sender_id, receiver_id, message_text, message_type, media_url) VALUES (?, ?, ?, ?, ?)',
      [sender_id, receiver_id, message_text || '', message_type, media_url || null]
    );

    const [rows] = await pool.execute(
      `SELECT cm.*,u.full_name as sender_name, u.avatar_url as sender_avatar
       FROM chat_messages cm
       JOIN users u ON cm.sender_id = u.id WHERE cm.id = ?`, [result.insertId]
    );

    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ GROUPS ============

// GET all groups (or groups for a user)
router.get('/groups', async (req, res) => {
  try {
    const { user_id } = req.query;
    let query, params;
    if (user_id) {
      query = `SELECT cg.*, u.full_name as creator_name,
        (SELECT COUNT(*) FROM chat_group_members WHERE group_id = cg.id) as member_count,
        (SELECT COUNT(*) FROM chat_messages WHERE group_id = cg.id) as message_count,
        (SELECT MAX(created_at) FROM chat_messages WHERE group_id = cg.id) as last_message_at
       FROM chat_groups cg
       JOIN users u ON cg.created_by = u.id
       WHERE cg.id IN (SELECT group_id FROM chat_group_members WHERE user_id = ?)
       ORDER BY last_message_at DESC, cg.created_at DESC`;
      params = [user_id];
    } else {
      query = `SELECT cg.*, u.full_name as creator_name,
        (SELECT COUNT(*) FROM chat_group_members WHERE group_id = cg.id) as member_count,
        (SELECT COUNT(*) FROM chat_messages WHERE group_id = cg.id) as message_count,
        (SELECT MAX(created_at) FROM chat_messages WHERE group_id = cg.id) as last_message_at
       FROM chat_groups cg
       JOIN users u ON cg.created_by = u.id
       ORDER BY last_message_at DESC, cg.created_at DESC`;
      params = [];
    }
    const [rows] = await pool.execute(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET single group with members
router.get('/groups/:id', async (req, res) => {
  try {
    const [groups] = await pool.execute(
      `SELECT cg.*, u.full_name as creator_name
       FROM chat_groups cg JOIN users u ON cg.created_by = u.id WHERE cg.id = ?`,
      [req.params.id]
    );
    if (groups.length === 0) return res.status(404).json({ error: 'Group not found' });

    const [members] = await pool.execute(
      `SELECT cgm.*, u.full_name, u.email, u.phone
       FROM chat_group_members cgm JOIN users u ON cgm.user_id = u.id
       WHERE cgm.group_id = ? ORDER BY cgm.role DESC, cgm.joined_at ASC`,
      [req.params.id]
    );

    res.json({ ...groups[0], members });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create group
router.post('/groups', async (req, res) => {
  try {
    const { name, description, created_by, member_ids = [] } = req.body;
    if (!name || !created_by) return res.status(400).json({ error: 'name and created_by required' });

    const [result] = await pool.execute(
      'INSERT INTO chat_groups (name, description, created_by) VALUES (?, ?, ?)',
      [name, description || '', created_by]
    );
    const groupId = result.insertId;

    // Add creator as admin
    await pool.execute(
      'INSERT INTO chat_group_members (group_id, user_id, role) VALUES (?, ?, ?)',
      [groupId, created_by, 'admin']
    );

    // Add other members
    const uniqueMembers = [...new Set(member_ids.filter(id => id !== created_by))];
    for (const memberId of uniqueMembers) {
      await pool.execute(
        'INSERT IGNORE INTO chat_group_members (group_id, user_id, role) VALUES (?, ?, ?)',
        [groupId, memberId, 'member']
      );
    }

    const [group] = await pool.execute('SELECT * FROM chat_groups WHERE id = ?', [groupId]);
    res.json(group[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update group
router.put('/groups/:id', async (req, res) => {
  try {
    const { name, description } = req.body;
    await pool.execute(
      'UPDATE chat_groups SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?',
      [name, description, req.params.id]
    );
    const [group] = await pool.execute('SELECT * FROM chat_groups WHERE id = ?', [req.params.id]);
    res.json(group[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE group
router.delete('/groups/:id', async (req, res) => {
  try {
    await pool.execute('DELETE FROM chat_groups WHERE id = ?', [req.params.id]);
    res.json({ message: 'Group deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST add members to group
router.post('/groups/:id/members', async (req, res) => {
  try {
    const { user_ids } = req.body;
    if (!user_ids || !Array.isArray(user_ids)) return res.status(400).json({ error: 'user_ids array required' });

    for (const uid of user_ids) {
      await pool.execute(
        'INSERT IGNORE INTO chat_group_members (group_id, user_id) VALUES (?, ?)',
        [req.params.id, uid]
      );
    }

    const [members] = await pool.execute(
      `SELECT cgm.*, u.full_name, u.email, u.phone
       FROM chat_group_members cgm JOIN users u ON cgm.user_id = u.id
       WHERE cgm.group_id = ?`, [req.params.id]
    );
    res.json(members);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE remove member from group
router.delete('/groups/:groupId/members/:userId', async (req, res) => {
  try {
    await pool.execute(
      'DELETE FROM chat_group_members WHERE group_id = ? AND user_id = ?',
      [req.params.groupId, req.params.userId]
    );
    res.json({ message: 'Member removed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET group messages
router.get('/groups/:id/messages', async (req, res) => {
  try {
    const { limit = 50, before } = req.query;
    let query = `SELECT cm.*, u.full_name as sender_name, u.avatar_url as sender_avatar
       FROM chat_messages cm JOIN users u ON cm.sender_id = u.id
       WHERE cm.group_id = ? AND cm.is_deleted = 0`;
    const params = [req.params.id];

    if (before) {
      query += ' AND cm.id < ?';
      params.push(before);
    }

    query += ` ORDER BY cm.created_at DESC LIMIT ${parseInt(limit)}`;
    const [rows] = await pool.execute(query, params);
    res.json(rows.reverse());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST send group message
router.post('/groups/:id/messages', async (req, res) => {
  try {
    const { sender_id, message_text } = req.body;
    if (!sender_id || !message_text) return res.status(400).json({ error: 'sender_id and message_text required' });

    // Verify sender is member
    const [member] = await pool.execute(
      'SELECT * FROM chat_group_members WHERE group_id = ? AND user_id = ?',
      [req.params.id, sender_id]
    );
    if (member.length === 0) return res.status(403).json({ error: 'You are not a member of this group' });

    const { message_type = 'text', media_url } = req.body;
    const [result] = await pool.execute(
      'INSERT INTO chat_messages (sender_id, group_id, message_text, message_type, media_url) VALUES (?, ?, ?, ?, ?)',
      [sender_id, req.params.id, message_text || '', message_type, media_url || null]
    );

    const [rows] = await pool.execute(
      `SELECT cm.*,u.full_name as sender_name, u.avatar_url as sender_avatar
       FROM chat_messages cm
       JOIN users u ON cm.sender_id = u.id WHERE cm.id = ?`, [result.insertId]
    );

    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ DELETE MESSAGE ============

// DELETE a message (soft delete — only sender can delete)
router.delete('/messages/:id', async (req, res) => {
  try {
    const { sender_id } = req.query;
    if (!sender_id) return res.status(400).json({ error: 'sender_id required' });

    const [msg] = await pool.execute('SELECT * FROM chat_messages WHERE id = ?', [req.params.id]);
    if (msg.length === 0) return res.status(404).json({ error: 'Message not found' });
    if (msg[0].sender_id !== parseInt(sender_id)) return res.status(403).json({ error: 'You can only delete your own messages' });

    // Delete media file if exists
    if (msg[0].media_url) {
      const filePath = path.join(__dirname, '../../uploads/chat', path.basename(msg[0].media_url));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await pool.execute('UPDATE chat_messages SET is_deleted = 1, message_text = "" WHERE id = ?', [req.params.id]);
    res.json({ message: 'Message deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ MEDIA UPLOAD ============

// POST upload media (image, voice, or any file)
router.post('/upload', uploadSingleFile, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const mediaUrl = `/api/chat/media/${req.file.filename}`;
    let type = 'file';
    if (req.file.mimetype.startsWith('image/')) type = 'image';
    else if (req.file.mimetype.startsWith('audio/')) type = 'voice';
    res.json({
      url: mediaUrl,
      filename: req.file.filename,
      originalname: req.file.originalname,
      type,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET unread counts
router.get('/unread/:userId', async (req, res) => {
  try {
    const [dmCount] = await pool.execute(
      'SELECT COUNT(*) as cnt FROM chat_messages WHERE receiver_id = ? AND is_read = 0',
      [req.params.userId]
    );
    const [groupCount] = await pool.execute(
      `SELECT COUNT(*) as cnt FROM chat_messages cm
       WHERE cm.group_id IS NOT NULL AND cm.sender_id != ?
       AND cm.id > COALESCE(
         (SELECT MAX(cm2.id) FROM chat_messages cm2
          WHERE cm2.group_id = cm.group_id AND cm2.sender_id = ?), 0
       )
       AND cm.group_id IN (SELECT group_id FROM chat_group_members WHERE user_id = ?)`,
      [req.params.userId, req.params.userId, req.params.userId]
    );
    res.json({ direct: dmCount[0].cnt, groups: groupCount[0].cnt });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
