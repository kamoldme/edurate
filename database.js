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
    name TEXT NOT NULL CHECK(name IN ('1st Half', '2nd Half')),
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

  CREATE TABLE IF NOT EXISTS verification_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_verification_codes_email ON verification_codes(email);

  CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    logo_url TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    address TEXT,
    subscription_status TEXT DEFAULT 'active' CHECK(subscription_status IN ('active', 'suspended', 'trial')),
    max_teachers INTEGER DEFAULT 100,
    max_students INTEGER DEFAULT 2000,
    settings TEXT DEFAULT '{}',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
  CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(subscription_status);

  CREATE TABLE IF NOT EXISTS user_organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    org_id INTEGER NOT NULL,
    role_in_org TEXT NOT NULL CHECK(role_in_org IN ('org_admin', 'school_head', 'teacher', 'student')),
    is_primary INTEGER DEFAULT 1,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
    UNIQUE(user_id, org_id)
  );

  CREATE INDEX IF NOT EXISTS idx_user_orgs_user ON user_organizations(user_id);
  CREATE INDEX IF NOT EXISTS idx_user_orgs_org ON user_organizations(org_id);
  CREATE INDEX IF NOT EXISTS idx_user_orgs_role ON user_organizations(role_in_org);
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

// Migration: Add preparation_rating column to reviews table if it doesn't exist
try {
  const reviewColumns = db.prepare("PRAGMA table_info(reviews)").all();
  const hasPreparation = reviewColumns.some(col => col.name === 'preparation_rating');

  if (!hasPreparation) {
    db.exec('ALTER TABLE reviews ADD COLUMN preparation_rating INTEGER CHECK(preparation_rating BETWEEN 1 AND 5)');
    console.log('✅ Migration: Added preparation_rating column to reviews table');
  }
} catch (err) {
  // Column might already exist, ignore error
}

// Migration: Add workload_rating column to reviews table if it doesn't exist
try {
  const reviewColumns = db.prepare("PRAGMA table_info(reviews)").all();
  const hasWorkload = reviewColumns.some(col => col.name === 'workload_rating');

  if (!hasWorkload) {
    db.exec('ALTER TABLE reviews ADD COLUMN workload_rating INTEGER CHECK(workload_rating BETWEEN 1 AND 5)');
    console.log('✅ Migration: Added workload_rating column to reviews table');
  }
} catch (err) {
  // Column might already exist, ignore error
}

// Migration: Add language column to users table if it doesn't exist
try {
  const userCols = db.prepare("PRAGMA table_info(users)").all();
  if (!userCols.some(col => col.name === 'language')) {
    db.exec("ALTER TABLE users ADD COLUMN language TEXT DEFAULT 'en'");
    console.log('✅ Migration: Added language column to users table');
  }
} catch (err) {
  // Column might already exist, ignore error
}

// Migration: Multi-tenancy - Add org_id columns and migrate roles
try {
  const userCols2 = db.prepare("PRAGMA table_info(users)").all();
  const hasOrgId = userCols2.some(col => col.name === 'org_id');

  if (!hasOrgId) {
    // Step 1: Seed default organization
    const orgExists = db.prepare("SELECT COUNT(*) as count FROM organizations").get();
    if (orgExists.count === 0) {
      db.prepare("INSERT INTO organizations (id, name, slug, contact_email) VALUES (1, 'Default School', 'default-school', 'admin@edurate.school.edu')").run();
      console.log('✅ Migration: Created default organization');
    }

    // Step 2: Recreate users table with new role CHECK and org_id column
    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN TRANSACTION;

      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('student', 'teacher', 'school_head', 'org_admin', 'super_admin')),
        grade_or_position TEXT,
        school_id INTEGER DEFAULT 1,
        org_id INTEGER REFERENCES organizations(id),
        verified_status INTEGER DEFAULT 0,
        suspended INTEGER DEFAULT 0,
        avatar_url TEXT,
        language TEXT DEFAULT 'en',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users_new (id, full_name, email, password, role, grade_or_position, school_id, org_id, verified_status, suspended, avatar_url, language, created_at)
        SELECT id, full_name, email, password,
          CASE WHEN role = 'admin' THEN 'super_admin' ELSE role END,
          grade_or_position, school_id,
          CASE WHEN role = 'admin' THEN NULL ELSE school_id END,
          verified_status, suspended, avatar_url, language, created_at
        FROM users;

      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
      CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

      COMMIT;
    `);
    db.pragma('foreign_keys = ON');
    console.log('✅ Migration: Recreated users table with new roles and org_id');

    // Step 3: Add org_id to teachers
    db.exec('ALTER TABLE teachers ADD COLUMN org_id INTEGER REFERENCES organizations(id)');
    db.exec('UPDATE teachers SET org_id = school_id');
    db.exec('CREATE INDEX IF NOT EXISTS idx_teachers_org ON teachers(org_id)');
    console.log('✅ Migration: Added org_id to teachers table');

    // Step 4: Add org_id to terms
    db.exec('ALTER TABLE terms ADD COLUMN org_id INTEGER REFERENCES organizations(id)');
    db.exec('UPDATE terms SET org_id = school_id');
    db.exec('CREATE INDEX IF NOT EXISTS idx_terms_org ON terms(org_id)');
    console.log('✅ Migration: Added org_id to terms table');

    // Step 5: Add org_id to classrooms
    db.exec('ALTER TABLE classrooms ADD COLUMN org_id INTEGER REFERENCES organizations(id)');
    db.exec('UPDATE classrooms SET org_id = (SELECT t.org_id FROM teachers t WHERE t.id = classrooms.teacher_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_classrooms_org ON classrooms(org_id)');
    console.log('✅ Migration: Added org_id to classrooms table');

    // Step 6: Add org_id to reviews
    db.exec('ALTER TABLE reviews ADD COLUMN org_id INTEGER REFERENCES organizations(id)');
    db.exec('UPDATE reviews SET org_id = school_id');
    db.exec('CREATE INDEX IF NOT EXISTS idx_reviews_org ON reviews(org_id)');
    console.log('✅ Migration: Added org_id to reviews table');

    // Step 7: Add org_id to audit_logs
    db.exec('ALTER TABLE audit_logs ADD COLUMN org_id INTEGER');
    db.exec('CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON audit_logs(org_id)');
    console.log('✅ Migration: Added org_id to audit_logs table');

    // Step 8: Add org_id to support_messages
    db.exec('ALTER TABLE support_messages ADD COLUMN org_id INTEGER');
    db.exec('CREATE INDEX IF NOT EXISTS idx_support_messages_org ON support_messages(org_id)');
    console.log('✅ Migration: Added org_id to support_messages table');

    // Step 9: Populate user_organizations for existing users
    const existingUsers = db.prepare("SELECT id, role, org_id FROM users WHERE org_id IS NOT NULL").all();
    const insertUserOrg = db.prepare("INSERT OR IGNORE INTO user_organizations (user_id, org_id, role_in_org, is_primary) VALUES (?, ?, ?, 1)");
    for (const u of existingUsers) {
      const roleInOrg = u.role === 'super_admin' ? 'org_admin' : u.role;
      if (['org_admin', 'school_head', 'teacher', 'student'].includes(roleInOrg)) {
        insertUserOrg.run(u.id, u.org_id, roleInOrg);
      }
    }
    console.log('✅ Migration: Populated user_organizations junction table');
  }
} catch (err) {
  console.error('Migration error (multi-tenancy):', err.message);
}

module.exports = db;
