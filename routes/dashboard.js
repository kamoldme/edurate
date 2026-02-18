const express = require('express');
const db = require('../database');
const { authenticate, authorize } = require('../middleware/auth');
const { getTeacherScores, getRatingDistribution, getTeacherTrend, getDepartmentAverage, getClassroomCompletionRate } = require('../utils/scoring');
const { logAuditEvent } = require('../utils/audit');

const router = express.Router();

// GET /api/dashboard/student
router.get('/student', authenticate, authorize('student'), (req, res) => {
  try {
    const classrooms = db.prepare(`
      SELECT c.*, te.id as teacher_id, te.full_name as teacher_name, te.subject as teacher_subject,
        te.avatar_url as teacher_avatar_url, t.name as term_name
      FROM classroom_members cm
      JOIN classrooms c ON cm.classroom_id = c.id
      JOIN teachers te ON c.teacher_id = te.id
      JOIN terms t ON c.term_id = t.id
      WHERE cm.student_id = ?
      ORDER BY c.created_at DESC
    `).all(req.user.id);

    const activePeriod = db.prepare(`
      SELECT fp.*, t.name as term_name FROM feedback_periods fp
      JOIN terms t ON fp.term_id = t.id
      WHERE fp.active_status = 1 AND t.active_status = 1
      LIMIT 1
    `).get();

    const myReviews = db.prepare(`
      SELECT r.id, r.teacher_id, r.classroom_id, r.overall_rating, r.flagged_status, r.approved_status,
        te.full_name as teacher_name, c.subject as classroom_subject, fp.name as period_name, t.name as term_name
      FROM reviews r
      JOIN teachers te ON r.teacher_id = te.id
      JOIN classrooms c ON r.classroom_id = c.id
      JOIN feedback_periods fp ON r.feedback_period_id = fp.id
      JOIN terms t ON r.term_id = t.id
      WHERE r.student_id = ?
      ORDER BY r.created_at DESC
    `).all(req.user.id);

    const activeTerm = db.prepare('SELECT * FROM terms WHERE active_status = 1 LIMIT 1').get();

    res.json({
      classrooms,
      active_period: activePeriod,
      active_term: activeTerm,
      my_reviews: myReviews,
      review_count: myReviews.length
    });
  } catch (err) {
    console.error('Student dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// GET /api/dashboard/teacher
router.get('/teacher', authenticate, authorize('teacher'), (req, res) => {
  try {
    const teacher = db.prepare('SELECT * FROM teachers WHERE user_id = ?').get(req.user.id);
    if (!teacher) return res.status(404).json({ error: 'Teacher profile not found' });

    const classrooms = db.prepare(`
      SELECT c.*, t.name as term_name,
        (SELECT COUNT(*) FROM classroom_members WHERE classroom_id = c.id) as student_count
      FROM classrooms c
      JOIN terms t ON c.term_id = t.id
      WHERE c.teacher_id = ?
      ORDER BY c.created_at DESC
    `).all(teacher.id);

    const activeTerm = db.prepare('SELECT * FROM terms WHERE active_status = 1 LIMIT 1').get();
    const activePeriod = db.prepare(`
      SELECT fp.* FROM feedback_periods fp
      WHERE fp.active_status = 1 ${activeTerm ? 'AND fp.term_id = ' + activeTerm.id : ''}
      LIMIT 1
    `).get();

    // Overall scores
    const overallScores = getTeacherScores(teacher.id);

    // Per-term scores
    let termScores = null;
    let trend = null;
    if (activeTerm) {
      termScores = getTeacherScores(teacher.id, { termId: activeTerm.id });
      trend = getTeacherTrend(teacher.id, activeTerm.id);
    }

    // Distribution
    const distribution = getRatingDistribution(teacher.id);

    // Department comparison (within same org)
    const deptAvg = teacher.department ? getDepartmentAverage(teacher.department, activeTerm?.id, teacher.org_id) : null;

    // All reviews for this teacher (approved + pending for visibility)
    const recentReviews = db.prepare(`
      SELECT r.overall_rating, r.clarity_rating, r.engagement_rating,
        r.fairness_rating, r.supportiveness_rating, r.preparation_rating, r.workload_rating,
        r.feedback_text, r.tags,
        r.created_at, r.flagged_status, r.approved_status,
        fp.name as period_name, t.name as term_name, c.subject as classroom_subject,
        c.grade_level
      FROM reviews r
      JOIN feedback_periods fp ON r.feedback_period_id = fp.id
      JOIN terms t ON r.term_id = t.id
      JOIN classrooms c ON r.classroom_id = c.id
      WHERE r.teacher_id = ?
      ORDER BY r.created_at DESC
      LIMIT 50
    `).all(teacher.id);

    // Completion rates per classroom for active period
    let completionRates = [];
    if (activePeriod) {
      completionRates = classrooms.map(c => ({
        classroom_id: c.id,
        subject: c.subject,
        grade_level: c.grade_level,
        ...getClassroomCompletionRate(c.id, activePeriod.id)
      }));
    }

    // Teacher responses
    const responses = db.prepare(`
      SELECT tr.*, fp.name as period_name, c.subject as classroom_subject
      FROM teacher_responses tr
      JOIN feedback_periods fp ON tr.feedback_period_id = fp.id
      JOIN classrooms c ON tr.classroom_id = c.id
      WHERE tr.teacher_id = ?
      ORDER BY tr.created_at DESC
    `).all(teacher.id);

    res.json({
      teacher,
      classrooms,
      active_term: activeTerm,
      active_period: activePeriod,
      overall_scores: overallScores,
      term_scores: termScores,
      trend,
      distribution,
      department_average: deptAvg,
      recent_reviews: recentReviews,
      completion_rates: completionRates,
      responses
    });
  } catch (err) {
    console.error('Teacher dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// POST /api/dashboard/teacher/respond - teacher posts period response
router.post('/teacher/respond', authenticate, authorize('teacher'), (req, res) => {
  try {
    const { classroom_id, feedback_period_id, response_text } = req.body;
    if (!classroom_id || !feedback_period_id || !response_text) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const teacher = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(req.user.id);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ? AND teacher_id = ?')
      .get(classroom_id, teacher.id);
    if (!classroom) return res.status(403).json({ error: 'Not your classroom' });

    db.prepare(`
      INSERT OR REPLACE INTO teacher_responses (teacher_id, classroom_id, feedback_period_id, response_text)
      VALUES (?, ?, ?, ?)
    `).run(teacher.id, classroom_id, feedback_period_id, response_text);

    logAuditEvent({
      userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
      actionType: 'teacher_respond',
      actionDescription: `Posted response to feedback for ${classroom.subject}`,
      targetType: 'teacher_response', targetId: classroom_id,
      metadata: { classroom_id, feedback_period_id },
      ipAddress: req.ip
    });

    res.json({ message: 'Response saved' });
  } catch (err) {
    console.error('Teacher respond error:', err);
    res.status(500).json({ error: 'Failed to save response' });
  }
});

// GET /api/dashboard/school-head
router.get('/school-head', authenticate, authorize('school_head', 'super_admin', 'org_admin'), (req, res) => {
  try {
    const orgId = req.user.org_id;
    if (!orgId && req.user.role !== 'super_admin') {
      return res.status(400).json({ error: 'Organization context required' });
    }

    const activeTerm = db.prepare(`SELECT * FROM terms WHERE active_status = 1 ${orgId ? 'AND org_id = ?' : ''} LIMIT 1`).get(...(orgId ? [orgId] : []));

    const teachers = db.prepare(`SELECT * FROM teachers WHERE ${orgId ? 'org_id = ?' : '1=1'}`).all(...(orgId ? [orgId] : []));

    const teacherPerformance = teachers.map(t => {
      const scores = getTeacherScores(t.id, activeTerm ? { termId: activeTerm.id } : {});
      const distribution = getRatingDistribution(t.id, activeTerm ? { termId: activeTerm.id } : {});
      const trend = activeTerm ? getTeacherTrend(t.id, activeTerm.id) : null;

      return {
        ...t,
        scores,
        distribution,
        trend
      };
    });

    // Department-level aggregation
    const departments = {};
    teachers.forEach(t => {
      if (!t.department) return;
      if (!departments[t.department]) {
        departments[t.department] = { teachers: [], avg_score: 0 };
      }
      departments[t.department].teachers.push(t.id);
    });

    for (const [dept, data] of Object.entries(departments)) {
      data.avg_score = getDepartmentAverage(dept, activeTerm?.id, orgId);
    }

    // All classrooms with stats
    const classrooms = db.prepare(`
      SELECT c.*, te.full_name as teacher_name, t.name as term_name,
        (SELECT COUNT(*) FROM classroom_members WHERE classroom_id = c.id) as student_count
      FROM classrooms c
      JOIN teachers te ON c.teacher_id = te.id
      JOIN terms t ON c.term_id = t.id
      ORDER BY c.created_at DESC
    `).all();

    const terms = db.prepare(`SELECT * FROM terms WHERE ${orgId ? 'org_id = ?' : '1=1'} ORDER BY start_date DESC`).all(...(orgId ? [orgId] : []));

    res.json({
      active_term: activeTerm,
      teachers: teacherPerformance,
      departments,
      classrooms,
      terms
    });
  } catch (err) {
    console.error('School head dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// GET /api/dashboard/school-head/teacher/:id - detailed teacher view
router.get('/school-head/teacher/:id', authenticate, authorize('school_head', 'super_admin', 'org_admin'), (req, res) => {
  try {
    const teacher = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

    // Org check
    if (req.user.role !== 'super_admin' && req.user.org_id !== teacher.org_id) {
      return res.status(403).json({ error: 'Teacher does not belong to your organization' });
    }

    const terms = db.prepare(`SELECT * FROM terms WHERE ${teacher.org_id ? 'org_id = ?' : '1=1'} ORDER BY start_date DESC`).all(...(teacher.org_id ? [teacher.org_id] : []));
    const activeTerm = db.prepare('SELECT * FROM terms WHERE active_status = 1 LIMIT 1').get();

    const classrooms = db.prepare(`
      SELECT c.*, t.name as term_name,
        (SELECT COUNT(*) FROM classroom_members WHERE classroom_id = c.id) as student_count
      FROM classrooms c
      JOIN terms t ON c.term_id = t.id
      WHERE c.teacher_id = ?
    `).all(teacher.id);

    const scores = {};
    const trends = {};
    terms.forEach(term => {
      scores[term.id] = getTeacherScores(teacher.id, { termId: term.id });
      trends[term.id] = getTeacherTrend(teacher.id, term.id);
    });

    const reviews = db.prepare(`
      SELECT r.overall_rating, r.clarity_rating, r.engagement_rating,
        r.fairness_rating, r.supportiveness_rating, r.preparation_rating, r.workload_rating,
        r.feedback_text, r.tags,
        r.created_at, fp.name as period_name, t.name as term_name, c.subject as classroom_subject
      FROM reviews r
      JOIN feedback_periods fp ON r.feedback_period_id = fp.id
      JOIN terms t ON r.term_id = t.id
      JOIN classrooms c ON r.classroom_id = c.id
      WHERE r.teacher_id = ? AND r.approved_status = 1
      ORDER BY r.created_at DESC
    `).all(teacher.id);

    res.json({ teacher, classrooms, terms, scores, trends, reviews });
  } catch (err) {
    console.error('Teacher detail error:', err);
    res.status(500).json({ error: 'Failed to load teacher details' });
  }
});

module.exports = router;
