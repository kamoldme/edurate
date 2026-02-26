const express = require('express');
const db = require('../database');
const { authenticate, authorize } = require('../middleware/auth');
const { logAuditEvent } = require('../utils/audit');
const { createNotifications } = require('../utils/notifications');

const router = express.Router();

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getTeacher(userId) {
  return db.prepare('SELECT id, org_id FROM teachers WHERE user_id = ?').get(userId);
}

// Returns true if the current user can manage (edit/delete/view results) a form
function canManageForm(form, req) {
  const { role, id: userId, org_id } = req.user;
  if (role === 'super_admin') return true;
  if (role === 'org_admin') return form.org_id === org_id;
  if (role === 'teacher') {
    const teacher = getTeacher(userId);
    return !!(teacher && form.teacher_id === teacher.id);
  }
  return false;
}

// ─── STUDENT ROUTES ───────────────────────────────────────────────────────────

// GET /api/forms/student/available — active forms for classrooms the student is enrolled in
router.get('/student/available', authenticate, authorize('student'), (req, res) => {
  try {
    const forms = db.prepare(`
      SELECT DISTINCT
        f.id, f.title, f.description, f.status, f.created_at,
        (SELECT c2.subject FROM form_classrooms fc2 JOIN classrooms c2 ON fc2.classroom_id = c2.id WHERE fc2.form_id = f.id LIMIT 1) as classroom_subject,
        (SELECT c2.grade_level FROM form_classrooms fc2 JOIN classrooms c2 ON fc2.classroom_id = c2.id WHERE fc2.form_id = f.id LIMIT 1) as grade_level,
        CASE WHEN f.teacher_id IS NOT NULL THEN te.full_name ELSE 'Admin' END as teacher_name,
        (SELECT COUNT(*) FROM form_questions WHERE form_id = f.id) as question_count,
        CASE WHEN fr.id IS NOT NULL THEN 1 ELSE 0 END as already_submitted
      FROM forms f
      JOIN form_classrooms fc ON fc.form_id = f.id
      LEFT JOIN teachers te ON f.teacher_id = te.id
      JOIN classroom_members cm ON cm.classroom_id = fc.classroom_id AND cm.student_id = ?
      LEFT JOIN form_responses fr ON fr.form_id = f.id AND fr.student_id = ?
      WHERE f.status = 'active'
      ORDER BY f.created_at DESC
    `).all(req.user.id, req.user.id);

    res.json(forms);
  } catch (err) {
    console.error('Available forms error:', err);
    res.status(500).json({ error: 'Failed to fetch forms' });
  }
});

// POST /api/forms/:id/submit — student submits a response
router.post('/:id/submit', authenticate, authorize('student'), (req, res) => {
  try {
    const { answers } = req.body;
    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({ error: 'Answers array is required' });
    }

    const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id);
    if (!form) return res.status(404).json({ error: 'Form not found' });
    if (form.status !== 'active') return res.status(400).json({ error: 'This form is not currently accepting responses' });

    // Verify student is in any of the form's classrooms
    const membership = db.prepare(`
      SELECT 1 FROM form_classrooms fc
      JOIN classroom_members cm ON cm.classroom_id = fc.classroom_id
      WHERE fc.form_id = ? AND cm.student_id = ?
    `).get(form.id, req.user.id);
    if (!membership) return res.status(403).json({ error: 'You are not enrolled in this classroom' });

    const questions = db.prepare('SELECT * FROM form_questions WHERE form_id = ? ORDER BY order_index').all(form.id);
    const requiredIds = questions.filter(q => q.required).map(q => q.id);
    const answeredIds = answers.map(a => parseInt(a.question_id));
    const missingRequired = requiredIds.filter(id => !answeredIds.includes(id));
    if (missingRequired.length > 0) {
      return res.status(400).json({ error: 'Please answer all required questions' });
    }

    const submitFn = db.transaction(() => {
      const dup = db.prepare('SELECT id FROM form_responses WHERE form_id = ? AND student_id = ?').get(form.id, req.user.id);
      if (dup) return null;
      const resp = db.prepare('INSERT INTO form_responses (form_id, student_id) VALUES (?, ?)').run(form.id, req.user.id);
      const responseId = resp.lastInsertRowid;
      const insertAnswer = db.prepare('INSERT INTO form_answers (response_id, question_id, answer_text) VALUES (?, ?, ?)');
      for (const ans of answers) {
        const qId = parseInt(ans.question_id);
        if (questions.find(q => q.id === qId)) {
          insertAnswer.run(responseId, qId, String(ans.answer_text || '').trim());
        }
      }
      return responseId;
    });

    const result = submitFn();
    if (!result) return res.status(409).json({ error: 'You have already submitted a response to this form' });

    res.status(201).json({ message: 'Response submitted successfully. Thank you!' });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'You have already submitted a response to this form' });
    }
    console.error('Submit form response error:', err);
    res.status(500).json({ error: 'Failed to submit response' });
  }
});

// ─── ADMIN: CLASSROOMS LIST FOR FORM CREATION ─────────────────────────────────

// GET /api/forms/admin/classrooms — classrooms available for admin to pick
router.get('/admin/classrooms', authenticate, authorize('super_admin', 'org_admin'), (req, res) => {
  try {
    if (req.user.role === 'org_admin') {
      const classrooms = db.prepare(`
        SELECT c.id, c.subject, c.grade_level, te.full_name as teacher_name
        FROM classrooms c
        LEFT JOIN teachers te ON c.teacher_id = te.id
        WHERE c.org_id = ?
        ORDER BY c.grade_level, c.subject
      `).all(req.user.org_id);
      return res.json(classrooms);
    }

    // super_admin — optionally filter by org
    const orgId = req.query.org_id ? parseInt(req.query.org_id) : null;
    if (orgId) {
      const classrooms = db.prepare(`
        SELECT c.id, c.subject, c.grade_level, te.full_name as teacher_name
        FROM classrooms c
        LEFT JOIN teachers te ON c.teacher_id = te.id
        WHERE c.org_id = ?
        ORDER BY c.grade_level, c.subject
      `).all(orgId);
      return res.json(classrooms);
    }

    // All orgs — group with org info
    const classrooms = db.prepare(`
      SELECT c.id, c.subject, c.grade_level, te.full_name as teacher_name, o.name as org_name, o.id as org_id
      FROM classrooms c
      LEFT JOIN teachers te ON c.teacher_id = te.id
      JOIN organizations o ON c.org_id = o.id
      ORDER BY o.name, c.grade_level, c.subject
    `).all();
    res.json(classrooms);
  } catch (err) {
    console.error('Admin classrooms error:', err);
    res.status(500).json({ error: 'Failed to fetch classrooms' });
  }
});

// ─── TEACHER / ADMIN ROUTES ───────────────────────────────────────────────────

// GET /api/forms — list forms
router.get('/', authenticate, authorize('teacher', 'super_admin', 'org_admin'), (req, res) => {
  try {
    const classroomLabel = `(
      SELECT GROUP_CONCAT(c2.subject || ' ' || c2.grade_level, ', ')
      FROM form_classrooms fc2 JOIN classrooms c2 ON fc2.classroom_id = c2.id
      WHERE fc2.form_id = f.id
    ) as classroom_label`;

    let forms;
    if (req.user.role === 'teacher') {
      const teacher = getTeacher(req.user.id);
      if (!teacher) return res.json([]);
      forms = db.prepare(`
        SELECT f.*, ${classroomLabel},
          (SELECT COUNT(*) FROM form_questions WHERE form_id = f.id) as question_count,
          (SELECT COUNT(*) FROM form_responses WHERE form_id = f.id) as response_count
        FROM forms f
        WHERE f.teacher_id = ?
        ORDER BY f.created_at DESC
      `).all(teacher.id);
    } else if (req.user.role === 'org_admin') {
      forms = db.prepare(`
        SELECT f.*, ${classroomLabel},
          CASE WHEN f.teacher_id IS NOT NULL THEN te.full_name ELSE 'Admin' END as creator_name,
          (SELECT COUNT(*) FROM form_questions WHERE form_id = f.id) as question_count,
          (SELECT COUNT(*) FROM form_responses WHERE form_id = f.id) as response_count
        FROM forms f
        LEFT JOIN teachers te ON f.teacher_id = te.id
        WHERE f.org_id = ?
        ORDER BY f.created_at DESC
      `).all(req.user.org_id);
    } else {
      // super_admin — optional org filter
      const orgId = req.query.org_id ? parseInt(req.query.org_id) : null;
      const where = orgId ? 'WHERE f.org_id = ?' : '';
      const params = orgId ? [orgId] : [];
      forms = db.prepare(`
        SELECT f.*, ${classroomLabel},
          CASE WHEN f.teacher_id IS NOT NULL THEN te.full_name ELSE 'Admin' END as creator_name,
          o.name as org_name,
          (SELECT COUNT(*) FROM form_questions WHERE form_id = f.id) as question_count,
          (SELECT COUNT(*) FROM form_responses WHERE form_id = f.id) as response_count
        FROM forms f
        LEFT JOIN teachers te ON f.teacher_id = te.id
        LEFT JOIN organizations o ON f.org_id = o.id
        ${where}
        ORDER BY f.created_at DESC
      `).all(...params);
    }
    res.json(forms);
  } catch (err) {
    console.error('List forms error:', err);
    res.status(500).json({ error: 'Failed to fetch forms' });
  }
});

// POST /api/forms — create a form
router.post('/', authenticate, authorize('teacher', 'super_admin', 'org_admin'), (req, res) => {
  try {
    const { title, description, classroom_id, classroom_ids, org_id } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

    if (req.user.role === 'teacher') {
      // Single classroom, teacher-owned
      if (!classroom_id) return res.status(400).json({ error: 'Classroom is required' });
      const teacher = getTeacher(req.user.id);
      if (!teacher) return res.status(400).json({ error: 'Teacher profile not found' });
      const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ? AND teacher_id = ?').get(Number(classroom_id), teacher.id);
      if (!classroom) return res.status(403).json({ error: 'Classroom not found or not yours' });

      const result = db.prepare(
        'INSERT INTO forms (teacher_id, classroom_id, creator_user_id, creator_role, org_id, title, description) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(teacher.id, Number(classroom_id), req.user.id, 'teacher', teacher.org_id, title.trim(), description?.trim() || null);

      db.prepare('INSERT OR IGNORE INTO form_classrooms (form_id, classroom_id) VALUES (?, ?)').run(result.lastInsertRowid, Number(classroom_id));

      logAuditEvent({
        userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
        actionType: 'form_create', actionDescription: `Created form: "${title.trim()}"`,
        targetType: 'form', targetId: result.lastInsertRowid,
        metadata: { classroom_id }, ipAddress: req.ip
      });
      return res.status(201).json(db.prepare('SELECT * FROM forms WHERE id = ?').get(result.lastInsertRowid));
    }

    // Admin (org_admin or super_admin) — multi-classroom
    const targetOrgId = req.user.role === 'super_admin' ? (org_id ? parseInt(org_id) : null) : req.user.org_id;
    if (!targetOrgId) return res.status(400).json({ error: 'Organization is required' });

    // Resolve classroom IDs
    let clIds = [];
    if (classroom_ids === 'all') {
      clIds = db.prepare('SELECT id FROM classrooms WHERE org_id = ?').all(targetOrgId).map(c => c.id);
    } else if (Array.isArray(classroom_ids) && classroom_ids.length > 0) {
      const ids = classroom_ids.map(Number).filter(Boolean);
      const placeholders = ids.map(() => '?').join(',');
      const valid = db.prepare(`SELECT id FROM classrooms WHERE id IN (${placeholders}) AND org_id = ?`).all(...ids, targetOrgId);
      clIds = valid.map(c => c.id);
    }
    if (clIds.length === 0) return res.status(400).json({ error: 'At least one valid classroom is required' });

    const formId = db.transaction(() => {
      const result = db.prepare(
        'INSERT INTO forms (teacher_id, classroom_id, creator_user_id, creator_role, org_id, title, description) VALUES (NULL, NULL, ?, ?, ?, ?, ?)'
      ).run(req.user.id, req.user.role, targetOrgId, title.trim(), description?.trim() || null);
      const fid = result.lastInsertRowid;
      const ins = db.prepare('INSERT OR IGNORE INTO form_classrooms (form_id, classroom_id) VALUES (?, ?)');
      for (const cid of clIds) ins.run(fid, cid);
      return fid;
    })();

    logAuditEvent({
      userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
      actionType: 'form_create', actionDescription: `Created admin form: "${title.trim()}" for ${clIds.length} classroom(s)`,
      targetType: 'form', targetId: formId, ipAddress: req.ip
    });
    res.status(201).json(db.prepare('SELECT * FROM forms WHERE id = ?').get(formId));
  } catch (err) {
    console.error('Create form error:', err);
    res.status(500).json({ error: 'Failed to create form' });
  }
});

// GET /api/forms/:id — form detail with questions
router.get('/:id', authenticate, (req, res) => {
  try {
    const form = db.prepare(`
      SELECT f.*,
        CASE WHEN f.teacher_id IS NOT NULL THEN te.full_name ELSE 'Admin' END as teacher_name,
        o.name as org_name
      FROM forms f
      LEFT JOIN teachers te ON f.teacher_id = te.id
      LEFT JOIN organizations o ON f.org_id = o.id
      WHERE f.id = ?
    `).get(req.params.id);
    if (!form) return res.status(404).json({ error: 'Form not found' });

    if (req.user.role === 'student') {
      const membership = db.prepare(`
        SELECT 1 FROM form_classrooms fc
        JOIN classroom_members cm ON cm.classroom_id = fc.classroom_id
        WHERE fc.form_id = ? AND cm.student_id = ?
      `).get(form.id, req.user.id);
      if (!membership) return res.status(403).json({ error: 'Access denied' });
    } else if (req.user.role === 'teacher') {
      const teacher = getTeacher(req.user.id);
      if (!teacher || form.teacher_id !== teacher.id) return res.status(403).json({ error: 'Access denied' });
    } else if (req.user.role === 'org_admin') {
      if (form.org_id !== req.user.org_id) return res.status(403).json({ error: 'Access denied' });
    }
    // super_admin: always allowed

    const questions = db.prepare('SELECT * FROM form_questions WHERE form_id = ? ORDER BY order_index, id').all(form.id);
    const parsedQuestions = questions.map(q => ({ ...q, options: q.options ? JSON.parse(q.options) : [] }));

    const classrooms = db.prepare(`
      SELECT c.id, c.subject, c.grade_level FROM form_classrooms fc
      JOIN classrooms c ON fc.classroom_id = c.id WHERE fc.form_id = ?
    `).all(form.id);

    res.json({
      ...form,
      questions: parsedQuestions,
      classrooms,
      classroom_subject: classrooms[0]?.subject || '',
      grade_level: classrooms[0]?.grade_level || ''
    });
  } catch (err) {
    console.error('Get form error:', err);
    res.status(500).json({ error: 'Failed to fetch form' });
  }
});

// PATCH /api/forms/:id — update title/description/status
router.patch('/:id', authenticate, authorize('teacher', 'super_admin', 'org_admin'), (req, res) => {
  try {
    const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id);
    if (!form) return res.status(404).json({ error: 'Form not found' });
    if (!canManageForm(form, req)) return res.status(403).json({ error: 'Access denied' });

    const VALID_STATUSES = ['draft', 'active', 'closed'];
    const title = req.body.title?.trim() || form.title;
    const description = req.body.description !== undefined ? (req.body.description?.trim() || null) : form.description;
    const status = req.body.status && VALID_STATUSES.includes(req.body.status) ? req.body.status : form.status;
    const deadline = req.body.deadline !== undefined ? (req.body.deadline || null) : form.deadline;

    db.prepare('UPDATE forms SET title = ?, description = ?, status = ?, deadline = ? WHERE id = ?').run(title, description, status, deadline, form.id);

    // Notify enrolled students when a form is activated
    if (status === 'active' && form.status !== 'active') {
      const classrooms = db.prepare('SELECT classroom_id FROM form_classrooms WHERE form_id = ?').all(form.id);
      if (classrooms.length > 0) {
        const cids = classrooms.map(c => c.classroom_id);
        const members = db.prepare(
          `SELECT DISTINCT student_id AS user_id FROM classroom_members WHERE classroom_id IN (${cids.map(() => '?').join(',')})`
        ).all(...cids);
        const userIds = members.map(m => m.user_id);
        createNotifications({
          userIds,
          orgId: form.org_id,
          type: 'form_active',
          title: `New form available: "${form.title}"`,
          body: form.description ? form.description.slice(0, 80) : 'A new form is ready for you to fill out.',
          link: 'student-forms'
        });
      }
    }

    res.json(db.prepare('SELECT * FROM forms WHERE id = ?').get(form.id));
  } catch (err) {
    console.error('Update form error:', err);
    res.status(500).json({ error: 'Failed to update form' });
  }
});

// DELETE /api/forms/:id
router.delete('/:id', authenticate, authorize('teacher', 'super_admin', 'org_admin'), (req, res) => {
  try {
    const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id);
    if (!form) return res.status(404).json({ error: 'Form not found' });
    if (!canManageForm(form, req)) return res.status(403).json({ error: 'Access denied' });

    db.prepare('DELETE FROM forms WHERE id = ?').run(form.id);
    logAuditEvent({
      userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
      actionType: 'form_delete', actionDescription: `Deleted form: "${form.title}"`,
      targetType: 'form', targetId: form.id, ipAddress: req.ip
    });
    res.json({ message: 'Form deleted' });
  } catch (err) {
    console.error('Delete form error:', err);
    res.status(500).json({ error: 'Failed to delete form' });
  }
});

// POST /api/forms/:id/questions
router.post('/:id/questions', authenticate, authorize('teacher', 'super_admin', 'org_admin'), (req, res) => {
  try {
    const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id);
    if (!form) return res.status(404).json({ error: 'Form not found' });
    if (!canManageForm(form, req)) return res.status(403).json({ error: 'Access denied' });
    if (form.status !== 'draft') return res.status(400).json({ error: 'Can only add questions to draft forms' });

    const { question_text, question_type, options, required, order_index } = req.body;
    if (!question_text?.trim()) return res.status(400).json({ error: 'Question text is required' });

    const VALID_TYPES = ['text', 'multiple_choice', 'yes_no'];
    if (!VALID_TYPES.includes(question_type)) return res.status(400).json({ error: 'Invalid question type' });

    let validatedOptions = null;
    if (question_type === 'multiple_choice') {
      if (!Array.isArray(options) || options.length < 2) return res.status(400).json({ error: 'Multiple choice requires at least 2 options' });
      validatedOptions = JSON.stringify(options.map(o => String(o).trim()).filter(Boolean));
    }

    const maxOrder = db.prepare('SELECT MAX(order_index) as m FROM form_questions WHERE form_id = ?').get(req.params.id);
    const nextOrder = order_index !== undefined ? parseInt(order_index) : (maxOrder.m ?? -1) + 1;

    const result = db.prepare(
      'INSERT INTO form_questions (form_id, question_text, question_type, options, required, order_index) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.params.id, question_text.trim(), question_type, validatedOptions, required ? 1 : 0, nextOrder);

    const question = db.prepare('SELECT * FROM form_questions WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ ...question, options: question.options ? JSON.parse(question.options) : [] });
  } catch (err) {
    console.error('Add question error:', err);
    res.status(500).json({ error: 'Failed to add question' });
  }
});

// PUT /api/forms/:id/questions/:qId
router.put('/:id/questions/:qId', authenticate, authorize('teacher', 'super_admin', 'org_admin'), (req, res) => {
  try {
    const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id);
    if (!form) return res.status(404).json({ error: 'Form not found' });
    if (!canManageForm(form, req)) return res.status(403).json({ error: 'Access denied' });
    if (form.status !== 'draft') return res.status(400).json({ error: 'Can only edit questions on draft forms' });

    const question = db.prepare('SELECT * FROM form_questions WHERE id = ? AND form_id = ?').get(req.params.qId, req.params.id);
    if (!question) return res.status(404).json({ error: 'Question not found' });

    const { question_text, question_type, options, required, order_index } = req.body;
    const newText = question_text?.trim() || question.question_text;
    const newType = question_type || question.question_type;
    const newRequired = required !== undefined ? (required ? 1 : 0) : question.required;
    const newOrder = order_index !== undefined ? parseInt(order_index) : question.order_index;

    let newOptions = question.options;
    if (newType === 'multiple_choice' && options !== undefined) {
      if (!Array.isArray(options) || options.length < 2) return res.status(400).json({ error: 'Multiple choice requires at least 2 options' });
      newOptions = JSON.stringify(options.map(o => String(o).trim()).filter(Boolean));
    } else if (newType !== 'multiple_choice') {
      newOptions = null;
    }

    db.prepare('UPDATE form_questions SET question_text = ?, question_type = ?, options = ?, required = ?, order_index = ? WHERE id = ?')
      .run(newText, newType, newOptions, newRequired, newOrder, question.id);

    const updated = db.prepare('SELECT * FROM form_questions WHERE id = ?').get(question.id);
    res.json({ ...updated, options: updated.options ? JSON.parse(updated.options) : [] });
  } catch (err) {
    console.error('Edit question error:', err);
    res.status(500).json({ error: 'Failed to edit question' });
  }
});

// DELETE /api/forms/:id/questions/:qId
router.delete('/:id/questions/:qId', authenticate, authorize('teacher', 'super_admin', 'org_admin'), (req, res) => {
  try {
    const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id);
    if (!form) return res.status(404).json({ error: 'Form not found' });
    if (!canManageForm(form, req)) return res.status(403).json({ error: 'Access denied' });
    if (form.status !== 'draft') return res.status(400).json({ error: 'Can only delete questions on draft forms' });

    const result = db.prepare('DELETE FROM form_questions WHERE id = ? AND form_id = ?').run(req.params.qId, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Question not found' });
    res.json({ message: 'Question deleted' });
  } catch (err) {
    console.error('Delete question error:', err);
    res.status(500).json({ error: 'Failed to delete question' });
  }
});

// GET /api/forms/:id/results
router.get('/:id/results', authenticate, authorize('teacher', 'super_admin', 'org_admin'), (req, res) => {
  try {
    const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id);
    if (!form) return res.status(404).json({ error: 'Form not found' });
    if (!canManageForm(form, req)) return res.status(403).json({ error: 'Access denied' });

    const questions = db.prepare('SELECT * FROM form_questions WHERE form_id = ? ORDER BY order_index, id').all(form.id);
    const totalResponses = db.prepare('SELECT COUNT(*) as c FROM form_responses WHERE form_id = ?').get(form.id).c;

    const results = questions.map(q => {
      const answers = db.prepare(`
        SELECT fa.answer_text FROM form_answers fa
        JOIN form_responses fr ON fa.response_id = fr.id
        WHERE fa.question_id = ? AND fr.form_id = ?
      `).all(q.id, form.id).map(a => a.answer_text);

      if (q.question_type === 'text') {
        return { question_id: q.id, question_text: q.question_text, question_type: q.question_type, total_answers: answers.length, answers: answers.filter(a => a && a.trim()) };
      }
      if (q.question_type === 'yes_no') {
        const counts = { Yes: 0, No: 0 };
        answers.forEach(a => { if (a in counts) counts[a]++; });
        return { question_id: q.id, question_text: q.question_text, question_type: q.question_type, total_answers: answers.length, counts };
      }
      const options = q.options ? JSON.parse(q.options) : [];
      const counts = {};
      options.forEach(o => { counts[o] = 0; });
      answers.forEach(a => { if (a in counts) counts[a]++; });
      return { question_id: q.id, question_text: q.question_text, question_type: q.question_type, options, total_answers: answers.length, counts };
    });

    res.json({ form, total_responses: totalResponses, results });
  } catch (err) {
    console.error('Form results error:', err);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

module.exports = router;
