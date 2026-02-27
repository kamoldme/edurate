const express = require('express');
const db = require('../database');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET /api/departments — list departments for current org (or ?org_id for super_admin)
router.get('/', authenticate, (req, res) => {
  try {
    let orgId;
    if (req.user.role === 'super_admin') {
      orgId = req.query.org_id ? parseInt(req.query.org_id) : null;
    } else {
      orgId = req.user.org_id;
    }

    if (!orgId) return res.json([]);

    const departments = db.prepare(`
      SELECT d.id, d.name, d.org_id, d.created_at,
        (SELECT COUNT(*) FROM teachers t WHERE t.org_id = d.org_id AND t.department = d.name) as teacher_count
      FROM departments d
      WHERE d.org_id = ?
      ORDER BY d.name
    `).all(orgId);

    res.json(departments);
  } catch (err) {
    console.error('List departments error:', err);
    res.status(500).json({ error: 'Failed to fetch departments' });
  }
});

// POST /api/departments — create department
router.post('/', authenticate, authorize('super_admin', 'org_admin', 'school_head'), (req, res) => {
  try {
    const { name, org_id } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Department name is required' });

    let orgId;
    if (req.user.role === 'super_admin') {
      orgId = org_id ? parseInt(org_id) : null;
      if (!orgId) return res.status(400).json({ error: 'org_id is required for super_admin' });
    } else {
      orgId = req.user.org_id;
    }

    if (!orgId) return res.status(400).json({ error: 'No organization found' });

    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 80) {
      return res.status(400).json({ error: 'Department name must be 2–80 characters' });
    }

    try {
      const result = db.prepare('INSERT INTO departments (org_id, name) VALUES (?, ?)').run(orgId, trimmed);
      const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(result.lastInsertRowid);
      res.status(201).json({ ...dept, teacher_count: 0 });
    } catch (e) {
      if (e.message.includes('UNIQUE')) {
        return res.status(409).json({ error: `Department "${trimmed}" already exists` });
      }
      throw e;
    }
  } catch (err) {
    console.error('Create department error:', err);
    res.status(500).json({ error: 'Failed to create department' });
  }
});

// PATCH /api/departments/:id — rename department
router.patch('/:id', authenticate, authorize('super_admin', 'org_admin', 'school_head'), (req, res) => {
  try {
    const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
    if (!dept) return res.status(404).json({ error: 'Department not found' });

    if (req.user.role !== 'super_admin' && dept.org_id !== req.user.org_id) {
      return res.status(403).json({ error: 'Department does not belong to your organization' });
    }

    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Department name is required' });
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 80) {
      return res.status(400).json({ error: 'Department name must be 2–80 characters' });
    }

    if (trimmed === dept.name) {
      const tc = db.prepare("SELECT COUNT(*) as count FROM teachers WHERE org_id = ? AND department = ?").get(dept.org_id, dept.name).count;
      return res.json({ ...dept, teacher_count: tc });
    }

    const existing = db.prepare('SELECT id FROM departments WHERE org_id = ? AND name = ? AND id != ?').get(dept.org_id, trimmed, dept.id);
    if (existing) return res.status(409).json({ error: `Department "${trimmed}" already exists` });

    db.transaction(() => {
      db.prepare('UPDATE departments SET name = ? WHERE id = ?').run(trimmed, dept.id);
      db.prepare('UPDATE teachers SET department = ? WHERE org_id = ? AND department = ?').run(trimmed, dept.org_id, dept.name);
    })();

    const updated = db.prepare('SELECT * FROM departments WHERE id = ?').get(dept.id);
    const teacherCount = db.prepare("SELECT COUNT(*) as count FROM teachers WHERE org_id = ? AND department = ?").get(dept.org_id, trimmed).count;
    res.json({ ...updated, teacher_count: teacherCount });
  } catch (err) {
    console.error('Rename department error:', err);
    res.status(500).json({ error: 'Failed to rename department' });
  }
});

// DELETE /api/departments/:id — delete department (blocked if teachers assigned)
router.delete('/:id', authenticate, authorize('super_admin', 'org_admin', 'school_head'), (req, res) => {
  try {
    const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
    if (!dept) return res.status(404).json({ error: 'Department not found' });

    if (req.user.role !== 'super_admin' && dept.org_id !== req.user.org_id) {
      return res.status(403).json({ error: 'Department does not belong to your organization' });
    }

    const teacherCount = db.prepare(
      "SELECT COUNT(*) as count FROM teachers WHERE org_id = ? AND department = ?"
    ).get(dept.org_id, dept.name).count;

    if (teacherCount > 0) {
      return res.status(409).json({
        error: `Cannot delete — ${teacherCount} teacher${teacherCount !== 1 ? 's are' : ' is'} assigned to this department`
      });
    }

    db.prepare('DELETE FROM departments WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete department error:', err);
    res.status(500).json({ error: 'Failed to delete department' });
  }
});

module.exports = router;
