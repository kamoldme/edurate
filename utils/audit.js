const db = require('../database');

/**
 * Log an audit event
 * @param {Object} params - Audit log parameters
 * @param {number} params.userId - ID of user performing action
 * @param {string} params.userRole - Role of user
 * @param {string} params.userName - Name of user
 * @param {string} params.actionType - Type of action (e.g., 'review_approve', 'user_suspend', 'review_submit')
 * @param {string} params.actionDescription - Human-readable description
 * @param {string} [params.targetType] - Type of target (e.g., 'review', 'user', 'classroom')
 * @param {number} [params.targetId] - ID of target
 * @param {Object} [params.metadata] - Additional metadata as object
 * @param {string} [params.ipAddress] - IP address of request
 * @param {number} [params.orgId] - Organization ID for multi-tenant scoping
 */
function logAuditEvent(params) {
  try {
    const {
      userId,
      userRole,
      userName,
      actionType,
      actionDescription,
      targetType = null,
      targetId = null,
      metadata = null,
      ipAddress = null,
      orgId = null
    } = params;

    db.prepare(`
      INSERT INTO audit_logs (
        user_id, user_role, user_name, action_type, action_description,
        target_type, target_id, metadata, ip_address, org_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      userRole,
      userName,
      actionType,
      actionDescription,
      targetType,
      targetId,
      metadata ? JSON.stringify(metadata) : null,
      ipAddress,
      orgId
    );
  } catch (err) {
    console.error('Audit log error:', err);
    // Don't throw - logging failures shouldn't break the application
  }
}

/**
 * Get audit logs with filtering
 */
function getAuditLogs(options = {}) {
  const {
    userId,
    actionType,
    targetType,
    targetId,
    startDate,
    endDate,
    limit = 100,
    offset = 0,
    orgId
  } = options;

  let query = 'SELECT * FROM audit_logs WHERE 1=1';
  const params = [];

  if (userId) {
    query += ' AND user_id = ?';
    params.push(userId);
  }

  if (actionType) {
    query += ' AND action_type = ?';
    params.push(actionType);
  }

  if (targetType) {
    query += ' AND target_type = ?';
    params.push(targetType);
  }

  if (targetId) {
    query += ' AND target_id = ?';
    params.push(targetId);
  }

  if (startDate) {
    query += ' AND created_at >= ?';
    params.push(startDate);
  }

  if (endDate) {
    query += ' AND created_at <= ?';
    params.push(endDate);
  }

  if (orgId) {
    query += ' AND org_id = ?';
    params.push(orgId);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const logs = db.prepare(query).all(...params);

  // Parse metadata JSON
  return logs.map(log => ({
    ...log,
    metadata: log.metadata ? JSON.parse(log.metadata) : null
  }));
}

/**
 * Get audit log statistics
 */
function getAuditStats(options = {}) {
  const { startDate, endDate, orgId } = options;

  let where = 'WHERE 1=1';
  const params = [];

  if (startDate) {
    where += ' AND created_at >= ?';
    params.push(startDate);
  }

  if (endDate) {
    where += ' AND created_at <= ?';
    params.push(endDate);
  }

  if (orgId) {
    where += ' AND org_id = ?';
    params.push(orgId);
  }

  const totalActions = db.prepare(`SELECT COUNT(*) as count FROM audit_logs ${where}`).get(...params).count;

  const actionBreakdown = db.prepare(`
    SELECT action_type, COUNT(*) as count
    FROM audit_logs ${where}
    GROUP BY action_type
    ORDER BY count DESC
  `).all(...params);

  const userActivity = db.prepare(`
    SELECT user_id, user_name, user_role, COUNT(*) as action_count
    FROM audit_logs ${where}
    GROUP BY user_id
    ORDER BY action_count DESC
    LIMIT 20
  `).all(...params);

  return {
    total_actions: totalActions,
    action_breakdown: actionBreakdown,
    top_users: userActivity
  };
}

module.exports = {
  logAuditEvent,
  getAuditLogs,
  getAuditStats
};
