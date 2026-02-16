const bcrypt = require('bcryptjs');
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

// Admin & School Head
const adminId = insertUser.run('Sarah Admin', 'admin@edurate.school.edu', hash('Admin@123'), 'admin', 'System Administrator').lastInsertRowid;
const headId = insertUser.run('Dr. Michael Roberts', 'head@edurate.school.edu', hash('Head@123'), 'school_head', 'School Head').lastInsertRowid;

// Teachers (6 departments: English, Non-English, Humanities, Science, Math, Arts)
const t1UserId = insertUser.run('Mr. James Smith', 'smith@edurate.school.edu', hash('Teacher@123'), 'teacher', 'Math Teacher').lastInsertRowid;
const t2UserId = insertUser.run('Ms. Emily Chen', 'chen@edurate.school.edu', hash('Teacher@123'), 'teacher', 'English Teacher').lastInsertRowid;
const t3UserId = insertUser.run('Dr. Sarah Martinez', 'martinez@edurate.school.edu', hash('Teacher@123'), 'teacher', 'Science Teacher').lastInsertRowid;
const t4UserId = insertUser.run('Mr. David Kim', 'kim@edurate.school.edu', hash('Teacher@123'), 'teacher', 'History Teacher').lastInsertRowid;
const t5UserId = insertUser.run('Ms. Aisha Karimova', 'karimova@edurate.school.edu', hash('Teacher@123'), 'teacher', 'Russian Teacher').lastInsertRowid;
const t6UserId = insertUser.run('Prof. Robert Taylor', 'taylor@edurate.school.edu', hash('Teacher@123'), 'teacher', 'Arts Teacher').lastInsertRowid;

// Students (4 students — enough to test with 3-4 per classroom)
const aliceId = insertUser.run('Alice Johnson', 'alice@edurate.school.edu', hash('Student@123'), 'student', 'Grade 10').lastInsertRowid;
const bobId = insertUser.run('Bob Williams', 'bob@edurate.school.edu', hash('Student@123'), 'student', 'Grade 10').lastInsertRowid;
const carolId = insertUser.run('Carol Davis', 'carol@edurate.school.edu', hash('Student@123'), 'student', 'Grade 10').lastInsertRowid;
const davidId = insertUser.run('David Brown', 'david@edurate.school.edu', hash('Student@123'), 'student', 'Grade 11').lastInsertRowid;

console.log('Users created (1 admin, 1 school head, 6 teachers, 4 students)');

// ============ TEACHERS ============
const insertTeacher = db.prepare(`
  INSERT INTO teachers (user_id, full_name, subject, department, experience_years, bio, school_id)
  VALUES (?, ?, ?, ?, ?, ?, 1)
`);

const t1Id = insertTeacher.run(t1UserId, 'Mr. James Smith', 'Algebra', 'Math', 8,
  'Dedicated mathematics educator with 8 years of experience. Passionate about making math accessible and enjoyable for all students.'
).lastInsertRowid;

const t2Id = insertTeacher.run(t2UserId, 'Ms. Emily Chen', 'English Literature', 'English', 5,
  'English literature teacher focused on developing critical thinking and creative writing skills. Believes every student has a unique voice.'
).lastInsertRowid;

const t3Id = insertTeacher.run(t3UserId, 'Dr. Sarah Martinez', 'Biology', 'Science', 10,
  'Experienced science educator dedicated to hands-on learning and nurturing curiosity in young minds.'
).lastInsertRowid;

const t4Id = insertTeacher.run(t4UserId, 'Mr. David Kim', 'World History', 'Humanities', 6,
  'History teacher who brings the past to life through storytelling and interactive discussions. Focuses on connecting historical events to modern issues.'
).lastInsertRowid;

const t5Id = insertTeacher.run(t5UserId, 'Ms. Aisha Karimova', 'Russian Language', 'Non-English', 4,
  'Native Russian speaker with a passion for teaching language and culture. Uses immersive methods to help students think in Russian.'
).lastInsertRowid;

const t6Id = insertTeacher.run(t6UserId, 'Prof. Robert Taylor', 'Visual Arts', 'Arts', 12,
  'Award-winning artist and educator. Encourages students to express themselves through various art forms and develop their creative vision.'
).lastInsertRowid;

console.log('Teachers created (6 departments: Math, English, Science, Humanities, Non-English, Arts)');

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

const period1Id = insertPeriod.run(term1Id, '1st Half', '2025-09-15', '2025-10-31', 1).lastInsertRowid;
const period2Id = insertPeriod.run(term1Id, '2nd Half', '2025-11-01', '2025-12-15', 0).lastInsertRowid;

console.log('Feedback periods created (1st Half is ACTIVE)');

// ============ CLASSROOMS ============
function genCode() { return String(Math.floor(10000000 + Math.random() * 90000000)); }

const insertClassroom = db.prepare(
  'INSERT INTO classrooms (teacher_id, subject, grade_level, term_id, join_code, active_status) VALUES (?, ?, ?, ?, ?, 1)'
);

// 6 classrooms, one per teacher, each with group number
const c1Id = insertClassroom.run(t1Id, 'Algebra - Group 1', 'Grade 10', term1Id, genCode()).lastInsertRowid;
const c2Id = insertClassroom.run(t2Id, 'English Literature - Group 1', 'Grade 10', term1Id, genCode()).lastInsertRowid;
const c3Id = insertClassroom.run(t3Id, 'Biology - Group 1', 'Grade 10', term1Id, genCode()).lastInsertRowid;
const c4Id = insertClassroom.run(t4Id, 'World History - Group 1', 'Grade 10', term1Id, genCode()).lastInsertRowid;
const c5Id = insertClassroom.run(t5Id, 'Russian Language - Group 1', 'Grade 10', term1Id, genCode()).lastInsertRowid;
const c6Id = insertClassroom.run(t6Id, 'Visual Arts - Group 1', 'Grade 10', term1Id, genCode()).lastInsertRowid;

console.log('Classrooms created (6 classrooms, one per department)');

// ============ CLASSROOM MEMBERS ============
// 4 students, 6 classrooms → each student gets 4-5, each classroom gets 3-4
const insertMember = db.prepare(
  'INSERT INTO classroom_members (classroom_id, student_id) VALUES (?, ?)'
);

// Alice: Algebra, English, Biology, History, Arts = 5 classrooms
insertMember.run(c1Id, aliceId);
insertMember.run(c2Id, aliceId);
insertMember.run(c3Id, aliceId);
insertMember.run(c4Id, aliceId);
insertMember.run(c6Id, aliceId);

// Bob: Algebra, English, Biology, Russian, Arts = 5 classrooms
insertMember.run(c1Id, bobId);
insertMember.run(c2Id, bobId);
insertMember.run(c3Id, bobId);
insertMember.run(c5Id, bobId);
insertMember.run(c6Id, bobId);

// Carol: Algebra, English, History, Russian, Arts = 5 classrooms
insertMember.run(c1Id, carolId);
insertMember.run(c2Id, carolId);
insertMember.run(c4Id, carolId);
insertMember.run(c5Id, carolId);
insertMember.run(c6Id, carolId);

// David: Algebra, Biology, History, Russian = 4 classrooms
insertMember.run(c1Id, davidId);
insertMember.run(c3Id, davidId);
insertMember.run(c4Id, davidId);
insertMember.run(c5Id, davidId);

// Classroom summary:
// Algebra G1:    Alice, Bob, Carol, David = 4 students
// English G1:    Alice, Bob, Carol        = 3 students
// Biology G1:    Alice, Bob, David        = 3 students
// History G1:    Alice, Carol, David      = 3 students
// Russian G1:    Bob, Carol, David        = 3 students
// Visual Arts G1: Alice, Bob, Carol       = 3 students

console.log('Students enrolled (4-5 classrooms per student, 3-4 students per classroom)');

// ============ SAMPLE REVIEWS ============
// Varied feedback across different rating ranges to show what teachers see visually
const insertReview = db.prepare(`
  INSERT INTO reviews (
    teacher_id, classroom_id, student_id, school_id, term_id, feedback_period_id,
    overall_rating, clarity_rating, engagement_rating, fairness_rating, supportiveness_rating,
    preparation_rating, workload_rating,
    feedback_text, tags, flagged_status, approved_status
  ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// --- Mr. Smith / Algebra - highly rated teacher (mostly 4-5) ---

// Alice → Algebra: glowing review
insertReview.run(t1Id, c1Id, aliceId, term1Id, period1Id,
  5, 5, 5, 5, 4, 5, 4,
  'Mr. Smith explains concepts very clearly and always makes sure everyone understands before moving on. His examples are really helpful and he uses real-world problems.',
  JSON.stringify(['Clear explanations', 'Good examples', 'Supportive']),
  'approved', 1
);

// Bob → Algebra: good but notes pace issue
insertReview.run(t1Id, c1Id, bobId, term1Id, period1Id,
  4, 4, 4, 5, 5, 4, 3,
  'Great teacher who cares about students. Sometimes goes a bit fast but always willing to help after class. The homework is reasonable.',
  JSON.stringify(['Supportive', 'Encourages participation', 'Too fast-paced']),
  'approved', 1
);

// Carol → Algebra: solid review
insertReview.run(t1Id, c1Id, carolId, term1Id, period1Id,
  4, 5, 4, 4, 4, 5, 4,
  'Well-prepared lessons every day. I like how he connects math to everyday life. Grading is fair and transparent.',
  JSON.stringify(['Well-prepared', 'Clear explanations', 'Fair grading']),
  'approved', 1
);

// David → Algebra: constructive criticism
insertReview.run(t1Id, c1Id, davidId, term1Id, period1Id,
  3, 3, 3, 4, 4, 4, 2,
  'Mr. Smith knows his subject well but the pace can be overwhelming. Would appreciate more practice problems before tests. The workload feels heavy sometimes.',
  JSON.stringify(['More examples needed', 'Too fast-paced', 'Challenging but good']),
  'pending', 0
);

// --- Ms. Chen / English - mixed ratings (3-5 range) ---

// Alice → English: enthusiastic
insertReview.run(t2Id, c2Id, aliceId, term1Id, period1Id,
  5, 4, 5, 5, 5, 4, 4,
  'Ms. Chen makes literature come alive! Her class discussions are always engaging and thought-provoking. She truly cares about each student\'s growth.',
  JSON.stringify(['Engaging lessons', 'Encourages participation', 'Supportive']),
  'approved', 1
);

// Bob → English: average experience
insertReview.run(t2Id, c2Id, bobId, term1Id, period1Id,
  3, 3, 4, 3, 3, 3, 3,
  'Class is okay. The readings are interesting but sometimes the essay assignments are unclear. Could use more specific rubrics.',
  JSON.stringify(['Engaging lessons', 'Needs clearer explanations', 'More feedback needed']),
  'approved', 1
);

// Carol → English: positive with suggestions
insertReview.run(t2Id, c2Id, carolId, term1Id, period1Id,
  4, 4, 5, 4, 4, 3, 3,
  'I really enjoy the creative writing assignments. Ms. Chen gives good verbal feedback but takes a long time to return graded papers.',
  JSON.stringify(['Engaging lessons', 'More feedback needed', 'Encourages participation']),
  'approved', 1
);

// --- Dr. Martinez / Biology - top performer ---

// Alice → Biology: stellar
insertReview.run(t3Id, c3Id, aliceId, term1Id, period1Id,
  5, 5, 5, 5, 5, 5, 4,
  'Dr. Martinez is the best science teacher I\'ve ever had! The lab experiments are well-organized and she explains complex concepts so clearly. Always available for questions.',
  JSON.stringify(['Well-prepared', 'Engaging lessons', 'Clear explanations', 'Supportive']),
  'approved', 1
);

// Bob → Biology: very positive
insertReview.run(t3Id, c3Id, bobId, term1Id, period1Id,
  5, 5, 5, 4, 5, 5, 4,
  'Amazing class. The hands-on experiments make biology easy to understand. Dr. Martinez is patient and always encourages us to ask questions.',
  JSON.stringify(['Engaging lessons', 'Good examples', 'Encourages participation']),
  'approved', 1
);

// David → Biology: good with minor notes
insertReview.run(t3Id, c3Id, davidId, term1Id, period1Id,
  4, 4, 4, 4, 4, 4, 3,
  'Good class overall. The experiments are interesting but sometimes the workload feels heavy with lab reports due every week.',
  JSON.stringify(['Engaging lessons', 'Challenging but good']),
  'pending', 0
);

// --- Mr. Kim / History - needs improvement (mostly 2-3) ---

// Alice → History: critical but fair
insertReview.run(t4Id, c4Id, aliceId, term1Id, period1Id,
  2, 2, 2, 3, 3, 2, 2,
  'The material could be interesting but the lessons are mostly reading from slides. Not much class discussion or interaction. Hard to stay focused.',
  JSON.stringify(['Needs clearer explanations', 'More interactive', 'Too slow-paced']),
  'approved', 1
);

// Carol → History: some positives
insertReview.run(t4Id, c4Id, carolId, term1Id, period1Id,
  3, 3, 2, 4, 3, 3, 3,
  'Mr. Kim is fair with grading and knows his subject, but the classes need more variety. It\'s hard to engage when every lesson is a lecture. The documentary days are great though.',
  JSON.stringify(['Fair grading', 'More interactive', 'Better organization']),
  'approved', 1
);

// David → History: struggling
insertReview.run(t4Id, c4Id, davidId, term1Id, period1Id,
  2, 2, 1, 3, 2, 2, 3,
  'I find it hard to learn in this class. The lessons are not engaging and there\'s no discussion. Tests are mostly memorization which doesn\'t feel useful.',
  JSON.stringify(['Needs clearer explanations', 'More interactive', 'Better organization']),
  'pending', 0
);

// --- Ms. Karimova / Russian - mid-range teacher (3-4) ---

// Bob → Russian: decent
insertReview.run(t5Id, c5Id, bobId, term1Id, period1Id,
  4, 4, 4, 3, 4, 4, 3,
  'Ms. Karimova speaks mostly in Russian which is great for immersion, but sometimes I wish she would explain grammar rules in English first. Good teacher overall.',
  JSON.stringify(['Engaging lessons', 'Needs clearer explanations', 'Challenging but good']),
  'approved', 1
);

// Carol → Russian: positive
insertReview.run(t5Id, c5Id, carolId, term1Id, period1Id,
  4, 3, 4, 4, 4, 4, 3,
  'I\'m learning a lot! The conversational practice is helpful. Sometimes the homework is unclear but she\'s always willing to explain. Fun cultural activities.',
  JSON.stringify(['Engaging lessons', 'Encourages participation', 'Supportive']),
  'approved', 1
);

// David → Russian: mixed
insertReview.run(t5Id, c5Id, davidId, term1Id, period1Id,
  3, 3, 3, 3, 3, 3, 4,
  'The class is fine but the workload is too much for a language course. Too many vocabulary quizzes. Speaking practice is good though.',
  JSON.stringify(['Challenging but good', 'More feedback needed']),
  'approved', 1
);

// --- Prof. Taylor / Visual Arts - well-loved (4-5) ---

// Alice → Arts: enthusiastic
insertReview.run(t6Id, c6Id, aliceId, term1Id, period1Id,
  5, 4, 5, 5, 5, 5, 5,
  'Prof. Taylor\'s class is the highlight of my week! He gives us creative freedom while still teaching technique. Very encouraging and the workload is perfect.',
  JSON.stringify(['Engaging lessons', 'Supportive', 'Well-prepared', 'Respectful']),
  'approved', 1
);

// Bob → Arts: very good
insertReview.run(t6Id, c6Id, bobId, term1Id, period1Id,
  4, 4, 5, 4, 5, 4, 5,
  'Fun class with a great atmosphere. Prof. Taylor respects everyone\'s artistic style. Projects are interesting and the feedback is always constructive.',
  JSON.stringify(['Engaging lessons', 'Supportive', 'Encourages participation']),
  'approved', 1
);

// Carol → Arts: loves it
insertReview.run(t6Id, c6Id, carolId, term1Id, period1Id,
  5, 5, 5, 5, 5, 5, 4,
  'Best class ever! I didn\'t think I was artistic but Prof. Taylor helped me find my style. The gallery project was amazing. He pushes you to improve while being supportive.',
  JSON.stringify(['Clear explanations', 'Supportive', 'Well-prepared', 'Engaging lessons']),
  'approved', 1
);

console.log('Sample reviews created (21 reviews with varied ratings across all 6 teachers)');

// Print summary
console.log('\n═══════════════════════════════════════════════════');
console.log('  SEED COMPLETE');
console.log('═══════════════════════════════════════════════════');
console.log('');
console.log('  Users: 12 (1 admin, 1 school head, 6 teachers, 4 students)');
console.log('  Terms: 1 (active)');
console.log('  Feedback Periods: 2 (1st Half is ACTIVE)');
console.log('  Classrooms: 6 (one per department, each with group number)');
console.log('  Departments: Math, English, Science, Humanities, Non-English, Arts');
console.log('  Reviews: 21 (varied ratings from 1-5 across all teachers)');
console.log('');
console.log('  Teacher Rating Summary:');
console.log('    Mr. Smith (Math)       - Mostly 4-5, one 3 (good teacher)');
console.log('    Ms. Chen (English)     - Mixed 3-5 (solid but room to grow)');
console.log('    Dr. Martinez (Science) - Mostly 5s (top performer)');
console.log('    Mr. Kim (Humanities)   - Mostly 2-3 (needs improvement)');
console.log('    Ms. Karimova (Non-Eng) - Mostly 3-4 (decent, mid-range)');
console.log('    Prof. Taylor (Arts)    - Mostly 4-5 (well-loved)');
console.log('');

// Print classroom codes
const classrooms = db.prepare(`
  SELECT c.id, c.subject, c.grade_level, c.join_code, te.full_name as teacher, te.department,
    (SELECT COUNT(*) FROM classroom_members WHERE classroom_id = c.id) as student_count
  FROM classrooms c JOIN teachers te ON c.teacher_id = te.id
  ORDER BY c.id
`).all();

console.log('  Classroom Join Codes:');
classrooms.forEach(c => {
  console.log(`    ${c.join_code}  →  ${c.subject} (${c.grade_level}) - ${c.teacher} [${c.department}] [${c.student_count} students]`);
});

console.log('');
console.log('  Login Credentials:');
console.log('  ──────────────────────────────────────────');
console.log('  Admin:       admin@edurate.school.edu    / Admin@123');
console.log('  School Head: head@edurate.school.edu     / Head@123');
console.log('  Teacher 1:   smith@edurate.school.edu    / Teacher@123  (Math)');
console.log('  Teacher 2:   chen@edurate.school.edu     / Teacher@123  (English)');
console.log('  Teacher 3:   martinez@edurate.school.edu / Teacher@123  (Science)');
console.log('  Teacher 4:   kim@edurate.school.edu      / Teacher@123  (Humanities)');
console.log('  Teacher 5:   karimova@edurate.school.edu / Teacher@123  (Non-English)');
console.log('  Teacher 6:   taylor@edurate.school.edu   / Teacher@123  (Arts)');
console.log('  Student 1:   alice@edurate.school.edu    / Student@123');
console.log('  Student 2:   bob@edurate.school.edu      / Student@123');
console.log('  Student 3:   carol@edurate.school.edu    / Student@123');
console.log('  Student 4:   david@edurate.school.edu    / Student@123');
console.log('  ──────────────────────────────────────────\n');

process.exit(0);
