const bcrypt = require('bcryptjs');
const db = require('./database');

console.log('Seeding EduRate database with multi-organization data...\n');

// Clear existing data
db.exec(`
  DELETE FROM teacher_responses;
  DELETE FROM reviews;
  DELETE FROM classroom_members;
  DELETE FROM classrooms;
  DELETE FROM feedback_periods;
  DELETE FROM terms;
  DELETE FROM teachers;
  DELETE FROM user_organizations;
  DELETE FROM users;
  DELETE FROM organizations;
`);

const hash = (pw) => bcrypt.hashSync(pw, 12);

// ============ ORGANIZATIONS ============
const insertOrg = db.prepare(`
  INSERT INTO organizations (id, name, slug, contact_email, contact_phone, address, subscription_status, max_teachers, max_students)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

insertOrg.run(1, 'Lincoln High School', 'lincoln-high', 'admin@lincoln.edu', '+1-555-0100', '123 Main St, Springfield, IL 62701', 'active', 50, 1000);
insertOrg.run(2, 'Roosevelt Academy', 'roosevelt-academy', 'admin@roosevelt.edu', '+1-555-0200', '456 Oak Ave, Riverside, CA 92501', 'active', 40, 800);

console.log('Organizations created: Lincoln High School (org_id=1), Roosevelt Academy (org_id=2)');

// ============ USERS ============
const insertUser = db.prepare(`
  INSERT INTO users (full_name, email, password, role, grade_or_position, school_id, org_id, verified_status)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1)
`);

// Super Admin (global, sees everything)
const superAdminId = insertUser.run('Sarah Williams', 'superadmin@edurate.com', hash('SuperAdmin@123'), 'super_admin', 'System Administrator', 1, null).lastInsertRowid;

// Org Admins (one per organization)
const org1AdminId = insertUser.run('Michael Roberts', 'admin@lincoln.edu', hash('OrgAdmin@123'), 'org_admin', 'Administrator', 1, 1).lastInsertRowid;
const org2AdminId = insertUser.run('Jennifer Martinez', 'admin@roosevelt.edu', hash('OrgAdmin@123'), 'org_admin', 'Administrator', 1, 2).lastInsertRowid;

// School Heads (one per organization)
const org1HeadId = insertUser.run('Dr. Robert Johnson', 'head@lincoln.edu', hash('Head@123'), 'school_head', 'School Head', 1, 1).lastInsertRowid;
const org2HeadId = insertUser.run('Dr. Lisa Chen', 'head@roosevelt.edu', hash('Head@123'), 'school_head', 'School Head', 1, 2).lastInsertRowid;

// ORG 1 (Lincoln High School) - Teachers
const t1UserId = insertUser.run('Mr. James Smith', 'smith@lincoln.edu', hash('Teacher@123'), 'teacher', 'Math Teacher', 1, 1).lastInsertRowid;
const t2UserId = insertUser.run('Ms. Emily Anderson', 'anderson@lincoln.edu', hash('Teacher@123'), 'teacher', 'English Teacher', 1, 1).lastInsertRowid;
const t3UserId = insertUser.run('Dr. Sarah Martinez', 'martinez@lincoln.edu', hash('Teacher@123'), 'teacher', 'Science Teacher', 1, 1).lastInsertRowid;
const t4UserId = insertUser.run('Mr. David Kim', 'kim@lincoln.edu', hash('Teacher@123'), 'teacher', 'History Teacher', 1, 1).lastInsertRowid;

// ORG 2 (Roosevelt Academy) - Teachers
const t5UserId = insertUser.run('Ms. Aisha Karimova', 'karimova@roosevelt.edu', hash('Teacher@123'), 'teacher', 'Russian Teacher', 1, 2).lastInsertRowid;
const t6UserId = insertUser.run('Prof. Robert Taylor', 'taylor@roosevelt.edu', hash('Teacher@123'), 'teacher', 'Arts Teacher', 1, 2).lastInsertRowid;
const t7UserId = insertUser.run('Ms. Patricia Wilson', 'wilson@roosevelt.edu', hash('Teacher@123'), 'teacher', 'Math Teacher', 1, 2).lastInsertRowid;
const t8UserId = insertUser.run('Mr. Carlos Garcia', 'garcia@roosevelt.edu', hash('Teacher@123'), 'teacher', 'Science Teacher', 1, 2).lastInsertRowid;

// Students (global users, org_id=NULL - they join orgs via classrooms)
const aliceId = insertUser.run('Alice Johnson', 'alice@student.edu', hash('Student@123'), 'student', 'Grade 10', 1, null).lastInsertRowid;
const bobId = insertUser.run('Bob Williams', 'bob@student.edu', hash('Student@123'), 'student', 'Grade 10', 1, null).lastInsertRowid;
const carolId = insertUser.run('Carol Davis', 'carol@student.edu', hash('Student@123'), 'student', 'Grade 10', 1, null).lastInsertRowid;
const davidId = insertUser.run('David Brown', 'david@student.edu', hash('Student@123'), 'student', 'Grade 11', 1, null).lastInsertRowid;
const eveId = insertUser.run('Eve Thompson', 'eve@student.edu', hash('Student@123'), 'student', 'Grade 10', 1, null).lastInsertRowid;
const frankId = insertUser.run('Frank Miller', 'frank@student.edu', hash('Student@123'), 'student', 'Grade 11', 1, null).lastInsertRowid;

console.log('Users created:');
console.log('  - 1 super_admin (global)');
console.log('  - 2 org_admins (1 per organization)');
console.log('  - 2 school_heads (1 per organization)');
console.log('  - 8 teachers (4 at Lincoln, 4 at Roosevelt)');
console.log('  - 6 students (global users)');

// ============ USER-ORGANIZATION RELATIONSHIPS ============
const insertUserOrg = db.prepare(`
  INSERT INTO user_organizations (user_id, org_id, role_in_org, is_primary)
  VALUES (?, ?, ?, ?)
`);

// Org admins
insertUserOrg.run(org1AdminId, 1, 'org_admin', 1);
insertUserOrg.run(org2AdminId, 2, 'org_admin', 1);

// School heads
insertUserOrg.run(org1HeadId, 1, 'school_head', 1);
insertUserOrg.run(org2HeadId, 2, 'school_head', 1);

// Teachers - Org 1
insertUserOrg.run(t1UserId, 1, 'teacher', 1);
insertUserOrg.run(t2UserId, 1, 'teacher', 1);
insertUserOrg.run(t3UserId, 1, 'teacher', 1);
insertUserOrg.run(t4UserId, 1, 'teacher', 1);

// Teachers - Org 2
insertUserOrg.run(t5UserId, 2, 'teacher', 1);
insertUserOrg.run(t6UserId, 2, 'teacher', 1);
insertUserOrg.run(t7UserId, 2, 'teacher', 1);
insertUserOrg.run(t8UserId, 2, 'teacher', 1);

// Students will be added to user_organizations when they join classrooms

console.log('User-organization relationships established');

// ============ TEACHERS ============
const insertTeacher = db.prepare(`
  INSERT INTO teachers (user_id, full_name, subject, department, experience_years, bio, school_id, org_id)
  VALUES (?, ?, ?, ?, ?, ?, 1, ?)
`);

// ORG 1 (Lincoln High School) Teachers
const t1Id = insertTeacher.run(t1UserId, 'Mr. James Smith', 'Algebra', 'Math', 8,
  'Dedicated mathematics educator with 8 years of experience. Passionate about making math accessible and enjoyable for all students.', 1
).lastInsertRowid;

const t2Id = insertTeacher.run(t2UserId, 'Ms. Emily Anderson', 'English Literature', 'English', 5,
  'English literature teacher focused on developing critical thinking and creative writing skills. Believes every student has a unique voice.', 1
).lastInsertRowid;

const t3Id = insertTeacher.run(t3UserId, 'Dr. Sarah Martinez', 'Biology', 'Science', 10,
  'Experienced science educator dedicated to hands-on learning and nurturing curiosity in young minds.', 1
).lastInsertRowid;

const t4Id = insertTeacher.run(t4UserId, 'Mr. David Kim', 'World History', 'Humanities', 6,
  'History teacher who brings the past to life through storytelling and interactive discussions. Focuses on connecting historical events to modern issues.', 1
).lastInsertRowid;

// ORG 2 (Roosevelt Academy) Teachers
const t5Id = insertTeacher.run(t5UserId, 'Ms. Aisha Karimova', 'Russian Language', 'Non-English', 4,
  'Native Russian speaker with a passion for teaching language and culture. Uses immersive methods to help students think in Russian.', 2
).lastInsertRowid;

const t6Id = insertTeacher.run(t6UserId, 'Prof. Robert Taylor', 'Visual Arts', 'Arts', 12,
  'Award-winning artist and educator. Encourages students to express themselves through various art forms and develop their creative vision.', 2
).lastInsertRowid;

const t7Id = insertTeacher.run(t7UserId, 'Ms. Patricia Wilson', 'Geometry', 'Math', 7,
  'Geometry specialist who uses visual and hands-on methods to help students understand spatial relationships and proofs.', 2
).lastInsertRowid;

const t8Id = insertTeacher.run(t8UserId, 'Mr. Carlos Garcia', 'Chemistry', 'Science', 9,
  'Chemistry teacher passionate about laboratory experiments and real-world applications of chemical concepts.', 2
).lastInsertRowid;

console.log('Teachers created (4 at Lincoln, 4 at Roosevelt across 6 departments)');

// ============ TERMS ============
const insertTerm = db.prepare(
  'INSERT INTO terms (name, start_date, end_date, school_id, org_id, active_status) VALUES (?, ?, ?, 1, ?, ?)'
);

// Org 1 (Lincoln) - active term
const term1Org1Id = insertTerm.run('Fall 2025', '2025-09-01', '2025-12-20', 1, 1).lastInsertRowid;

// Org 2 (Roosevelt) - active term
const term1Org2Id = insertTerm.run('Autumn 2025', '2025-09-01', '2025-12-20', 2, 1).lastInsertRowid;

console.log('Terms created (1 active term per organization)');

// ============ FEEDBACK PERIODS ============
const insertPeriod = db.prepare(
  'INSERT INTO feedback_periods (term_id, name, start_date, end_date, active_status) VALUES (?, ?, ?, ?, ?)'
);

// Org 1 (Lincoln) periods
const period1Org1Id = insertPeriod.run(term1Org1Id, '1st Half', '2025-09-15', '2025-10-31', 1).lastInsertRowid;
const period2Org1Id = insertPeriod.run(term1Org1Id, '2nd Half', '2025-11-01', '2025-12-15', 0).lastInsertRowid;

// Org 2 (Roosevelt) periods
const period1Org2Id = insertPeriod.run(term1Org2Id, '1st Half', '2025-09-15', '2025-10-31', 1).lastInsertRowid;
const period2Org2Id = insertPeriod.run(term1Org2Id, '2nd Half', '2025-11-01', '2025-12-15', 0).lastInsertRowid;

console.log('Feedback periods created (2 per organization, first period ACTIVE)');

// ============ CLASSROOMS ============
function genCode() { return String(Math.floor(10000000 + Math.random() * 90000000)); }

const insertClassroom = db.prepare(
  'INSERT INTO classrooms (teacher_id, subject, grade_level, term_id, join_code, org_id, active_status) VALUES (?, ?, ?, ?, ?, ?, 1)'
);

// ORG 1 (Lincoln) - 4 classrooms
const c1Id = insertClassroom.run(t1Id, 'Algebra - Group 1', 'Grade 10', term1Org1Id, genCode(), 1).lastInsertRowid;
const c2Id = insertClassroom.run(t2Id, 'English Literature - Group 1', 'Grade 10', term1Org1Id, genCode(), 1).lastInsertRowid;
const c3Id = insertClassroom.run(t3Id, 'Biology - Group 1', 'Grade 10', term1Org1Id, genCode(), 1).lastInsertRowid;
const c4Id = insertClassroom.run(t4Id, 'World History - Group 1', 'Grade 10', term1Org1Id, genCode(), 1).lastInsertRowid;

// ORG 2 (Roosevelt) - 4 classrooms
const c5Id = insertClassroom.run(t5Id, 'Russian Language - Group 1', 'Grade 10', term1Org2Id, genCode(), 2).lastInsertRowid;
const c6Id = insertClassroom.run(t6Id, 'Visual Arts - Group 1', 'Grade 10', term1Org2Id, genCode(), 2).lastInsertRowid;
const c7Id = insertClassroom.run(t7Id, 'Geometry - Group 1', 'Grade 11', term1Org2Id, genCode(), 2).lastInsertRowid;
const c8Id = insertClassroom.run(t8Id, 'Chemistry - Group 1', 'Grade 11', term1Org2Id, genCode(), 2).lastInsertRowid;

console.log('Classrooms created (4 at Lincoln, 4 at Roosevelt)');

// ============ CLASSROOM MEMBERS ============
const insertMember = db.prepare(
  'INSERT INTO classroom_members (classroom_id, student_id) VALUES (?, ?)'
);

// Students at ORG 1 (Lincoln) - Alice, Bob, Carol
// Alice: Algebra, English, Biology, History (4 classes at Lincoln)
insertMember.run(c1Id, aliceId);
insertMember.run(c2Id, aliceId);
insertMember.run(c3Id, aliceId);
insertMember.run(c4Id, aliceId);

// Bob: Algebra, English, Biology (3 classes at Lincoln)
insertMember.run(c1Id, bobId);
insertMember.run(c2Id, bobId);
insertMember.run(c3Id, bobId);

// Carol: Algebra, English, History (3 classes at Lincoln)
insertMember.run(c1Id, carolId);
insertMember.run(c2Id, carolId);
insertMember.run(c4Id, carolId);

// Students at ORG 2 (Roosevelt) - David, Eve, Frank
// David: Russian, Arts, Geometry (3 classes at Roosevelt)
insertMember.run(c5Id, davidId);
insertMember.run(c6Id, davidId);
insertMember.run(c7Id, davidId);

// Eve: Russian, Arts, Chemistry (3 classes at Roosevelt)
insertMember.run(c5Id, eveId);
insertMember.run(c6Id, eveId);
insertMember.run(c8Id, eveId);

// Frank: Arts, Geometry, Chemistry (3 classes at Roosevelt)
insertMember.run(c6Id, frankId);
insertMember.run(c7Id, frankId);
insertMember.run(c8Id, frankId);

// Multi-org student: Alice also joins one class at Roosevelt (to test multi-org membership)
insertMember.run(c6Id, aliceId);

console.log('Students enrolled:');
console.log('  - Lincoln: Alice (4 classes), Bob (3), Carol (3)');
console.log('  - Roosevelt: David (3), Eve (3), Frank (3)');
console.log('  - Multi-org: Alice (in both Lincoln and Roosevelt)');

// Now auto-populate user_organizations for students based on their classroom memberships
// This simulates what happens when students join via the /join endpoint

// Alice - in both orgs
insertUserOrg.run(aliceId, 1, 'student', 1); // Lincoln (primary)
insertUserOrg.run(aliceId, 2, 'student', 0); // Roosevelt (secondary)

// Bob, Carol - org 1 only
insertUserOrg.run(bobId, 1, 'student', 1);
insertUserOrg.run(carolId, 1, 'student', 1);

// David, Eve, Frank - org 2 only
insertUserOrg.run(davidId, 2, 'student', 1);
insertUserOrg.run(eveId, 2, 'student', 1);
insertUserOrg.run(frankId, 2, 'student', 1);

console.log('Student-organization associations created');

// ============ SAMPLE REVIEWS ============
const insertReview = db.prepare(`
  INSERT INTO reviews (
    teacher_id, classroom_id, student_id, school_id, org_id, term_id, feedback_period_id,
    overall_rating, clarity_rating, engagement_rating, fairness_rating, supportiveness_rating,
    preparation_rating, workload_rating,
    feedback_text, tags, flagged_status, approved_status
  ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// --- ORG 1 (Lincoln) Reviews ---

// Mr. Smith / Algebra - highly rated
insertReview.run(t1Id, c1Id, aliceId, 1, term1Org1Id, period1Org1Id,
  5, 5, 5, 5, 4, 5, 4,
  'Mr. Smith explains concepts very clearly and always makes sure everyone understands before moving on. His examples are really helpful.',
  JSON.stringify(['Clear explanations', 'Good examples', 'Supportive']),
  'approved', 1
);

insertReview.run(t1Id, c1Id, bobId, 1, term1Org1Id, period1Org1Id,
  4, 4, 4, 5, 5, 4, 3,
  'Great teacher who cares about students. Sometimes goes a bit fast but always willing to help after class.',
  JSON.stringify(['Supportive', 'Encourages participation']),
  'approved', 1
);

insertReview.run(t1Id, c1Id, carolId, 1, term1Org1Id, period1Org1Id,
  4, 5, 4, 4, 4, 5, 4,
  'Well-prepared lessons every day. I like how he connects math to everyday life.',
  JSON.stringify(['Well-prepared', 'Clear explanations']),
  'approved', 1
);

// Ms. Anderson / English - mixed ratings
insertReview.run(t2Id, c2Id, aliceId, 1, term1Org1Id, period1Org1Id,
  5, 4, 5, 5, 5, 4, 4,
  'Ms. Anderson makes literature come alive! Her class discussions are always engaging and thought-provoking.',
  JSON.stringify(['Engaging lessons', 'Encourages participation']),
  'approved', 1
);

insertReview.run(t2Id, c2Id, bobId, 1, term1Org1Id, period1Org1Id,
  3, 3, 4, 3, 3, 3, 3,
  'Class is okay. The readings are interesting but sometimes the essay assignments are unclear.',
  JSON.stringify(['Needs clearer explanations']),
  'approved', 1
);

// Dr. Martinez / Biology - top performer
insertReview.run(t3Id, c3Id, aliceId, 1, term1Org1Id, period1Org1Id,
  5, 5, 5, 5, 5, 5, 4,
  'Dr. Martinez is the best science teacher I\'ve ever had! The lab experiments are well-organized.',
  JSON.stringify(['Well-prepared', 'Engaging lessons', 'Clear explanations']),
  'approved', 1
);

insertReview.run(t3Id, c3Id, bobId, 1, term1Org1Id, period1Org1Id,
  5, 5, 5, 4, 5, 5, 4,
  'Amazing class. The hands-on experiments make biology easy to understand.',
  JSON.stringify(['Engaging lessons', 'Good examples']),
  'approved', 1
);

// Mr. Kim / History - needs improvement
insertReview.run(t4Id, c4Id, aliceId, 1, term1Org1Id, period1Org1Id,
  2, 2, 2, 3, 3, 2, 2,
  'The material could be interesting but the lessons are mostly reading from slides. Not much class discussion.',
  JSON.stringify(['Needs clearer explanations', 'More interactive']),
  'approved', 1
);

insertReview.run(t4Id, c4Id, carolId, 1, term1Org1Id, period1Org1Id,
  3, 3, 2, 4, 3, 3, 3,
  'Mr. Kim is fair with grading and knows his subject, but the classes need more variety.',
  JSON.stringify(['Fair grading', 'More interactive']),
  'approved', 1
);

// --- ORG 2 (Roosevelt) Reviews ---

// Ms. Karimova / Russian - mid-range
insertReview.run(t5Id, c5Id, davidId, 2, term1Org2Id, period1Org2Id,
  4, 4, 4, 3, 4, 4, 3,
  'Ms. Karimova speaks mostly in Russian which is great for immersion. Good teacher overall.',
  JSON.stringify(['Engaging lessons', 'Challenging but good']),
  'approved', 1
);

insertReview.run(t5Id, c5Id, eveId, 2, term1Org2Id, period1Org2Id,
  4, 3, 4, 4, 4, 4, 3,
  'I\'m learning a lot! The conversational practice is helpful. Fun cultural activities.',
  JSON.stringify(['Engaging lessons', 'Supportive']),
  'approved', 1
);

// Prof. Taylor / Arts - well-loved
insertReview.run(t6Id, c6Id, aliceId, 2, term1Org2Id, period1Org2Id,
  5, 4, 5, 5, 5, 5, 5,
  'Prof. Taylor\'s class is the highlight of my week! He gives us creative freedom while teaching technique.',
  JSON.stringify(['Engaging lessons', 'Supportive', 'Well-prepared']),
  'approved', 1
);

insertReview.run(t6Id, c6Id, davidId, 2, term1Org2Id, period1Org2Id,
  4, 4, 5, 4, 5, 4, 5,
  'Fun class with a great atmosphere. Prof. Taylor respects everyone\'s artistic style.',
  JSON.stringify(['Engaging lessons', 'Supportive']),
  'approved', 1
);

insertReview.run(t6Id, c6Id, eveId, 2, term1Org2Id, period1Org2Id,
  5, 5, 5, 5, 5, 5, 4,
  'Best class ever! Prof. Taylor helped me find my style. The gallery project was amazing.',
  JSON.stringify(['Clear explanations', 'Supportive', 'Well-prepared']),
  'approved', 1
);

// Ms. Wilson / Geometry - solid
insertReview.run(t7Id, c7Id, davidId, 2, term1Org2Id, period1Org2Id,
  4, 4, 4, 4, 4, 4, 3,
  'Ms. Wilson uses great visual aids. Geometry makes more sense now. Clear explanations.',
  JSON.stringify(['Clear explanations', 'Good examples']),
  'approved', 1
);

insertReview.run(t7Id, c7Id, frankId, 2, term1Org2Id, period1Org2Id,
  4, 5, 3, 4, 4, 5, 4,
  'Well-prepared lessons with lots of practice problems. Sometimes moves a bit slow though.',
  JSON.stringify(['Well-prepared', 'Clear explanations']),
  'approved', 1
);

// Mr. Garcia / Chemistry - good
insertReview.run(t8Id, c8Id, eveId, 2, term1Org2Id, period1Org2Id,
  4, 4, 4, 4, 4, 4, 3,
  'Mr. Garcia makes chemistry fun with lots of experiments. Lab work is excellent.',
  JSON.stringify(['Engaging lessons', 'Good examples']),
  'approved', 1
);

insertReview.run(t8Id, c8Id, frankId, 2, term1Org2Id, period1Org2Id,
  5, 5, 5, 4, 5, 5, 4,
  'Amazing teacher! Chemistry was always scary but Mr. Garcia makes it approachable and interesting.',
  JSON.stringify(['Clear explanations', 'Engaging lessons', 'Supportive']),
  'approved', 1
);

console.log('Sample reviews created (18 reviews across both organizations)');

// Print summary
console.log('\n═══════════════════════════════════════════════════');
console.log('  MULTI-ORGANIZATION SEED COMPLETE');
console.log('═══════════════════════════════════════════════════');
console.log('');
console.log('  Organizations: 2');
console.log('    - Lincoln High School (org_id=1)');
console.log('    - Roosevelt Academy (org_id=2)');
console.log('');
console.log('  Users: 17 total');
console.log('    - 1 super_admin (global, can see all orgs)');
console.log('    - 2 org_admins (1 per org)');
console.log('    - 2 school_heads (1 per org)');
console.log('    - 8 teachers (4 per org)');
console.log('    - 6 students (global users, 1 enrolled in both orgs)');
console.log('');
console.log('  Terms: 2 (1 active per organization)');
console.log('  Feedback Periods: 4 (1 active per organization)');
console.log('  Classrooms: 8 (4 per organization)');
console.log('  Reviews: 18 (9 per organization)');
console.log('');

// Print classroom codes by organization
console.log('  LINCOLN HIGH SCHOOL - Classroom Join Codes:');
console.log('  ────────────────────────────────────────────────');
const org1Classrooms = db.prepare(`
  SELECT c.id, c.subject, c.grade_level, c.join_code, te.full_name as teacher,
    (SELECT COUNT(*) FROM classroom_members WHERE classroom_id = c.id) as student_count
  FROM classrooms c
  JOIN teachers te ON c.teacher_id = te.id
  WHERE c.org_id = 1
  ORDER BY c.id
`).all();

org1Classrooms.forEach(c => {
  console.log(`    ${c.join_code}  →  ${c.subject} (${c.grade_level}) - ${c.teacher} [${c.student_count} students]`);
});

console.log('');
console.log('  ROOSEVELT ACADEMY - Classroom Join Codes:');
console.log('  ────────────────────────────────────────────────');
const org2Classrooms = db.prepare(`
  SELECT c.id, c.subject, c.grade_level, c.join_code, te.full_name as teacher,
    (SELECT COUNT(*) FROM classroom_members WHERE classroom_id = c.id) as student_count
  FROM classrooms c
  JOIN teachers te ON c.teacher_id = te.id
  WHERE c.org_id = 2
  ORDER BY c.id
`).all();

org2Classrooms.forEach(c => {
  console.log(`    ${c.join_code}  →  ${c.subject} (${c.grade_level}) - ${c.teacher} [${c.student_count} students]`);
});

console.log('');
console.log('  Login Credentials:');
console.log('  ──────────────────────────────────────────────────');
console.log('  GLOBAL:');
console.log('    Super Admin: superadmin@edurate.com / SuperAdmin@123');
console.log('');
console.log('  LINCOLN HIGH SCHOOL (org_id=1):');
console.log('    Org Admin:   admin@lincoln.edu     / OrgAdmin@123');
console.log('    School Head: head@lincoln.edu      / Head@123');
console.log('    Teacher 1:   smith@lincoln.edu     / Teacher@123  (Math)');
console.log('    Teacher 2:   anderson@lincoln.edu  / Teacher@123  (English)');
console.log('    Teacher 3:   martinez@lincoln.edu  / Teacher@123  (Science)');
console.log('    Teacher 4:   kim@lincoln.edu       / Teacher@123  (Humanities)');
console.log('    Students:    alice@student.edu     / Student@123  (also in Roosevelt)');
console.log('                 bob@student.edu       / Student@123');
console.log('                 carol@student.edu     / Student@123');
console.log('');
console.log('  ROOSEVELT ACADEMY (org_id=2):');
console.log('    Org Admin:   admin@roosevelt.edu   / OrgAdmin@123');
console.log('    School Head: head@roosevelt.edu    / Head@123');
console.log('    Teacher 1:   karimova@roosevelt.edu / Teacher@123  (Russian)');
console.log('    Teacher 2:   taylor@roosevelt.edu   / Teacher@123  (Arts)');
console.log('    Teacher 3:   wilson@roosevelt.edu   / Teacher@123  (Math)');
console.log('    Teacher 4:   garcia@roosevelt.edu   / Teacher@123  (Science)');
console.log('    Students:    david@student.edu      / Student@123');
console.log('                 eve@student.edu        / Student@123');
console.log('                 frank@student.edu      / Student@123');
console.log('  ──────────────────────────────────────────────────');
console.log('');
console.log('  Test Scenarios:');
console.log('    1. Login as super_admin → see all orgs, switch between them');
console.log('    2. Login as org_admin@lincoln.edu → only see Lincoln data');
console.log('    3. Login as org_admin@roosevelt.edu → only see Roosevelt data');
console.log('    4. Login as alice@student.edu → see classrooms from BOTH orgs');
console.log('    5. Create new classroom via teacher → auto-assigns org_id');
console.log('    6. Student joins classroom → auto-added to user_organizations');
console.log('  ──────────────────────────────────────────────────\n');

process.exit(0);
