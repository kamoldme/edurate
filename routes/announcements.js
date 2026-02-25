const express = require('express');
const db = require('../database');
const { authenticate, authorize } = require('../middleware/auth');
const { logAuditEvent } = require('../utils/audit');

const router = express.Router();

// Helper: get announcements visible to a user
function getVisibleAnnouncements(userId, userRole, orgId, classroomIds = []) {
  const params = [];
  let query = `
    SELECT a.*, u.full_name as creator_name,
      GROUP_CONCAT(DISTINCT ac.classroom_id) as classroom_ids,
      GROUP_CONCAT(DISTINCT c.subject || ' ' || COALESCE(c.grade_level, '')) as classroom_labels
    FROM announcements a
    JOIN users u ON a.creator_id = u.id
    LEFT JOIN announcement_classrooms ac ON ac.announcement_id = a.id
    LEFT JOIN classrooms c ON c.id = ac.classroom_id
    WHERE (
  `;

  if (userRole === 'super_admin') {
    query += '1=1';
  } else if (userRole === 'org_admin' || userRole === 'school_head') {
    query += 'a.org_id = ?';
    params.push(orgId);
  } else if (userRole === 'teacher') {
    // Sees org announcements + announcements targeting their classrooms
    if (classroomIds.length > 0) {
      const ph = classroomIds.map(() => '?').join(',');
      query += `(a.org_id = ? AND a.target_type IN ('org','all')) OR ac.classroom_id IN (${ph})`;
      params.push(orgId, ...classroomIds);
    } else {
      query += `a.org_id = ? AND a.target_type IN ('org','all')`;
      params.push(orgId);
    }
  } else if (userRole === 'student') {
    // Sees org announcements + announcements for their classrooms
    if (classroomIds.length > 0) {
      const ph = classroomIds.map(() => '?').join(',');
      query += `(a.org_id = ? AND a.target_type IN ('org','all')) OR ac.classroom_id IN (${ph})`;
      params.push(orgId, ...classroomIds);
    } else {
      query += `a.org_id = ? AND a.target_type IN ('org','all')`;
      params.push(orgId);
    }
  } else {
    query += '1=0';
  }

  query += ') GROUP BY a.id ORDER BY a.created_at DESC LIMIT 100';
  return db.prepare(query).all(...params);
}

// GET /api/announcements - list announcements relevant to current user
router.get('/', authenticate, (req, res) => {
  try {
    const { role, id: userId, org_id: rawOrgId } = req.user;
    let orgId = rawOrgId;
    let classroomIds = [];

    if (role === 'teacher') {
      const teacher = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(userId);
      if (teacher) {
        classroomIds = db.prepare('SELECT id FROM classrooms WHERE teacher_id = ?')
          .all(teacher.id).map(c => c.id);
      }
    } else if (role === 'student') {
      classroomIds = db.prepare('SELECT classroom_id FROM classroom_members WHERE student_id = ?')
        .all(userId).map(c => c.classroom_id);
      // Students register with org_id = NULL — derive from classroom memberships
      if (!orgId && classroomIds.length > 0) {
        const ph = classroomIds.map(() => '?').join(',');
        const row = db.prepare(`SELECT org_id FROM classrooms WHERE id IN (${ph}) AND org_id IS NOT NULL LIMIT 1`).get(...classroomIds);
        orgId = row?.org_id || null;
      }
    }

    const announcements = getVisibleAnnouncements(userId, role, orgId, classroomIds);

    // Parse classroom_ids and classroom_labels strings into arrays
    const parsed = announcements.map(a => ({
      ...a,
      classroom_ids: a.classroom_ids ? a.classroom_ids.split(',').map(Number) : [],
      classroom_labels: a.classroom_labels ? a.classroom_labels.split(',').map(s => s.trim()).filter(Boolean) : []
    }));

    res.json(parsed);
  } catch (err) {
    console.error('List announcements error:', err);
    res.status(500).json({ error: 'Failed to fetch announcements' });
  }
});

// POST /api/announcements - create announcement
router.post('/', authenticate, authorize('super_admin', 'org_admin', 'school_head', 'teacher'), (req, res) => {
  try {
    const { title, content, target_type, org_ids, classroom_ids } = req.body;
    const { role, id: userId, org_id: userOrgId } = req.user;

    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    // Determine effective org_id for the announcement
    let announcementOrgId = userOrgId;
    if (role === 'teacher') {
      // Teachers can only target their own classrooms — no org-wide announcements
      if (!classroom_ids || !Array.isArray(classroom_ids) || classroom_ids.length === 0) {
        return res.status(400).json({ error: 'Teachers must select at least one classroom' });
      }
      // Verify teacher owns all selected classrooms
      const teacher = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(userId);
      if (!teacher) return res.status(403).json({ error: 'Teacher profile not found' });
      const owned = db.prepare(
        `SELECT id FROM classrooms WHERE id IN (${classroom_ids.map(() => '?').join(',')}) AND teacher_id = ?`
      ).all(...classroom_ids, teacher.id);
      if (owned.length !== classroom_ids.length) {
        return res.status(403).json({ error: 'You can only post to your own classrooms' });
      }
    } else if (role === 'school_head' || role === 'org_admin') {
      announcementOrgId = userOrgId;
    } else if (role === 'super_admin') {
      // Can target a specific org or all orgs
      announcementOrgId = req.body.org_id ? parseInt(req.body.org_id) : null;
    }

    const effectiveTargetType = role === 'teacher' ? 'classrooms' : (target_type || 'org');

    const result = db.prepare(`
      INSERT INTO announcements (creator_id, creator_role, org_id, title, content, target_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, role, announcementOrgId, title.trim(), content, effectiveTargetType);

    const announcementId = result.lastInsertRowid;

    // Link classrooms if targeting specific classrooms
    if (classroom_ids && Array.isArray(classroom_ids) && classroom_ids.length > 0) {
      const insertClassroom = db.prepare(
        'INSERT OR IGNORE INTO announcement_classrooms (announcement_id, classroom_id) VALUES (?, ?)'
      );
      classroom_ids.forEach(cid => insertClassroom.run(announcementId, cid));
    }

    logAuditEvent({
      userId, userRole: role, userName: req.user.full_name,
      actionType: 'announcement_create',
      actionDescription: `Created announcement: "${title}"`,
      targetType: 'announcement', targetId: announcementId,
      metadata: { target_type: effectiveTargetType, classroom_ids },
      ipAddress: req.ip, orgId: announcementOrgId
    });

    const created = db.prepare('SELECT * FROM announcements WHERE id = ?').get(announcementId);
    res.status(201).json(created);
  } catch (err) {
    console.error('Create announcement error:', err);
    res.status(500).json({ error: 'Failed to create announcement' });
  }
});

// DELETE /api/announcements/:id
router.delete('/:id', authenticate, authorize('super_admin', 'org_admin', 'school_head', 'teacher'), (req, res) => {
  try {
    const ann = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
    if (!ann) return res.status(404).json({ error: 'Announcement not found' });

    const { role, id: userId, org_id: orgId } = req.user;
    if (role === 'teacher' && ann.creator_id !== userId) {
      return res.status(403).json({ error: 'You can only delete your own announcements' });
    }
    if ((role === 'school_head' || role === 'org_admin') && ann.org_id !== orgId && ann.creator_id !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);

    logAuditEvent({
      userId, userRole: role, userName: req.user.full_name,
      actionType: 'announcement_delete',
      actionDescription: `Deleted announcement: "${ann.title}"`,
      targetType: 'announcement', targetId: ann.id,
      ipAddress: req.ip, orgId: ann.org_id
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Delete announcement error:', err);
    res.status(500).json({ error: 'Failed to delete announcement' });
  }
});

// GET /api/announcements/classrooms - get classrooms available for teacher/admin to target
router.get('/classrooms', authenticate, authorize('super_admin', 'org_admin', 'school_head', 'teacher'), (req, res) => {
  try {
    const { role, id: userId, org_id: orgId } = req.user;
    let classrooms;

    if (role === 'teacher') {
      const teacher = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(userId);
      classrooms = teacher
        ? db.prepare('SELECT id, subject, grade_level FROM classrooms WHERE teacher_id = ? AND active_status = 1 ORDER BY subject').all(teacher.id)
        : [];
    } else {
      const orgParam = role === 'super_admin' ? (req.query.org_id ? parseInt(req.query.org_id) : null) : orgId;
      classrooms = orgParam
        ? db.prepare('SELECT c.id, c.subject, c.grade_level, te.full_name as teacher_name FROM classrooms c JOIN teachers te ON c.teacher_id = te.id WHERE c.org_id = ? AND c.active_status = 1 ORDER BY c.subject').all(orgParam)
        : db.prepare('SELECT c.id, c.subject, c.grade_level, te.full_name as teacher_name FROM classrooms c JOIN teachers te ON c.teacher_id = te.id WHERE c.active_status = 1 ORDER BY c.subject').all();
    }

    res.json(classrooms);
  } catch (err) {
    console.error('Announcement classrooms error:', err);
    res.status(500).json({ error: 'Failed to fetch classrooms' });
  }
});

module.exports = router;
