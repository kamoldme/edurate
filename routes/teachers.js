const express = require('express');
const db = require('../database');
const { authenticate, authorize } = require('../middleware/auth');
const { getTeacherScores } = require('../utils/scoring');

const router = express.Router();

// GET /api/teachers/:id/profile - Teacher profile with approved reviews (Admin & School Head only)
router.get('/:id/profile', authenticate, authorize('super_admin', 'org_admin', 'school_head'), (req, res) => {
  try {
    const teacher = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);

    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    // Get approved reviews only
    const reviews = db.prepare(`
      SELECT r.id, r.overall_rating, r.clarity_rating, r.engagement_rating,
        r.fairness_rating, r.supportiveness_rating, r.feedback_text,
        r.tags, r.created_at, fp.name as period_name, t.name as term_name
      FROM reviews r
      JOIN feedback_periods fp ON r.feedback_period_id = fp.id
      JOIN terms t ON fp.term_id = t.id
      WHERE r.teacher_id = ?
        AND r.approved_status = 1
        AND r.flagged_status = 'approved'
        AND t.feedback_visible = 1
      ORDER BY r.created_at DESC
    `).all(req.params.id);

    // Calculate scores
    const scores = getTeacherScores(req.params.id);

    res.json({ teacher, reviews, scores });
  } catch (err) {
    console.error('Teacher profile error:', err);
    res.status(500).json({ error: 'Failed to fetch teacher profile' });
  }
});

module.exports = router;
