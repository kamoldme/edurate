const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { authenticate, authorize, authorizeOrg, ROLE_HIERARCHY } = require('../middleware/auth');
const { sanitizeInput } = require('../utils/moderation');
const { logAuditEvent, getAuditLogs, getAuditStats } = require('../utils/audit');
const { createNotifications } = require('../utils/notifications');

const router = express.Router();

// Helper: build org filter clause for queries
function orgFilter(req, alias, paramsList) {
  if (req.user.role === 'super_admin' && !req.orgId) {
    return ''; // super_admin sees all when no org selected
  }
  if (req.orgId) {
    paramsList.push(req.orgId);
    return ` AND ${alias}.org_id = ?`;
  }
  return '';
}

// ============ USER MANAGEMENT ============

// GET /api/admin/users
router.get('/users', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const { role, search } = req.query;
    const params = [];
    let query = 'SELECT u.id, u.full_name, u.email, u.role, u.grade_or_position, u.school_id, u.org_id, u.verified_status, u.suspended, u.created_at FROM users u WHERE 1=1';

    // Org scoping
    if (req.user.role === 'org_admin') {
      // org_admin sees users in their org (via user_organizations) + staff assigned to org
      query = `SELECT DISTINCT u.id, u.full_name, u.email, u.role, u.grade_or_position, u.school_id, u.org_id, u.verified_status, u.suspended, u.created_at
        FROM users u
        LEFT JOIN user_organizations uo ON u.id = uo.user_id AND uo.org_id = ?
        WHERE (u.org_id = ? OR uo.org_id IS NOT NULL)`;
      params.push(req.orgId, req.orgId);
    } else if (req.orgId) {
      // super_admin filtering by specific org
      query = `SELECT DISTINCT u.id, u.full_name, u.email, u.role, u.grade_or_position, u.school_id, u.org_id, u.verified_status, u.suspended, u.created_at
        FROM users u
        LEFT JOIN user_organizations uo ON u.id = uo.user_id AND uo.org_id = ?
        WHERE (u.org_id = ? OR uo.org_id IS NOT NULL)`;
      params.push(req.orgId, req.orgId);
    }

    if (role) { query += ' AND u.role = ?'; params.push(role); }
    if (search) { query += ' AND (u.full_name LIKE ? OR u.email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    query += ' ORDER BY u.created_at DESC';
    const users = db.prepare(query).all(...params);
    res.json(users);
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST /api/admin/users - create user (any role)
router.post('/users', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, async (req, res) => {
  try {
    const { full_name, email, password, role, grade_or_position, subject, department, experience_years, bio } = req.body;

    if (!full_name || !email || !password || !role) {
      return res.status(400).json({ error: 'Name, email, password, and role are required' });
    }

    const validRoles = ['student', 'teacher', 'school_head', 'org_admin', 'super_admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Hierarchy enforcement: org_admin cannot create super_admin or org_admin
    if (req.user.role === 'org_admin' && ['super_admin', 'org_admin'].includes(role)) {
      return res.status(403).json({ error: 'You cannot create users with this role' });
    }

    // Only super_admin can create super_admin
    if (role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only platform administrators can create super admin accounts' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'Email already exists' });

    // org_admin must always have an org context
    if (req.user.role === 'org_admin' && !req.orgId) {
      return res.status(400).json({ error: 'Organization context required' });
    }

    // Determine org_id for the new user
    // super_admin can pass org_id in the body when creating school_head/org_admin for a specific org
    let userOrgId = role === 'super_admin' ? null : (req.orgId || null);
    if (req.user.role === 'super_admin' && !userOrgId && req.body.org_id) {
      userOrgId = parseInt(req.body.org_id) || null;
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const result = db.prepare(`
      INSERT INTO users (full_name, email, password, role, grade_or_position, school_id, org_id, verified_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(sanitizeInput(full_name), email.toLowerCase(), hashedPassword, role, grade_or_position || null, userOrgId || 1, userOrgId);

    // If teacher, create teacher profile
    if (role === 'teacher') {
      db.prepare(`
        INSERT INTO teachers (user_id, full_name, subject, department, experience_years, bio, school_id, org_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(result.lastInsertRowid, sanitizeInput(full_name), subject || null, department || null, experience_years || 0, bio || null, userOrgId || 1, userOrgId);
    }

    // Add to user_organizations if org is set
    if (userOrgId && role !== 'super_admin') {
      const roleInOrg = role === 'student' ? 'student' : role;
      db.prepare('INSERT OR IGNORE INTO user_organizations (user_id, org_id, role_in_org) VALUES (?, ?, ?)')
        .run(result.lastInsertRowid, userOrgId, roleInOrg);
    }

    const user = db.prepare('SELECT id, full_name, email, role, grade_or_position, org_id, verified_status, created_at FROM users WHERE id = ?')
      .get(result.lastInsertRowid);

    logAuditEvent({
      userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
      actionType: 'user_create',
      actionDescription: `Created ${role} account for ${full_name} (${email.toLowerCase()})`,
      targetType: 'user', targetId: result.lastInsertRowid,
      metadata: { email: email.toLowerCase(), role, org_id: userOrgId },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.status(201).json(user);
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PUT /api/admin/users/:id - edit user profile
router.put('/users/:id', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // org_admin can only edit users in their org
    if (req.user.role === 'org_admin') {
      const inOrg = db.prepare('SELECT id FROM user_organizations WHERE user_id = ? AND org_id = ?').get(user.id, req.orgId);
      if (!inOrg && user.org_id !== req.orgId) {
        return res.status(403).json({ error: 'User is not in your organization' });
      }
      // Cannot edit super_admin or org_admin users
      if (['super_admin', 'org_admin'].includes(user.role)) {
        return res.status(403).json({ error: 'You cannot edit users with this role' });
      }
    }

    const { full_name, email, grade_or_position, role } = req.body;

    // Hierarchy enforcement on role changes
    if (role && req.user.role === 'org_admin' && ['super_admin', 'org_admin'].includes(role)) {
      return res.status(403).json({ error: 'You cannot assign this role' });
    }

    // Check email uniqueness if changing
    if (email && email.toLowerCase() !== user.email) {
      const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?')
        .get(email.toLowerCase(), req.params.id);
      if (existing) return res.status(409).json({ error: 'Email already in use' });
    }

    db.prepare(`
      UPDATE users SET
        full_name = COALESCE(?, full_name),
        email = COALESCE(?, email),
        grade_or_position = COALESCE(?, grade_or_position),
        role = COALESCE(?, role)
      WHERE id = ?
    `).run(
      full_name ? sanitizeInput(full_name) : null,
      email ? email.toLowerCase() : null,
      grade_or_position,
      role,
      req.params.id
    );

    // If teacher, update teacher profile too
    if (user.role === 'teacher' && full_name) {
      db.prepare('UPDATE teachers SET full_name = ? WHERE user_id = ?')
        .run(sanitizeInput(full_name), req.params.id);
    }

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'user_edit',
      actionDescription: `Edited user profile for ${user.full_name} (${user.email})`,
      targetType: 'user',
      targetId: user.id,
      metadata: { changes: req.body },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    const updated = db.prepare('SELECT id, full_name, email, role, grade_or_position, org_id, verified_status, suspended FROM users WHERE id = ?')
      .get(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error('Edit user error:', err);
    res.status(500).json({ error: 'Failed to edit user' });
  }
});

// POST /api/admin/users/:id/reset-password - admin resets user password
router.post('/users/:id/reset-password', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, async (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // org_admin ownership check
    if (req.user.role === 'org_admin') {
      if (user.org_id !== req.orgId && !db.prepare('SELECT id FROM user_organizations WHERE user_id = ? AND org_id = ?').get(user.id, req.orgId)) {
        return res.status(403).json({ error: 'User is not in your organization' });
      }
      if (['super_admin', 'org_admin'].includes(user.role)) {
        return res.status(403).json({ error: 'You cannot reset password for users with this role' });
      }
    }

    const { new_password } = req.body;
    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const hashedPassword = await bcrypt.hash(new_password, 12);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.params.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'password_reset',
      actionDescription: `Reset password for ${user.full_name} (${user.email})`,
      targetType: 'user',
      targetId: user.id,
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// DELETE /api/admin/users/:id - permanently delete a user
router.delete('/users/:id', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Cannot delete yourself
    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }

    // org_admin restrictions
    if (req.user.role === 'org_admin') {
      // Must be in their org
      const inOrg = db.prepare('SELECT id FROM user_organizations WHERE user_id = ? AND org_id = ?').get(user.id, req.orgId);
      if (!inOrg && user.org_id !== req.orgId) {
        return res.status(403).json({ error: 'User is not in your organization' });
      }
      // Cannot delete super_admin or org_admin accounts
      if (['super_admin', 'org_admin'].includes(user.role)) {
        return res.status(403).json({ error: 'You cannot delete users with this role' });
      }
    }

    const userName = user.full_name;
    const userEmail = user.email;
    const userRole = user.role;

    // Delete cascades via foreign keys: teachers, classrooms, reviews, classroom_members, user_organizations, support_messages
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'user_delete',
      actionDescription: `Permanently deleted ${userRole} account: ${userName} (${userEmail})`,
      targetType: 'user',
      targetId: parseInt(req.params.id),
      metadata: { deleted_email: userEmail, deleted_role: userRole, deleted_name: userName },
      ipAddress: req.ip,
      orgId: req.orgId || null
    });

    res.json({ message: 'User permanently deleted' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// PUT /api/admin/users/:id/suspend
router.put('/users/:id/suspend', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // org_admin ownership check
    if (req.user.role === 'org_admin') {
      if (user.org_id !== req.orgId && !db.prepare('SELECT id FROM user_organizations WHERE user_id = ? AND org_id = ?').get(user.id, req.orgId)) {
        return res.status(403).json({ error: 'User is not in your organization' });
      }
      if (['super_admin', 'org_admin'].includes(user.role)) {
        return res.status(403).json({ error: 'You cannot suspend users with this role' });
      }
    }

    const newStatus = user.suspended ? 0 : 1;
    db.prepare('UPDATE users SET suspended = ? WHERE id = ?').run(newStatus, req.params.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: newStatus ? 'user_suspend' : 'user_unsuspend',
      actionDescription: `${newStatus ? 'Suspended' : 'Unsuspended'} user ${user.full_name} (${user.email})`,
      targetType: 'user',
      targetId: user.id,
      metadata: { user_email: user.email, user_role: user.role },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.json({ message: newStatus ? 'User suspended' : 'User unsuspended', suspended: newStatus });
  } catch (err) {
    console.error('Suspend user error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// ============ TERM MANAGEMENT ============

// GET /api/admin/terms
router.get('/terms', authenticate, authorize('super_admin', 'org_admin', 'school_head', 'teacher'), authorizeOrg, (req, res) => {
  try {
    const params = [];
    let query = 'SELECT t.*, o.name as org_name FROM terms t LEFT JOIN organizations o ON t.org_id = o.id WHERE 1=1';

    if (req.orgId) {
      query += ' AND t.org_id = ?';
      params.push(req.orgId);
    } else if (req.user.role !== 'super_admin') {
      // Non-super_admin must have org context
      query += ' AND t.org_id = ?';
      params.push(req.user.org_id);
    }

    query += ' ORDER BY t.start_date DESC';
    const terms = db.prepare(query).all(...params);

    const termsWithPeriods = terms.map(term => {
      const periods = db.prepare('SELECT * FROM feedback_periods WHERE term_id = ? ORDER BY id').all(term.id);
      return { ...term, periods };
    });

    res.json(termsWithPeriods);
  } catch (err) {
    console.error('List terms error:', err);
    res.status(500).json({ error: 'Failed to fetch terms' });
  }
});

// POST /api/admin/terms
router.post('/terms', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const { name, start_date, end_date } = req.body;
    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }

    if (start_date >= end_date) {
      return res.status(400).json({ error: 'Start date must be before end date' });
    }

    const termOrgId = req.orgId || null;
    if (!termOrgId && req.user.role === 'org_admin') {
      return res.status(400).json({ error: 'Organization context required' });
    }

    // Auto-generate name if not provided
    const termName = (name && name.trim()) || `Term ${new Date(start_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;

    const result = db.prepare(
      'INSERT INTO terms (name, start_date, end_date, school_id, org_id) VALUES (?, ?, ?, ?, ?)'
    ).run(termName, start_date, end_date, termOrgId || 1, termOrgId);

    // Auto-create one default feedback period spanning the whole term
    const termId = result.lastInsertRowid;
    db.prepare(
      'INSERT INTO feedback_periods (term_id, name, start_date, end_date, active_status) VALUES (?, ?, ?, ?, 0)'
    ).run(termId, 'Feedback Period', start_date, end_date);

    const term = db.prepare('SELECT * FROM terms WHERE id = ?').get(termId);
    const periods = db.prepare('SELECT * FROM feedback_periods WHERE term_id = ?').all(termId);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'term_create',
      actionDescription: `Created term: ${termName} (${start_date} to ${end_date})`,
      targetType: 'term',
      targetId: termId,
      metadata: { name, start_date, end_date, org_id: termOrgId },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.status(201).json({ ...term, periods });
  } catch (err) {
    console.error('Create term error:', err);
    res.status(500).json({ error: 'Failed to create term' });
  }
});

// PUT /api/admin/terms/:id
router.put('/terms/:id', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const { name, start_date, end_date, active_status, feedback_visible } = req.body;
    const term = db.prepare('SELECT * FROM terms WHERE id = ?').get(req.params.id);
    if (!term) return res.status(404).json({ error: 'Term not found' });

    // org_admin can only modify terms in their org
    if (req.user.role === 'org_admin' && term.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Term does not belong to your organization' });
    }

    // Validate date range if either date is being updated
    const effectiveTermStart = start_date || term.start_date;
    const effectiveTermEnd = end_date || term.end_date;
    if (effectiveTermStart && effectiveTermEnd && effectiveTermStart >= effectiveTermEnd) {
      return res.status(400).json({ error: 'Start date must be before end date' });
    }

    // If activating, deactivate others in same org
    if (active_status === 1) {
      db.prepare('UPDATE terms SET active_status = 0 WHERE org_id = ?').run(term.org_id);
    }

    db.prepare(`
      UPDATE terms SET
        name = COALESCE(?, name),
        start_date = COALESCE(?, start_date),
        end_date = COALESCE(?, end_date),
        active_status = COALESCE(?, active_status),
        feedback_visible = COALESCE(?, feedback_visible)
      WHERE id = ?
    `).run(name, start_date, end_date, active_status, feedback_visible, req.params.id);

    const updated = db.prepare('SELECT * FROM terms WHERE id = ?').get(req.params.id);

    const changes = [];
    if (name) changes.push(`name to "${name}"`);
    if (start_date) changes.push(`start date to ${start_date}`);
    if (end_date) changes.push(`end date to ${end_date}`);
    if (active_status !== undefined) changes.push(active_status ? 'activated' : 'deactivated');
    if (feedback_visible !== undefined) changes.push(feedback_visible ? 'feedback visible' : 'feedback hidden');

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: active_status === 1 ? 'term_activate' : 'term_update',
      actionDescription: `Updated term "${term.name}": ${changes.join(', ')}`,
      targetType: 'term',
      targetId: term.id,
      metadata: { name, start_date, end_date, active_status, feedback_visible },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.json(updated);
  } catch (err) {
    console.error('Update term error:', err);
    res.status(500).json({ error: 'Failed to update term' });
  }
});

// DELETE /api/admin/terms/:id
router.delete('/terms/:id', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const term = db.prepare('SELECT * FROM terms WHERE id = ?').get(req.params.id);
    if (!term) return res.status(404).json({ error: 'Term not found' });

    if (req.user.role === 'org_admin' && term.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Term does not belong to your organization' });
    }

    if (term.active_status) {
      return res.status(400).json({ error: 'Cannot delete an active term. Deactivate it first.' });
    }

    db.prepare('DELETE FROM terms WHERE id = ?').run(req.params.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'term_delete',
      actionDescription: `Deleted term "${term.name}" and all associated data`,
      targetType: 'term',
      targetId: term.id,
      metadata: { term_name: term.name },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.json({ message: 'Term and all associated data deleted successfully' });
  } catch (err) {
    console.error('Delete term error:', err);
    res.status(500).json({ error: 'Failed to delete term' });
  }
});

// ============ FEEDBACK PERIOD MANAGEMENT ============

// GET /api/admin/feedback-periods
router.get('/feedback-periods', authenticate, authorize('super_admin', 'org_admin', 'teacher', 'school_head'), authorizeOrg, (req, res) => {
  try {
    const { term_id } = req.query;
    const params = [];
    let query = `
      SELECT fp.*, t.name as term_name
      FROM feedback_periods fp
      JOIN terms t ON fp.term_id = t.id
      WHERE 1=1
    `;

    if (term_id) {
      query += ' AND fp.term_id = ?';
      params.push(term_id);
    }

    // Org scoping via terms
    if (req.orgId) {
      query += ' AND t.org_id = ?';
      params.push(req.orgId);
    } else if (req.user.role !== 'super_admin' && req.user.org_id) {
      query += ' AND t.org_id = ?';
      params.push(req.user.org_id);
    }

    query += ' ORDER BY fp.term_id, fp.id';

    res.json(db.prepare(query).all(...params));
  } catch (err) {
    console.error('List periods error:', err);
    res.status(500).json({ error: 'Failed to fetch feedback periods' });
  }
});

// POST /api/admin/feedback-periods
router.post('/feedback-periods', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const { term_id, name, start_date, end_date } = req.body;
    if (!term_id || !start_date || !end_date) {
      return res.status(400).json({ error: 'term_id, start_date, and end_date are required' });
    }

    const term = db.prepare('SELECT * FROM terms WHERE id = ?').get(term_id);
    if (!term) return res.status(404).json({ error: 'Term not found' });

    if (req.user.role === 'org_admin' && term.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Term does not belong to your organization' });
    }

    if (start_date >= end_date) {
      return res.status(400).json({ error: 'Start date must be before end date' });
    }

    // Validate period dates are within term dates
    if (term.start_date && start_date < term.start_date) {
      return res.status(400).json({ error: `Period start date cannot be before term start date (${term.start_date})` });
    }
    if (term.end_date && end_date > term.end_date) {
      return res.status(400).json({ error: `Period end date cannot be after term end date (${term.end_date})` });
    }

    // Count existing periods to auto-name
    const existingCount = db.prepare('SELECT COUNT(*) as c FROM feedback_periods WHERE term_id = ?').get(term_id).c;
    const periodName = (name && name.trim()) || `Period ${existingCount + 1}`;

    const result = db.prepare(
      'INSERT INTO feedback_periods (term_id, name, start_date, end_date, active_status) VALUES (?, ?, ?, ?, 0)'
    ).run(term_id, periodName, start_date, end_date);

    const period = db.prepare('SELECT * FROM feedback_periods WHERE id = ?').get(result.lastInsertRowid);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'period_create',
      actionDescription: `Created feedback period: ${periodName} for term "${term.name}"`,
      targetType: 'feedback_period',
      targetId: period.id,
      metadata: { term_id, name, start_date, end_date },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.status(201).json(period);
  } catch (err) {
    console.error('Create period error:', err);
    res.status(500).json({ error: 'Failed to create feedback period' });
  }
});

// PUT /api/admin/feedback-periods/:id
router.put('/feedback-periods/:id', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const { active_status, name, start_date, end_date } = req.body;
    const period = db.prepare(`
      SELECT fp.*, t.org_id FROM feedback_periods fp JOIN terms t ON fp.term_id = t.id WHERE fp.id = ?
    `).get(req.params.id);
    if (!period) return res.status(404).json({ error: 'Feedback period not found' });

    // org_admin ownership check via term's org
    if (req.user.role === 'org_admin' && period.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Period does not belong to your organization' });
    }

    // Validate date range if either date is being updated
    const effectiveStart = start_date || period.start_date;
    const effectiveEnd = end_date || period.end_date;
    if (effectiveStart && effectiveEnd && effectiveStart > effectiveEnd) {
      return res.status(400).json({ error: 'Start date must be before end date' });
    }

    // If activating, deactivate all others in same term
    if (active_status === 1) {
      db.prepare('UPDATE feedback_periods SET active_status = 0 WHERE term_id = ?').run(period.term_id);
    }

    db.prepare(`
      UPDATE feedback_periods SET
        name = COALESCE(?, name),
        active_status = COALESCE(?, active_status),
        start_date = COALESCE(?, start_date),
        end_date = COALESCE(?, end_date)
      WHERE id = ?
    `).run(name || null, active_status, start_date, end_date, req.params.id);

    const updated = db.prepare('SELECT * FROM feedback_periods WHERE id = ?').get(req.params.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: active_status === 1 ? 'period_activate' : 'period_update',
      actionDescription: `${active_status === 1 ? 'Opened' : 'Updated'} feedback period: ${period.name}`,
      targetType: 'feedback_period',
      targetId: period.id,
      metadata: { active_status, name, start_date, end_date },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    // Notify all org members when a feedback period is opened
    if (active_status === 1 && period.org_id) {
      const members = db.prepare('SELECT user_id FROM user_organizations WHERE org_id = ?').all(period.org_id);
      const userIds = members.map(m => m.user_id).filter(id => id !== req.user.id);
      const periodName = name || period.name;
      createNotifications({
        userIds,
        orgId: period.org_id,
        type: 'period_open',
        title: `Feedback period "${periodName}" is now open`,
        body: 'You can now submit teacher reviews.',
        link: 'student-review'
      });
    }

    res.json(updated);
  } catch (err) {
    console.error('Update period error:', err);
    res.status(500).json({ error: 'Failed to update feedback period' });
  }
});

// DELETE /api/admin/feedback-periods/:id
router.delete('/feedback-periods/:id', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const period = db.prepare(`
      SELECT fp.*, t.org_id, t.name as term_name FROM feedback_periods fp
      JOIN terms t ON fp.term_id = t.id WHERE fp.id = ?
    `).get(req.params.id);
    if (!period) return res.status(404).json({ error: 'Feedback period not found' });

    if (req.user.role === 'org_admin' && period.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Period does not belong to your organization' });
    }

    const reviewCount = db.prepare('SELECT COUNT(*) as count FROM reviews WHERE feedback_period_id = ?').get(req.params.id).count;
    if (reviewCount > 0) {
      return res.status(400).json({ error: `Cannot delete: ${reviewCount} review(s) exist for this period` });
    }

    db.prepare('DELETE FROM feedback_periods WHERE id = ?').run(req.params.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'period_delete',
      actionDescription: `Deleted feedback period: ${period.name} from term "${period.term_name}"`,
      targetType: 'feedback_period',
      targetId: period.id,
      metadata: {},
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Delete period error:', err);
    res.status(500).json({ error: 'Failed to delete feedback period' });
  }
});

// ============ REVIEW MODERATION ============

// Helper to build review query with org scoping
function reviewQuery(statusFilter, req) {
  const params = [];
  let where = '';

  if (statusFilter) {
    where = `WHERE r.flagged_status = '${statusFilter}'`;
  }

  // Org scoping
  if (req.orgId) {
    where += (where ? ' AND' : 'WHERE') + ' r.org_id = ?';
    params.push(req.orgId);
  }

  return {
    sql: `
      SELECT r.*, te.full_name as teacher_name, c.subject as classroom_subject,
        c.grade_level, fp.name as period_name, t.name as term_name,
        u.full_name as student_name, u.email as student_email, u.grade_or_position as student_grade
      FROM reviews r
      JOIN teachers te ON r.teacher_id = te.id
      JOIN classrooms c ON r.classroom_id = c.id
      JOIN feedback_periods fp ON r.feedback_period_id = fp.id
      JOIN terms t ON r.term_id = t.id
      JOIN users u ON r.student_id = u.id
      ${where}
      ORDER BY r.created_at ${statusFilter ? 'ASC' : 'DESC'}
    `,
    params
  };
}

// GET /api/admin/reviews/pending
router.get('/reviews/pending', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const { sql, params } = reviewQuery('pending', req);
    res.json(db.prepare(sql).all(...params));
  } catch (err) {
    console.error('Pending reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch pending reviews' });
  }
});

// GET /api/admin/reviews/flagged
router.get('/reviews/flagged', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const { sql, params } = reviewQuery('flagged', req);
    res.json(db.prepare(sql).all(...params));
  } catch (err) {
    console.error('Flagged reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch flagged reviews' });
  }
});

// GET /api/admin/reviews/all
router.get('/reviews/all', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const { sql, params } = reviewQuery(null, req);
    res.json(db.prepare(sql).all(...params));
  } catch (err) {
    console.error('All reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// Helper for review ownership check
function checkReviewOrg(reviewId, req) {
  const review = db.prepare(`
    SELECT r.*, r.org_id as review_org_id, te.full_name as teacher_name, u.full_name as student_name
    FROM reviews r
    JOIN teachers te ON r.teacher_id = te.id
    JOIN users u ON r.student_id = u.id
    WHERE r.id = ?
  `).get(reviewId);

  if (review && req.user.role === 'org_admin' && review.review_org_id !== req.orgId) {
    return { error: true, review };
  }
  return { error: false, review };
}

// PUT /api/admin/reviews/:id/approve
router.put('/reviews/:id/approve', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const { error, review } = checkReviewOrg(req.params.id, req);
    if (error) return res.status(403).json({ error: 'Review does not belong to your organization' });

    db.prepare("UPDATE reviews SET flagged_status = 'approved', approved_status = 1 WHERE id = ?")
      .run(req.params.id);

    if (review) {
      logAuditEvent({
        userId: req.user.id,
        userRole: req.user.role,
        userName: req.user.full_name,
        actionType: 'review_approve',
        actionDescription: `Approved review from ${review.student_name} for ${review.teacher_name}`,
        targetType: 'review',
        targetId: review.id,
        metadata: { teacher_id: review.teacher_id, student_id: review.student_id, rating: review.overall_rating },
        ipAddress: req.ip,
        orgId: req.orgId
      });

      // Notify the student whose review was approved
      createNotifications({
        userIds: [review.student_id],
        orgId: review.review_org_id,
        type: 'review_approved',
        title: 'Your review has been approved',
        body: `Your feedback for ${review.teacher_name} is now visible.`,
        link: 'student-my-reviews'
      });
    }

    res.json({ message: 'Review approved' });
  } catch (err) {
    console.error('Approve review error:', err);
    res.status(500).json({ error: 'Failed to approve review' });
  }
});

// PUT /api/admin/reviews/:id/reject
router.put('/reviews/:id/reject', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const { error, review } = checkReviewOrg(req.params.id, req);
    if (error) return res.status(403).json({ error: 'Review does not belong to your organization' });

    db.prepare("UPDATE reviews SET flagged_status = 'rejected', approved_status = 0 WHERE id = ?")
      .run(req.params.id);

    if (review) {
      logAuditEvent({
        userId: req.user.id,
        userRole: req.user.role,
        userName: req.user.full_name,
        actionType: 'review_reject',
        actionDescription: `Rejected review from ${review.student_name} for ${review.teacher_name}`,
        targetType: 'review',
        targetId: review.id,
        metadata: { teacher_id: review.teacher_id, student_id: review.student_id, rating: review.overall_rating },
        ipAddress: req.ip,
        orgId: req.orgId
      });
    }

    res.json({ message: 'Review rejected' });
  } catch (err) {
    console.error('Reject review error:', err);
    res.status(500).json({ error: 'Failed to reject review' });
  }
});

// DELETE /api/admin/reviews/:id
router.delete('/reviews/:id', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const { error, review } = checkReviewOrg(req.params.id, req);
    if (error) return res.status(403).json({ error: 'Review does not belong to your organization' });

    db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);

    if (review) {
      logAuditEvent({
        userId: req.user.id,
        userRole: req.user.role,
        userName: req.user.full_name,
        actionType: 'review_delete',
        actionDescription: `Permanently deleted review from ${review.student_name} for ${review.teacher_name}`,
        targetType: 'review',
        targetId: review.id,
        metadata: { teacher_id: review.teacher_id, student_id: review.student_id, rating: review.overall_rating },
        ipAddress: req.ip,
        orgId: req.orgId
      });
    }

    res.json({ message: 'Review permanently removed' });
  } catch (err) {
    console.error('Delete review error:', err);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

// POST /api/admin/reviews/bulk-approve - bulk approve pending reviews
router.post('/reviews/bulk-approve', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const { review_ids } = req.body;
    if (!review_ids || !Array.isArray(review_ids) || review_ids.length === 0) {
      return res.status(400).json({ error: 'review_ids array is required' });
    }

    // Org scoping: only approve reviews in the admin's org
    let ids = review_ids;
    if (req.user.role === 'org_admin' && req.orgId) {
      const orgReviews = db.prepare(
        `SELECT id FROM reviews WHERE id IN (${review_ids.map(() => '?').join(',')}) AND org_id = ?`
      ).all(...review_ids, req.orgId);
      ids = orgReviews.map(r => r.id);
    }

    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`
        UPDATE reviews
        SET flagged_status = 'approved', approved_status = 1
        WHERE id IN (${placeholders})
      `).run(...ids);
    }

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'review_bulk_approve',
      actionDescription: `Bulk approved ${ids.length} reviews`,
      targetType: 'review',
      metadata: { count: ids.length, review_ids: ids },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.json({ message: `Approved ${ids.length} reviews`, count: ids.length });
  } catch (err) {
    console.error('Bulk approve error:', err);
    res.status(500).json({ error: 'Failed to bulk approve reviews' });
  }
});

// ============ CLASSROOM MANAGEMENT ============

// GET /api/admin/classrooms - list all classrooms
router.get('/classrooms', authenticate, authorize('super_admin', 'org_admin', 'school_head'), authorizeOrg, (req, res) => {
  try {
    const params = [];
    let where = 'WHERE 1=1';

    if (req.orgId) {
      where += ' AND c.org_id = ?';
      params.push(req.orgId);
    } else if (req.user.role !== 'super_admin' && req.user.org_id) {
      where += ' AND c.org_id = ?';
      params.push(req.user.org_id);
    }

    const classrooms = db.prepare(`
      SELECT c.*, te.full_name as teacher_name, t.name as term_name,
        o.name as org_name,
        (SELECT COUNT(*) FROM classroom_members WHERE classroom_id = c.id) as student_count
      FROM classrooms c
      JOIN teachers te ON c.teacher_id = te.id
      LEFT JOIN terms t ON c.term_id = t.id
      LEFT JOIN organizations o ON c.org_id = o.id
      ${where}
      ORDER BY c.created_at DESC
    `).all(...params);

    res.json(classrooms);
  } catch (err) {
    console.error('List classrooms error:', err);
    res.status(500).json({ error: 'Failed to fetch classrooms' });
  }
});

// PUT /api/admin/classrooms/:id - edit classroom
router.put('/classrooms/:id', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(req.params.id);
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });

    if (req.user.role === 'org_admin' && classroom.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Classroom does not belong to your organization' });
    }

    const { subject, grade_level, teacher_id, term_id, active_status } = req.body;

    if (subject !== undefined && !subject?.trim()) {
      return res.status(400).json({ error: 'Subject cannot be empty' });
    }
    if (grade_level !== undefined && !grade_level?.trim()) {
      return res.status(400).json({ error: 'Grade level cannot be empty' });
    }

    db.prepare(`
      UPDATE classrooms SET
        subject = COALESCE(?, subject),
        grade_level = COALESCE(?, grade_level),
        teacher_id = COALESCE(?, teacher_id),
        term_id = COALESCE(?, term_id),
        active_status = COALESCE(?, active_status)
      WHERE id = ?
    `).run(subject, grade_level, teacher_id, term_id, active_status, req.params.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'classroom_edit',
      actionDescription: `Edited classroom ${classroom.subject} (${classroom.grade_level})`,
      targetType: 'classroom',
      targetId: classroom.id,
      metadata: { changes: req.body },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    const updated = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error('Edit classroom error:', err);
    res.status(500).json({ error: 'Failed to edit classroom' });
  }
});

// DELETE /api/admin/classrooms/:id - delete classroom
router.delete('/classrooms/:id', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(req.params.id);
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });

    if (req.user.role === 'org_admin' && classroom.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Classroom does not belong to your organization' });
    }

    db.prepare('DELETE FROM classrooms WHERE id = ?').run(req.params.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'classroom_delete',
      actionDescription: `Deleted classroom ${classroom.subject} (${classroom.grade_level})`,
      targetType: 'classroom',
      targetId: classroom.id,
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.json({ message: 'Classroom deleted successfully' });
  } catch (err) {
    console.error('Delete classroom error:', err);
    res.status(500).json({ error: 'Failed to delete classroom' });
  }
});

// POST /api/admin/classrooms/:id/add-student - add student to classroom
router.post('/classrooms/:id/add-student', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const { student_id } = req.body;
    if (!student_id) return res.status(400).json({ error: 'student_id is required' });

    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(req.params.id);
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });

    if (req.user.role === 'org_admin' && classroom.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Classroom does not belong to your organization' });
    }

    const student = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(student_id);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const existing = db.prepare('SELECT id FROM classroom_members WHERE classroom_id = ? AND student_id = ?')
      .get(req.params.id, student_id);
    if (existing) return res.status(409).json({ error: 'Student already in classroom' });

    db.prepare('INSERT INTO classroom_members (classroom_id, student_id) VALUES (?, ?)')
      .run(req.params.id, student_id);

    // Auto-associate student with the classroom's org
    if (classroom.org_id) {
      db.prepare('INSERT OR IGNORE INTO user_organizations (user_id, org_id, role_in_org) VALUES (?, ?, ?)')
        .run(student_id, classroom.org_id, 'student');
    }

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'classroom_add_student',
      actionDescription: `Added ${student.full_name} to classroom ${classroom.subject}`,
      targetType: 'classroom',
      targetId: classroom.id,
      metadata: { student_id, student_name: student.full_name },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.json({ message: 'Student added to classroom' });
  } catch (err) {
    console.error('Add student error:', err);
    res.status(500).json({ error: 'Failed to add student' });
  }
});

// DELETE /api/admin/classrooms/:id/remove-student/:student_id - remove student
router.delete('/classrooms/:id/remove-student/:student_id', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(req.params.id);
    if (classroom && req.user.role === 'org_admin' && classroom.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Classroom does not belong to your organization' });
    }

    const result = db.prepare('DELETE FROM classroom_members WHERE classroom_id = ? AND student_id = ?')
      .run(req.params.id, req.params.student_id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Student not in classroom' });
    }

    const student = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.params.student_id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'classroom_remove_student',
      actionDescription: `Removed ${student?.full_name} from classroom ${classroom?.subject}`,
      targetType: 'classroom',
      targetId: parseInt(req.params.id),
      metadata: { student_id: req.params.student_id },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.json({ message: 'Student removed from classroom' });
  } catch (err) {
    console.error('Remove student error:', err);
    res.status(500).json({ error: 'Failed to remove student' });
  }
});

// ============ STUDENT SUBMISSION TRACKING ============

// GET /api/admin/submission-tracking
router.get('/submission-tracking', authenticate, authorize('super_admin', 'org_admin', 'school_head'), authorizeOrg, (req, res) => {
  try {
    const { classroom_id, feedback_period_id } = req.query;

    if (!classroom_id || !feedback_period_id) {
      return res.status(400).json({ error: 'classroom_id and feedback_period_id are required' });
    }

    // Org ownership check
    const classroom = db.prepare(`
      SELECT c.*, te.full_name as teacher_name, t.name as term_name
      FROM classrooms c
      JOIN teachers te ON c.teacher_id = te.id
      LEFT JOIN terms t ON c.term_id = t.id
      WHERE c.id = ?
    `).get(classroom_id);

    if (classroom && req.user.role === 'org_admin' && classroom.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Classroom does not belong to your organization' });
    }

    const students = db.prepare(`
      SELECT u.id, u.full_name, u.email, u.grade_or_position, cm.joined_at
      FROM classroom_members cm
      JOIN users u ON cm.student_id = u.id
      WHERE cm.classroom_id = ?
      ORDER BY u.full_name
    `).all(classroom_id);

    const studentsWithStatus = students.map(student => {
      const review = db.prepare(`
        SELECT id, overall_rating, flagged_status, created_at
        FROM reviews
        WHERE student_id = ? AND classroom_id = ? AND feedback_period_id = ?
      `).get(student.id, classroom_id, feedback_period_id);

      return {
        ...student,
        submitted: review !== undefined,
        review_id: review?.id,
        overall_rating: review?.overall_rating,
        flagged_status: review?.flagged_status,
        submitted_at: review?.created_at
      };
    });

    const period = db.prepare('SELECT * FROM feedback_periods WHERE id = ?').get(feedback_period_id);

    const submitted = studentsWithStatus.filter(s => s.submitted).length;
    const total = studentsWithStatus.length;

    res.json({
      classroom,
      period,
      students: studentsWithStatus,
      summary: {
        total_students: total,
        submitted: submitted,
        not_submitted: total - submitted,
        completion_rate: total > 0 ? Math.round((submitted / total) * 100) : 100
      }
    });
  } catch (err) {
    console.error('Submission tracking error:', err);
    res.status(500).json({ error: 'Failed to fetch submission tracking' });
  }
});

// GET /api/admin/submission-overview
router.get('/submission-overview', authenticate, authorize('super_admin', 'org_admin', 'school_head'), authorizeOrg, (req, res) => {
  try {
    const { feedback_period_id } = req.query;

    if (!feedback_period_id) {
      return res.status(400).json({ error: 'feedback_period_id is required' });
    }

    const params = [feedback_period_id];
    let where = 'WHERE c.active_status = 1';

    if (req.orgId) {
      where += ' AND c.org_id = ?';
      params.push(req.orgId);
    } else if (req.user.role !== 'super_admin' && req.user.org_id) {
      where += ' AND c.org_id = ?';
      params.push(req.user.org_id);
    }

    const classrooms = db.prepare(`
      SELECT c.*, te.full_name as teacher_name, t.name as term_name,
        (SELECT COUNT(*) FROM classroom_members WHERE classroom_id = c.id) as total_students,
        (SELECT COUNT(DISTINCT student_id) FROM reviews WHERE classroom_id = c.id AND feedback_period_id = ?) as submitted_count
      FROM classrooms c
      JOIN teachers te ON c.teacher_id = te.id
      LEFT JOIN terms t ON c.term_id = t.id
      ${where}
      ORDER BY c.subject, c.grade_level
    `).all(...params);

    const classroomsWithRates = classrooms.map(c => ({
      ...c,
      not_submitted: c.total_students - c.submitted_count,
      completion_rate: c.total_students > 0 ? Math.round((c.submitted_count / c.total_students) * 100) : 100
    }));

    const period = db.prepare('SELECT * FROM feedback_periods WHERE id = ?').get(feedback_period_id);

    const totalStudents = classrooms.reduce((sum, c) => sum + c.total_students, 0);
    const totalSubmitted = classrooms.reduce((sum, c) => sum + c.submitted_count, 0);

    res.json({
      period,
      classrooms: classroomsWithRates,
      summary: {
        total_classrooms: classrooms.length,
        total_students: totalStudents,
        total_submitted: totalSubmitted,
        total_not_submitted: totalStudents - totalSubmitted,
        overall_completion_rate: totalStudents > 0 ? Math.round((totalSubmitted / totalStudents) * 100) : 100
      }
    });
  } catch (err) {
    console.error('Submission overview error:', err);
    res.status(500).json({ error: 'Failed to fetch submission overview' });
  }
});

// ============ TEACHER FEEDBACK VIEWING ============

// GET /api/admin/teacher/:id/feedback
router.get('/teacher/:id/feedback', authenticate, authorize('super_admin', 'org_admin', 'school_head'), authorizeOrg, (req, res) => {
  try {
    const teacher = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

    // Org check
    if (['org_admin', 'school_head'].includes(req.user.role) && teacher.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Teacher does not belong to your organization' });
    }

    const { term_id, period_id, classroom_id } = req.query;

    let query = `
      SELECT r.id, r.overall_rating, r.clarity_rating, r.engagement_rating,
        r.fairness_rating, r.supportiveness_rating, r.preparation_rating, r.workload_rating,
        r.feedback_text, r.tags, r.created_at, r.flagged_status, r.approved_status,
        c.subject as classroom_subject, c.grade_level,
        fp.name as period_name, t.name as term_name
      FROM reviews r
      JOIN classrooms c ON r.classroom_id = c.id
      JOIN feedback_periods fp ON r.feedback_period_id = fp.id
      JOIN terms t ON r.term_id = t.id
      WHERE r.teacher_id = ? AND r.approved_status = 1
    `;
    const params = [req.params.id];

    if (term_id) { query += ' AND r.term_id = ?'; params.push(term_id); }
    if (period_id) { query += ' AND r.feedback_period_id = ?'; params.push(period_id); }
    if (classroom_id) { query += ' AND r.classroom_id = ?'; params.push(classroom_id); }

    query += ' ORDER BY r.created_at DESC';

    const reviews = db.prepare(query).all(...params);

    const { getTeacherScores, getRatingDistribution } = require('../utils/scoring');
    const scores = getTeacherScores(teacher.id, {
      termId: term_id ? parseInt(term_id) : undefined,
      feedbackPeriodId: period_id ? parseInt(period_id) : undefined,
      classroomId: classroom_id ? parseInt(classroom_id) : undefined
    });

    const distribution = getRatingDistribution(teacher.id, {
      termId: term_id ? parseInt(term_id) : undefined,
      feedbackPeriodId: period_id ? parseInt(period_id) : undefined,
      classroomId: classroom_id ? parseInt(classroom_id) : undefined
    });

    res.json({ teacher, reviews, scores, distribution });
  } catch (err) {
    console.error('Teacher feedback error:', err);
    res.status(500).json({ error: 'Failed to fetch teacher feedback' });
  }
});

// GET /api/admin/teachers
router.get('/teachers', authenticate, authorize('super_admin', 'org_admin', 'school_head'), authorizeOrg, (req, res) => {
  try {
    const params = [];
    let where = 'WHERE 1=1';

    if (req.orgId) {
      where += ' AND org_id = ?';
      params.push(req.orgId);
    } else if (req.user.role !== 'super_admin' && req.user.org_id) {
      where += ' AND org_id = ?';
      params.push(req.user.org_id);
    }

    const teachers = db.prepare(`SELECT * FROM teachers ${where} ORDER BY full_name`).all(...params);
    const { getTeacherScores } = require('../utils/scoring');

    const teachersWithStats = teachers.map(t => ({
      ...t,
      scores: getTeacherScores(t.id)
    }));

    res.json(teachersWithStats);
  } catch (err) {
    console.error('List teachers error:', err);
    res.status(500).json({ error: 'Failed to fetch teachers' });
  }
});

// PUT /api/admin/teachers/:id
router.put('/teachers/:id', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const teacher = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

    if (req.user.role === 'org_admin' && teacher.org_id !== req.orgId) {
      return res.status(403).json({ error: 'Teacher does not belong to your organization' });
    }

    const { full_name, subject, department, experience_years, bio } = req.body;

    db.prepare(`
      UPDATE teachers SET
        full_name = COALESCE(?, full_name),
        subject = COALESCE(?, subject),
        department = COALESCE(?, department),
        experience_years = COALESCE(?, experience_years),
        bio = COALESCE(?, bio)
      WHERE id = ?
    `).run(
      full_name ? sanitizeInput(full_name) : null,
      subject, department, experience_years, bio, req.params.id
    );

    if (full_name && teacher.user_id) {
      db.prepare('UPDATE users SET full_name = ? WHERE id = ?')
        .run(sanitizeInput(full_name), teacher.user_id);
    }

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'teacher_edit',
      actionDescription: `Edited teacher profile for ${teacher.full_name}`,
      targetType: 'teacher',
      targetId: teacher.id,
      metadata: { changes: req.body },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    const updated = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error('Edit teacher error:', err);
    res.status(500).json({ error: 'Failed to edit teacher' });
  }
});

// ============ AUDIT LOGS ============

// GET /api/admin/audit-logs
router.get('/audit-logs', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const { user_id, action_type, target_type, target_id, start_date, end_date, limit, offset } = req.query;

    const logs = getAuditLogs({
      userId: user_id ? parseInt(user_id) : undefined,
      actionType: action_type,
      targetType: target_type,
      targetId: target_id ? parseInt(target_id) : undefined,
      startDate: start_date,
      endDate: end_date,
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0,
      orgId: req.orgId
    });

    res.json(logs);
  } catch (err) {
    console.error('Audit logs error:', err);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// GET /api/admin/audit-stats
router.get('/audit-stats', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    const stats = getAuditStats({
      startDate: start_date,
      endDate: end_date,
      orgId: req.orgId
    });

    res.json(stats);
  } catch (err) {
    console.error('Audit stats error:', err);
    res.status(500).json({ error: 'Failed to fetch audit statistics' });
  }
});

// ============ STATISTICS ============

// GET /api/admin/stats
router.get('/stats', authenticate, authorize('super_admin', 'org_admin', 'school_head'), authorizeOrg, (req, res) => {
  try {
    let orgWhere = '';
    let orgWhereReviews = '';
    const params = [];
    const reviewParams = [];

    if (req.orgId) {
      orgWhere = ' AND org_id = ?';
      orgWhereReviews = ' AND org_id = ?';
    } else if (req.user.role !== 'super_admin' && req.user.org_id) {
      orgWhere = ' AND org_id = ?';
      orgWhereReviews = ' AND org_id = ?';
    }

    const orgVal = req.orgId || (req.user.role !== 'super_admin' ? req.user.org_id : null);

    const buildParams = () => orgVal ? [orgVal] : [];

    const totalUsers = db.prepare(`SELECT COUNT(*) as count FROM users WHERE 1=1${orgWhere}`).get(...buildParams()).count;
    const totalStudents = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'student'${orgWhere}`).get(...buildParams()).count;
    const totalTeachers = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'teacher'${orgWhere}`).get(...buildParams()).count;
    const totalClassrooms = db.prepare(`SELECT COUNT(*) as count FROM classrooms WHERE 1=1${orgWhere ? ' AND org_id = ?' : ''}`).get(...buildParams()).count;
    const totalReviews = db.prepare(`SELECT COUNT(*) as count FROM reviews WHERE 1=1${orgWhereReviews}`).get(...buildParams()).count;
    const pendingReviews = db.prepare(`SELECT COUNT(*) as count FROM reviews WHERE flagged_status = 'pending'${orgWhereReviews}`).get(...buildParams()).count;
    const flaggedReviews = db.prepare(`SELECT COUNT(*) as count FROM reviews WHERE flagged_status = 'flagged'${orgWhereReviews}`).get(...buildParams()).count;
    const approvedReviews = db.prepare(`SELECT COUNT(*) as count FROM reviews WHERE approved_status = 1${orgWhereReviews}`).get(...buildParams()).count;

    const avgRating = db.prepare(
      `SELECT ROUND(AVG(overall_rating), 2) as avg FROM reviews WHERE approved_status = 1${orgWhereReviews}`
    ).get(...buildParams()).avg;

    const ratingDist = db.prepare(
      `SELECT overall_rating as rating, COUNT(*) as count FROM reviews WHERE approved_status = 1${orgWhereReviews} GROUP BY overall_rating ORDER BY overall_rating`
    ).all(...buildParams());
    const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    ratingDist.forEach(r => { ratingDistribution[r.rating] = r.count; });

    const totalAdmins = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role IN ('super_admin', 'org_admin')${orgWhere}`).get(...buildParams()).count;
    const totalSchoolHeads = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'school_head'${orgWhere}`).get(...buildParams()).count;

    // Add org count for super_admin
    const totalOrgs = req.user.role === 'super_admin'
      ? db.prepare('SELECT COUNT(*) as count FROM organizations').get().count
      : undefined;

    res.json({
      total_users: totalUsers,
      total_students: totalStudents,
      total_teachers: totalTeachers,
      total_admins: totalAdmins,
      total_school_heads: totalSchoolHeads,
      total_classrooms: totalClassrooms,
      total_reviews: totalReviews,
      pending_reviews: pendingReviews,
      flagged_reviews: flaggedReviews,
      approved_reviews: approvedReviews,
      average_rating: avgRating,
      rating_distribution: ratingDistribution,
      ...(totalOrgs !== undefined && { total_organizations: totalOrgs })
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// GET /api/admin/org-period-trend — per-feedback-period avg ratings for an org
router.get('/org-period-trend', authenticate, authorize('super_admin', 'org_admin'), (req, res) => {
  try {
    const orgId = req.user.role === 'org_admin'
      ? req.user.org_id
      : (req.query.org_id ? parseInt(req.query.org_id) : null);

    if (!orgId) return res.status(400).json({ error: 'org_id is required for super_admin' });

    const periods = db.prepare(`
      SELECT
        fp.id, fp.name as period_name, t.id as term_id, t.name as term_name,
        COUNT(r.id) as review_count,
        ROUND((
          AVG(NULLIF(r.clarity_rating,0)) +
          AVG(NULLIF(r.engagement_rating,0)) +
          AVG(NULLIF(r.fairness_rating,0)) +
          AVG(NULLIF(r.supportiveness_rating,0)) +
          AVG(NULLIF(r.preparation_rating,0)) +
          AVG(NULLIF(r.workload_rating,0))
        ) / 6, 2) as avg_overall,
        ROUND(AVG(NULLIF(r.clarity_rating,0)), 2) as avg_clarity,
        ROUND(AVG(NULLIF(r.engagement_rating,0)), 2) as avg_engagement,
        ROUND(AVG(NULLIF(r.fairness_rating,0)), 2) as avg_fairness,
        ROUND(AVG(NULLIF(r.supportiveness_rating,0)), 2) as avg_supportiveness,
        ROUND(AVG(NULLIF(r.preparation_rating,0)), 2) as avg_preparation,
        ROUND(AVG(NULLIF(r.workload_rating,0)), 2) as avg_workload
      FROM feedback_periods fp
      JOIN terms t ON fp.term_id = t.id
      LEFT JOIN reviews r ON r.feedback_period_id = fp.id
        AND r.approved_status = 1 AND r.org_id = ?
      WHERE t.org_id = ?
      GROUP BY fp.id
      ORDER BY t.start_date ASC, fp.id ASC
    `).all(orgId, orgId);

    res.json(periods);
  } catch (err) {
    console.error('Org period trend error:', err);
    res.status(500).json({ error: 'Failed to fetch period trend' });
  }
});

// ============ SUPPORT MESSAGES MANAGEMENT ============

// GET /api/admin/support/messages
router.get('/support/messages', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const { status, user_id, category, limit, offset } = req.query;

    let query = 'SELECT sm.*, o.name as org_name FROM support_messages sm LEFT JOIN organizations o ON sm.org_id = o.id WHERE 1=1';
    let countQuery = 'SELECT COUNT(*) as count FROM support_messages sm WHERE 1=1';
    const params = [];
    const countParams = [];

    // Org scoping: org_admin sees only org-level messages (not technical/feature requests)
    if (req.user.role === 'org_admin' && req.orgId) {
      const orgFilter = ' AND (sm.org_id = ? OR sm.user_id IN (SELECT user_id FROM user_organizations WHERE org_id = ?))';
      query += orgFilter;
      countQuery += orgFilter;
      params.push(req.orgId, req.orgId);
      countParams.push(req.orgId, req.orgId);
      // Org admins only see org-relevant categories, not platform-level ones
      const catFilter = " AND sm.category NOT IN ('technical', 'feature')";
      query += catFilter;
      countQuery += catFilter;
    } else if (req.orgId) {
      const orgFilter = ' AND (sm.org_id = ? OR sm.user_id IN (SELECT user_id FROM user_organizations WHERE org_id = ?))';
      query += orgFilter;
      countQuery += orgFilter;
      params.push(req.orgId, req.orgId);
      countParams.push(req.orgId, req.orgId);
    }

    if (status) {
      query += ' AND sm.status = ?';
      countQuery += ' AND sm.status = ?';
      params.push(status);
      countParams.push(status);
    }

    if (user_id) {
      query += ' AND sm.user_id = ?';
      countQuery += ' AND sm.user_id = ?';
      params.push(parseInt(user_id));
      countParams.push(parseInt(user_id));
    }

    if (category) {
      query += ' AND sm.category = ?';
      countQuery += ' AND sm.category = ?';
      params.push(category);
      countParams.push(category);
    }

    query += ' ORDER BY sm.created_at DESC';

    if (limit) { query += ' LIMIT ?'; params.push(parseInt(limit)); }
    if (offset) { query += ' OFFSET ?'; params.push(parseInt(offset)); }

    const messages = db.prepare(query).all(...params);
    const totalCount = db.prepare(countQuery).get(...countParams).count;

    res.json({ messages, total: totalCount });
  } catch (err) {
    console.error('List support messages error:', err);
    res.status(500).json({ error: 'Failed to fetch support messages' });
  }
});

// PUT /api/admin/support/messages/:id
router.put('/support/messages/:id', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const message = db.prepare('SELECT * FROM support_messages WHERE id = ?').get(req.params.id);
    if (!message) return res.status(404).json({ error: 'Support message not found' });

    const { status, admin_notes } = req.body;

    if (status && !['new', 'in_progress', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const updates = [];
    const params = [];

    if (status) { updates.push('status = ?'); params.push(status); }
    if (admin_notes !== undefined) { updates.push('admin_notes = ?'); params.push(admin_notes ? sanitizeInput(admin_notes) : null); }
    if (status === 'resolved') { updates.push('resolved_at = CURRENT_TIMESTAMP'); updates.push('resolved_by = ?'); params.push(req.user.id); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    params.push(req.params.id);
    db.prepare(`UPDATE support_messages SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'support_message_update',
      actionDescription: `Updated support message #${req.params.id} to status: ${status || 'updated'}`,
      targetType: 'support_message',
      targetId: parseInt(req.params.id),
      metadata: { status, admin_notes },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    const updated = db.prepare('SELECT * FROM support_messages WHERE id = ?').get(req.params.id);

    // Notify the submitter when their message is resolved
    if (status === 'resolved' && message.user_id) {
      createNotifications({
        userIds: [message.user_id],
        orgId: message.org_id || null,
        type: 'support_resolved',
        title: 'Your support request has been resolved',
        body: message.subject,
        link: 'help'
      });
    }

    res.json(updated);
  } catch (err) {
    console.error('Update support message error:', err);
    res.status(500).json({ error: 'Failed to update support message' });
  }
});

// DELETE /api/admin/support/messages/:id
router.delete('/support/messages/:id', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const message = db.prepare('SELECT * FROM support_messages WHERE id = ?').get(req.params.id);
    if (!message) return res.status(404).json({ error: 'Support message not found' });

    db.prepare('DELETE FROM support_messages WHERE id = ?').run(req.params.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'support_message_delete',
      actionDescription: `Deleted support message #${req.params.id} from ${message.user_name}`,
      targetType: 'support_message',
      targetId: parseInt(req.params.id),
      metadata: { subject: message.subject, category: message.category },
      ipAddress: req.ip,
      orgId: req.orgId
    });

    res.json({ message: 'Support message deleted successfully' });
  } catch (err) {
    console.error('Delete support message error:', err);
    res.status(500).json({ error: 'Failed to delete support message' });
  }
});

// GET /api/admin/support/stats
router.get('/support/stats', authenticate, authorize('super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    let orgFilter = '';
    const params = [];

    if (req.user.role === 'org_admin' && req.orgId) {
      orgFilter = ' AND (org_id = ? OR user_id IN (SELECT user_id FROM user_organizations WHERE org_id = ?))';
      params.push(req.orgId, req.orgId);
    } else if (req.orgId) {
      orgFilter = ' AND (org_id = ? OR user_id IN (SELECT user_id FROM user_organizations WHERE org_id = ?))';
      params.push(req.orgId, req.orgId);
    }

    const totalMessages = db.prepare(`SELECT COUNT(*) as count FROM support_messages WHERE 1=1${orgFilter}`).get(...params).count;
    const newMessages = db.prepare(`SELECT COUNT(*) as count FROM support_messages WHERE status = 'new'${orgFilter}`).get(...params).count;
    const inProgressMessages = db.prepare(`SELECT COUNT(*) as count FROM support_messages WHERE status = 'in_progress'${orgFilter}`).get(...params).count;
    const resolvedMessages = db.prepare(`SELECT COUNT(*) as count FROM support_messages WHERE status = 'resolved'${orgFilter}`).get(...params).count;

    const categoryBreakdown = db.prepare(`
      SELECT category, COUNT(*) as count
      FROM support_messages WHERE 1=1${orgFilter}
      GROUP BY category
    `).all(...params);

    res.json({
      total: totalMessages,
      new: newMessages,
      in_progress: inProgressMessages,
      resolved: resolvedMessages,
      by_category: categoryBreakdown
    });
  } catch (err) {
    console.error('Support stats error:', err);
    res.status(500).json({ error: 'Failed to fetch support statistics' });
  }
});

// ============ ORGANIZATION APPLICATIONS ============

// GET /api/admin/applications - list all org applications (super_admin only)
router.get('/applications', authenticate, authorize('super_admin'), (req, res) => {
  try {
    const applications = db.prepare(`
      SELECT * FROM org_applications ORDER BY created_at DESC
    `).all();
    res.json(applications);
  } catch (err) {
    console.error('Get applications error:', err);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

// GET /api/admin/applications/count - count of new applications (super_admin only)
router.get('/applications/count', authenticate, authorize('super_admin'), (req, res) => {
  try {
    const { count } = db.prepare(`SELECT COUNT(*) as count FROM org_applications WHERE status = 'new'`).get();
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch count' });
  }
});

// PUT /api/admin/applications/:id - update application status (super_admin only)
router.put('/applications/:id', authenticate, authorize('super_admin'), (req, res) => {
  try {
    const { status } = req.body;
    if (!['new', 'reviewed', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    db.prepare('UPDATE org_applications SET status = ? WHERE id = ?').run(status, req.params.id);
    res.json({ message: 'Application updated' });
  } catch (err) {
    console.error('Update application error:', err);
    res.status(500).json({ error: 'Failed to update application' });
  }
});

// DELETE /api/admin/applications/:id - delete application (super_admin only)
router.delete('/applications/:id', authenticate, authorize('super_admin'), (req, res) => {
  try {
    db.prepare('DELETE FROM org_applications WHERE id = ?').run(req.params.id);
    res.json({ message: 'Application deleted' });
  } catch (err) {
    console.error('Delete application error:', err);
    res.status(500).json({ error: 'Failed to delete application' });
  }
});

// GET /api/admin/invite-code - get org's teacher invite code
router.get('/invite-code', authenticate, authorize('super_admin', 'org_admin'), (req, res) => {
  const orgId = req.user.role === 'super_admin'
    ? (req.query.org_id ? parseInt(req.query.org_id) : null)
    : req.user.org_id;
  if (!orgId) return res.status(400).json({ error: 'Organization context required' });
  const org = db.prepare('SELECT id, name, invite_code FROM organizations WHERE id = ?').get(orgId);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  res.json({ invite_code: org.invite_code, org_name: org.name });
});

// POST /api/admin/regenerate-invite-code - regenerate org's teacher invite code
router.post('/regenerate-invite-code', authenticate, authorize('super_admin', 'org_admin'), (req, res) => {
  const orgId = req.user.role === 'super_admin'
    ? (req.body.org_id ? parseInt(req.body.org_id) : (req.query.org_id ? parseInt(req.query.org_id) : null))
    : req.user.org_id;
  if (!orgId) return res.status(400).json({ error: 'Organization context required' });

  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function genCode() {
    let code = '';
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  let code;
  do { code = genCode(); } while (db.prepare('SELECT id FROM organizations WHERE invite_code = ?').get(code));

  db.prepare('UPDATE organizations SET invite_code = ? WHERE id = ?').run(code, orgId);

  logAuditEvent({
    userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
    actionType: 'invite_code_regenerate',
    actionDescription: 'Regenerated teacher invite code',
    targetType: 'organization', targetId: orgId,
    orgId: orgId, ipAddress: req.ip
  });

  res.json({ invite_code: code });
});

module.exports = router;
