const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { authenticate, authorize } = require('../middleware/auth');
const { sanitizeInput } = require('../utils/moderation');
const { logAuditEvent, getAuditLogs, getAuditStats } = require('../utils/audit');

const router = express.Router();

// ============ USER MANAGEMENT ============

// GET /api/admin/users
router.get('/users', authenticate, authorize('admin'), (req, res) => {
  try {
    const { role, search } = req.query;
    let query = 'SELECT id, full_name, email, role, grade_or_position, school_id, verified_status, suspended, created_at FROM users WHERE 1=1';
    const params = [];

    if (role) { query += ' AND role = ?'; params.push(role); }
    if (search) { query += ' AND (full_name LIKE ? OR email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    query += ' ORDER BY created_at DESC';
    const users = db.prepare(query).all(...params);
    res.json(users);
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST /api/admin/users - create user (any role)
router.post('/users', authenticate, authorize('admin'), (req, res) => {
  try {
    const { full_name, email, password, role, grade_or_position, subject, department, experience_years, bio } = req.body;

    if (!full_name || !email || !password || !role) {
      return res.status(400).json({ error: 'Name, email, password, and role are required' });
    }

    if (!['student', 'teacher', 'school_head', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) return res.status(409).json({ error: 'Email already exists' });

    const hashedPassword = bcrypt.hashSync(password, 12);
    const result = db.prepare(`
      INSERT INTO users (full_name, email, password, role, grade_or_position, school_id, verified_status)
      VALUES (?, ?, ?, ?, ?, 1, 1)
    `).run(sanitizeInput(full_name), email.toLowerCase(), hashedPassword, role, grade_or_position || null);

    // If teacher, create teacher profile
    if (role === 'teacher') {
      db.prepare(`
        INSERT INTO teachers (user_id, full_name, subject, department, experience_years, bio, school_id)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(result.lastInsertRowid, sanitizeInput(full_name), subject || null, department || null, experience_years || 0, bio || null);
    }

    const user = db.prepare('SELECT id, full_name, email, role, grade_or_position, verified_status, created_at FROM users WHERE id = ?')
      .get(result.lastInsertRowid);

    res.status(201).json(user);
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PUT /api/admin/users/:id - edit user profile
router.put('/users/:id', authenticate, authorize('admin'), (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { full_name, email, grade_or_position, role } = req.body;

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
      ipAddress: req.ip
    });

    const updated = db.prepare('SELECT id, full_name, email, role, grade_or_position, verified_status, suspended FROM users WHERE id = ?')
      .get(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error('Edit user error:', err);
    res.status(500).json({ error: 'Failed to edit user' });
  }
});

// POST /api/admin/users/:id/reset-password - admin resets user password
router.post('/users/:id/reset-password', authenticate, authorize('admin'), (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { new_password } = req.body;
    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const hashedPassword = bcrypt.hashSync(new_password, 12);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.params.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'password_reset',
      actionDescription: `Reset password for ${user.full_name} (${user.email})`,
      targetType: 'user',
      targetId: user.id,
      ipAddress: req.ip
    });

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// PUT /api/admin/users/:id/suspend
router.put('/users/:id/suspend', authenticate, authorize('admin'), (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const newStatus = user.suspended ? 0 : 1;
    db.prepare('UPDATE users SET suspended = ? WHERE id = ?').run(newStatus, req.params.id);

    // Log audit event
    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: newStatus ? 'user_suspend' : 'user_unsuspend',
      actionDescription: `${newStatus ? 'Suspended' : 'Unsuspended'} user ${user.full_name} (${user.email})`,
      targetType: 'user',
      targetId: user.id,
      metadata: { user_email: user.email, user_role: user.role },
      ipAddress: req.ip
    });

    res.json({ message: newStatus ? 'User suspended' : 'User unsuspended', suspended: newStatus });
  } catch (err) {
    console.error('Suspend user error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// ============ TERM MANAGEMENT ============

// GET /api/admin/terms
router.get('/terms', authenticate, authorize('admin', 'school_head', 'teacher'), (req, res) => {
  try {
    const terms = db.prepare('SELECT * FROM terms WHERE school_id = 1 ORDER BY start_date DESC').all();

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
router.post('/terms', authenticate, authorize('admin'), (req, res) => {
  try {
    const { name, start_date, end_date } = req.body;
    if (!name || !start_date || !end_date) {
      return res.status(400).json({ error: 'Name, start date, and end date are required' });
    }

    const result = db.prepare(
      'INSERT INTO terms (name, start_date, end_date, school_id) VALUES (?, ?, ?, 1)'
    ).run(name, start_date, end_date);

    // Auto-create 3 feedback periods
    const termId = result.lastInsertRowid;
    const periodNames = ['Beginning', 'Mid-Term', 'End'];
    periodNames.forEach(pName => {
      db.prepare(
        'INSERT INTO feedback_periods (term_id, name, active_status) VALUES (?, ?, 0)'
      ).run(termId, pName);
    });

    const term = db.prepare('SELECT * FROM terms WHERE id = ?').get(termId);
    const periods = db.prepare('SELECT * FROM feedback_periods WHERE term_id = ?').all(termId);

    // Log audit event
    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'term_create',
      actionDescription: `Created term: ${name} (${start_date} to ${end_date})`,
      targetType: 'term',
      targetId: termId,
      metadata: { name, start_date, end_date },
      ipAddress: req.ip
    });

    res.status(201).json({ ...term, periods });
  } catch (err) {
    console.error('Create term error:', err);
    res.status(500).json({ error: 'Failed to create term' });
  }
});

// PUT /api/admin/terms/:id
router.put('/terms/:id', authenticate, authorize('admin'), (req, res) => {
  try {
    const { name, start_date, end_date, active_status } = req.body;
    const term = db.prepare('SELECT * FROM terms WHERE id = ?').get(req.params.id);
    if (!term) return res.status(404).json({ error: 'Term not found' });

    // If activating, deactivate others
    if (active_status === 1) {
      db.prepare('UPDATE terms SET active_status = 0 WHERE school_id = 1').run();
    }

    db.prepare(`
      UPDATE terms SET
        name = COALESCE(?, name),
        start_date = COALESCE(?, start_date),
        end_date = COALESCE(?, end_date),
        active_status = COALESCE(?, active_status)
      WHERE id = ?
    `).run(name, start_date, end_date, active_status, req.params.id);

    const updated = db.prepare('SELECT * FROM terms WHERE id = ?').get(req.params.id);

    // Log audit event
    const changes = [];
    if (name) changes.push(`name to "${name}"`);
    if (start_date) changes.push(`start date to ${start_date}`);
    if (end_date) changes.push(`end date to ${end_date}`);
    if (active_status !== undefined) changes.push(active_status ? 'activated' : 'deactivated');

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: active_status === 1 ? 'term_activate' : 'term_update',
      actionDescription: `Updated term "${term.name}": ${changes.join(', ')}`,
      targetType: 'term',
      targetId: term.id,
      metadata: { name, start_date, end_date, active_status },
      ipAddress: req.ip
    });

    res.json(updated);
  } catch (err) {
    console.error('Update term error:', err);
    res.status(500).json({ error: 'Failed to update term' });
  }
});

// ============ FEEDBACK PERIOD MANAGEMENT ============

// GET /api/admin/feedback-periods
router.get('/feedback-periods', authenticate, authorize('admin', 'teacher', 'school_head'), (req, res) => {
  try {
    const { term_id } = req.query;
    let query = `
      SELECT fp.*, t.name as term_name
      FROM feedback_periods fp
      JOIN terms t ON fp.term_id = t.id
    `;
    const params = [];
    if (term_id) {
      query += ' WHERE fp.term_id = ?';
      params.push(term_id);
    }
    query += ' ORDER BY fp.term_id, fp.id';

    res.json(db.prepare(query).all(...params));
  } catch (err) {
    console.error('List periods error:', err);
    res.status(500).json({ error: 'Failed to fetch feedback periods' });
  }
});

// PUT /api/admin/feedback-periods/:id
router.put('/feedback-periods/:id', authenticate, authorize('admin'), (req, res) => {
  try {
    const { active_status, start_date, end_date } = req.body;
    const period = db.prepare('SELECT * FROM feedback_periods WHERE id = ?').get(req.params.id);
    if (!period) return res.status(404).json({ error: 'Feedback period not found' });

    // If activating, deactivate all others in same term
    if (active_status === 1) {
      db.prepare('UPDATE feedback_periods SET active_status = 0 WHERE term_id = ?').run(period.term_id);
    }

    db.prepare(`
      UPDATE feedback_periods SET
        active_status = COALESCE(?, active_status),
        start_date = COALESCE(?, start_date),
        end_date = COALESCE(?, end_date)
      WHERE id = ?
    `).run(active_status, start_date, end_date, req.params.id);

    const updated = db.prepare('SELECT * FROM feedback_periods WHERE id = ?').get(req.params.id);

    // Log audit event
    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: active_status === 1 ? 'period_activate' : 'period_update',
      actionDescription: `${active_status === 1 ? 'Opened' : 'Updated'} feedback period: ${period.name}`,
      targetType: 'feedback_period',
      targetId: period.id,
      metadata: { active_status, start_date, end_date },
      ipAddress: req.ip
    });

    res.json(updated);
  } catch (err) {
    console.error('Update period error:', err);
    res.status(500).json({ error: 'Failed to update feedback period' });
  }
});

// ============ REVIEW MODERATION ============

// GET /api/admin/reviews/pending
router.get('/reviews/pending', authenticate, authorize('admin'), (req, res) => {
  try {
    const reviews = db.prepare(`
      SELECT r.*, te.full_name as teacher_name, c.subject as classroom_subject,
        c.grade_level, fp.name as period_name, t.name as term_name,
        u.full_name as student_name, u.email as student_email, u.grade_or_position as student_grade
      FROM reviews r
      JOIN teachers te ON r.teacher_id = te.id
      JOIN classrooms c ON r.classroom_id = c.id
      JOIN feedback_periods fp ON r.feedback_period_id = fp.id
      JOIN terms t ON r.term_id = t.id
      JOIN users u ON r.student_id = u.id
      WHERE r.flagged_status = 'pending'
      ORDER BY r.created_at ASC
    `).all();

    res.json(reviews);
  } catch (err) {
    console.error('Pending reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch pending reviews' });
  }
});

// GET /api/admin/reviews/flagged
router.get('/reviews/flagged', authenticate, authorize('admin'), (req, res) => {
  try {
    const reviews = db.prepare(`
      SELECT r.*, te.full_name as teacher_name, c.subject as classroom_subject,
        fp.name as period_name,
        u.full_name as student_name, u.email as student_email, u.grade_or_position as student_grade
      FROM reviews r
      JOIN teachers te ON r.teacher_id = te.id
      JOIN classrooms c ON r.classroom_id = c.id
      JOIN feedback_periods fp ON r.feedback_period_id = fp.id
      JOIN users u ON r.student_id = u.id
      WHERE r.flagged_status = 'flagged'
      ORDER BY r.created_at ASC
    `).all();

    res.json(reviews);
  } catch (err) {
    console.error('Flagged reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch flagged reviews' });
  }
});

// GET /api/admin/reviews/all
router.get('/reviews/all', authenticate, authorize('admin'), (req, res) => {
  try {
    const reviews = db.prepare(`
      SELECT r.*, te.full_name as teacher_name, c.subject as classroom_subject,
        fp.name as period_name, t.name as term_name,
        u.full_name as student_name, u.email as student_email, u.grade_or_position as student_grade
      FROM reviews r
      JOIN teachers te ON r.teacher_id = te.id
      JOIN classrooms c ON r.classroom_id = c.id
      JOIN feedback_periods fp ON r.feedback_period_id = fp.id
      JOIN terms t ON r.term_id = t.id
      JOIN users u ON r.student_id = u.id
      ORDER BY r.created_at DESC
    `).all();

    res.json(reviews);
  } catch (err) {
    console.error('All reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// PUT /api/admin/reviews/:id/approve
router.put('/reviews/:id/approve', authenticate, authorize('admin'), (req, res) => {
  try {
    const review = db.prepare(`
      SELECT r.*, te.full_name as teacher_name, u.full_name as student_name
      FROM reviews r
      JOIN teachers te ON r.teacher_id = te.id
      JOIN users u ON r.student_id = u.id
      WHERE r.id = ?
    `).get(req.params.id);

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
        ipAddress: req.ip
      });
    }

    res.json({ message: 'Review approved' });
  } catch (err) {
    console.error('Approve review error:', err);
    res.status(500).json({ error: 'Failed to approve review' });
  }
});

// PUT /api/admin/reviews/:id/reject
router.put('/reviews/:id/reject', authenticate, authorize('admin'), (req, res) => {
  try {
    const review = db.prepare(`
      SELECT r.*, te.full_name as teacher_name, u.full_name as student_name
      FROM reviews r
      JOIN teachers te ON r.teacher_id = te.id
      JOIN users u ON r.student_id = u.id
      WHERE r.id = ?
    `).get(req.params.id);

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
        ipAddress: req.ip
      });
    }

    res.json({ message: 'Review rejected' });
  } catch (err) {
    console.error('Reject review error:', err);
    res.status(500).json({ error: 'Failed to reject review' });
  }
});

// DELETE /api/admin/reviews/:id
router.delete('/reviews/:id', authenticate, authorize('admin'), (req, res) => {
  try {
    const review = db.prepare(`
      SELECT r.*, te.full_name as teacher_name, u.full_name as student_name
      FROM reviews r
      JOIN teachers te ON r.teacher_id = te.id
      JOIN users u ON r.student_id = u.id
      WHERE r.id = ?
    `).get(req.params.id);

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
        ipAddress: req.ip
      });
    }

    res.json({ message: 'Review permanently removed' });
  } catch (err) {
    console.error('Delete review error:', err);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

// POST /api/admin/reviews/bulk-approve - bulk approve pending reviews
router.post('/reviews/bulk-approve', authenticate, authorize('admin'), (req, res) => {
  try {
    const { review_ids } = req.body;
    if (!review_ids || !Array.isArray(review_ids) || review_ids.length === 0) {
      return res.status(400).json({ error: 'review_ids array is required' });
    }

    const placeholders = review_ids.map(() => '?').join(',');
    db.prepare(`
      UPDATE reviews
      SET flagged_status = 'approved', approved_status = 1
      WHERE id IN (${placeholders})
    `).run(...review_ids);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'review_bulk_approve',
      actionDescription: `Bulk approved ${review_ids.length} reviews`,
      targetType: 'review',
      metadata: { count: review_ids.length, review_ids },
      ipAddress: req.ip
    });

    res.json({ message: `Approved ${review_ids.length} reviews`, count: review_ids.length });
  } catch (err) {
    console.error('Bulk approve error:', err);
    res.status(500).json({ error: 'Failed to bulk approve reviews' });
  }
});

// ============ CLASSROOM MANAGEMENT ============

// GET /api/admin/classrooms - list all classrooms
router.get('/classrooms', authenticate, authorize('admin', 'school_head'), (req, res) => {
  try {
    const classrooms = db.prepare(`
      SELECT c.*, te.full_name as teacher_name, t.name as term_name,
        (SELECT COUNT(*) FROM classroom_members WHERE classroom_id = c.id) as student_count
      FROM classrooms c
      JOIN teachers te ON c.teacher_id = te.id
      JOIN terms t ON c.term_id = t.id
      ORDER BY c.created_at DESC
    `).all();

    res.json(classrooms);
  } catch (err) {
    console.error('List classrooms error:', err);
    res.status(500).json({ error: 'Failed to fetch classrooms' });
  }
});

// PUT /api/admin/classrooms/:id - edit classroom
router.put('/classrooms/:id', authenticate, authorize('admin'), (req, res) => {
  try {
    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(req.params.id);
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });

    const { subject, grade_level, teacher_id, term_id, active_status } = req.body;

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
      ipAddress: req.ip
    });

    const updated = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error('Edit classroom error:', err);
    res.status(500).json({ error: 'Failed to edit classroom' });
  }
});

// DELETE /api/admin/classrooms/:id - delete classroom
router.delete('/classrooms/:id', authenticate, authorize('admin'), (req, res) => {
  try {
    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(req.params.id);
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });

    db.prepare('DELETE FROM classrooms WHERE id = ?').run(req.params.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'classroom_delete',
      actionDescription: `Deleted classroom ${classroom.subject} (${classroom.grade_level})`,
      targetType: 'classroom',
      targetId: classroom.id,
      ipAddress: req.ip
    });

    res.json({ message: 'Classroom deleted successfully' });
  } catch (err) {
    console.error('Delete classroom error:', err);
    res.status(500).json({ error: 'Failed to delete classroom' });
  }
});

// POST /api/admin/classrooms/:id/add-student - add student to classroom
router.post('/classrooms/:id/add-student', authenticate, authorize('admin'), (req, res) => {
  try {
    const { student_id } = req.body;
    if (!student_id) return res.status(400).json({ error: 'student_id is required' });

    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ?').get(req.params.id);
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });

    const student = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(student_id);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const existing = db.prepare('SELECT id FROM classroom_members WHERE classroom_id = ? AND student_id = ?')
      .get(req.params.id, student_id);
    if (existing) return res.status(409).json({ error: 'Student already in classroom' });

    db.prepare('INSERT INTO classroom_members (classroom_id, student_id) VALUES (?, ?)')
      .run(req.params.id, student_id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'classroom_add_student',
      actionDescription: `Added ${student.full_name} to classroom ${classroom.subject}`,
      targetType: 'classroom',
      targetId: classroom.id,
      metadata: { student_id, student_name: student.full_name },
      ipAddress: req.ip
    });

    res.json({ message: 'Student added to classroom' });
  } catch (err) {
    console.error('Add student error:', err);
    res.status(500).json({ error: 'Failed to add student' });
  }
});

// DELETE /api/admin/classrooms/:id/remove-student/:student_id - remove student
router.delete('/classrooms/:id/remove-student/:student_id', authenticate, authorize('admin'), (req, res) => {
  try {
    const result = db.prepare('DELETE FROM classroom_members WHERE classroom_id = ? AND student_id = ?')
      .run(req.params.id, req.params.student_id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Student not in classroom' });
    }

    const student = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.params.student_id);
    const classroom = db.prepare('SELECT subject FROM classrooms WHERE id = ?').get(req.params.id);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'classroom_remove_student',
      actionDescription: `Removed ${student?.full_name} from classroom ${classroom?.subject}`,
      targetType: 'classroom',
      targetId: parseInt(req.params.id),
      metadata: { student_id: req.params.student_id },
      ipAddress: req.ip
    });

    res.json({ message: 'Student removed from classroom' });
  } catch (err) {
    console.error('Remove student error:', err);
    res.status(500).json({ error: 'Failed to remove student' });
  }
});

// ============ STUDENT SUBMISSION TRACKING ============

// GET /api/admin/submission-tracking - check which students submitted reviews
router.get('/submission-tracking', authenticate, authorize('admin', 'school_head'), (req, res) => {
  try {
    const { classroom_id, feedback_period_id } = req.query;

    if (!classroom_id || !feedback_period_id) {
      return res.status(400).json({ error: 'classroom_id and feedback_period_id are required' });
    }

    // Get all students in the classroom
    const students = db.prepare(`
      SELECT u.id, u.full_name, u.email, u.grade_or_position,
        cm.joined_at
      FROM classroom_members cm
      JOIN users u ON cm.student_id = u.id
      WHERE cm.classroom_id = ?
      ORDER BY u.full_name
    `).all(classroom_id);

    // Get submission status for each student
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

    // Get classroom and period info
    const classroom = db.prepare(`
      SELECT c.*, te.full_name as teacher_name, t.name as term_name
      FROM classrooms c
      JOIN teachers te ON c.teacher_id = te.id
      JOIN terms t ON c.term_id = t.id
      WHERE c.id = ?
    `).get(classroom_id);

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
        completion_rate: total > 0 ? Math.round((submitted / total) * 100) : 0
      }
    });
  } catch (err) {
    console.error('Submission tracking error:', err);
    res.status(500).json({ error: 'Failed to fetch submission tracking' });
  }
});

// GET /api/admin/submission-overview - overview of all classrooms
router.get('/submission-overview', authenticate, authorize('admin', 'school_head'), (req, res) => {
  try {
    const { feedback_period_id } = req.query;

    if (!feedback_period_id) {
      return res.status(400).json({ error: 'feedback_period_id is required' });
    }

    const classrooms = db.prepare(`
      SELECT c.*, te.full_name as teacher_name, t.name as term_name,
        (SELECT COUNT(*) FROM classroom_members WHERE classroom_id = c.id) as total_students,
        (SELECT COUNT(DISTINCT student_id) FROM reviews WHERE classroom_id = c.id AND feedback_period_id = ?) as submitted_count
      FROM classrooms c
      JOIN teachers te ON c.teacher_id = te.id
      JOIN terms t ON c.term_id = t.id
      WHERE c.active_status = 1
      ORDER BY c.subject, c.grade_level
    `).all(feedback_period_id);

    const classroomsWithRates = classrooms.map(c => ({
      ...c,
      not_submitted: c.total_students - c.submitted_count,
      completion_rate: c.total_students > 0 ? Math.round((c.submitted_count / c.total_students) * 100) : 0
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
        overall_completion_rate: totalStudents > 0 ? Math.round((totalSubmitted / totalStudents) * 100) : 0
      }
    });
  } catch (err) {
    console.error('Submission overview error:', err);
    res.status(500).json({ error: 'Failed to fetch submission overview' });
  }
});

// ============ TEACHER FEEDBACK VIEWING ============

// GET /api/admin/teacher/:id/feedback - view all feedback for a specific teacher
router.get('/teacher/:id/feedback', authenticate, authorize('admin', 'school_head'), (req, res) => {
  try {
    const teacher = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

    const { term_id, period_id, classroom_id } = req.query;

    let query = `
      SELECT r.*,
        u.full_name as student_name, u.email as student_email, u.grade_or_position as student_grade,
        c.subject as classroom_subject, c.grade_level,
        fp.name as period_name, t.name as term_name
      FROM reviews r
      JOIN users u ON r.student_id = u.id
      JOIN classrooms c ON r.classroom_id = c.id
      JOIN feedback_periods fp ON r.feedback_period_id = fp.id
      JOIN terms t ON r.term_id = t.id
      WHERE r.teacher_id = ? AND r.approved_status = 1
    `;
    const params = [req.params.id];

    if (term_id) {
      query += ' AND r.term_id = ?';
      params.push(term_id);
    }

    if (period_id) {
      query += ' AND r.feedback_period_id = ?';
      params.push(period_id);
    }

    if (classroom_id) {
      query += ' AND r.classroom_id = ?';
      params.push(classroom_id);
    }

    query += ' ORDER BY r.created_at DESC';

    const reviews = db.prepare(query).all(...params);

    // Get teacher scores
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

    res.json({
      teacher,
      reviews,
      scores,
      distribution
    });
  } catch (err) {
    console.error('Teacher feedback error:', err);
    res.status(500).json({ error: 'Failed to fetch teacher feedback' });
  }
});

// GET /api/admin/teachers - list all teachers with summary stats
router.get('/teachers', authenticate, authorize('admin', 'school_head'), (req, res) => {
  try {
    const teachers = db.prepare('SELECT * FROM teachers WHERE school_id = 1 ORDER BY full_name').all();
    const { getTeacherScores } = require('../utils/scoring');

    const teachersWithStats = teachers.map(t => {
      const scores = getTeacherScores(t.id);
      return {
        ...t,
        scores
      };
    });

    res.json(teachersWithStats);
  } catch (err) {
    console.error('List teachers error:', err);
    res.status(500).json({ error: 'Failed to fetch teachers' });
  }
});

// PUT /api/admin/teachers/:id - edit teacher profile
router.put('/teachers/:id', authenticate, authorize('admin'), (req, res) => {
  try {
    const teacher = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

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
      subject,
      department,
      experience_years,
      bio,
      req.params.id
    );

    // Update user table too if name changed
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
      ipAddress: req.ip
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
router.get('/audit-logs', authenticate, authorize('admin'), (req, res) => {
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
      offset: offset ? parseInt(offset) : 0
    });

    res.json(logs);
  } catch (err) {
    console.error('Audit logs error:', err);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// GET /api/admin/audit-stats
router.get('/audit-stats', authenticate, authorize('admin'), (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    const stats = getAuditStats({
      startDate: start_date,
      endDate: end_date
    });

    res.json(stats);
  } catch (err) {
    console.error('Audit stats error:', err);
    res.status(500).json({ error: 'Failed to fetch audit statistics' });
  }
});

// ============ STATISTICS ============

// GET /api/admin/stats
router.get('/stats', authenticate, authorize('admin', 'school_head'), (req, res) => {
  try {
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalStudents = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'student'").get().count;
    const totalTeachers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'teacher'").get().count;
    const totalClassrooms = db.prepare('SELECT COUNT(*) as count FROM classrooms').get().count;
    const totalReviews = db.prepare('SELECT COUNT(*) as count FROM reviews').get().count;
    const pendingReviews = db.prepare("SELECT COUNT(*) as count FROM reviews WHERE flagged_status = 'pending'").get().count;
    const flaggedReviews = db.prepare("SELECT COUNT(*) as count FROM reviews WHERE flagged_status = 'flagged'").get().count;
    const approvedReviews = db.prepare("SELECT COUNT(*) as count FROM reviews WHERE approved_status = 1").get().count;

    const avgRating = db.prepare(
      'SELECT ROUND(AVG(overall_rating), 2) as avg FROM reviews WHERE approved_status = 1'
    ).get().avg;

    // Participation rate
    const enrolledStudents = db.prepare(
      'SELECT COUNT(DISTINCT student_id) as count FROM classroom_members'
    ).get().count;
    const reviewingStudents = db.prepare(
      'SELECT COUNT(DISTINCT student_id) as count FROM reviews'
    ).get().count;

    res.json({
      total_users: totalUsers,
      total_students: totalStudents,
      total_teachers: totalTeachers,
      total_classrooms: totalClassrooms,
      total_reviews: totalReviews,
      pending_reviews: pendingReviews,
      flagged_reviews: flaggedReviews,
      approved_reviews: approvedReviews,
      average_rating: avgRating,
      enrolled_students: enrolledStudents,
      reviewing_students: reviewingStudents,
      participation_rate: enrolledStudents > 0 ? Math.round((reviewingStudents / enrolledStudents) * 100) : 0
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

module.exports = router;
