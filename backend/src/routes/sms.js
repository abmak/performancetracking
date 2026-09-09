const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// GET active users with phone numbers (for SMS recipient selection)
router.get('/users', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, full_name, email, phone, department, status
       FROM users WHERE status = 'active' AND phone IS NOT NULL AND phone != '' ORDER BY full_name`
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET all SMS messages with stats
router.get('/', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    let where = '';
    const params = [];
    if (status) { where = 'WHERE status = ?'; params.push(status); }

    const [countResult] = await pool.execute(
      `SELECT COUNT(*) as total FROM sms_messages ${where}`, params
    );

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const [rows] = await pool.execute(
      `SELECT m.*, u.full_name as sender_name_full, u.avatar_url as sender_avatar
       FROM sms_messages m
       LEFT JOIN users u ON m.created_by = u.id
       ${where}
       ORDER BY m.created_at DESC
       LIMIT ${parseInt(limit)} OFFSET ${offset}`, params
    );

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

// GET SMS stats
router.get('/stats', async (req, res) => {
  try {
    const [total] = await pool.execute('SELECT COUNT(*) as cnt FROM sms_messages');
    const [sent] = await pool.execute("SELECT COUNT(*) as cnt FROM sms_messages WHERE status = 'sent'");
    const [totalRecipients] = await pool.execute('SELECT COALESCE(SUM(sent_count), 0) as cnt FROM sms_messages');
    const [failedRecipients] = await pool.execute('SELECT COALESCE(SUM(failed_count), 0) as cnt FROM sms_messages');
    const [todayCount] = await pool.execute("SELECT COUNT(*) as cnt FROM sms_messages WHERE DATE(created_at) = CURDATE()");

    res.json({
      total_messages: total[0].cnt,
      sent_messages: sent[0].cnt,
      total_recipients: totalRecipients[0].cnt,
      failed_recipients: failedRecipients[0].cnt,
      today_messages: todayCount[0].cnt,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET single SMS with recipients
router.get('/:id', async (req, res) => {
  try {
    const [messages] = await pool.execute(
      'SELECT * FROM sms_messages WHERE id = ?', [req.params.id]
    );
    if (messages.length === 0) return res.status(404).json({ error: 'Message not found' });

    const [recipients] = await pool.execute(
      'SELECT * FROM sms_recipients WHERE message_id = ? ORDER BY id', [req.params.id]
    );

    res.json({ ...messages[0], recipients });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST send single SMS
router.post('/send', async (req, res) => {
  try {
    const { message_text, phone_numbers, sender_name = 'VAS System', created_by } = req.body;

    if (!message_text || !phone_numbers || !Array.isArray(phone_numbers) || phone_numbers.length === 0) {
      return res.status(400).json({ error: 'Message text and at least one phone number required' });
    }

    // Create message record
    const [result] = await pool.execute(
      `INSERT INTO sms_messages (message_text, sender_name, total_recipients, status, sent_at, created_by)
       VALUES (?, ?, ?, 'sending', NOW(), ?)`,
      [message_text, sender_name, phone_numbers.length, created_by || null]
    );
    const messageId = result.insertId;

    // Insert recipients
    let sentCount = 0;
    let failedCount = 0;
    for (const recipient of phone_numbers) {
      const phone = typeof recipient === 'string' ? recipient : recipient.phone;
      const name = typeof recipient === 'string' ? '' : (recipient.name || '');
      const type = typeof recipient === 'string' ? 'external' : (recipient.type || 'external');

      // Simulate send (in production, integrate with SMS gateway like Africa's Talking, Twilio, etc.)
      const isSuccess = Math.random() > 0.02; // 98% success rate simulation

      await pool.execute(
        `INSERT INTO sms_recipients (message_id, phone_number, recipient_name, recipient_type, status, sent_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [messageId, phone, name, type, isSuccess ? 'sent' : 'failed']
      );

      if (isSuccess) sentCount++;
      else failedCount++;
    }

    // Update message status
    const finalStatus = failedCount === 0 ? 'sent' : sentCount === 0 ? 'failed' : 'partial';
    await pool.execute(
      'UPDATE sms_messages SET status = ?, sent_count = ?, failed_count = ? WHERE id = ?',
      [finalStatus, sentCount, failedCount, messageId]
    );

    res.json({
      id: messageId,
      status: finalStatus,
      sent_count: sentCount,
      failed_count: failedCount,
      total_recipients: phone_numbers.length,
      message: `SMS ${finalStatus}: ${sentCount} sent, ${failedCount} failed`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST import recipients from Excel and send
router.post('/import-and-send', async (req, res) => {
  try {
    const { message_text, sender_name = 'VAS System', recipients, created_by } = req.body;

    if (!message_text || !recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: 'Message text and recipients list required' });
    }

    // Create message record
    const [result] = await pool.execute(
      `INSERT INTO sms_messages (message_text, sender_name, total_recipients, status, sent_at, created_by)
       VALUES (?, ?, ?, 'sending', NOW(), ?)`,
      [message_text, sender_name, recipients.length, created_by || null]
    );
    const messageId = result.insertId;

    let sentCount = 0;
    let failedCount = 0;
    for (const recipient of recipients) {
      const phone = recipient.phone_number || recipient.phone || '';
      const name = recipient.name || recipient.recipient_name || '';
      if (!phone) continue;

      const isSuccess = Math.random() > 0.02;
      await pool.execute(
        `INSERT INTO sms_recipients (message_id, phone_number, recipient_name, recipient_type, status, sent_at)
         VALUES (?, ?, ?, 'external', ?, NOW())`,
        [messageId, phone, name, isSuccess ? 'sent' : 'failed']
      );
      if (isSuccess) sentCount++;
      else failedCount++;
    }

    const finalStatus = failedCount === 0 ? 'sent' : sentCount === 0 ? 'failed' : 'partial';
    await pool.execute(
      'UPDATE sms_messages SET status = ?, sent_count = ?, failed_count = ? WHERE id = ?',
      [finalStatus, sentCount, failedCount, messageId]
    );

    res.json({
      id: messageId,
      status: finalStatus,
      sent_count: sentCount,
      failed_count: failedCount,
      total_recipients: recipients.length,
      message: `Bulk SMS ${finalStatus}: ${sentCount} sent, ${failedCount} failed`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE message
router.delete('/:id', async (req, res) => {
  try {
    await pool.execute('DELETE FROM sms_messages WHERE id = ?', [req.params.id]);
    res.json({ message: 'Message deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
