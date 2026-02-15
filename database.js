const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'edurate.db');
const db = new Database(DB_PATH);

// Enable WAL mode and foreign keys
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('student', 'teacher', 'school_head', 'admin')),
    grade_or_position TEXT,
    school_id INTEGER DEFAULT 1,
    verified_status INTEGER DEFAULT 0,
    suspended INTEGER DEFAULT 0,
    avatar_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    subject TEXT,
    department TEXT,
    experience_years INTEGER DEFAULT 0,
    bio TEXT,
    avatar_url TEXT,
    school_id INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS terms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    school_id INTEGER DEFAULT 1,
    active_status INTEGER DEFAULT 1,
    feedback_visible INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS feedback_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    term_id INTEGER NOT NULL,
    name TEXT NOT NULL CHECK(name IN ('Beginning', 'Mid-Term', 'End')),
    start_date DATE,
    end_date DATE,
    active_status INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS classrooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL,
    subject TEXT NOT NULL,
    grade_level TEXT NOT NULL,
    term_id INTEGER NOT NULL,
    join_code TEXT UNIQUE NOT NULL,
    active_status INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
    FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS classroom_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    classroom_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(classroom_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL,
    classroom_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    school_id INTEGER DEFAULT 1,
    term_id INTEGER NOT NULL,
    feedback_period_id INTEGER NOT NULL,
    overall_rating INTEGER NOT NULL CHECK(overall_rating BETWEEN 1 AND 5),
    clarity_rating INTEGER NOT NULL CHECK(clarity_rating BETWEEN 1 AND 5),
    engagement_rating INTEGER NOT NULL CHECK(engagement_rating BETWEEN 1 AND 5),
    fairness_rating INTEGER NOT NULL CHECK(fairness_rating BETWEEN 1 AND 5),
    supportiveness_rating INTEGER NOT NULL CHECK(supportiveness_rating BETWEEN 1 AND 5),
    feedback_text TEXT,
    tags TEXT DEFAULT '[]',
    flagged_status TEXT DEFAULT 'pending' CHECK(flagged_status IN ('pending', 'flagged', 'approved', 'rejected')),
    approved_status INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
    FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE,
    FOREIGN KEY (feedback_period_id) REFERENCES feedback_periods(id) ON DELETE CASCADE,
    UNIQUE(teacher_id, student_id, feedback_period_id)
  );

  CREATE TABLE IF NOT EXISTS teacher_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL,
    classroom_id INTEGER NOT NULL,
    feedback_period_id INTEGER NOT NULL,
    response_text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
    FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
    FOREIGN KEY (feedback_period_id) REFERENCES feedback_periods(id) ON DELETE CASCADE,
    UNIQUE(teacher_id, classroom_id, feedback_period_id)
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
  CREATE INDEX IF NOT EXISTS idx_classrooms_teacher ON classrooms(teacher_id);
  CREATE INDEX IF NOT EXISTS idx_classrooms_join_code ON classrooms(join_code);
  CREATE INDEX IF NOT EXISTS idx_classroom_members_student ON classroom_members(student_id);
  CREATE INDEX IF NOT EXISTS idx_classroom_members_classroom ON classroom_members(classroom_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_teacher ON reviews(teacher_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_student ON reviews(student_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_period ON reviews(feedback_period_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_classroom ON reviews(classroom_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(flagged_status);
  CREATE INDEX IF NOT EXISTS idx_feedback_periods_term ON feedback_periods(term_id);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    user_role TEXT NOT NULL,
    user_name TEXT NOT NULL,
    action_type TEXT NOT NULL,
    action_description TEXT NOT NULL,
    target_type TEXT,
    target_id INTEGER,
    metadata TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action_type);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);

  CREATE TABLE IF NOT EXISTS support_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    user_name TEXT NOT NULL,
    user_email TEXT NOT NULL,
    user_role TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('technical', 'account', 'question', 'feature', 'other')),
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'new' CHECK(status IN ('new', 'in_progress', 'resolved')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    resolved_by INTEGER,
    admin_notes TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_support_messages_user ON support_messages(user_id);
  CREATE INDEX IF NOT EXISTS idx_support_messages_status ON support_messages(status);
  CREATE INDEX IF NOT EXISTS idx_support_messages_created ON support_messages(created_at);
`);

// Migration: Add feedback_visible column to terms table if it doesn't exist
try {
  const columns = db.prepare("PRAGMA table_info(terms)").all();
  const hasFeedbackVisible = columns.some(col => col.name === 'feedback_visible');

  if (!hasFeedbackVisible) {
    db.exec('ALTER TABLE terms ADD COLUMN feedback_visible INTEGER DEFAULT 1');
    console.log('✅ Migration: Added feedback_visible column to terms table');
  }
} catch (err) {
  // Column might already exist, ignore error
}

// Migration: Add avatar_url column to users table if it doesn't exist
try {
  const userColumns = db.prepare("PRAGMA table_info(users)").all();
  const hasUserAvatar = userColumns.some(col => col.name === 'avatar_url');

  if (!hasUserAvatar) {
    db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT');
    console.log('✅ Migration: Added avatar_url column to users table');
  }
} catch (err) {
  // Column might already exist, ignore error
}

// Migration: Add avatar_url column to teachers table if it doesn't exist
try {
  const teacherColumns = db.prepare("PRAGMA table_info(teachers)").all();
  const hasTeacherAvatar = teacherColumns.some(col => col.name === 'avatar_url');

  if (!hasTeacherAvatar) {
    db.exec('ALTER TABLE teachers ADD COLUMN avatar_url TEXT');
    console.log('✅ Migration: Added avatar_url column to teachers table');
  }
} catch (err) {
  // Column might already exist, ignore error
}

module.exports = db;
