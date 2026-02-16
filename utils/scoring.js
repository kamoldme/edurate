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
      COUNT(*) as review_count,
      ROUND(AVG(r.overall_rating), 2) as avg_overall,
      ROUND(AVG(r.clarity_rating), 2) as avg_clarity,
      ROUND(AVG(r.engagement_rating), 2) as avg_engagement,
      ROUND(AVG(r.fairness_rating), 2) as avg_fairness,
      ROUND(AVG(r.supportiveness_rating), 2) as avg_supportiveness,
      ROUND(AVG(r.preparation_rating), 2) as avg_preparation,
      ROUND(AVG(r.workload_rating), 2) as avg_workload,
      ROUND(AVG(r.overall_rating), 2) as final_score
    FROM reviews r
    ${where}
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

function getTeacherTrend(teacherId, termId) {
  const periods = db.prepare(`
    SELECT fp.id, fp.name,
      ROUND(AVG(r.overall_rating), 2) as score,
      COUNT(r.id) as review_count
    FROM feedback_periods fp
    LEFT JOIN reviews r ON r.feedback_period_id = fp.id
      AND r.teacher_id = ? AND r.approved_status = 1
    WHERE fp.term_id = ?
    GROUP BY fp.id
    ORDER BY fp.id
  `).all(teacherId, termId);

  let trend = 'stable';
  const scores = periods.filter(p => p.score !== null).map(p => p.score);
  if (scores.length >= 2) {
    const diff = scores[scores.length - 1] - scores[0];
    if (diff > 0.3) trend = 'improving';
    else if (diff < -0.3) trend = 'declining';
  }

  return { periods, trend };
}

function getDepartmentAverage(department, termId) {
  const result = db.prepare(`
    SELECT
      ROUND(AVG(r.overall_rating), 2) as avg_score
    FROM reviews r
    JOIN teachers t ON r.teacher_id = t.id
    WHERE t.department = ? AND r.approved_status = 1
    ${termId ? 'AND r.term_id = ?' : ''}
  `).get(...(termId ? [department, termId] : [department]));

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
    rate: totalStudents > 0 ? Math.round((submittedStudents / totalStudents) * 100) : 0
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
