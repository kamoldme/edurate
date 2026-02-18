const db = require('./database');
const bcrypt = require('bcryptjs');

console.log('🔄 Resetting database and creating test data (org_id=1: Lincoln High School)...\n');

// Delete all reviews
console.log('🗑️  Deleting all reviews...');
db.prepare('DELETE FROM reviews').run();
console.log('✅ All reviews deleted\n');

// Delete all existing classrooms and members to avoid duplication
console.log('🗑️  Deleting existing classrooms and members...');
db.prepare('DELETE FROM classroom_members').run();
db.prepare('DELETE FROM classrooms').run();
console.log('✅ All classrooms cleared\n');

// Delete specific teachers: teacherjonov and teacherbek
console.log('🗑️  Deleting teacherjonov and teacherbek...');
const teacherJonov = db.prepare("SELECT id, user_id FROM teachers WHERE full_name LIKE '%jonov%'").get();
const teacherBek = db.prepare("SELECT id, user_id FROM teachers WHERE full_name LIKE '%bek%'").get();

if (teacherJonov) {
  db.prepare('DELETE FROM teachers WHERE id = ?').run(teacherJonov.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(teacherJonov.user_id);
  console.log('✅ Deleted teacherjonov');
}

if (teacherBek) {
  db.prepare('DELETE FROM teachers WHERE id = ?').run(teacherBek.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(teacherBek.user_id);
  console.log('✅ Deleted teacherbek');
}
console.log('');

// Create new teachers from different departments (for org_id=1)
console.log('👨‍🏫 Creating new teachers for Lincoln High School...');

const newTeachers = [
  { name: 'Dr. Sarah Martinez', email: 'martinez@edurate.school.edu', department: 'Science', subject: 'Biology' },
  { name: 'Prof. Michael Chen', email: 'chen@edurate.school.edu', department: 'Math', subject: 'Calculus' },
  { name: 'Ms. Jennifer Lopez', email: 'lopez@edurate.school.edu', department: 'English', subject: 'Literature' },
  { name: 'Mr. David Kim', email: 'kim@edurate.school.edu', department: 'Humanities', subject: 'World History' },
  { name: 'Ms. Aisha Karimova', email: 'karimova@edurate.school.edu', department: 'Non-English', subject: 'Russian Language' },
  { name: 'Prof. Robert Taylor', email: 'taylor@edurate.school.edu', department: 'Arts', subject: 'Visual Arts' }
];

const ORG_ID = 1; // Lincoln High School
const password = 'Teacher@123';
const hashedPassword = bcrypt.hashSync(password, 10);

newTeachers.forEach(t => {
  // Check if teacher already exists
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(t.email);
  if (existing) {
    console.log(`⏭️  ${t.name} already exists, skipping`);
    return;
  }

  // Create user (with org_id)
  const userResult = db.prepare(`
    INSERT INTO users (full_name, email, password, role, grade_or_position, school_id, org_id, verified_status)
    VALUES (?, ?, ?, 'teacher', ?, 1, ?, 1)
  `).run(t.name, t.email, hashedPassword, t.department, ORG_ID);

  // Create teacher (with org_id)
  db.prepare(`
    INSERT INTO teachers (user_id, full_name, subject, department, experience_years, bio, school_id, org_id)
    VALUES (?, ?, ?, ?, 5, 'Passionate educator dedicated to student success', 1, ?)
  `).run(userResult.lastInsertRowid, t.name, t.subject, t.department, ORG_ID);

  // Add to user_organizations
  db.prepare(`
    INSERT OR IGNORE INTO user_organizations (user_id, org_id, role_in_org, is_primary)
    VALUES (?, ?, 'teacher', 1)
  `).run(userResult.lastInsertRowid, ORG_ID);

  console.log(`✅ Created ${t.name} (${t.department} - ${t.subject})`);
});
console.log('');

// Get active term for org_id=1
let activeTerm = db.prepare('SELECT id FROM terms WHERE active_status = 1 AND org_id = ? LIMIT 1').get(ORG_ID);
if (!activeTerm) {
  console.log('❌ No active term found for Lincoln. Creating one...');
  const termResult = db.prepare(`
    INSERT INTO terms (name, start_date, end_date, school_id, org_id, active_status, feedback_visible)
    VALUES ('Spring 2026', '2026-01-15', '2026-05-30', 1, ?, 1, 1)
  `).run(ORG_ID);
  activeTerm = { id: termResult.lastInsertRowid };

  // Create feedback periods
  db.prepare(`
    INSERT INTO feedback_periods (term_id, name, start_date, end_date, active_status)
    VALUES (?, '1st Half', '2026-01-15', '2026-03-15', 1)
  `).run(activeTerm.id);
  db.prepare(`
    INSERT INTO feedback_periods (term_id, name, start_date, end_date, active_status)
    VALUES (?, '2nd Half', '2026-03-16', '2026-05-30', 0)
  `).run(activeTerm.id);
  console.log('✅ Created Spring 2026 term with feedback periods');
}

// Create test classrooms with group numbers (with org_id)
console.log('🏫 Creating test classrooms...');

const teachers = db.prepare('SELECT id, full_name, subject, department FROM teachers WHERE org_id = ?').all(ORG_ID);
const classrooms = [];

// Track how many groups each teacher has to assign group numbers
const teacherGroupCount = {};

teachers.forEach(teacher => {
  teacherGroupCount[teacher.id] = (teacherGroupCount[teacher.id] || 0) + 1;
  const groupNum = teacherGroupCount[teacher.id];
  const subjectWithGroup = `${teacher.subject} - Group ${groupNum}`;

  const result = db.prepare(`
    INSERT INTO classrooms (teacher_id, subject, grade_level, term_id, join_code, org_id, active_status)
    VALUES (?, ?, 'Grade 10', ?, ?, ?, 1)
  `).run(teacher.id, subjectWithGroup, activeTerm.id, String(Math.floor(10000000 + Math.random() * 90000000)), ORG_ID);

  classrooms.push({ id: result.lastInsertRowid, teacher_id: teacher.id, teacher_name: teacher.full_name, subject: subjectWithGroup });
  console.log(`✅ Created classroom for ${teacher.full_name} - ${subjectWithGroup}`);
});
console.log('');

// Enroll students in 4-5 classrooms each (not all classrooms)
console.log('👨‍🎓 Enrolling students in classrooms...');
const students = db.prepare("SELECT id, full_name FROM users WHERE role = 'student'").all();

students.forEach((student, idx) => {
  // Each student gets 4-5 classrooms (shuffled, pick a subset)
  const shuffled = [...classrooms].sort(() => Math.random() - 0.5);
  const count = Math.min(shuffled.length, 4 + (idx % 2)); // alternates 4 and 5
  const selected = shuffled.slice(0, count);

  selected.forEach(classroom => {
    try {
      db.prepare(`
        INSERT INTO classroom_members (classroom_id, student_id)
        VALUES (?, ?)
      `).run(classroom.id, student.id);

      // Auto-add student to user_organizations (simulating the /join endpoint behavior)
      db.prepare(`
        INSERT OR IGNORE INTO user_organizations (user_id, org_id, role_in_org, is_primary)
        VALUES (?, ?, 'student', ?)
      `).run(student.id, ORG_ID, idx === 0 ? 1 : 0); // First enrollment is primary
    } catch (err) {
      // Skip if already enrolled
    }
  });
  console.log(`✅ Enrolled ${student.full_name} in ${count} classrooms`);
});
console.log('');

// Get active feedback period
let activePeriod = db.prepare(`
  SELECT id FROM feedback_periods WHERE term_id = ? AND active_status = 1 LIMIT 1
`).get(activeTerm.id);

if (!activePeriod) {
  console.log('⚠️  No active feedback period found. Creating one...');
  const periodResult = db.prepare(`
    INSERT INTO feedback_periods (term_id, name, start_date, end_date, active_status)
    VALUES (?, '1st Half', '2026-01-15', '2026-03-15', 1)
  `).run(activeTerm.id);
  activePeriod = { id: periodResult.lastInsertRowid };
  console.log('✅ Created 1st Half feedback period\n');
}

// Create test reviews (only for classrooms the student is actually enrolled in)
console.log('📝 Creating test reviews...');

const reviewData = [
  { clarity: 5, engagement: 5, fairness: 5, supportiveness: 5, preparation: 5, workload: 4, text: 'Excellent teacher! Very clear explanations and always well-prepared.', tags: ['Clear explanations', 'Well-prepared', 'Engaging lessons'] },
  { clarity: 4, engagement: 5, fairness: 4, supportiveness: 4, preparation: 4, workload: 3, text: 'Great class! Really enjoyed the interactive discussions.', tags: ['Engaging lessons', 'Encourages participation'] },
  { clarity: 3, engagement: 3, fairness: 4, supportiveness: 3, preparation: 3, workload: 2, text: 'Good teacher but could use more examples.', tags: ['Fair grading', 'More examples needed'] },
  { clarity: 5, engagement: 4, fairness: 5, supportiveness: 5, preparation: 5, workload: 5, text: 'Amazing! Very supportive and understanding.', tags: ['Supportive', 'Fair grading', 'Respectful'] },
  { clarity: 4, engagement: 4, fairness: 4, supportiveness: 4, preparation: 4, workload: 4, text: 'Solid teaching overall, keeps the class interesting.', tags: ['Clear explanations', 'Engaging lessons'] }
];

let reviewCount = 0;
students.forEach((student) => {
  // Get classrooms this student is enrolled in
  const enrolled = db.prepare(
    'SELECT cm.classroom_id, c.teacher_id FROM classroom_members cm JOIN classrooms c ON cm.classroom_id = c.id WHERE cm.student_id = ?'
  ).all(student.id);

  enrolled.forEach((enrollment) => {
    // Each student reviews about 60% of their enrolled classrooms
    if (Math.random() < 0.6) {
      const review = reviewData[reviewCount % reviewData.length];

      // Add some variation to ratings
      const variance = () => Math.floor(Math.random() * 2) - 1;
      const clarity = Math.max(1, Math.min(5, review.clarity + variance()));
      const engagement = Math.max(1, Math.min(5, review.engagement + variance()));
      const fairness = Math.max(1, Math.min(5, review.fairness + variance()));
      const supportiveness = Math.max(1, Math.min(5, review.supportiveness + variance()));
      const preparation = Math.max(1, Math.min(5, review.preparation + variance()));
      const workload = Math.max(1, Math.min(5, review.workload + variance()));
      const overall = Math.round((clarity + engagement + fairness + supportiveness + preparation + workload) / 6);

      try {
        db.prepare(`
          INSERT INTO reviews (
            teacher_id, classroom_id, student_id, school_id, org_id, term_id, feedback_period_id,
            overall_rating, clarity_rating, engagement_rating, fairness_rating,
            supportiveness_rating, preparation_rating, workload_rating,
            feedback_text, tags, flagged_status, approved_status
          ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1)
        `).run(
          enrollment.teacher_id, enrollment.classroom_id, student.id, ORG_ID, activeTerm.id, activePeriod.id,
          overall, clarity, engagement, fairness, supportiveness, preparation, workload,
          review.text, JSON.stringify(review.tags)
        );
        reviewCount++;
      } catch (err) {
        // Skip duplicates
      }
    }
  });
});

console.log(`✅ Created ${reviewCount} test reviews\n`);

console.log('🎉 Database reset complete!\n');
console.log('Summary:');
console.log(`  - Deleted all old reviews and classrooms`);
console.log(`  - Removed teacherjonov and teacherbek`);
console.log(`  - Created ${newTeachers.length} new teachers for Lincoln High School (org_id=${ORG_ID})`);
console.log(`  - Created ${classrooms.length} classrooms (each with group number)`);
console.log(`  - Enrolled ${students.length} students (4-5 classrooms each)`);
console.log(`  - Auto-added students to user_organizations`);
console.log(`  - Created ${reviewCount} test reviews (already approved)`);
console.log('');
