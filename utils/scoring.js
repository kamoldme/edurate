const db = require('../database');

function calculateFinalScore(review) {
  const clarity = review.clarity_rating || 0;
  const engagement = review.engagement_rating || 0;
  const fairness = review.fairness_rating || 0;
  const supportiveness = review.supportiveness_rating || 0;
  const preparation = review.preparation_rating || 0;
  const workload = review.workload_rating || 0;
  return (clarity + engagement + fairness + supportiveness + preparation + workload) / 6;
}

// Classroom-weighted: average each classroom's scores first, then average those.
// Prevents classrooms with more students from dominating the result.
function getTeacherScores(teacherId, options = {}) {
  const { classroomId, feedbackPeriodId, termId } = options;

  let where = 'WHERE r.teacher_id = ? AND r.approved_status = 1';
  const params = [teacherId];

  if (classroomId) {
    where += ' AND r.classroom_id = ?';
    params.push(classroomId);
  }
  if (feedbackPeriodId) {
    where += ' AND r.feedback_period_id = ?';
    params.push(feedbackPeriodId);
  }
  if (termId) {
    where += ' AND r.term_id = ?';
    params.push(termId);
  }

  const result = db.prepare(`
    SELECT
      SUM(review_count) as review_count,
      ROUND(AVG(avg_clarity), 2) as avg_clarity,
      ROUND(AVG(avg_engagement), 2) as avg_engagement,
      ROUND(AVG(avg_fairness), 2) as avg_fairness,
      ROUND(AVG(avg_supportiveness), 2) as avg_supportiveness,
      ROUND(AVG(avg_preparation), 2) as avg_preparation,
      ROUND(AVG(avg_workload), 2) as avg_workload,
      ROUND((AVG(avg_clarity) + AVG(avg_engagement) + AVG(avg_fairness) +
             AVG(avg_supportiveness) + AVG(avg_preparation) + AVG(avg_workload)) / 6, 2) as avg_overall,
      ROUND((AVG(avg_clarity) + AVG(avg_engagement) + AVG(avg_fairness) +
             AVG(avg_supportiveness) + AVG(avg_preparation) + AVG(avg_workload)) / 6, 2) as final_score
    FROM (
      SELECT
        r.classroom_id,
        COUNT(*) as review_count,
        AVG(r.clarity_rating) as avg_clarity,
        AVG(r.engagement_rating) as avg_engagement,
        AVG(r.fairness_rating) as avg_fairness,
        AVG(r.supportiveness_rating) as avg_supportiveness,
        AVG(r.preparation_rating) as avg_preparation,
        AVG(r.workload_rating) as avg_workload
      FROM reviews r
      ${where}
      GROUP BY r.classroom_id
    )
  `).get(...params);

  return result;
}

function getRatingDistribution(teacherId, options = {}) {
  const { classroomId, feedbackPeriodId, termId } = options;

  let where = 'WHERE r.teacher_id = ? AND r.approved_status = 1';
  const params = [teacherId];

  if (classroomId) { where += ' AND r.classroom_id = ?'; params.push(classroomId); }
  if (feedbackPeriodId) { where += ' AND r.feedback_period_id = ?'; params.push(feedbackPeriodId); }
  if (termId) { where += ' AND r.term_id = ?'; params.push(termId); }

  const distribution = db.prepare(`
    SELECT overall_rating as rating, COUNT(*) as count
    FROM reviews r
    ${where}
    GROUP BY overall_rating
    ORDER BY overall_rating
  `).all(...params);

  const result = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  distribution.forEach(d => { result[d.rating] = d.count; });
  return result;
}

// Timeline groups by calendar month (e.g. "2026-03" → March 2026).
// Periods that overlap within the same month are merged into one data point.
// Option A: per-classroom monthly breakdown.
// Option C: trend direction only set when the same classrooms appear in
//           both the first and last month; otherwise trend is null.
function getTeacherTrend(teacherId, termId) {
  // Overall monthly timeline — classroom-weighted across all periods in each month
  const monthRows = db.prepare(`
    SELECT strftime('%Y-%m', fp.start_date) as month,
      MIN(fp.start_date) as month_start,
      COUNT(DISTINCT r.classroom_id) as classroom_count,
      COUNT(r.id) as review_count
    FROM feedback_periods fp
    JOIN reviews r ON r.feedback_period_id = fp.id
      AND r.teacher_id = ? AND r.approved_status = 1
    WHERE fp.term_id = ?
    GROUP BY month
    ORDER BY month ASC
  `).all(teacherId, termId);

  const months = monthRows.map(m => {
    const cwScore = db.prepare(`
      SELECT ROUND(AVG(classroom_score), 2) as score
      FROM (
        SELECT r.classroom_id,
          ROUND((AVG(r.clarity_rating) + AVG(r.engagement_rating) + AVG(r.fairness_rating) +
                 AVG(r.supportiveness_rating) + AVG(r.preparation_rating) + AVG(r.workload_rating)) / 6, 2) as classroom_score
        FROM feedback_periods fp
        JOIN reviews r ON r.feedback_period_id = fp.id
          AND r.teacher_id = ? AND r.approved_status = 1
        WHERE fp.term_id = ? AND strftime('%Y-%m', fp.start_date) = ?
        GROUP BY r.classroom_id
      )
    `).get(teacherId, termId, m.month);

    return {
      month: m.month,
      month_start: m.month_start,
      score: cwScore?.score ?? null,
      review_count: m.review_count,
      classroom_count: m.classroom_count
    };
  });

  // Option A: per-classroom monthly breakdown
  const classrooms = db.prepare(`
    SELECT DISTINCT r.classroom_id, c.subject, c.grade_level
    FROM reviews r
    JOIN classrooms c ON r.classroom_id = c.id
    WHERE r.teacher_id = ? AND r.term_id = ? AND r.approved_status = 1
  `).all(teacherId, termId);

  const classroomTrends = classrooms.map(cls => {
    const classroomMonths = db.prepare(`
      SELECT strftime('%Y-%m', fp.start_date) as month,
        MIN(fp.start_date) as month_start,
        ROUND((AVG(r.clarity_rating) + AVG(r.engagement_rating) + AVG(r.fairness_rating) +
               AVG(r.supportiveness_rating) + AVG(r.preparation_rating) + AVG(r.workload_rating)) / 6, 2) as score,
        COUNT(r.id) as review_count
      FROM feedback_periods fp
      JOIN reviews r ON r.feedback_period_id = fp.id
        AND r.teacher_id = ? AND r.classroom_id = ? AND r.approved_status = 1
      WHERE fp.term_id = ?
      GROUP BY month
      ORDER BY month ASC
    `).all(teacherId, cls.classroom_id, termId);

    return {
      classroom_id: cls.classroom_id,
      subject: cls.subject,
      grade_level: cls.grade_level,
      months: classroomMonths
    };
  });

  // Option C: only set trend direction if same classrooms appear in both first and last month
  let trend = null;
  const validMonths = months.filter(m => m.score !== null);
  if (validMonths.length >= 2) {
    const firstMonth = validMonths[0].month;
    const lastMonth = validMonths[validMonths.length - 1].month;

    const firstClassrooms = new Set(
      db.prepare(`
        SELECT DISTINCT r.classroom_id FROM reviews r
        JOIN feedback_periods fp ON r.feedback_period_id = fp.id
        WHERE r.teacher_id = ? AND fp.term_id = ? AND strftime('%Y-%m', fp.start_date) = ? AND r.approved_status = 1
      `).all(teacherId, termId, firstMonth).map(r => r.classroom_id)
    );
    const lastClassroomIds = db.prepare(`
      SELECT DISTINCT r.classroom_id FROM reviews r
      JOIN feedback_periods fp ON r.feedback_period_id = fp.id
      WHERE r.teacher_id = ? AND fp.term_id = ? AND strftime('%Y-%m', fp.start_date) = ? AND r.approved_status = 1
    `).all(teacherId, termId, lastMonth).map(r => r.classroom_id);

    const hasOverlap = lastClassroomIds.some(id => firstClassrooms.has(id));
    if (hasOverlap) {
      const diff = validMonths[validMonths.length - 1].score - validMonths[0].score;
      if (diff > 0.3) trend = 'improving';
      else if (diff < -0.3) trend = 'declining';
      else trend = 'stable';
    }
    // No overlap → trend stays null (Option C)
  }

  return { classroom_trends: classroomTrends, months, trend };
}

function getDepartmentAverage(department, termId, orgId) {
  let where = 't.department = ? AND r.approved_status = 1';
  const params = [department];

  if (termId) {
    where += ' AND r.term_id = ?';
    params.push(termId);
  }

  if (orgId) {
    where += ' AND t.org_id = ?';
    params.push(orgId);
  }

  const result = db.prepare(`
    SELECT ROUND(AVG(classroom_score), 2) as avg_score
    FROM (
      SELECT ROUND((AVG(r.clarity_rating) + AVG(r.engagement_rating) + AVG(r.fairness_rating) +
                    AVG(r.supportiveness_rating) + AVG(r.preparation_rating) + AVG(r.workload_rating)) / 6, 2) as classroom_score
      FROM reviews r
      JOIN teachers t ON r.teacher_id = t.id
      WHERE ${where}
      GROUP BY r.classroom_id
    )
  `).get(...params);

  return result?.avg_score || 0;
}

function getClassroomCompletionRate(classroomId, feedbackPeriodId) {
  const totalStudents = db.prepare(
    'SELECT COUNT(*) as count FROM classroom_members WHERE classroom_id = ?'
  ).get(classroomId).count;

  const submittedStudents = db.prepare(
    'SELECT COUNT(DISTINCT student_id) as count FROM reviews WHERE classroom_id = ? AND feedback_period_id = ?'
  ).get(classroomId, feedbackPeriodId).count;

  return {
    total: totalStudents,
    submitted: submittedStudents,
    rate: totalStudents > 0 ? Math.round((submittedStudents / totalStudents) * 100) : 100
  };
}

module.exports = {
  calculateFinalScore,
  getTeacherScores,
  getRatingDistribution,
  getTeacherTrend,
  getDepartmentAverage,
  getClassroomCompletionRate
};
