const express = require('express');
const db = require('../database');
const { authenticate, authorize, authorizeOrg } = require('../middleware/auth');
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
      LEFT JOIN terms t ON c.term_id = t.id
      WHERE cm.student_id = ?
      ORDER BY c.created_at DESC
    `).all(req.user.id);

    // Students register with org_id = NULL and join orgs via classrooms.
    // Derive their org from classroom memberships so the period/term queries work correctly.
    const studentOrgRow = db.prepare(`
      SELECT DISTINCT c.org_id FROM classroom_members cm
      JOIN classrooms c ON cm.classroom_id = c.id
      WHERE cm.student_id = ? AND c.org_id IS NOT NULL
      LIMIT 1
    `).get(req.user.id);
    const studentOrgId = studentOrgRow?.org_id ?? req.user.org_id;

    const activePeriod = studentOrgId ? db.prepare(`
      SELECT fp.*, t.name as term_name FROM feedback_periods fp
      JOIN terms t ON fp.term_id = t.id
      WHERE fp.active_status = 1 AND t.active_status = 1 AND t.org_id = ?
      ORDER BY fp.id ASC LIMIT 1
    `).get(studentOrgId) : null;

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

    const activeTerm = studentOrgId
      ? db.prepare('SELECT * FROM terms WHERE active_status = 1 AND org_id = ? LIMIT 1').get(studentOrgId)
      : null;

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
      LEFT JOIN terms t ON c.term_id = t.id
      WHERE c.teacher_id = ?
      ORDER BY c.created_at DESC
    `).all(teacher.id);

    const activeTerm = db.prepare('SELECT * FROM terms WHERE active_status = 1 AND org_id = ? LIMIT 1').get(teacher.org_id);
    const activePeriod = activeTerm ? db.prepare(`
      SELECT fp.* FROM feedback_periods fp
      WHERE fp.active_status = 1 AND fp.term_id = ?
      ORDER BY fp.id ASC LIMIT 1
    `).get(activeTerm.id) : null;
    const allTerms = db.prepare('SELECT id, name FROM terms WHERE org_id = ? ORDER BY start_date DESC').all(teacher.org_id);

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

    // Approved reviews only — teachers must not see pending/flagged moderation status
    const recentReviews = db.prepare(`
      SELECT r.overall_rating, r.clarity_rating, r.engagement_rating,
        r.fairness_rating, r.supportiveness_rating, r.preparation_rating, r.workload_rating,
        r.feedback_text, r.tags, r.approved_status,
        r.created_at,
        fp.name as period_name, t.name as term_name, c.subject as classroom_subject,
        c.grade_level
      FROM reviews r
      JOIN feedback_periods fp ON r.feedback_period_id = fp.id
      JOIN terms t ON r.term_id = t.id
      JOIN classrooms c ON r.classroom_id = c.id
      WHERE r.teacher_id = ? AND r.approved_status = 1
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

    // Pending review count (for teacher awareness)
    const pendingCount = db.prepare(
      "SELECT COUNT(*) as count FROM reviews WHERE teacher_id = ? AND approved_status = 0 AND flagged_status = 'pending'"
    ).get(teacher.id).count;

    const totalReviewCount = db.prepare(
      'SELECT COUNT(*) as count FROM reviews WHERE teacher_id = ?'
    ).get(teacher.id).count;

    res.json({
      teacher,
      classrooms,
      active_term: activeTerm,
      active_period: activePeriod,
      all_terms: allTerms,
      overall_scores: overallScores,
      term_scores: termScores,
      trend,
      distribution,
      department_average: deptAvg,
      recent_reviews: recentReviews,
      completion_rates: completionRates,
      pending_review_count: pendingCount,
      total_review_count: totalReviewCount
    });
  } catch (err) {
    console.error('Teacher dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// GET /api/dashboard/teacher/reviews - paginated approved reviews for teacher
router.get('/teacher/reviews', authenticate, authorize('teacher'), (req, res) => {
  try {
    const teacher = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(req.user.id);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;

    const total = db.prepare('SELECT COUNT(*) as count FROM reviews WHERE teacher_id = ? AND approved_status = 1').get(teacher.id).count;

    const reviews = db.prepare(`
      SELECT r.overall_rating, r.clarity_rating, r.engagement_rating,
        r.fairness_rating, r.supportiveness_rating, r.preparation_rating, r.workload_rating,
        r.feedback_text, r.tags, r.approved_status, r.created_at,
        fp.name as period_name, t.name as term_name, c.subject as classroom_subject, c.grade_level
      FROM reviews r
      JOIN feedback_periods fp ON r.feedback_period_id = fp.id
      JOIN terms t ON r.term_id = t.id
      JOIN classrooms c ON r.classroom_id = c.id
      WHERE r.teacher_id = ? AND r.approved_status = 1
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `).all(teacher.id, limit, offset);

    res.json({ reviews, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('Teacher reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// GET /api/dashboard/school-head
router.get('/school-head', authenticate, authorize('school_head', 'super_admin', 'org_admin'), authorizeOrg, (req, res) => {
  try {
    const orgId = req.orgId;
    if (!orgId && req.user.role !== 'super_admin') {
      return res.status(400).json({ error: 'Organization context required' });
    }

    const activeTerm = db.prepare(`SELECT * FROM terms WHERE active_status = 1 ${orgId ? 'AND org_id = ?' : ''} LIMIT 1`).get(...(orgId ? [orgId] : []));

    const teachers = db.prepare(`SELECT * FROM teachers WHERE ${orgId ? 'org_id = ?' : '1=1'}`).all(...(orgId ? [orgId] : []));

    // ── Bulk queries instead of N × 3 queries ──────────────────────────────
    const termFilter = activeTerm ? 'AND r.term_id = ?' : '';
    const orgFilter2 = orgId ? 'AND r.org_id = ?' : '';
    const bulkParams = [...(activeTerm ? [activeTerm.id] : []), ...(orgId ? [orgId] : [])];

    // 1 query: all teacher aggregate scores
    const scoresData = db.prepare(`
      SELECT r.teacher_id,
        COUNT(*) as review_count,
        ROUND(AVG(r.clarity_rating), 2) as avg_clarity,
        ROUND(AVG(r.engagement_rating), 2) as avg_engagement,
        ROUND(AVG(r.fairness_rating), 2) as avg_fairness,
        ROUND(AVG(r.supportiveness_rating), 2) as avg_supportiveness,
        ROUND(AVG(r.preparation_rating), 2) as avg_preparation,
        ROUND(AVG(r.workload_rating), 2) as avg_workload,
        ROUND((AVG(r.clarity_rating)+AVG(r.engagement_rating)+AVG(r.fairness_rating)+
               AVG(r.supportiveness_rating)+AVG(r.preparation_rating)+AVG(r.workload_rating))/6,2) as avg_overall,
        ROUND((AVG(r.clarity_rating)+AVG(r.engagement_rating)+AVG(r.fairness_rating)+
               AVG(r.supportiveness_rating)+AVG(r.preparation_rating)+AVG(r.workload_rating))/6,2) as final_score
      FROM reviews r
      WHERE r.approved_status = 1 ${termFilter} ${orgFilter2}
      GROUP BY r.teacher_id
    `).all(...bulkParams);

    // 1 query: rating distributions
    const distData = db.prepare(`
      SELECT teacher_id, overall_rating as rating, COUNT(*) as count
      FROM reviews WHERE approved_status = 1 ${termFilter} ${orgFilter2}
      GROUP BY teacher_id, overall_rating
    `).all(...bulkParams);

    // 1 query: period scores for trend (only if active term exists)
    let periodData = [];
    if (activeTerm) {
      periodData = db.prepare(`
        SELECT fp.id as period_id, fp.name as period_name, r.teacher_id,
          COUNT(r.id) as review_count,
          ROUND((AVG(r.clarity_rating)+AVG(r.engagement_rating)+AVG(r.fairness_rating)+
                 AVG(r.supportiveness_rating)+AVG(r.preparation_rating)+AVG(r.workload_rating))/6,2) as score
        FROM feedback_periods fp
        LEFT JOIN reviews r ON r.feedback_period_id = fp.id AND r.approved_status = 1 ${orgFilter2}
        WHERE fp.term_id = ?
        GROUP BY fp.id, r.teacher_id ORDER BY fp.id
      `).all(...(orgId ? [orgId] : []), activeTerm.id);
    }

    // Build lookup maps
    const scoreMap = {};
    scoresData.forEach(s => { scoreMap[s.teacher_id] = s; });

    const distMap = {};
    distData.forEach(d => {
      if (!distMap[d.teacher_id]) distMap[d.teacher_id] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      distMap[d.teacher_id][d.rating] = d.count;
    });

    const allPeriodIds = [...new Set(periodData.map(p => p.period_id))];
    const periodNameMap = {};
    periodData.forEach(p => { periodNameMap[p.period_id] = p.period_name; });
    const teacherPeriodMap = {};
    periodData.forEach(p => {
      if (!p.teacher_id) return;
      if (!teacherPeriodMap[p.teacher_id]) teacherPeriodMap[p.teacher_id] = {};
      teacherPeriodMap[p.teacher_id][p.period_id] = { score: p.score, review_count: p.review_count };
    });

    const teacherPerformance = teachers.map(t => {
      const scores = scoreMap[t.id] || { review_count: 0, avg_overall: null, avg_clarity: null, avg_engagement: null, avg_fairness: null, avg_supportiveness: null, avg_preparation: null, avg_workload: null, final_score: null };
      const distribution = distMap[t.id] || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

      let trend = null;
      if (activeTerm) {
        const periods = allPeriodIds.map(pid => ({
          id: pid, name: periodNameMap[pid],
          score: teacherPeriodMap[t.id]?.[pid]?.score ?? null,
          review_count: teacherPeriodMap[t.id]?.[pid]?.review_count ?? 0
        }));
        const validScores = periods.filter(p => p.score !== null).map(p => p.score);
        let trendDir = 'stable';
        if (validScores.length >= 2) {
          const diff = validScores[validScores.length - 1] - validScores[0];
          if (diff > 0.3) trendDir = 'improving';
          else if (diff < -0.3) trendDir = 'declining';
        }
        trend = { periods, trend: trendDir };
      }

      return { ...t, scores, distribution, trend };
    });

    // Department-level aggregation (from already-fetched scores)
    const departments = {};
    teachers.forEach(t => {
      if (!t.department) return;
      if (!departments[t.department]) departments[t.department] = { teachers: [], avg_score: 0 };
      departments[t.department].teachers.push(t.id);
    });
    for (const [dept, data] of Object.entries(departments)) {
      const deptScores = scoresData.filter(s => {
        const teacher = teachers.find(t => t.id === s.teacher_id);
        return teacher?.department === dept;
      });
      data.avg_score = deptScores.length > 0
        ? Math.round((deptScores.reduce((sum, s) => sum + (s.avg_overall || 0), 0) / deptScores.length) * 100) / 100
        : 0;
    }

    // All classrooms with stats (scoped to org)
    const classrooms = db.prepare(`
      SELECT c.*, te.full_name as teacher_name, t.name as term_name,
        (SELECT COUNT(*) FROM classroom_members WHERE classroom_id = c.id) as student_count
      FROM classrooms c
      JOIN teachers te ON c.teacher_id = te.id
      LEFT JOIN terms t ON c.term_id = t.id
      ${orgId ? 'WHERE c.org_id = ?' : ''}
      ORDER BY c.created_at DESC
    `).all(...(orgId ? [orgId] : []));

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
      LEFT JOIN terms t ON c.term_id = t.id
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
