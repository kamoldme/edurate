const db = require('../database');

/**
 * Bulk-insert in-app notifications for a list of user IDs.
 * Always wrapped in try/catch — a failure here must NEVER break the calling route.
 *
 * @param {object} opts
 * @param {number[]} opts.userIds
 * @param {number|null} opts.orgId
 * @param {'announcement'|'form_active'|'period_open'|'review_approved'} opts.type
 * @param {string} opts.title
 * @param {string} [opts.body]   - short preview text (≤120 chars recommended)
 * @param {string} [opts.link]   - SPA view name, e.g. 'student-forms'
 */
function createNotifications({ userIds, orgId, type, title, body, link }) {
  if (!userIds || userIds.length === 0) return;
  try {
    const insert = db.prepare(
      'INSERT INTO in_app_notifications (user_id, org_id, type, title, body, link) VALUES (?, ?, ?, ?, ?, ?)'
    );
    db.transaction(() => {
      for (const uid of userIds) {
        insert.run(uid, orgId ?? null, type, title, body ?? null, link ?? null);
      }
    })();
  } catch (e) {
    console.error('Notification insert error (non-fatal):', e.message);
  }
}

module.exports = { createNotifications };
