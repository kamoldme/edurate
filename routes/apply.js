const express = require('express');
const db = require('../database');
const { sanitizeInput } = require('../utils/moderation');

const router = express.Router();

// POST /api/apply - public organization application (no auth required)
router.post('/', (req, res) => {
  try {
    const { org_name, contact_name, email, phone, message } = req.body;

    if (!org_name || !contact_name || !email) {
      return res.status(400).json({ error: 'Organization name, contact name, and email are required' });
    }

    if (org_name.trim().length < 2 || org_name.trim().length > 200) {
      return res.status(400).json({ error: 'Organization name must be between 2 and 200 characters' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const sanitizedOrg = sanitizeInput(org_name.trim());
    const sanitizedName = sanitizeInput(contact_name.trim());
    const sanitizedPhone = phone ? sanitizeInput(phone.trim()) : null;
    const sanitizedMsg = message ? sanitizeInput(message.trim()) : null;

    db.prepare(`
      INSERT INTO org_applications (org_name, contact_name, email, phone, message)
      VALUES (?, ?, ?, ?, ?)
    `).run(sanitizedOrg, sanitizedName, email.trim().toLowerCase(), sanitizedPhone, sanitizedMsg);

    res.status(201).json({ message: 'Application submitted successfully' });
  } catch (err) {
    console.error('Apply error:', err);
    res.status(500).json({ error: 'Failed to submit application' });
  }
});

module.exports = router;
