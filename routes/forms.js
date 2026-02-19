const express = require('express');
const db = require('../database');
const { authenticate, authorize } = require('../middleware/auth');
const { logAuditEvent } = require('../utils/audit');

const router = express.Router();

// Helper — resolve teacher record from user
function getTeacher(userId) {
  return db.prepare('SELECT id, org_id FROM teachers WHERE user_id = ?').get(userId);
}

// Helper — verify teacher owns a form
function teacherOwnsForm(formId, teacherId) {
  return db.prepare('SELECT id FROM forms WHERE id = ? AND teacher_id = ?').get(formId, teacherId);
}

// ─── STUDENT ROUTES ───────────────────────────────────────────────────────────

// GET /api/forms/student/available — active forms for classrooms the student is enrolled in
router.get('/student/available', authenticate, authorize('student'), (req, res) => {
  try {
    const forms = db.prepare(`
      SELECT
        f.id, f.title, f.description, f.status, f.created_at,
        c.subject as classroom_subject, c.grade_level,
        te.full_name as teacher_name,
        (SELECT COUNT(*) FROM form_questions WHERE form_id = f.id) as question_count,
        CASE WHEN fr.id IS NOT NULL THEN 1 ELSE 0 END as already_submitted
      FROM forms f
      JOIN classrooms c ON f.classroom_id = c.id
      JOIN teachers te ON f.teacher_id = te.id
      JOIN classroom_members cm ON cm.classroom_id = c.id AND cm.student_id = ?
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

    // Verify student is in the form's classroom
    const membership = db.prepare(
      'SELECT id FROM classroom_members WHERE classroom_id = ? AND student_id = ?'
    ).get(form.classroom_id, req.user.id);
    if (!membership) return res.status(403).json({ error: 'You are not enrolled in this classroom' });

    // Get required questions
    const questions = db.prepare('SELECT * FROM form_questions WHERE form_id = ? ORDER BY order_index').all(form.id);
    const requiredIds = questions.filter(q => q.required).map(q => q.id);
    const answeredIds = answers.map(a => parseInt(a.question_id));
    const missingRequired = requiredIds.filter(id => !answeredIds.includes(id));
    if (missingRequired.length > 0) {
      return res.status(400).json({ error: 'Please answer all required questions' });
    }

    const submitFn = db.transaction(() => {
      // Check duplicate inside transaction
      const dup = db.prepare('SELECT id FROM form_responses WHERE form_id = ? AND student_id = ?').get(form.id, req.user.id);
      if (dup) return null;

      const resp = db.prepare(
        'INSERT INTO form_responses (form_id, student_id) VALUES (?, ?)'
      ).run(form.id, req.user.id);

      const responseId = resp.lastInsertRowid;
      const insertAnswer = db.prepare(
        'INSERT INTO form_answers (response_id, question_id, answer_text) VALUES (?, ?, ?)'
      );
      for (const ans of answers) {
        const qId = parseInt(ans.question_id);
        // Only insert answers for questions that belong to this form
        if (questions.find(q => q.id === qId)) {
          insertAnswer.run(responseId, qId, String(ans.answer_text || '').trim());
        }
      }
      return responseId;
    });

    const result = submitFn();
    if (!result) {
      return res.status(409).json({ error: 'You have already submitted a response to this form' });
    }

    res.status(201).json({ message: 'Response submitted successfully. Thank you!' });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'You have already submitted a response to this form' });
    }
    console.error('Submit form response error:', err);
    res.status(500).json({ error: 'Failed to submit response' });
  }
});

// ─── TEACHER / ADMIN ROUTES ───────────────────────────────────────────────────

// GET /api/forms — list teacher's forms
router.get('/', authenticate, authorize('teacher', 'super_admin', 'org_admin'), (req, res) => {
  try {
    let forms;
    if (req.user.role === 'teacher') {
      const teacher = getTeacher(req.user.id);
      if (!teacher) return res.json([]);
      forms = db.prepare(`
        SELECT
          f.*,
          c.subject as classroom_subject, c.grade_level,
          (SELECT COUNT(*) FROM form_questions WHERE form_id = f.id) as question_count,
          (SELECT COUNT(*) FROM form_responses WHERE form_id = f.id) as response_count
        FROM forms f
        JOIN classrooms c ON f.classroom_id = c.id
        WHERE f.teacher_id = ?
        ORDER BY f.created_at DESC
      `).all(teacher.id);
    } else {
      // admin — list all
      forms = db.prepare(`
        SELECT
          f.*,
          c.subject as classroom_subject, c.grade_level,
          te.full_name as teacher_name,
          (SELECT COUNT(*) FROM form_questions WHERE form_id = f.id) as question_count,
          (SELECT COUNT(*) FROM form_responses WHERE form_id = f.id) as response_count
        FROM forms f
        JOIN classrooms c ON f.classroom_id = c.id
        JOIN teachers te ON f.teacher_id = te.id
        ORDER BY f.created_at DESC
      `).all();
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
    const { title, description, classroom_id } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
    if (!classroom_id) return res.status(400).json({ error: 'Classroom is required' });

    const teacher = getTeacher(req.user.id);
    if (!teacher) return res.status(400).json({ error: 'Teacher profile not found' });

    // Verify classroom belongs to this teacher
    const classroom = db.prepare('SELECT * FROM classrooms WHERE id = ? AND teacher_id = ?').get(classroom_id, teacher.id);
    if (!classroom) return res.status(403).json({ error: 'Classroom not found or not yours' });

    const result = db.prepare(
      'INSERT INTO forms (teacher_id, classroom_id, title, description) VALUES (?, ?, ?, ?)'
    ).run(teacher.id, classroom_id, title.trim(), description?.trim() || null);

    const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(result.lastInsertRowid);

    logAuditEvent({
      userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
      actionType: 'form_create',
      actionDescription: `Created form: "${title.trim()}"`,
      targetType: 'form', targetId: result.lastInsertRowid,
      metadata: { classroom_id },
      ipAddress: req.ip
    });

    res.status(201).json(form);
  } catch (err) {
    console.error('Create form error:', err);
    res.status(500).json({ error: 'Failed to create form' });
  }
});

// GET /api/forms/:id — form detail with questions
router.get('/:id', authenticate, (req, res) => {
  try {
    const form = db.prepare(`
      SELECT f.*, c.subject as classroom_subject, c.grade_level, te.full_name as teacher_name
      FROM forms f
      JOIN classrooms c ON f.classroom_id = c.id
      JOIN teachers te ON f.teacher_id = te.id
      WHERE f.id = ?
    `).get(req.params.id);
    if (!form) return res.status(404).json({ error: 'Form not found' });

    // Access control: teacher must own it, student must be in the classroom
    if (req.user.role === 'student') {
      const membership = db.prepare(
        'SELECT id FROM classroom_members WHERE classroom_id = ? AND student_id = ?'
      ).get(form.classroom_id, req.user.id);
      if (!membership) return res.status(403).json({ error: 'Access denied' });
    } else if (req.user.role === 'teacher') {
      const teacher = getTeacher(req.user.id);
      if (!teacher || form.teacher_id !== teacher.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const questions = db.prepare(
      'SELECT * FROM form_questions WHERE form_id = ? ORDER BY order_index, id'
    ).all(form.id);

    // Parse options JSON
    const parsedQuestions = questions.map(q => ({
      ...q,
      options: q.options ? JSON.parse(q.options) : []
    }));

    res.json({ ...form, questions: parsedQuestions });
  } catch (err) {
    console.error('Get form error:', err);
    res.status(500).json({ error: 'Failed to fetch form' });
  }
});

// PATCH /api/forms/:id — update form title/description/status
router.patch('/:id', authenticate, authorize('teacher', 'super_admin', 'org_admin'), (req, res) => {
  try {
    const teacher = getTeacher(req.user.id);
    if (!teacher) return res.status(400).json({ error: 'Teacher profile not found' });

    const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id);
    if (!form) return res.status(404).json({ error: 'Form not found' });
    if (!teacherOwnsForm(form.id, teacher.id)) return res.status(403).json({ error: 'Not your form' });

    const VALID_STATUSES = ['draft', 'active', 'closed'];
    const title = req.body.title?.trim() || form.title;
    const description = req.body.description !== undefined ? (req.body.description?.trim() || null) : form.description;
    const status = req.body.status && VALID_STATUSES.includes(req.body.status) ? req.body.status : form.status;

    db.prepare('UPDATE forms SET title = ?, description = ?, status = ? WHERE id = ?')
      .run(title, description, status, form.id);

    const updated = db.prepare('SELECT * FROM forms WHERE id = ?').get(form.id);
    res.json(updated);
  } catch (err) {
    console.error('Update form error:', err);
    res.status(500).json({ error: 'Failed to update form' });
  }
});

// DELETE /api/forms/:id — delete form (only draft)
router.delete('/:id', authenticate, authorize('teacher', 'super_admin', 'org_admin'), (req, res) => {
  try {
    const teacher = getTeacher(req.user.id);
    if (!teacher) return res.status(400).json({ error: 'Teacher profile not found' });

    const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id);
    if (!form) return res.status(404).json({ error: 'Form not found' });
    if (!teacherOwnsForm(form.id, teacher.id)) return res.status(403).json({ error: 'Not your form' });

    db.prepare('DELETE FROM forms WHERE id = ?').run(form.id);

    logAuditEvent({
      userId: req.user.id, userRole: req.user.role, userName: req.user.full_name,
      actionType: 'form_delete',
      actionDescription: `Deleted form: "${form.title}"`,
      targetType: 'form', targetId: form.id,
      ipAddress: req.ip
    });

    res.json({ message: 'Form deleted' });
  } catch (err) {
    console.error('Delete form error:', err);
    res.status(500).json({ error: 'Failed to delete form' });
  }
});

// POST /api/forms/:id/questions — add a question
router.post('/:id/questions', authenticate, authorize('teacher', 'super_admin', 'org_admin'), (req, res) => {
  try {
    const teacher = getTeacher(req.user.id);
    if (!teacher) return res.status(400).json({ error: 'Teacher profile not found' });
    if (!teacherOwnsForm(req.params.id, teacher.id)) return res.status(403).json({ error: 'Not your form' });

    const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id);
    if (form.status !== 'draft') return res.status(400).json({ error: 'Can only add questions to draft forms' });

    const { question_text, question_type, options, required, order_index } = req.body;
    if (!question_text?.trim()) return res.status(400).json({ error: 'Question text is required' });

    const VALID_TYPES = ['text', 'multiple_choice', 'yes_no'];
    if (!VALID_TYPES.includes(question_type)) {
      return res.status(400).json({ error: 'Invalid question type' });
    }

    let validatedOptions = null;
    if (question_type === 'multiple_choice') {
      if (!Array.isArray(options) || options.length < 2) {
        return res.status(400).json({ error: 'Multiple choice requires at least 2 options' });
      }
      validatedOptions = JSON.stringify(options.map(o => String(o).trim()).filter(Boolean));
    }

    // Get next order index if not provided
    const maxOrder = db.prepare('SELECT MAX(order_index) as m FROM form_questions WHERE form_id = ?').get(req.params.id);
    const nextOrder = order_index !== undefined ? parseInt(order_index) : (maxOrder.m ?? -1) + 1;

    const result = db.prepare(`
      INSERT INTO form_questions (form_id, question_text, question_type, options, required, order_index)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.params.id, question_text.trim(), question_type, validatedOptions, required ? 1 : 0, nextOrder);

    const question = db.prepare('SELECT * FROM form_questions WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ ...question, options: question.options ? JSON.parse(question.options) : [] });
  } catch (err) {
    console.error('Add question error:', err);
    res.status(500).json({ error: 'Failed to add question' });
  }
});

// PUT /api/forms/:id/questions/:qId — edit a question
router.put('/:id/questions/:qId', authenticate, authorize('teacher', 'super_admin', 'org_admin'), (req, res) => {
  try {
    const teacher = getTeacher(req.user.id);
    if (!teacher) return res.status(400).json({ error: 'Teacher profile not found' });
    if (!teacherOwnsForm(req.params.id, teacher.id)) return res.status(403).json({ error: 'Not your form' });

    const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id);
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
      if (!Array.isArray(options) || options.length < 2) {
        return res.status(400).json({ error: 'Multiple choice requires at least 2 options' });
      }
      newOptions = JSON.stringify(options.map(o => String(o).trim()).filter(Boolean));
    } else if (newType !== 'multiple_choice') {
      newOptions = null;
    }

    db.prepare(`
      UPDATE form_questions SET question_text = ?, question_type = ?, options = ?, required = ?, order_index = ?
      WHERE id = ?
    `).run(newText, newType, newOptions, newRequired, newOrder, question.id);

    const updated = db.prepare('SELECT * FROM form_questions WHERE id = ?').get(question.id);
    res.json({ ...updated, options: updated.options ? JSON.parse(updated.options) : [] });
  } catch (err) {
    console.error('Edit question error:', err);
    res.status(500).json({ error: 'Failed to edit question' });
  }
});

// DELETE /api/forms/:id/questions/:qId — delete a question
router.delete('/:id/questions/:qId', authenticate, authorize('teacher', 'super_admin', 'org_admin'), (req, res) => {
  try {
    const teacher = getTeacher(req.user.id);
    if (!teacher) return res.status(400).json({ error: 'Teacher profile not found' });
    if (!teacherOwnsForm(req.params.id, teacher.id)) return res.status(403).json({ error: 'Not your form' });

    const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id);
    if (form.status !== 'draft') return res.status(400).json({ error: 'Can only delete questions on draft forms' });

    const result = db.prepare('DELETE FROM form_questions WHERE id = ? AND form_id = ?').run(req.params.qId, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Question not found' });

    res.json({ message: 'Question deleted' });
  } catch (err) {
    console.error('Delete question error:', err);
    res.status(500).json({ error: 'Failed to delete question' });
  }
});

// GET /api/forms/:id/results — teacher views anonymous results
router.get('/:id/results', authenticate, authorize('teacher', 'super_admin', 'org_admin'), (req, res) => {
  try {
    const teacher = getTeacher(req.user.id);
    if (!teacher) return res.status(400).json({ error: 'Teacher profile not found' });
    if (!teacherOwnsForm(req.params.id, teacher.id)) return res.status(403).json({ error: 'Not your form' });

    const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(req.params.id);
    if (!form) return res.status(404).json({ error: 'Form not found' });

    const questions = db.prepare(
      'SELECT * FROM form_questions WHERE form_id = ? ORDER BY order_index, id'
    ).all(form.id);

    const totalResponses = db.prepare('SELECT COUNT(*) as c FROM form_responses WHERE form_id = ?').get(form.id).c;

    const results = questions.map(q => {
      const answers = db.prepare(`
        SELECT fa.answer_text FROM form_answers fa
        JOIN form_responses fr ON fa.response_id = fr.id
        WHERE fa.question_id = ? AND fr.form_id = ?
      `).all(q.id, form.id).map(a => a.answer_text);

      if (q.question_type === 'text') {
        return {
          question_id: q.id,
          question_text: q.question_text,
          question_type: q.question_type,
          total_answers: answers.length,
          answers: answers.filter(a => a && a.trim())
        };
      }

      if (q.question_type === 'yes_no') {
        const counts = { Yes: 0, No: 0 };
        answers.forEach(a => { if (a in counts) counts[a]++; });
        return {
          question_id: q.id,
          question_text: q.question_text,
          question_type: q.question_type,
          total_answers: answers.length,
          counts
        };
      }

      // multiple_choice
      const options = q.options ? JSON.parse(q.options) : [];
      const counts = {};
      options.forEach(o => { counts[o] = 0; });
      answers.forEach(a => { if (a in counts) counts[a]++; });
      return {
        question_id: q.id,
        question_text: q.question_text,
        question_type: q.question_type,
        options,
        total_answers: answers.length,
        counts
      };
    });

    res.json({ form, total_responses: totalResponses, results });
  } catch (err) {
    console.error('Form results error:', err);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

module.exports = router;
