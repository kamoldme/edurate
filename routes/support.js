const express = require('express');
const db = require('../database');
const { authenticate, authorize } = require('../middleware/auth');
const { sanitizeInput } = require('../utils/moderation');
const { logAuditEvent } = require('../utils/audit');
const { createNotifications } = require('../utils/notifications');

const router = express.Router();

// POST /api/support/message - submit support message (any authenticated user)
router.post('/message', authenticate, (req, res) => {
  try {
    const { category, subject, message } = req.body;

    // Validation
    if (!category || !subject || !message) {
      return res.status(400).json({ error: 'Category, subject, and message are required' });
    }

    if (!['technical', 'account', 'question', 'feature', 'other'].includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }

    if (subject.trim().length < 3 || subject.trim().length > 200) {
      return res.status(400).json({ error: 'Subject must be between 3 and 200 characters' });
    }

    if (message.trim().length < 10 || message.trim().length > 5000) {
      return res.status(400).json({ error: 'Message must be between 10 and 5000 characters' });
    }

    // Sanitize inputs
    const sanitizedSubject = sanitizeInput(subject.trim());
    const sanitizedMessage = sanitizeInput(message.trim());

    // Insert support message
    const result = db.prepare(`
      INSERT INTO support_messages (user_id, user_name, user_email, user_role, org_id, category, subject, message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      req.user.full_name,
      req.user.email,
      req.user.role,
      req.user.org_id || null,
      category,
      sanitizedSubject,
      sanitizedMessage
    );

    // Log audit event
    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'support_message_submit',
      actionDescription: `Submitted support message: ${sanitizedSubject}`,
      targetType: 'support_message',
      targetId: result.lastInsertRowid,
      metadata: { category, subject: sanitizedSubject },
      ipAddress: req.ip
    });

    // Notify super_admins and the org's org_admin
    const superAdmins = db.prepare("SELECT id FROM users WHERE role = 'super_admin'").all().map(u => u.id);
    const orgAdmins = req.user.org_id
      ? db.prepare("SELECT id FROM users WHERE org_id = ? AND role = 'org_admin'").all(req.user.org_id).map(u => u.id)
      : [];
    const adminUserIds = [...new Set([...superAdmins, ...orgAdmins])].filter(id => id !== req.user.id);
    createNotifications({
      userIds: adminUserIds,
      orgId: req.user.org_id || null,
      type: 'support_new',
      title: 'New support message',
      body: sanitizedSubject,
      link: 'admin-support'
    });

    res.status(201).json({
      message: 'Support message submitted successfully. An administrator will review it shortly.',
      id: result.lastInsertRowid
    });
  } catch (err) {
    console.error('Submit support message error:', err);
    res.status(500).json({ error: 'Failed to submit support message' });
  }
});

// GET /api/support/my-messages - get user's own support messages
router.get('/my-messages', authenticate, (req, res) => {
  try {
    const messages = db.prepare(`
      SELECT id, category, subject, message, status, created_at, resolved_at, admin_notes
      FROM support_messages
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(req.user.id);

    res.json(messages);
  } catch (err) {
    console.error('Get my messages error:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

module.exports = router;
