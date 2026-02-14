const express = require('express');
const db = require('../database');
const { authenticate, authorize } = require('../middleware/auth');
const { moderateText, sanitizeInput } = require('../utils/moderation');
const { calculateFinalScore } = require('../utils/scoring');
const { logAuditEvent } = require('../utils/audit');

const router = express.Router();

const VALID_TAGS = [
  'Clear explanations', 'Engaging lessons', 'Fair grading', 'Supportive',
  'Well-prepared', 'Good examples', 'Encourages participation', 'Respectful',
  'Needs clearer explanations', 'Too fast-paced', 'Too slow-paced',
  'More examples needed', 'More interactive', 'Better organization',
  'More feedback needed', 'Challenging but good'
];

// GET /api/reviews/tags - available feedback tags
router.get('/tags', authenticate, (req, res) => {
  res.json(VALID_TAGS);
});

// GET /api/reviews/eligible-teachers - teachers student can review
router.get('/eligible-teachers', authenticate, authorize('student'), (req, res) => {
  try {
    // Get active feedback period
    const activePeriod = db.prepare(`
      SELECT fp.* FROM feedback_periods fp
      JOIN terms t ON fp.term_id = t.id
      WHERE fp.active_status = 1 AND t.active_status = 1
      LIMIT 1
    `).get();

    if (!activePeriod) {
      return res.json({ period: null, teachers: [] });
    }

    // Get teachers from classrooms the student is enrolled in
    const teachers = db.prepare(`
      SELECT DISTINCT
        te.id as teacher_id,
        te.full_name as teacher_name,
        te.subject,
        te.department,
        c.id as classroom_id,
        c.subject as classroom_subject,
        c.grade_level,
        CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END as already_reviewed,
        r.id as review_id
      FROM classroom_members cm
      JOIN classrooms c ON cm.classroom_id = c.id
      JOIN teachers te ON c.teacher_id = te.id
      LEFT JOIN reviews r ON r.teacher_id = te.id
        AND r.student_id = cm.student_id
        AND r.feedback_period_id = ?
      WHERE cm.student_id = ?
        AND c.active_status = 1
        AND c.term_id = ?
      ORDER BY te.full_name
    `).all(activePeriod.id, req.user.id, activePeriod.term_id);

    res.json({ period: activePeriod, teachers });
  } catch (err) {
    console.error('Eligible teachers error:', err);
    res.status(500).json({ error: 'Failed to fetch eligible teachers' });
  }
});

// POST /api/reviews - submit a review
router.post('/', authenticate, authorize('student'), (req, res) => {
  try {
    const {
      teacher_id, classroom_id,
      overall_rating, clarity_rating, engagement_rating,
      fairness_rating, supportiveness_rating,
      feedback_text, tags
    } = req.body;

    // Validate required fields
    if (!teacher_id || !classroom_id) {
      return res.status(400).json({ error: 'Teacher and classroom are required' });
    }

    const ratings = [overall_rating, clarity_rating, engagement_rating, fairness_rating, supportiveness_rating];
    for (const r of ratings) {
      if (!r || r < 1 || r > 5) {
        return res.status(400).json({ error: 'All ratings must be between 1 and 5' });
      }
    }

    // Verify student is in the classroom
    const membership = db.prepare(
      'SELECT id FROM classroom_members WHERE classroom_id = ? AND student_id = ?'
    ).get(classroom_id, req.user.id);
    if (!membership) {
      return res.status(403).json({ error: 'You are not enrolled in this classroom' });
    }

    // Verify classroom belongs to teacher
    const classroom = db.prepare(
      'SELECT * FROM classrooms WHERE id = ? AND teacher_id = ?'
    ).get(classroom_id, teacher_id);
    if (!classroom) {
      return res.status(400).json({ error: 'Invalid classroom-teacher combination' });
    }

    // Get active feedback period
    const activePeriod = db.prepare(`
      SELECT fp.* FROM feedback_periods fp
      JOIN terms t ON fp.term_id = t.id
      WHERE fp.active_status = 1 AND t.active_status = 1
      LIMIT 1
    `).get();
    if (!activePeriod) {
      return res.status(400).json({ error: 'No active feedback period' });
    }

    // Check for duplicate
    const existing = db.prepare(
      'SELECT id FROM reviews WHERE teacher_id = ? AND student_id = ? AND feedback_period_id = ?'
    ).get(teacher_id, req.user.id, activePeriod.id);
    if (existing) {
      return res.status(409).json({ error: 'You already submitted a review for this teacher in this period' });
    }

    // Validate tags
    let validatedTags = [];
    if (tags && Array.isArray(tags)) {
      validatedTags = tags.filter(t => VALID_TAGS.includes(t));
    }

    // Sanitize and moderate feedback text
    const sanitized = sanitizeInput(feedback_text || '');
    const moderation = moderateText(feedback_text || '');

    let flaggedStatus = 'pending';
    if (moderation.shouldAutoReject) {
      flaggedStatus = 'flagged';
    } else if (moderation.flagged) {
      flaggedStatus = 'flagged';
    }

    const result = db.prepare(`
      INSERT INTO reviews (
        teacher_id, classroom_id, student_id, school_id, term_id, feedback_period_id,
        overall_rating, clarity_rating, engagement_rating, fairness_rating, supportiveness_rating,
        feedback_text, tags, flagged_status, approved_status
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      teacher_id, classroom_id, req.user.id, activePeriod.term_id, activePeriod.id,
      overall_rating, clarity_rating, engagement_rating, fairness_rating, supportiveness_rating,
      sanitized, JSON.stringify(validatedTags), flaggedStatus
    );

    const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(result.lastInsertRowid);

    // Log audit event
    const teacher = db.prepare('SELECT full_name FROM teachers WHERE id = ?').get(teacher_id);
    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'review_submit',
      actionDescription: `Submitted review for ${teacher?.full_name || 'teacher'} (Rating: ${overall_rating}/5)`,
      targetType: 'review',
      targetId: result.lastInsertRowid,
      metadata: {
        teacher_id,
        classroom_id,
        overall_rating,
        flagged: moderation.flagged
      },
      ipAddress: req.ip
    });

    res.status(201).json({
      message: 'Review submitted successfully. It will be visible after admin approval.',
      review,
      moderation_note: moderation.flagged ? 'Your review has been flagged for admin review.' : null
    });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Duplicate review not allowed' });
    }
    console.error('Submit review error:', err);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

// GET /api/reviews/my-reviews - student's own reviews
router.get('/my-reviews', authenticate, authorize('student'), (req, res) => {
  try {
    const reviews = db.prepare(`
      SELECT r.*, te.full_name as teacher_name, c.subject as classroom_subject,
        fp.name as period_name, t.name as term_name
      FROM reviews r
      JOIN teachers te ON r.teacher_id = te.id
      JOIN classrooms c ON r.classroom_id = c.id
      JOIN feedback_periods fp ON r.feedback_period_id = fp.id
      JOIN terms t ON r.term_id = t.id
      WHERE r.student_id = ?
      ORDER BY r.created_at DESC
    `).all(req.user.id);

    res.json(reviews);
  } catch (err) {
    console.error('My reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// PUT /api/reviews/:id - edit review (only during active period)
router.put('/:id', authenticate, authorize('student'), (req, res) => {
  try {
    const review = db.prepare('SELECT * FROM reviews WHERE id = ? AND student_id = ?')
      .get(req.params.id, req.user.id);
    if (!review) return res.status(404).json({ error: 'Review not found' });

    // Check if feedback period is still active
    const period = db.prepare('SELECT * FROM feedback_periods WHERE id = ? AND active_status = 1')
      .get(review.feedback_period_id);
    if (!period) return res.status(400).json({ error: 'Feedback period is closed. Cannot edit.' });

    const {
      overall_rating, clarity_rating, engagement_rating,
      fairness_rating, supportiveness_rating,
      feedback_text, tags
    } = req.body;

    const ratings = [overall_rating, clarity_rating, engagement_rating, fairness_rating, supportiveness_rating];
    for (const r of ratings) {
      if (r !== undefined && (r < 1 || r > 5)) {
        return res.status(400).json({ error: 'Ratings must be between 1 and 5' });
      }
    }

    const sanitized = feedback_text !== undefined ? sanitizeInput(feedback_text) : review.feedback_text;
    const moderation = feedback_text !== undefined ? moderateText(feedback_text) : { flagged: false };

    let validatedTags = JSON.parse(review.tags || '[]');
    if (tags && Array.isArray(tags)) {
      validatedTags = tags.filter(t => VALID_TAGS.includes(t));
    }

    db.prepare(`
      UPDATE reviews SET
        overall_rating = COALESCE(?, overall_rating),
        clarity_rating = COALESCE(?, clarity_rating),
        engagement_rating = COALESCE(?, engagement_rating),
        fairness_rating = COALESCE(?, fairness_rating),
        supportiveness_rating = COALESCE(?, supportiveness_rating),
        feedback_text = ?,
        tags = ?,
        flagged_status = ?,
        approved_status = 0
      WHERE id = ?
    `).run(
      overall_rating, clarity_rating, engagement_rating,
      fairness_rating, supportiveness_rating,
      sanitized, JSON.stringify(validatedTags),
      moderation.flagged ? 'flagged' : 'pending',
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
    res.json({ message: 'Review updated. Awaiting re-approval.', review: updated });
  } catch (err) {
    console.error('Edit review error:', err);
    res.status(500).json({ error: 'Failed to edit review' });
  }
});

// POST /api/reviews/:id/flag - flag a review
router.post('/:id/flag', authenticate, (req, res) => {
  try {
    const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
    if (!review) return res.status(404).json({ error: 'Review not found' });

    db.prepare("UPDATE reviews SET flagged_status = 'flagged' WHERE id = ?").run(req.params.id);
    res.json({ message: 'Review flagged for admin review' });
  } catch (err) {
    console.error('Flag review error:', err);
    res.status(500).json({ error: 'Failed to flag review' });
  }
});

module.exports = router;
