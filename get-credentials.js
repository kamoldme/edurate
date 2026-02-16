const db = require('./database');

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('                    EDURATE LOGIN CREDENTIALS');
console.log('═══════════════════════════════════════════════════════════════\n');

// Get all users grouped by role
const roles = ['admin', 'school_head', 'teacher', 'student'];

roles.forEach(role => {
  const users = db.prepare(`
    SELECT u.id, u.full_name, u.email, u.role, u.grade_or_position
    FROM users u
    WHERE u.role = ?
    ORDER BY u.full_name
  `).all(role);

  if (users.length > 0) {
    console.log(`\n${role.toUpperCase().replace('_', ' ')}S (${users.length})`);
    console.log('─────────────────────────────────────────────────────────────────');

    users.forEach((user, idx) => {
      const password = role === 'student' ? 'Student@123' :
                      role === 'teacher' ? 'Teacher@123' :
                      role === 'school_head' ? 'SchoolHead@123' :
                      'Admin@123';

      console.log(`${idx + 1}. ${user.full_name}`);
      console.log(`   Email:    ${user.email}`);
      console.log(`   Password: ${password}`);
      if (user.grade_or_position) {
        console.log(`   ${role === 'student' ? 'Grade' : 'Position'}:    ${user.grade_or_position}`);
      }
      console.log('');
    });
  }
});

console.log('═══════════════════════════════════════════════════════════════');
console.log('NOTE: All passwords follow the format: [Role]@123');
console.log('      Example: Student@123, Teacher@123, Admin@123');
console.log('═══════════════════════════════════════════════════════════════\n');

// Get teacher details with departments
console.log('\nTEACHERS BY DEPARTMENT');
console.log('─────────────────────────────────────────────────────────────────');

const departments = db.prepare(`
  SELECT DISTINCT department FROM teachers ORDER BY department
`).all();

departments.forEach(dept => {
  const teachers = db.prepare(`
    SELECT t.full_name, t.subject, u.email
    FROM teachers t
    JOIN users u ON t.user_id = u.id
    WHERE t.department = ?
    ORDER BY t.full_name
  `).all(dept.department);

  console.log(`\n${dept.department.toUpperCase()}:`);
  teachers.forEach((t, idx) => {
    console.log(`  ${idx + 1}. ${t.full_name} - ${t.subject} (${t.email})`);
  });
});

console.log('\n');
