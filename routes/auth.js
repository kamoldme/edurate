const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { generateToken, authenticate } = require('../middleware/auth');
const { sanitizeInput } = require('../utils/moderation');
const { sendVerificationCode } = require('../utils/email');
const { logAuditEvent } = require('../utils/audit');

const router = express.Router();

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// POST /api/auth/send-code - send verification code to email
router.post('/send-code', async (req, res) => {
  try {
    const { email, full_name, password, grade_or_position } = req.body;

    if (!email || !full_name || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
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

    // Rate limit: max 3 codes per email per 15 minutes
    const recentCodes = db.prepare(
      "SELECT COUNT(*) as count FROM verification_codes WHERE email = ? AND created_at > datetime('now', '-15 minutes')"
    ).get(email.toLowerCase());
    if (recentCodes.count >= 3) {
      return res.status(429).json({ error: 'Too many attempts. Please wait before requesting a new code.' });
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Invalidate previous codes for this email
    db.prepare("UPDATE verification_codes SET used = 1 WHERE email = ? AND used = 0").run(email.toLowerCase());

    // Store new code
    db.prepare(
      'INSERT INTO verification_codes (email, code, expires_at) VALUES (?, ?, ?)'
    ).run(email.toLowerCase(), code, expiresAt);

    // Send email
    await sendVerificationCode(email, code);

    res.json({ message: 'Verification code sent to your email' });
  } catch (err) {
    console.error('Send code error:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to send verification code. Please try again.' });
  }
});

// POST /api/auth/register
router.post('/register', (req, res) => {
  try {
    const { full_name, email, password, grade_or_position, code } = req.body;

    if (!full_name || !email || !password || !code) {
      return res.status(400).json({ error: 'Name, email, password, and verification code are required' });
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

    // Verify code
    const storedCode = db.prepare(
      "SELECT * FROM verification_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1"
    ).get(email.toLowerCase(), code);

    if (!storedCode) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    // Mark code as used
    db.prepare('UPDATE verification_codes SET used = 1 WHERE id = ?').run(storedCode.id);

    const hashedPassword = bcrypt.hashSync(password, 12);
    const sanitizedName = sanitizeInput(full_name);

    // Students register globally with org_id = NULL (they join orgs via classrooms)
    const result = db.prepare(`
      INSERT INTO users (full_name, email, password, role, grade_or_position, school_id, org_id, verified_status)
      VALUES (?, ?, ?, 'student', ?, 1, NULL, 1)
    `).run(sanitizedName, email.toLowerCase(), hashedPassword, grade_or_position || null);

    const user = db.prepare('SELECT id, full_name, email, role, grade_or_position, school_id, org_id, verified_status, avatar_url, language FROM users WHERE id = ?')
      .get(result.lastInsertRowid);

    const token = generateToken(user);

    res.cookie('token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });

    logAuditEvent({
      userId: user.id,
      userRole: 'student',
      userName: sanitizedName,
      actionType: 'user_register',
      actionDescription: `Registered new account: ${email.toLowerCase()}`,
      targetType: 'user',
      targetId: user.id,
      ipAddress: req.ip
    });

    res.status(201).json({ message: 'Registration successful', user, token });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/send-teacher-code - validate invite code then send email verification
router.post('/send-teacher-code', async (req, res) => {
  try {
    const { full_name, email, password, invite_code } = req.body;

    if (!full_name || !email || !password || !invite_code) {
      return res.status(400).json({ error: 'Name, email, password, and invite code are required' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ error: 'Password must contain uppercase, lowercase, and a number' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const org = db.prepare('SELECT * FROM organizations WHERE invite_code = ?').get(invite_code.trim().toUpperCase());
    if (!org) {
      return res.status(400).json({ error: 'Invalid invite code' });
    }
    if (org.subscription_status === 'suspended') {
      return res.status(403).json({ error: 'This organization is currently suspended' });
    }

    // Rate limit: max 3 codes per email per 15 minutes
    const recentCodes = db.prepare(
      "SELECT COUNT(*) as count FROM verification_codes WHERE email = ? AND created_at > datetime('now', '-15 minutes')"
    ).get(email.toLowerCase());
    if (recentCodes.count >= 3) {
      return res.status(429).json({ error: 'Too many attempts. Please wait before requesting a new code.' });
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    db.prepare("UPDATE verification_codes SET used = 1 WHERE email = ? AND used = 0").run(email.toLowerCase());
    db.prepare('INSERT INTO verification_codes (email, code, expires_at) VALUES (?, ?, ?)').run(email.toLowerCase(), code, expiresAt);

    await sendVerificationCode(email, code);

    res.json({ message: 'Verification code sent to your email' });
  } catch (err) {
    console.error('Send teacher code error:', err.message);
    res.status(500).json({ error: 'Failed to send verification code. Please try again.' });
  }
});

// POST /api/auth/register-teacher - complete teacher self-registration via org invite code + email verification
router.post('/register-teacher', async (req, res) => {
  try {
    const { full_name, email, password, invite_code, code } = req.body;

    if (!full_name || !email || !password || !invite_code || !code) {
      return res.status(400).json({ error: 'All fields including verification code are required' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ error: 'Password must contain uppercase, lowercase, and a number' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const org = db.prepare('SELECT * FROM organizations WHERE invite_code = ?').get(invite_code.trim().toUpperCase());
    if (!org) {
      return res.status(400).json({ error: 'Invalid invite code' });
    }
    if (org.subscription_status === 'suspended') {
      return res.status(403).json({ error: 'This organization is currently suspended' });
    }

    const teacherCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE org_id = ? AND role = 'teacher'").get(org.id);
    if (teacherCount.count >= org.max_teachers) {
      return res.status(400).json({ error: 'This organization has reached its teacher limit' });
    }

    // Verify email code
    const storedCode = db.prepare(
      "SELECT * FROM verification_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1"
    ).get(email.toLowerCase(), code);
    if (!storedCode) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }
    db.prepare('UPDATE verification_codes SET used = 1 WHERE id = ?').run(storedCode.id);

    const hashedPassword = bcrypt.hashSync(password, 12);
    const sanitizedName = sanitizeInput(full_name.trim());

    const result = db.prepare(`
      INSERT INTO users (full_name, email, password, role, school_id, org_id, verified_status)
      VALUES (?, ?, ?, 'teacher', 1, ?, 1)
    `).run(sanitizedName, email.toLowerCase(), hashedPassword, org.id);

    const userId = result.lastInsertRowid;

    db.prepare(`INSERT INTO teachers (user_id, full_name, school_id, org_id) VALUES (?, ?, 1, ?)`)
      .run(userId, sanitizedName, org.id);

    db.prepare('INSERT OR IGNORE INTO user_organizations (user_id, org_id, role_in_org, is_primary) VALUES (?, ?, ?, 1)')
      .run(userId, org.id, 'teacher');

    const user = db.prepare('SELECT id, full_name, email, role, org_id, verified_status, avatar_url, language FROM users WHERE id = ?').get(userId);
    const token = generateToken(user);

    res.cookie('token', token, { httpOnly: true, secure: false, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 });

    logAuditEvent({
      userId: user.id, userRole: 'teacher', userName: sanitizedName,
      actionType: 'teacher_self_register',
      actionDescription: `Teacher self-registered via invite code for org: ${org.name}`,
      targetType: 'organization', targetId: org.id,
      orgId: org.id, ipAddress: req.ip
    });

    res.status(201).json({ message: 'Registration successful', user, token });
  } catch (err) {
    console.error('Teacher registration error:', err);
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
      logAuditEvent({
        userId: 0, userRole: 'unknown', userName: email.toLowerCase(),
        actionType: 'login_failed',
        actionDescription: `Failed login attempt: unknown email`,
        metadata: { email: email.toLowerCase(), reason: 'unknown_email' },
        ipAddress: req.ip
      });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!bcrypt.compareSync(password, user.password)) {
      logAuditEvent({
        userId: user.id, userRole: user.role, userName: user.full_name,
        actionType: 'login_failed',
        actionDescription: `Failed login attempt: wrong password`,
        metadata: { email: email.toLowerCase(), reason: 'wrong_password' },
        ipAddress: req.ip
      });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.suspended) {
      logAuditEvent({
        userId: user.id, userRole: user.role, userName: user.full_name,
        actionType: 'login_failed',
        actionDescription: `Failed login attempt: account suspended`,
        metadata: { email: email.toLowerCase(), reason: 'suspended' },
        ipAddress: req.ip
      });
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

    logAuditEvent({
      userId: user.id, userRole: user.role, userName: user.full_name,
      actionType: 'user_login',
      actionDescription: `Logged in successfully`,
      targetType: 'user', targetId: user.id,
      ipAddress: req.ip
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

  // For students, include their organization memberships
  let organizations = [];
  if (req.user.role === 'student') {
    organizations = db.prepare(`
      SELECT o.id, o.name, o.slug, uo.role_in_org, uo.joined_at
      FROM user_organizations uo
      JOIN organizations o ON uo.org_id = o.id
      WHERE uo.user_id = ?
      ORDER BY uo.joined_at DESC
    `).all(req.user.id);
  }

  // Include org name for non-students
  let orgName = null;
  if (req.user.org_id) {
    const org = db.prepare('SELECT name FROM organizations WHERE id = ?').get(req.user.org_id);
    orgName = org?.name;
  }

  res.json({
    user: { ...req.user, org_name: orgName },
    teacher: teacherInfo,
    organizations: organizations.length > 0 ? organizations : undefined
  });
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

    logAuditEvent({
      userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
      actionType: 'password_change',
      actionDescription: 'Changed password',
      targetType: 'user', targetId: req.user.id,
      ipAddress: req.ip
    });

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

    // Log profile update for non-teacher users (teacher updates are logged below)
    if (req.user.role !== 'teacher' && (full_name || grade_or_position !== undefined)) {
      logAuditEvent({
        userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
        actionType: 'profile_update',
        actionDescription: 'Updated own profile',
        targetType: 'user', targetId: req.user.id,
        metadata: { full_name, grade_or_position },
        ipAddress: req.ip
      });
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

    const updated = db.prepare('SELECT id, full_name, email, role, grade_or_position, school_id, org_id, verified_status, suspended, avatar_url FROM users WHERE id = ?').get(req.user.id);

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
  const jwt = require('jsonwebtoken');
  const { JWT_SECRET } = require('../middleware/auth');
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = db.prepare('SELECT id, full_name, role FROM users WHERE id = ?').get(decoded.id);
      if (user) {
        logAuditEvent({
          userId: user.id, userRole: user.role, userName: user.full_name,
          actionType: 'user_logout',
          actionDescription: 'Logged out',
          targetType: 'user', targetId: user.id,
          ipAddress: req.ip
        });
      }
    } catch (e) { /* token expired or invalid, skip logging */ }
  }
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

// PUT /api/auth/language - save language preference
router.put('/language', authenticate, (req, res) => {
  try {
    const { language } = req.body;
    if (!['en', 'ru', 'uz'].includes(language)) {
      return res.status(400).json({ error: 'Invalid language' });
    }
    db.prepare('UPDATE users SET language = ? WHERE id = ?').run(language, req.user.id);
    res.json({ message: 'Language updated', language });
  } catch (err) {
    console.error('Language update error:', err);
    res.status(500).json({ error: 'Failed to update language' });
  }
});

module.exports = router;
