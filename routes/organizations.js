const express = require('express');
const router = express.Router();
const db = require('../database');
const { authenticate, authorize, authorizeOrg } = require('../middleware/auth');
const { logAuditEvent } = require('../utils/audit');

// All routes require authentication
router.use(authenticate);

// GET /api/organizations - List all organizations
router.get('/', authorize('super_admin'), (req, res) => {
  try {
    const orgs = db.prepare(`
      SELECT o.*,
        (SELECT COUNT(*) FROM user_organizations uo WHERE uo.org_id = o.id AND uo.role_in_org = 'teacher') as teacher_count,
        (SELECT COUNT(*) FROM user_organizations uo WHERE uo.org_id = o.id AND uo.role_in_org = 'student') as student_count,
        (SELECT COUNT(*) FROM user_organizations uo WHERE uo.org_id = o.id) as total_members
      FROM organizations o
      ORDER BY o.created_at DESC
    `).all();
    res.json(orgs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

// POST /api/organizations - Create new organization
router.post('/', authorize('super_admin'), (req, res) => {
  try {
    const { name, slug, contact_email, contact_phone, address, max_teachers, max_students } = req.body;

    if (!name || !slug) {
      return res.status(400).json({ error: 'Name and slug are required' });
    }

    // Validate slug format (lowercase alphanumeric + hyphens)
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({ error: 'Slug must contain only lowercase letters, numbers, and hyphens' });
    }

    // Check slug uniqueness
    const existing = db.prepare('SELECT id FROM organizations WHERE slug = ?').get(slug);
    if (existing) {
      return res.status(409).json({ error: 'An organization with this slug already exists' });
    }

    const result = db.prepare(`
      INSERT INTO organizations (name, slug, contact_email, contact_phone, address, max_teachers, max_students)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name, slug, contact_email || null, contact_phone || null, address || null, max_teachers || 100, max_students || 2000);

    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(result.lastInsertRowid);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'org_create',
      actionDescription: `Created organization: ${name}`,
      targetType: 'organization',
      targetId: org.id,
      metadata: JSON.stringify({ name, slug }),
      ipAddress: req.ip
    });

    res.status(201).json(org);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create organization' });
  }
});

// GET /api/organizations/:id - Get organization details
router.get('/:id', authorize('super_admin', 'org_admin'), (req, res) => {
  try {
    const orgId = parseInt(req.params.id);

    // org_admin can only view their own org
    if (req.user.role === 'org_admin' && req.user.org_id !== orgId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const org = db.prepare(`
      SELECT o.*,
        (SELECT COUNT(*) FROM user_organizations uo WHERE uo.org_id = o.id AND uo.role_in_org = 'teacher') as teacher_count,
        (SELECT COUNT(*) FROM user_organizations uo WHERE uo.org_id = o.id AND uo.role_in_org = 'student') as student_count,
        (SELECT COUNT(*) FROM user_organizations uo WHERE uo.org_id = o.id) as total_members
      FROM organizations o WHERE o.id = ?
    `).get(orgId);

    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    res.json(org);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch organization' });
  }
});

// PUT /api/organizations/:id - Update organization
router.put('/:id', authorize('super_admin', 'org_admin'), (req, res) => {
  try {
    const orgId = parseInt(req.params.id);

    if (req.user.role === 'org_admin' && req.user.org_id !== orgId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId);
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const { name, slug, contact_email, contact_phone, address, subscription_status, max_teachers, max_students } = req.body;

    // Only super_admin can change subscription_status
    if (subscription_status && req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only platform administrators can change subscription status' });
    }

    if (slug && slug !== org.slug) {
      if (!/^[a-z0-9-]+$/.test(slug)) {
        return res.status(400).json({ error: 'Slug must contain only lowercase letters, numbers, and hyphens' });
      }
      const existing = db.prepare('SELECT id FROM organizations WHERE slug = ? AND id != ?').get(slug, orgId);
      if (existing) {
        return res.status(409).json({ error: 'An organization with this slug already exists' });
      }
    }

    db.prepare(`
      UPDATE organizations SET
        name = COALESCE(?, name),
        slug = COALESCE(?, slug),
        contact_email = COALESCE(?, contact_email),
        contact_phone = COALESCE(?, contact_phone),
        address = COALESCE(?, address),
        subscription_status = COALESCE(?, subscription_status),
        max_teachers = COALESCE(?, max_teachers),
        max_students = COALESCE(?, max_students)
      WHERE id = ?
    `).run(name || null, slug || null, contact_email || null, contact_phone || null, address || null, subscription_status || null, max_teachers || null, max_students || null, orgId);

    const updated = db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'org_update',
      actionDescription: `Updated organization: ${updated.name}`,
      targetType: 'organization',
      targetId: orgId,
      ipAddress: req.ip
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update organization' });
  }
});

// DELETE /api/organizations/:id - Delete organization (super_admin only)
router.delete('/:id', authorize('super_admin'), (req, res) => {
  try {
    const orgId = parseInt(req.params.id);

    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId);
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Safety check: don't allow deleting orgs with active members
    const memberCount = db.prepare('SELECT COUNT(*) as count FROM user_organizations WHERE org_id = ?').get(orgId);
    if (memberCount.count > 0) {
      return res.status(400).json({ error: `Cannot delete organization with ${memberCount.count} active members. Remove all members first.` });
    }

    db.prepare('DELETE FROM organizations WHERE id = ?').run(orgId);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'org_delete',
      actionDescription: `Deleted organization: ${org.name}`,
      targetType: 'organization',
      targetId: orgId,
      ipAddress: req.ip
    });

    res.json({ message: 'Organization deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete organization' });
  }
});

// GET /api/organizations/:id/members - List org members
router.get('/:id/members', authorize('super_admin', 'org_admin'), (req, res) => {
  try {
    const orgId = parseInt(req.params.id);

    if (req.user.role === 'org_admin' && req.user.org_id !== orgId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { role } = req.query;

    let query = `
      SELECT u.id, u.full_name, u.email, u.role, u.grade_or_position, u.suspended, u.avatar_url,
             uo.role_in_org, uo.is_primary, uo.joined_at
      FROM user_organizations uo
      JOIN users u ON u.id = uo.user_id
      WHERE uo.org_id = ?
    `;
    const params = [orgId];

    if (role) {
      query += ' AND uo.role_in_org = ?';
      params.push(role);
    }

    query += ' ORDER BY uo.role_in_org, u.full_name';

    const members = db.prepare(query).all(...params);
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// POST /api/organizations/:id/members - Add user to organization
router.post('/:id/members', authorize('super_admin', 'org_admin'), (req, res) => {
  try {
    const orgId = parseInt(req.params.id);

    if (req.user.role === 'org_admin' && req.user.org_id !== orgId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { user_id, role_in_org } = req.body;

    if (!user_id || !role_in_org) {
      return res.status(400).json({ error: 'user_id and role_in_org are required' });
    }

    if (!['org_admin', 'school_head', 'teacher', 'student'].includes(role_in_org)) {
      return res.status(400).json({ error: 'Invalid role_in_org' });
    }

    // org_admin cannot add other org_admins
    if (req.user.role === 'org_admin' && role_in_org === 'org_admin') {
      return res.status(403).json({ error: 'Only platform administrators can assign organization admin role' });
    }

    const user = db.prepare('SELECT id, full_name FROM users WHERE id = ?').get(user_id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if already a member
    const existing = db.prepare('SELECT id FROM user_organizations WHERE user_id = ? AND org_id = ?').get(user_id, orgId);
    if (existing) {
      return res.status(409).json({ error: 'User is already a member of this organization' });
    }

    db.prepare('INSERT INTO user_organizations (user_id, org_id, role_in_org) VALUES (?, ?, ?)').run(user_id, orgId, role_in_org);

    // Update user's org_id if they don't have one (non-students) or if this is their primary
    if (role_in_org !== 'student') {
      db.prepare('UPDATE users SET org_id = ? WHERE id = ? AND org_id IS NULL').run(orgId, user_id);
    }

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'org_member_add',
      actionDescription: `Added ${user.full_name} to organization as ${role_in_org}`,
      targetType: 'user',
      targetId: user_id,
      metadata: JSON.stringify({ org_id: orgId, role_in_org }),
      ipAddress: req.ip,
      orgId: orgId
    });

    res.status(201).json({ message: 'User added to organization' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// DELETE /api/organizations/:id/members/:userId - Remove user from organization
router.delete('/:id/members/:userId', authorize('super_admin', 'org_admin'), (req, res) => {
  try {
    const orgId = parseInt(req.params.id);
    const userId = parseInt(req.params.userId);

    if (req.user.role === 'org_admin' && req.user.org_id !== orgId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const membership = db.prepare('SELECT * FROM user_organizations WHERE user_id = ? AND org_id = ?').get(userId, orgId);
    if (!membership) {
      return res.status(404).json({ error: 'User is not a member of this organization' });
    }

    // org_admin cannot remove other org_admins
    if (req.user.role === 'org_admin' && membership.role_in_org === 'org_admin') {
      return res.status(403).json({ error: 'Only platform administrators can remove organization admins' });
    }

    db.prepare('DELETE FROM user_organizations WHERE user_id = ? AND org_id = ?').run(userId, orgId);

    // Clear user's org_id if this was their primary org
    const user = db.prepare('SELECT org_id FROM users WHERE id = ?').get(userId);
    if (user && user.org_id === orgId) {
      db.prepare('UPDATE users SET org_id = NULL WHERE id = ?').run(userId);
    }

    const removedUser = db.prepare('SELECT full_name FROM users WHERE id = ?').get(userId);

    logAuditEvent({
      userId: req.user.id,
      userRole: req.user.role,
      userName: req.user.full_name,
      actionType: 'org_member_remove',
      actionDescription: `Removed ${removedUser?.full_name || 'user'} from organization`,
      targetType: 'user',
      targetId: userId,
      metadata: JSON.stringify({ org_id: orgId }),
      ipAddress: req.ip,
      orgId: orgId
    });

    res.json({ message: 'User removed from organization' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

module.exports = router;
