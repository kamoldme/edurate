const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

console.log('Seeding EduRate database...\n');

// Clear existing data
db.exec(`
  DELETE FROM teacher_responses;
  DELETE FROM reviews;
  DELETE FROM classroom_members;
  DELETE FROM classrooms;
  DELETE FROM feedback_periods;
  DELETE FROM terms;
  DELETE FROM teachers;
  DELETE FROM users;
`);

const hash = (pw) => bcrypt.hashSync(pw, 12);

// ============ USERS ============
const insertUser = db.prepare(`
  INSERT INTO users (full_name, email, password, role, grade_or_position, school_id, verified_status)
  VALUES (?, ?, ?, ?, ?, 1, 1)
`);

const adminId = insertUser.run('Sarah Admin', 'admin@edurate.school.edu', hash('Admin@123'), 'admin', 'System Administrator').lastInsertRowid;
const headId = insertUser.run('Dr. Michael Roberts', 'head@edurate.school.edu', hash('Head@123'), 'school_head', 'School Head').lastInsertRowid;

const teacher1UserId = insertUser.run('Mr. James Smith', 'j.smith@edurate.school.edu', hash('Teacher@123'), 'teacher', 'Mathematics Teacher').lastInsertRowid;
const teacher2UserId = insertUser.run('Ms. Emily Chen', 'e.chen@edurate.school.edu', hash('Teacher@123'), 'teacher', 'English Teacher').lastInsertRowid;

const aliceId = insertUser.run('Alice Johnson', 'alice@edurate.school.edu', hash('Student@123'), 'student', 'Grade 10').lastInsertRowid;
const bobId = insertUser.run('Bob Williams', 'bob@edurate.school.edu', hash('Student@123'), 'student', 'Grade 10').lastInsertRowid;
const carolId = insertUser.run('Carol Davis', 'carol@edurate.school.edu', hash('Student@123'), 'student', 'Grade 10').lastInsertRowid;
const davidId = insertUser.run('David Brown', 'david@edurate.school.edu', hash('Student@123'), 'student', 'Grade 11').lastInsertRowid;
const emmaId = insertUser.run('Emma Wilson', 'emma@edurate.school.edu', hash('Student@123'), 'student', 'Grade 11').lastInsertRowid;
const frankId = insertUser.run('Frank Miller', 'frank@edurate.school.edu', hash('Student@123'), 'student', 'Grade 11').lastInsertRowid;

console.log('Users created');

// ============ TEACHERS ============
const insertTeacher = db.prepare(`
  INSERT INTO teachers (user_id, full_name, subject, department, experience_years, bio, school_id)
  VALUES (?, ?, ?, ?, ?, ?, 1)
`);

const teacher1Id = insertTeacher.run(
  teacher1UserId, 'Mr. James Smith', 'Mathematics', 'STEM', 8,
  'Dedicated mathematics educator with 8 years of experience. Passionate about making math accessible and enjoyable for all students.'
).lastInsertRowid;

const teacher2Id = insertTeacher.run(
  teacher2UserId, 'Ms. Emily Chen', 'English Literature', 'Humanities', 5,
  'English literature teacher focused on developing critical thinking and creative writing skills. Believes every student has a unique voice.'
).lastInsertRowid;

console.log('Teachers created');

// ============ TERMS ============
const insertTerm = db.prepare(
  'INSERT INTO terms (name, start_date, end_date, school_id, active_status) VALUES (?, ?, ?, 1, ?)'
);

const term1Id = insertTerm.run('Term 1 2025-2026', '2025-09-01', '2025-12-20', 1).lastInsertRowid;

console.log('Terms created');

// ============ FEEDBACK PERIODS ============
const insertPeriod = db.prepare(
  'INSERT INTO feedback_periods (term_id, name, start_date, end_date, active_status) VALUES (?, ?, ?, ?, ?)'
);

const period1Id = insertPeriod.run(term1Id, 'Beginning', '2025-09-15', '2025-10-15', 1).lastInsertRowid;
const period2Id = insertPeriod.run(term1Id, 'Mid-Term', '2025-10-20', '2025-11-15', 0).lastInsertRowid;
const period3Id = insertPeriod.run(term1Id, 'End', '2025-11-20', '2025-12-15', 0).lastInsertRowid;

console.log('Feedback periods created (Beginning is ACTIVE)');

// ============ CLASSROOMS ============
function genCode() { return uuidv4().substring(0, 8).toUpperCase(); }

const insertClassroom = db.prepare(
  'INSERT INTO classrooms (teacher_id, subject, grade_level, term_id, join_code, active_status) VALUES (?, ?, ?, ?, ?, 1)'
);

const class1Id = insertClassroom.run(teacher1Id, 'Mathematics', 'Grade 10', term1Id, genCode()).lastInsertRowid;
const class2Id = insertClassroom.run(teacher1Id, 'Advanced Mathematics', 'Grade 11', term1Id, genCode()).lastInsertRowid;
const class3Id = insertClassroom.run(teacher2Id, 'English Literature', 'Grade 10', term1Id, genCode()).lastInsertRowid;
const class4Id = insertClassroom.run(teacher2Id, 'Creative Writing', 'Grade 11', term1Id, genCode()).lastInsertRowid;

console.log('Classrooms created');

// ============ CLASSROOM MEMBERS ============
const insertMember = db.prepare(
  'INSERT INTO classroom_members (classroom_id, student_id) VALUES (?, ?)'
);

// Grade 10 students -> Math + English
insertMember.run(class1Id, aliceId);
insertMember.run(class1Id, bobId);
insertMember.run(class1Id, carolId);
insertMember.run(class3Id, aliceId);
insertMember.run(class3Id, bobId);
insertMember.run(class3Id, carolId);

// Grade 11 students -> Advanced Math + Creative Writing
insertMember.run(class2Id, davidId);
insertMember.run(class2Id, emmaId);
insertMember.run(class2Id, frankId);
insertMember.run(class4Id, davidId);
insertMember.run(class4Id, emmaId);
insertMember.run(class4Id, frankId);

console.log('Students enrolled in classrooms');

// ============ SAMPLE REVIEWS ============
const insertReview = db.prepare(`
  INSERT INTO reviews (
    teacher_id, classroom_id, student_id, school_id, term_id, feedback_period_id,
    overall_rating, clarity_rating, engagement_rating, fairness_rating, supportiveness_rating,
    feedback_text, tags, flagged_status, approved_status
  ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Alice reviews Mr. Smith (Math Grade 10) - approved
insertReview.run(
  teacher1Id, class1Id, aliceId, term1Id, period1Id,
  5, 5, 4, 5, 4,
  'Mr. Smith explains concepts very clearly and always makes sure everyone understands before moving on. His examples are really helpful.',
  JSON.stringify(['Clear explanations', 'Good examples', 'Supportive']),
  'approved', 1
);

// Bob reviews Mr. Smith (Math Grade 10) - approved
insertReview.run(
  teacher1Id, class1Id, bobId, term1Id, period1Id,
  4, 4, 4, 5, 5,
  'Great teacher who cares about students. Sometimes goes a bit fast but always willing to help after class.',
  JSON.stringify(['Supportive', 'Encourages participation']),
  'approved', 1
);

// Alice reviews Ms. Chen (English Grade 10) - approved
insertReview.run(
  teacher2Id, class3Id, aliceId, term1Id, period1Id,
  4, 4, 5, 4, 4,
  'Ms. Chen makes literature come alive! Her class discussions are always engaging and thought-provoking.',
  JSON.stringify(['Engaging lessons', 'Encourages participation']),
  'approved', 1
);

// David reviews Mr. Smith (Adv Math Grade 11) - pending
insertReview.run(
  teacher1Id, class2Id, davidId, term1Id, period1Id,
  4, 3, 4, 5, 4,
  'Advanced math is challenging but Mr. Smith tries to make it understandable. Could use more worked examples during class.',
  JSON.stringify(['Fair grading', 'More examples needed']),
  'pending', 0
);

// Emma reviews Ms. Chen (Creative Writing Grade 11) - pending
insertReview.run(
  teacher2Id, class4Id, emmaId, term1Id, period1Id,
  5, 5, 5, 5, 5,
  'Amazing class! Ms. Chen truly encourages creativity and gives constructive feedback on our writing. Best class this term.',
  JSON.stringify(['Engaging lessons', 'Supportive', 'Well-prepared']),
  'pending', 0
);

console.log('Sample reviews created');

// Print summary
console.log('\n═══════════════════════════════════════════════════');
console.log('  SEED COMPLETE');
console.log('═══════════════════════════════════════════════════');
console.log('');
console.log('  Users: 10 (1 admin, 1 school head, 2 teachers, 6 students)');
console.log('  Terms: 1 (active)');
console.log('  Feedback Periods: 3 (Beginning is ACTIVE)');
console.log('  Classrooms: 4');
console.log('  Enrollments: 12');
console.log('  Reviews: 5 (3 approved, 2 pending)');
console.log('');

// Print classroom codes
const classrooms = db.prepare(`
  SELECT c.id, c.subject, c.grade_level, c.join_code, te.full_name as teacher
  FROM classrooms c JOIN teachers te ON c.teacher_id = te.id
  ORDER BY c.id
`).all();

console.log('  Classroom Join Codes:');
classrooms.forEach(c => {
  console.log(`    ${c.join_code}  →  ${c.subject} (${c.grade_level}) - ${c.teacher}`);
});

console.log('');
console.log('  Login Credentials:');
console.log('  ─────────────────────────────────────────────────');
console.log('  Admin:       admin@edurate.school.edu     / Admin@123');
console.log('  School Head: head@edurate.school.edu      / Head@123');
console.log('  Teacher 1:   j.smith@edurate.school.edu   / Teacher@123');
console.log('  Teacher 2:   e.chen@edurate.school.edu    / Teacher@123');
console.log('  Student 1:   alice@edurate.school.edu     / Student@123');
console.log('  Student 2:   bob@edurate.school.edu       / Student@123');
console.log('  Student 3:   carol@edurate.school.edu     / Student@123');
console.log('  Student 4:   david@edurate.school.edu     / Student@123');
console.log('  Student 5:   emma@edurate.school.edu      / Student@123');
console.log('  Student 6:   frank@edurate.school.edu     / Student@123');
console.log('  ─────────────────────────────────────────────────\n');

process.exit(0);
