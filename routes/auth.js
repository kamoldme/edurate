const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { generateToken, authenticate } = require('../middleware/auth');
const { sanitizeInput } = require('../utils/moderation');

const router = express.Router();

const SCHOOL_EMAIL_DOMAIN = 'edurate.school.edu';

// POST /api/auth/register
router.post('/register', (req, res) => {
  try {
    const { full_name, email, password, grade_or_position } = req.body;

    if (!full_name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    // Validate email domain
    const emailDomain = email.split('@')[1];
    if (emailDomain !== SCHOOL_EMAIL_DOMAIN) {
      return res.status(400).json({ error: `Only @${SCHOOL_EMAIL_DOMAIN} emails are allowed` });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ error: 'Password must contain uppercase, lowercase, and a number' });
    }

    // Check existing user
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = bcrypt.hashSync(password, 12);
    const sanitizedName = sanitizeInput(full_name);

    // Only students can self-register
    const result = db.prepare(`
      INSERT INTO users (full_name, email, password, role, grade_or_position, school_id, verified_status)
      VALUES (?, ?, ?, 'student', ?, 1, 0)
    `).run(sanitizedName, email.toLowerCase(), hashedPassword, grade_or_position || null);

    // In production, send verification email. For demo, auto-verify.
    db.prepare('UPDATE users SET verified_status = 1 WHERE id = ?').run(result.lastInsertRowid);

    const user = db.prepare('SELECT id, full_name, email, role, grade_or_position, school_id, verified_status, avatar_url FROM users WHERE id = ?')
      .get(result.lastInsertRowid);

    const token = generateToken(user);

    res.cookie('token', token, {
      httpOnly: true,
      secure: false, // set true in production with HTTPS
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    res.status(201).json({ message: 'Registration successful', user, token });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.suspended) {
      return res.status(403).json({ error: 'Account suspended. Contact administrator.' });
    }

    if (!user.verified_status) {
      return res.status(403).json({ error: 'Email not verified. Check your inbox.' });
    }

    const token = generateToken(user);

    res.cookie('token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    const { password: _, ...safeUser } = user;
    res.json({ message: 'Login successful', user: safeUser, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  let teacherInfo = null;
  if (req.user.role === 'teacher') {
    teacherInfo = db.prepare('SELECT * FROM teachers WHERE user_id = ?').get(req.user.id);
  }
  res.json({ user: req.user, teacher: teacherInfo });
});

// PUT /api/auth/change-password
router.put('/change-password', authenticate, (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }
    if (!/[A-Z]/.test(new_password) || !/[a-z]/.test(new_password) || !/[0-9]/.test(new_password)) {
      return res.status(400).json({ error: 'New password must contain uppercase, lowercase, and a number' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(current_password, user.password)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashed = bcrypt.hashSync(new_password, 12);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, req.user.id);

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// PUT /api/auth/update-profile
router.put('/update-profile', authenticate, (req, res) => {
  try {
    const { full_name, grade_or_position, bio, subject, department } = req.body;
    const { logAuditEvent } = require('../utils/audit');

    if (full_name) {
      const sanitized = sanitizeInput(full_name);
      db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(sanitized, req.user.id);

      // Also update teacher profile if teacher
      if (req.user.role === 'teacher') {
        db.prepare('UPDATE teachers SET full_name = ? WHERE user_id = ?').run(sanitized, req.user.id);
      }
    }

    if (grade_or_position !== undefined) {
      db.prepare('UPDATE users SET grade_or_position = ? WHERE id = ?').run(grade_or_position, req.user.id);
    }

    // Teacher-specific fields
    if (req.user.role === 'teacher') {
      const updates = [];
      const params = [];

      if (bio !== undefined) {
        updates.push('bio = ?');
        params.push(sanitizeInput(bio));
      }
      if (subject !== undefined) {
        updates.push('subject = ?');
        params.push(subject);
      }
      if (department !== undefined) {
        updates.push('department = ?');
        params.push(department);
      }

      if (updates.length > 0) {
        params.push(req.user.id);
        db.prepare(`UPDATE teachers SET ${updates.join(', ')} WHERE user_id = ?`).run(...params);

        // Log audit event for teacher profile update
        logAuditEvent({
          userId: req.user.id,
          userRole: req.user.role,
          userName: req.user.full_name,
          actionType: 'profile_update',
          actionDescription: `Updated own profile (${updates.map(u => u.split(' =')[0]).join(', ')})`,
          targetType: 'teacher',
          metadata: { bio, subject, department },
          ipAddress: req.ip
        });
      }
    }

    const updated = db.prepare('SELECT id, full_name, email, role, grade_or_position, school_id, verified_status, suspended, avatar_url FROM users WHERE id = ?').get(req.user.id);

    let teacherInfo = null;
    if (req.user.role === 'teacher') {
      teacherInfo = db.prepare('SELECT * FROM teachers WHERE user_id = ?').get(req.user.id);
    }

    res.json({ message: 'Profile updated', user: updated, teacher: teacherInfo });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// POST /api/auth/avatar
router.post('/avatar', authenticate, (req, res) => {
  try {
    const { avatar, filename } = req.body;
    const { logAuditEvent } = require('../utils/audit');
    const fs = require('fs');
    const path = require('path');

    // Validate user role
    if (req.user.role !== 'teacher' && req.user.role !== 'school_head') {
      return res.status(403).json({ error: 'Only teachers and school heads can upload avatars' });
    }

    if (!avatar || !avatar.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Invalid image data' });
    }

    // Extract base64 data and file extension
    const matches = avatar.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: 'Invalid image format' });
    }

    const ext = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    // Validate file size (5MB max)
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image must be smaller than 5MB' });
    }

    // Create avatars directory if it doesn't exist
    const avatarsDir = path.join(__dirname, '..', 'public', 'avatars');
    if (!fs.existsSync(avatarsDir)) {
      fs.mkdirSync(avatarsDir, { recursive: true });
    }

    // Generate unique filename
    const avatarFilename = `avatar_${req.user.id}_${Date.now()}.${ext}`;
    const avatarPath = path.join(avatarsDir, avatarFilename);
    const avatarUrl = `/avatars/${avatarFilename}`;

    // Delete old avatar if exists
    if (req.user.avatar_url) {
      const oldPath = path.join(__dirname, '..', 'public', req.user.avatar_url);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    // Save new avatar
    fs.writeFileSync(avatarPath, buffer);

    // Update database
    db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, req.user.id);

    if (req.user.role === 'teacher') {
      db.prepare('UPDATE teachers SET avatar_url = ? WHERE user_id = ?').run(avatarUrl, req.user.id);
    }

    // Log audit event
    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'avatar_upload',
      actionDescription: 'Updated profile photo',
      targetType: 'user',
      targetId: req.user.id,
      ipAddress: req.ip
    });

    res.json({ message: 'Avatar uploaded', avatar_url: avatarUrl });
  } catch (err) {
    console.error('Avatar upload error:', err);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

// DELETE /api/auth/avatar
router.delete('/avatar', authenticate, (req, res) => {
  try {
    const { logAuditEvent } = require('../utils/audit');
    const fs = require('fs');
    const path = require('path');

    if (!req.user.avatar_url) {
      return res.status(400).json({ error: 'No avatar to remove' });
    }

    // Delete avatar file
    const avatarPath = path.join(__dirname, '..', 'public', req.user.avatar_url);
    if (fs.existsSync(avatarPath)) {
      fs.unlinkSync(avatarPath);
    }

    // Update database
    db.prepare('UPDATE users SET avatar_url = NULL WHERE id = ?').run(req.user.id);

    if (req.user.role === 'teacher') {
      db.prepare('UPDATE teachers SET avatar_url = NULL WHERE user_id = ?').run(req.user.id);
    }

    // Log audit event
    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'avatar_remove',
      actionDescription: 'Removed profile photo',
      targetType: 'user',
      targetId: req.user.id,
      ipAddress: req.ip
    });

    res.json({ message: 'Avatar removed' });
  } catch (err) {
    console.error('Avatar remove error:', err);
    res.status(500).json({ error: 'Failed to remove avatar' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

module.exports = router;
