const express = require('express');
const db = require('../database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/notifications — latest 50 for current user, unread first
router.get('/', authenticate, (req, res) => {
  try {
    const notifications = db.prepare(`
      SELECT id, type, title, body, link, read, created_at
      FROM in_app_notifications
      WHERE user_id = ?
      ORDER BY read ASC, created_at DESC
      LIMIT 50
    `).all(req.user.id);
    res.json(notifications);
  } catch (err) {
    console.error('Get notifications error:', err);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

// GET /api/notifications/unread-count — lightweight poll endpoint
router.get('/unread-count', authenticate, (req, res) => {
  try {
    const { count } = db.prepare(
      'SELECT COUNT(*) as count FROM in_app_notifications WHERE user_id = ? AND read = 0'
    ).get(req.user.id);
    res.json({ count });
  } catch (err) {
    console.error('Unread count error:', err);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// PATCH /api/notifications/read-all — mark all notifications read for current user
router.patch('/read-all', authenticate, (req, res) => {
  try {
    db.prepare('UPDATE in_app_notifications SET read = 1 WHERE user_id = ? AND read = 0').run(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Mark all read error:', err);
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
});

// PATCH /api/notifications/:id/read — mark one notification read
router.patch('/:id/read', authenticate, (req, res) => {
  try {
    const result = db.prepare(
      'UPDATE in_app_notifications SET read = 1 WHERE id = ? AND user_id = ?'
    ).run(req.params.id, req.user.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Notification not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Mark read error:', err);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

module.exports = router;
