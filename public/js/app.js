// ============ API HELPER ============
const API = {
  token: localStorage.getItem('edurate_token'),
  async request(path, options = {}) {
    const res = await fetch('/api' + path, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + this.token,
        ...options.headers
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) { logout(); return; }
      throw new Error(data.error || 'Request failed');
    }
    return data;
  },
  get(path) { return this.request(path); },
  post(path, body) { return this.request(path, { method: 'POST', body }); },
  put(path, body) { return this.request(path, { method: 'PUT', body }); },
  delete(path) { return this.request(path, { method: 'DELETE' }); }
};

// ============ STATE ============
let currentUser = null;
let teacherInfo = null;
let currentView = '';
let chartInstances = {};

// ============ INIT ============
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const data = await API.get('/auth/me');
    currentUser = data.user;
    teacherInfo = data.teacher;
    setupUI();
    navigateTo(getDefaultView());
  } catch {
    logout();
  }
});

function getDefaultView() {
  const r = currentUser.role;
  if (r === 'student') return 'student-home';
  if (r === 'teacher') return 'teacher-home';
  if (r === 'school_head') return 'head-home';
  if (r === 'admin') return 'admin-home';
  return 'student-home';
}

// ============ UI SETUP ============
function setupUI() {
  const u = currentUser;
  document.getElementById('roleBadge').textContent = u.role.replace('_', ' ');
  document.getElementById('userName').textContent = u.full_name;
  document.getElementById('userEmail').textContent = u.email;
  document.getElementById('userAvatar').textContent = u.full_name.split(' ').map(n => n[0]).join('');
  buildNavigation();
}

const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  classroom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
  review: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>'
};

function buildNavigation() {
  const nav = document.getElementById('sidebarNav');
  const role = currentUser.role;
  let items = [];

  if (role === 'student') {
    items = [
      { id: 'student-home', label: 'Dashboard', icon: 'home' },
      { id: 'student-classrooms', label: 'My Classrooms', icon: 'classroom' },
      { id: 'student-review', label: 'Write Review', icon: 'review' },
      { id: 'student-my-reviews', label: 'My Reviews', icon: 'chart' }
    ];
  } else if (role === 'teacher') {
    items = [
      { id: 'teacher-home', label: 'Dashboard', icon: 'home' },
      { id: 'teacher-classrooms', label: 'My Classrooms', icon: 'classroom' },
      { id: 'teacher-feedback', label: 'Feedback', icon: 'review' },
      { id: 'teacher-analytics', label: 'Analytics', icon: 'chart' }
    ];
  } else if (role === 'school_head') {
    items = [
      { id: 'head-home', label: 'Dashboard', icon: 'home' },
      { id: 'head-teachers', label: 'Teachers', icon: 'users' },
      { id: 'head-classrooms', label: 'Classrooms', icon: 'classroom' },
      { id: 'head-analytics', label: 'Analytics', icon: 'chart' }
    ];
  } else if (role === 'admin') {
    items = [
      { id: 'admin-home', label: 'Dashboard', icon: 'home' },
      { id: 'admin-users', label: 'Users', icon: 'users' },
      { id: 'admin-terms', label: 'Terms & Periods', icon: 'calendar' },
      { id: 'admin-classrooms', label: 'Classrooms', icon: 'classroom' },
      { id: 'admin-teachers', label: 'Teacher Feedback', icon: 'review' },
      { id: 'admin-submissions', label: 'Submission Tracking', icon: 'check' },
      { id: 'admin-moderate', label: 'Moderate Reviews', icon: 'shield' },
      { id: 'admin-flagged', label: 'Flagged', icon: 'flag' },
      { id: 'admin-support', label: 'Support Messages', icon: 'settings' },
      { id: 'admin-audit', label: 'Audit Logs', icon: 'list' }
    ];
  }

  nav.innerHTML = '<div class="nav-section"><div class="nav-section-title">Main Menu</div>' +
    items.map(it => `
      <button class="nav-item" data-view="${it.id}" onclick="navigateTo('${it.id}')">
        ${ICONS[it.icon]}
        ${it.label}
      </button>
    `).join('') + '</div>' +
    '<div class="nav-section"><div class="nav-section-title">Account</div>' +
    `<button class="nav-item" data-view="account" onclick="navigateTo('account')">
      ${ICONS.settings}
      Account Details
    </button>
    ${role !== 'admin' ? `<button class="nav-item" onclick="showSupportModal()">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>
      Support
    </button>` : ''}</div>`;
}

// ============ NAVIGATION ============
function navigateTo(view) {
  currentView = view;
  destroyCharts();
  document.querySelectorAll('.nav-item[data-view]').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });

  const content = document.getElementById('contentArea');
  content.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  const titles = {
    'student-home': 'Student Dashboard',
    'student-classrooms': 'My Classrooms',
    'student-review': 'Write a Review',
    'student-my-reviews': 'My Reviews',
    'teacher-home': 'Teacher Dashboard',
    'teacher-classrooms': 'My Classrooms',
    'teacher-feedback': 'Student Feedback',
    'teacher-analytics': 'Analytics',
    'head-home': 'School Overview',
    'head-teachers': 'Teacher Performance',
    'head-classrooms': 'All Classrooms',
    'head-analytics': 'Analytics',
    'admin-home': 'Admin Dashboard',
    'admin-users': 'User Management',
    'admin-terms': 'Terms & Feedback Periods',
    'admin-classrooms': 'Classroom Management',
    'admin-teachers': 'Teacher Feedback',
    'admin-submissions': 'Submission Tracking',
    'admin-moderate': 'Review Moderation',
    'admin-flagged': 'Flagged Reviews',
    'admin-support': 'Support Messages',
    'admin-audit': 'Audit Logs',
    'account': 'Account Details'
  };
  document.getElementById('pageTitle').textContent = titles[view] || 'Dashboard';

  const viewFunctions = {
    'student-home': renderStudentHome,
    'student-classrooms': renderStudentClassrooms,
    'student-review': renderStudentReview,
    'student-my-reviews': renderStudentMyReviews,
    'teacher-home': renderTeacherHome,
    'teacher-classrooms': renderTeacherClassrooms,
    'teacher-feedback': renderTeacherFeedback,
    'teacher-analytics': renderTeacherAnalytics,
    'head-home': renderHeadHome,
    'head-teachers': renderHeadTeachers,
    'head-classrooms': renderHeadClassrooms,
    'head-analytics': renderHeadAnalytics,
    'admin-home': renderAdminHome,
    'admin-users': renderAdminUsers,
    'admin-terms': renderAdminTerms,
    'admin-classrooms': renderAdminClassrooms,
    'admin-teachers': renderAdminTeachers,
    'admin-submissions': renderAdminSubmissions,
    'admin-moderate': renderAdminModerate,
    'admin-flagged': renderAdminFlagged,
    'admin-support': renderAdminSupport,
    'admin-audit': renderAdminAudit,
    'account': renderAccount
  };

  if (viewFunctions[view]) {
    viewFunctions[view]().catch(err => {
      content.innerHTML = `<div class="empty-state"><h3>Error loading page</h3><p>${err.message}</p></div>`;
    });
  }
}

// ============ UTILITIES ============
function starsHTML(rating, size = '') {
  let html = '<div class="stars">';
  for (let i = 1; i <= 5; i++) {
    html += `<span class="star ${i <= Math.round(rating) ? 'filled' : ''}">${i <= Math.round(rating) ? '\u2605' : '\u2606'}</span>`;
  }
  html += '</div>';
  return html;
}

function badgeHTML(status) {
  const map = { pending: 'badge-pending', approved: 'badge-approved', rejected: 'badge-rejected', flagged: 'badge-flagged' };
  return `<span class="badge ${map[status] || 'badge-pending'}">${status}</span>`;
}

function trendArrow(trend) {
  if (trend === 'improving') return '<span class="trend-arrow trend-up">&#9650;</span>';
  if (trend === 'declining') return '<span class="trend-arrow trend-down">&#9660;</span>';
  return '<span class="trend-arrow trend-stable">&#9654;</span>';
}

function toast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function openModal(html) {
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalOverlay').classList.add('active');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
}

function destroyCharts() {
  Object.values(chartInstances).forEach(c => c.destroy());
  chartInstances = {};
}

function scoreColor(score) {
  if (score >= 4) return 'var(--success)';
  if (score >= 3) return 'var(--warning)';
  return 'var(--danger)';
}

function logout() {
  localStorage.removeItem('edurate_token');
  localStorage.removeItem('edurate_user');
  fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/';
}

// ============ STUDENT VIEWS ============
async function renderStudentHome() {
  const data = await API.get('/dashboard/student');
  const el = document.getElementById('contentArea');

  const periodInfo = data.active_period
    ? `<div class="stat-card" style="border-left:4px solid var(--success)">
         <div class="stat-label">Active Feedback Period</div>
         <div class="stat-value" style="font-size:1.4rem">${data.active_period.name}</div>
         <div class="stat-change" style="color:var(--success)">${data.active_term?.name || ''}</div>
       </div>`
    : `<div class="stat-card" style="border-left:4px solid var(--gray-400)">
         <div class="stat-label">Feedback Period</div>
         <div class="stat-value" style="font-size:1.4rem">Closed</div>
         <div class="stat-change stable">No active period right now</div>
       </div>`;

  el.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:28px">
      <div class="stat-card">
        <div class="stat-label">My Classrooms</div>
        <div class="stat-value">${data.classrooms.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Reviews Submitted</div>
        <div class="stat-value">${data.review_count}</div>
      </div>
      ${periodInfo}
      <div class="stat-card">
        <div class="stat-label">Teachers to Review</div>
        <div class="stat-value" id="eligibleCount">...</div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-header"><h3>My Classrooms</h3></div>
        <div class="card-body">
          ${data.classrooms.length === 0
            ? '<div class="empty-state"><h3>No classrooms yet</h3><p>Join a classroom using a code from your teacher</p></div>'
            : data.classrooms.map(c => `
              <div class="classroom-card" style="margin-bottom:12px">
                <div class="class-subject">${c.subject}</div>
                <div class="class-meta">${c.teacher_name} &middot; ${c.grade_level} &middot; ${c.term_name}</div>
              </div>
            `).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Recent Reviews</h3></div>
        <div class="card-body">
          ${data.my_reviews.length === 0
            ? '<div class="empty-state"><h3>No reviews yet</h3><p>Submit feedback for your teachers</p></div>'
            : data.my_reviews.slice(0, 5).map(r => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--gray-100)">
                <div>
                  <strong>${r.teacher_name}</strong>
                  <div style="font-size:0.8rem;color:var(--gray-500)">${r.classroom_subject} &middot; ${r.period_name}</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                  ${starsHTML(r.overall_rating)}
                  ${badgeHTML(r.flagged_status)}
                </div>
              </div>
            `).join('')}
        </div>
      </div>
    </div>
  `;

  // Fetch eligible count
  try {
    const eligible = await API.get('/reviews/eligible-teachers');
    const remaining = eligible.teachers.filter(t => !t.already_reviewed).length;
    document.getElementById('eligibleCount').textContent = remaining;
  } catch { document.getElementById('eligibleCount').textContent = '0'; }
}

async function renderStudentClassrooms() {
  const classrooms = await API.get('/classrooms');
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <p style="color:var(--gray-500)">Join classrooms using codes from your teachers</p>
      <button class="btn btn-primary" onclick="showJoinClassroom()">+ Join Classroom</button>
    </div>
    <div class="grid grid-3">
      ${classrooms.length === 0
        ? '<div class="empty-state" style="grid-column:1/-1"><h3>No classrooms yet</h3><p>Ask your teacher for a classroom join code</p></div>'
        : classrooms.map(c => `
          <div class="classroom-card">
            <div class="class-subject">${c.subject}</div>
            <div class="class-meta">${c.teacher_name} &middot; ${c.grade_level} &middot; ${c.term_name}</div>
            <div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center">
              <span class="badge badge-active">Enrolled</span>
              <button class="btn btn-sm btn-outline" onclick="leaveClassroom(${c.id}, '${c.subject}')">Leave</button>
            </div>
          </div>
        `).join('')}
    </div>
  `;
}

function showJoinClassroom() {
  openModal(`
    <div class="modal-header"><h3>Join Classroom</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>Classroom Join Code</label>
        <input type="text" class="form-control" id="joinCodeInput" placeholder="Enter 8-character code" maxlength="8" style="text-transform:uppercase;font-family:monospace;font-size:1.2rem;letter-spacing:3px;text-align:center">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="joinClassroom()">Join</button>
    </div>
  `);
  setTimeout(() => document.getElementById('joinCodeInput')?.focus(), 100);
}

async function joinClassroom() {
  const code = document.getElementById('joinCodeInput').value.trim();
  if (!code) return toast('Enter a join code', 'error');
  try {
    const data = await API.post('/classrooms/join', { join_code: code });
    toast(data.message);
    closeModal();
    navigateTo('student-classrooms');
  } catch (err) { toast(err.message, 'error'); }
}

async function leaveClassroom(id, name) {
  if (!confirm(`Leave "${name}"? You won't be able to review this teacher.`)) return;
  try {
    await API.delete(`/classrooms/${id}/leave`);
    toast('Left classroom');
    navigateTo('student-classrooms');
  } catch (err) { toast(err.message, 'error'); }
}

async function renderStudentReview() {
  const el = document.getElementById('contentArea');
  try {
    const data = await API.get('/reviews/eligible-teachers');
    const tags = await API.get('/reviews/tags');

    if (!data.period) {
      el.innerHTML = '<div class="empty-state"><h3>No Active Feedback Period</h3><p>Reviews can only be submitted during an active feedback period. Check back later.</p></div>';
      return;
    }

    const eligible = data.teachers.filter(t => !t.already_reviewed);
    const reviewed = data.teachers.filter(t => t.already_reviewed);

    el.innerHTML = `
      <div class="card" style="margin-bottom:24px;border-left:4px solid var(--success)">
        <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <strong>Active Period:</strong> ${data.period.name}
            <span style="color:var(--gray-500);margin-left:12px">Submit your feedback anonymously</span>
          </div>
          <span class="badge badge-active">Open</span>
        </div>
      </div>

      ${eligible.length === 0 && reviewed.length > 0
        ? '<div class="card"><div class="card-body"><div class="empty-state"><h3>All Done!</h3><p>You\'ve reviewed all your teachers for this period.</p></div></div></div>'
        : eligible.length === 0
          ? '<div class="card"><div class="card-body"><div class="empty-state"><h3>No Teachers to Review</h3><p>Join classrooms first to be able to review teachers.</p></div></div></div>'
          : ''}

      ${eligible.map(t => `
        <div class="card" style="margin-bottom:16px">
          <div class="card-header">
            <h3>${t.teacher_name} - ${t.classroom_subject}</h3>
            <span style="color:var(--gray-500);font-size:0.85rem">${t.grade_level}</span>
          </div>
          <div class="card-body">
            <form onsubmit="submitReview(event, ${t.teacher_id}, ${t.classroom_id})">
              <div class="grid grid-2" style="margin-bottom:20px">
                ${['Overall', 'Clarity', 'Engagement', 'Fairness', 'Supportiveness'].map(cat => `
                  <div class="form-group" style="margin-bottom:12px">
                    <label>${cat} Rating</label>
                    <div class="star-rating-input" data-name="${cat.toLowerCase()}_rating" data-form="review-${t.teacher_id}">
                      ${[1,2,3,4,5].map(i => `<button type="button" class="star-btn" data-value="${i}" onclick="setRating(this)">\u2606</button>`).join('')}
                    </div>
                  </div>
                `).join('')}
              </div>
              <div class="form-group">
                <label>Feedback Tags (optional)</label>
                <div class="tag-container" id="tags-${t.teacher_id}">
                  ${tags.map(tag => `<div class="tag" onclick="this.classList.toggle('selected')" data-tag="${tag}">${tag}</div>`).join('')}
                </div>
              </div>
              <div class="form-group">
                <label>Written Feedback (optional but encouraged)</label>
                <textarea class="form-control" name="feedback_text" placeholder="Share constructive feedback about your learning experience..." rows="3"></textarea>
              </div>
              <button type="submit" class="btn btn-primary">Submit Review</button>
            </form>
          </div>
        </div>
      `).join('')}

      ${reviewed.length > 0 ? `
        <div class="card" style="margin-top:24px">
          <div class="card-header"><h3>Already Reviewed (${reviewed.length})</h3></div>
          <div class="card-body">
            ${reviewed.map(t => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--gray-100)">
                <span>${t.teacher_name} - ${t.classroom_subject}</span>
                <span class="badge badge-approved">Submitted</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    `;
  } catch (err) {
    el.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${err.message}</p></div>`;
  }
}

function setRating(btn) {
  const container = btn.parentElement;
  const value = parseInt(btn.dataset.value);
  container.dataset.value = value;
  container.querySelectorAll('.star-btn').forEach((b, i) => {
    b.textContent = i < value ? '\u2605' : '\u2606';
    b.classList.toggle('active', i < value);
  });
}

async function submitReview(e, teacherId, classroomId) {
  e.preventDefault();
  const form = e.target;
  const getRating = (name) => {
    const el = form.closest('.card-body').querySelector(`[data-name="${name}"]`);
    return parseInt(el?.dataset.value || 0);
  };

  const overall = getRating('overall_rating');
  const clarity = getRating('clarity_rating');
  const engagement = getRating('engagement_rating');
  const fairness = getRating('fairness_rating');
  const supportiveness = getRating('supportiveness_rating');

  if (!overall || !clarity || !engagement || !fairness || !supportiveness) {
    return toast('Please rate all categories', 'error');
  }

  const tagsContainer = document.getElementById(`tags-${teacherId}`);
  const selectedTags = [...tagsContainer.querySelectorAll('.tag.selected')].map(el => el.dataset.tag);
  const feedbackText = form.querySelector('[name="feedback_text"]').value;

  try {
    await API.post('/reviews', {
      teacher_id: teacherId,
      classroom_id: classroomId,
      overall_rating: overall,
      clarity_rating: clarity,
      engagement_rating: engagement,
      fairness_rating: fairness,
      supportiveness_rating: supportiveness,
      feedback_text: feedbackText,
      tags: selectedTags
    });
    toast('Review submitted! It will be visible after admin approval.');
    navigateTo('student-review');
  } catch (err) { toast(err.message, 'error'); }
}

async function renderStudentMyReviews() {
  const reviews = await API.get('/reviews/my-reviews');
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div class="card">
      <div class="card-header"><h3>My Reviews (${reviews.length})</h3></div>
      <div class="card-body">
        ${reviews.length === 0
          ? '<div class="empty-state"><h3>No reviews yet</h3><p>Submit feedback during an active feedback period</p></div>'
          : reviews.map(r => `
            <div class="review-card">
              <div class="review-header">
                <div>
                  <strong>${r.teacher_name}</strong>
                  <span style="color:var(--gray-500);font-size:0.85rem"> &middot; ${r.classroom_subject} &middot; ${r.period_name} (${r.term_name})</span>
                </div>
                ${badgeHTML(r.flagged_status)}
              </div>
              <div class="review-ratings">
                <div class="rating-item"><span>Overall</span> ${starsHTML(r.overall_rating)}</div>
                <div class="rating-item"><span>Clarity</span> ${starsHTML(r.clarity_rating)}</div>
                <div class="rating-item"><span>Engagement</span> ${starsHTML(r.engagement_rating)}</div>
                <div class="rating-item"><span>Fairness</span> ${starsHTML(r.fairness_rating)}</div>
                <div class="rating-item"><span>Supportiveness</span> ${starsHTML(r.supportiveness_rating)}</div>
              </div>
              ${r.feedback_text ? `<div class="review-text">${r.feedback_text}</div>` : ''}
              ${JSON.parse(r.tags || '[]').length > 0 ? `
                <div class="review-tags">
                  ${JSON.parse(r.tags).map(t => `<span class="tag">${t}</span>`).join('')}
                </div>
              ` : ''}
            </div>
          `).join('')}
      </div>
    </div>
  `;
}

// ============ TEACHER VIEWS ============
async function renderTeacherHome() {
  const data = await API.get('/dashboard/teacher');
  const el = document.getElementById('contentArea');
  const s = data.overall_scores;

  el.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:28px">
      <div class="stat-card">
        <div class="stat-label">Final Score</div>
        <div class="stat-value" style="color:${scoreColor(s.final_score || 0)}">${s.final_score || 'N/A'}</div>
        <div class="stat-change">${s.review_count} total reviews</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Classrooms</div>
        <div class="stat-value">${data.classrooms.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Active Period</div>
        <div class="stat-value" style="font-size:1.3rem">${data.active_period?.name || 'None'}</div>
        ${data.active_term ? `<div class="stat-change">${data.active_term.name}</div>` : ''}
      </div>
      <div class="stat-card">
        <div class="stat-label">Trend</div>
        <div class="stat-value">${data.trend ? trendArrow(data.trend.trend) : 'N/A'}</div>
        <div class="stat-change ${data.trend?.trend === 'improving' ? 'up' : data.trend?.trend === 'declining' ? 'down' : 'stable'}">${data.trend?.trend || 'No data'}</div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-bottom:28px">
      <div class="card">
        <div class="card-header"><h3>Rating Breakdown</h3></div>
        <div class="card-body">
          ${['clarity', 'engagement', 'fairness', 'supportiveness'].map(cat => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--gray-100)">
              <span style="font-weight:500;text-transform:capitalize">${cat}</span>
              <div style="display:flex;align-items:center;gap:8px">
                ${starsHTML(s[`avg_${cat}`] || 0)}
                <span style="font-weight:600;color:${scoreColor(s[`avg_${cat}`] || 0)}">${s[`avg_${cat}`] || '-'}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Rating Distribution</h3></div>
        <div class="card-body">
          <canvas id="distChart"></canvas>
        </div>
      </div>
    </div>

    ${data.completion_rates.length > 0 ? `
      <div class="card" style="margin-bottom:28px">
        <div class="card-header"><h3>Feedback Completion Rate</h3></div>
        <div class="card-body">
          ${data.completion_rates.map(c => `
            <div style="margin-bottom:16px">
              <div style="display:flex;justify-content:space-between;margin-bottom:6px">
                <span style="font-weight:500">${c.subject} (${c.grade_level})</span>
                <span style="font-weight:600;color:${c.rate >= 70 ? 'var(--success)' : c.rate >= 40 ? 'var(--warning)' : 'var(--danger)'}">${c.submitted}/${c.total} (${c.rate}%)</span>
              </div>
              <div class="progress-bar">
                <div class="progress-fill ${c.rate >= 70 ? 'green' : c.rate >= 40 ? 'yellow' : 'red'}" style="width:${c.rate}%"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}

    ${data.department_average ? `
      <div class="card" style="margin-bottom:28px">
        <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <strong>Department Average (${data.teacher.department})</strong>
            <p style="font-size:0.85rem;color:var(--gray-500)">Anonymous comparison with your department</p>
          </div>
          <div style="text-align:right">
            <div style="font-size:1.5rem;font-weight:700">${data.department_average}</div>
            <div style="font-size:0.85rem;color:${(s.final_score||0) >= data.department_average ? 'var(--success)' : 'var(--warning)'}">
              Your score: ${s.final_score || 'N/A'}
              ${(s.final_score||0) >= data.department_average ? ' (above avg)' : ' (below avg)'}
            </div>
          </div>
        </div>
      </div>
    ` : ''}
  `;

  // Distribution chart
  if (data.distribution) {
    const ctx = document.getElementById('distChart');
    if (ctx) {
      chartInstances.dist = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ['1 Star', '2 Stars', '3 Stars', '4 Stars', '5 Stars'],
          datasets: [{
            data: [data.distribution[1], data.distribution[2], data.distribution[3], data.distribution[4], data.distribution[5]],
            backgroundColor: ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981'],
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, ticks: { stepSize: 1 } }
          }
        }
      });
    }
  }
}

async function renderTeacherClassrooms() {
  const data = await API.get('/dashboard/teacher');
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <p style="color:var(--gray-500)">Manage your classrooms and share join codes with students</p>
      <button class="btn btn-primary" onclick="showCreateClassroom(${JSON.stringify(data.active_term?.id || null).replace(/"/g, '&quot;')})">+ Create Classroom</button>
    </div>
    <div class="grid grid-2">
      ${data.classrooms.map(c => `
        <div class="classroom-card">
          <div style="display:flex;justify-content:space-between;align-items:start">
            <div>
              <div class="class-subject">${c.subject}</div>
              <div class="class-meta">${c.grade_level} &middot; ${c.term_name} &middot; ${c.student_count} students</div>
            </div>
            <span class="badge ${c.active_status ? 'badge-active' : 'badge-inactive'}">${c.active_status ? 'Active' : 'Inactive'}</span>
          </div>
          <div style="margin-top:16px;display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-size:0.75rem;color:var(--gray-500);margin-bottom:4px">Join Code</div>
              <span class="join-code">${c.join_code}</span>
            </div>
            <div style="display:flex;gap:8px">
              <button class="btn btn-sm btn-outline" onclick="regenerateCode(${c.id})">New Code</button>
              <button class="btn btn-sm btn-primary" onclick="viewClassroomMembers(${c.id}, '${c.subject}')">Members</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function showCreateClassroom(termId) {
  openModal(`
    <div class="modal-header"><h3>Create Classroom</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>Subject</label>
        <input type="text" class="form-control" id="newSubject" placeholder="e.g. Mathematics">
      </div>
      <div class="form-group">
        <label>Grade Level</label>
        <input type="text" class="form-control" id="newGradeLevel" placeholder="e.g. Grade 10">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createClassroom(${termId})">Create</button>
    </div>
  `);
}

async function createClassroom(termId) {
  const subject = document.getElementById('newSubject').value.trim();
  const grade_level = document.getElementById('newGradeLevel').value.trim();
  if (!subject || !grade_level) return toast('Fill in all fields', 'error');
  if (!termId) return toast('No active term. Ask admin to create one.', 'error');
  try {
    const data = await API.post('/classrooms', { subject, grade_level, term_id: termId });
    toast(`Classroom created! Join code: ${data.join_code}`);
    closeModal();
    navigateTo('teacher-classrooms');
  } catch (err) { toast(err.message, 'error'); }
}

async function regenerateCode(classroomId) {
  if (!confirm('Generate a new join code? The old one will stop working.')) return;
  try {
    const data = await API.post(`/classrooms/${classroomId}/regenerate-code`);
    toast(`New join code: ${data.join_code}`);
    navigateTo('teacher-classrooms');
  } catch (err) { toast(err.message, 'error'); }
}

async function viewClassroomMembers(classroomId, subject) {
  try {
    const members = await API.get(`/classrooms/${classroomId}/members`);
    openModal(`
      <div class="modal-header"><h3>${subject} - Students</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
      <div class="modal-body">
        ${members.length === 0
          ? '<p style="color:var(--gray-500);text-align:center">No students enrolled yet</p>'
          : `<table><thead><tr><th>Name</th><th>Grade</th><th>Joined</th></tr></thead><tbody>
              ${members.map(m => `<tr><td>${m.full_name}</td><td>${m.grade_or_position || '-'}</td><td>${new Date(m.joined_at).toLocaleDateString()}</td></tr>`).join('')}
            </tbody></table>`}
      </div>
    `);
  } catch (err) { toast(err.message, 'error'); }
}

async function renderTeacherFeedback() {
  const data = await API.get('/dashboard/teacher');
  const el = document.getElementById('contentArea');

  // Separate approved and pending reviews
  const approvedReviews = data.recent_reviews.filter(r => r.approved_status === 1);
  const pendingReviews = data.recent_reviews.filter(r => r.approved_status === 0);

  // Group APPROVED reviews by subject/classroom for averages
  const bySubject = {};
  approvedReviews.forEach(r => {
    const key = `${r.classroom_subject} (${r.grade_level})`;
    if (!bySubject[key]) {
      bySubject[key] = { reviews: [], subject: r.classroom_subject, grade: r.grade_level };
    }
    bySubject[key].reviews.push(r);
  });

  // Calculate averages for each subject (ONLY approved reviews)
  Object.keys(bySubject).forEach(key => {
    const reviews = bySubject[key].reviews;
    bySubject[key].count = reviews.length;
    bySubject[key].avg_overall = (reviews.reduce((sum, r) => sum + r.overall_rating, 0) / reviews.length).toFixed(2);
    bySubject[key].avg_clarity = (reviews.reduce((sum, r) => sum + r.clarity_rating, 0) / reviews.length).toFixed(2);
    bySubject[key].avg_engagement = (reviews.reduce((sum, r) => sum + r.engagement_rating, 0) / reviews.length).toFixed(2);
    bySubject[key].avg_fairness = (reviews.reduce((sum, r) => sum + r.fairness_rating, 0) / reviews.length).toFixed(2);
    bySubject[key].avg_supportiveness = (reviews.reduce((sum, r) => sum + r.supportiveness_rating, 0) / reviews.length).toFixed(2);
  });

  el.innerHTML = `
    <div class="grid grid-2" style="margin-bottom:28px">
      <!-- Summary by Subject -->
      <div class="card">
        <div class="card-header"><h3>Average Ratings by Subject</h3></div>
        <div class="card-body">
          ${Object.keys(bySubject).length === 0
            ? '<div class="empty-state"><p>No reviews yet</p></div>'
            : Object.keys(bySubject).map(key => {
              const s = bySubject[key];
              return `
                <div style="padding:16px;border:1px solid var(--gray-200);border-radius:var(--radius-md);margin-bottom:12px">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                    <div>
                      <div style="font-weight:600;font-size:1.05rem">${s.subject}</div>
                      <div style="color:var(--gray-500);font-size:0.85rem">${s.grade} &middot; ${s.count} review${s.count !== 1 ? 's' : ''}</div>
                    </div>
                    ${starsHTML(parseFloat(s.avg_overall))}
                  </div>
                  <div class="review-ratings">
                    <div class="rating-item"><span>Clarity</span><span style="font-weight:600;color:${scoreColor(s.avg_clarity)}">${s.avg_clarity} ${starsHTML(parseFloat(s.avg_clarity))}</span></div>
                    <div class="rating-item"><span>Engagement</span><span style="font-weight:600;color:${scoreColor(s.avg_engagement)}">${s.avg_engagement} ${starsHTML(parseFloat(s.avg_engagement))}</span></div>
                    <div class="rating-item"><span>Fairness</span><span style="font-weight:600;color:${scoreColor(s.avg_fairness)}">${s.avg_fairness} ${starsHTML(parseFloat(s.avg_fairness))}</span></div>
                    <div class="rating-item"><span>Supportiveness</span><span style="font-weight:600;color:${scoreColor(s.avg_supportiveness)}">${s.avg_supportiveness} ${starsHTML(parseFloat(s.avg_supportiveness))}</span></div>
                  </div>
                </div>
              `;
            }).join('')}
        </div>
      </div>

      <!-- Overall Summary -->
      <div class="card">
        <div class="card-header"><h3>Overall Performance</h3></div>
        <div class="card-body">
          <div style="text-align:center;padding:20px 0">
            <div style="font-size:3rem;font-weight:700;color:${scoreColor(data.overall_scores.avg_overall || 0)};margin-bottom:8px">
              ${data.overall_scores.avg_overall || 'N/A'}
            </div>
            ${starsHTML(data.overall_scores.avg_overall || 0)}
            <div style="color:var(--gray-500);margin-top:12px">${data.overall_scores.review_count} total reviews</div>
          </div>
          <div style="margin-top:24px">
            <div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--gray-100)">
              <span>Clarity</span>
              <span style="font-weight:600;color:${scoreColor(data.overall_scores.avg_clarity || 0)}">${data.overall_scores.avg_clarity || 'N/A'} ${starsHTML(data.overall_scores.avg_clarity || 0)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--gray-100)">
              <span>Engagement</span>
              <span style="font-weight:600;color:${scoreColor(data.overall_scores.avg_engagement || 0)}">${data.overall_scores.avg_engagement || 'N/A'} ${starsHTML(data.overall_scores.avg_engagement || 0)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--gray-100)">
              <span>Fairness</span>
              <span style="font-weight:600;color:${scoreColor(data.overall_scores.avg_fairness || 0)}">${data.overall_scores.avg_fairness || 'N/A'} ${starsHTML(data.overall_scores.avg_fairness || 0)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:12px 0">
              <span>Supportiveness</span>
              <span style="font-weight:600;color:${scoreColor(data.overall_scores.avg_supportiveness || 0)}">${data.overall_scores.avg_supportiveness || 'N/A'} ${starsHTML(data.overall_scores.avg_supportiveness || 0)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Individual Reviews -->
    <div class="card">
      <div class="card-header">
        <h3>Approved Reviews (${approvedReviews.length})</h3>
      </div>
      <div class="card-body">
        ${approvedReviews.length === 0
          ? '<div class="empty-state"><h3>No approved reviews yet</h3><p>Approved reviews will appear here once admins review student feedback</p></div>'
          : approvedReviews.map(r => `
            <div class="review-card">
              <div class="review-header">
                <div>
                  <span style="color:var(--gray-500);font-size:0.85rem">${r.classroom_subject} (${r.grade_level}) &middot; ${r.period_name}</span>
                </div>
                ${starsHTML(r.overall_rating)}
              </div>
              <div class="review-ratings">
                <div class="rating-item"><span>Clarity</span><span style="font-weight:600">${r.clarity_rating}/5 ${starsHTML(r.clarity_rating)}</span></div>
                <div class="rating-item"><span>Engagement</span><span style="font-weight:600">${r.engagement_rating}/5 ${starsHTML(r.engagement_rating)}</span></div>
                <div class="rating-item"><span>Fairness</span><span style="font-weight:600">${r.fairness_rating}/5 ${starsHTML(r.fairness_rating)}</span></div>
                <div class="rating-item"><span>Supportiveness</span><span style="font-weight:600">${r.supportiveness_rating}/5 ${starsHTML(r.supportiveness_rating)}</span></div>
              </div>
              ${r.feedback_text ? `<div class="review-text">${r.feedback_text}</div>` : ''}
              ${JSON.parse(r.tags || '[]').length > 0 ? `
                <div class="review-tags">
                  ${JSON.parse(r.tags).map(t => `<span class="tag">${t}</span>`).join('')}
                </div>
              ` : ''}
            </div>
          `).join('')}
      </div>
    </div>
  `;
}

async function renderTeacherAnalytics() {
  const data = await API.get('/dashboard/teacher');
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div class="grid grid-2" style="margin-bottom:28px">
      <div class="card">
        <div class="card-header"><h3>Score Trend (${data.active_term?.name || 'Current Term'})</h3></div>
        <div class="card-body"><div class="chart-container"><canvas id="trendChart"></canvas></div></div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Category Breakdown</h3></div>
        <div class="card-body"><div class="chart-container"><canvas id="radarChart"></canvas></div></div>
      </div>
    </div>
  `;

  // Trend chart
  if (data.trend?.periods) {
    const ctx = document.getElementById('trendChart');
    chartInstances.trend = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.trend.periods.map(p => p.name),
        datasets: [{
          label: 'Score',
          data: data.trend.periods.map(p => p.score),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 6,
          pointBackgroundColor: '#3b82f6'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { min: 0, max: 5, beginAtZero: true } },
        plugins: { legend: { display: false } }
      }
    });
  }

  // Radar chart
  const s = data.overall_scores;
  if (s.review_count > 0) {
    const ctx2 = document.getElementById('radarChart');
    chartInstances.radar = new Chart(ctx2, {
      type: 'radar',
      data: {
        labels: ['Clarity', 'Engagement', 'Fairness', 'Supportiveness'],
        datasets: [{
          label: 'Your Scores',
          data: [s.avg_clarity, s.avg_engagement, s.avg_fairness, s.avg_supportiveness],
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.2)',
          pointBackgroundColor: '#3b82f6'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { r: { min: 0, max: 5, beginAtZero: true } }
      }
    });
  }
}

// ============ SCHOOL HEAD VIEWS ============
async function renderHeadHome() {
  const [data, stats] = await Promise.all([
    API.get('/dashboard/school-head'),
    API.get('/admin/stats')
  ]);
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:28px">
      <div class="stat-card"><div class="stat-label">Teachers</div><div class="stat-value">${stats.total_teachers}</div></div>
      <div class="stat-card"><div class="stat-label">Students</div><div class="stat-value">${stats.total_students}</div></div>
      <div class="stat-card"><div class="stat-label">Classrooms</div><div class="stat-value">${stats.total_classrooms}</div></div>
      <div class="stat-card"><div class="stat-label">Avg Rating</div><div class="stat-value" style="color:${scoreColor(stats.average_rating || 0)}">${stats.average_rating || 'N/A'}</div></div>
    </div>

    <div class="grid grid-2" style="margin-bottom:28px">
      <div class="card">
        <div class="card-header"><h3>Teacher Rankings</h3></div>
        <div class="card-body">
          <table>
            <thead><tr><th>Teacher</th><th>Department</th><th>Score</th><th>Reviews</th><th>Trend</th></tr></thead>
            <tbody>
              ${data.teachers.sort((a, b) => (b.scores.final_score || 0) - (a.scores.final_score || 0)).map(t => `
                <tr>
                  <td><strong>${t.full_name}</strong></td>
                  <td>${t.department || '-'}</td>
                  <td style="font-weight:600;color:${scoreColor(t.scores.final_score || 0)}">${t.scores.final_score || 'N/A'}</td>
                  <td>${t.scores.review_count}</td>
                  <td>${t.trend ? trendArrow(t.trend.trend) : '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Department Comparison</h3></div>
        <div class="card-body"><canvas id="deptChart"></canvas></div>
      </div>
    </div>

    <div class="card">
      <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <strong>Participation Rate</strong>
          <p style="font-size:0.85rem;color:var(--gray-500)">${stats.reviewing_students} of ${stats.enrolled_students} enrolled students have submitted reviews</p>
        </div>
        <div style="text-align:right">
          <div style="font-size:2rem;font-weight:700;color:${stats.participation_rate >= 70 ? 'var(--success)' : 'var(--warning)'}">${stats.participation_rate}%</div>
        </div>
      </div>
    </div>
  `;

  // Department chart
  const deptLabels = Object.keys(data.departments);
  if (deptLabels.length > 0) {
    chartInstances.dept = new Chart(document.getElementById('deptChart'), {
      type: 'bar',
      data: {
        labels: deptLabels,
        datasets: [{
          label: 'Avg Score',
          data: deptLabels.map(d => data.departments[d].avg_score),
          backgroundColor: deptLabels.map((_, i) => ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][i % 5]),
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { min: 0, max: 5 } }
      }
    });
  }
}

async function renderHeadTeachers() {
  const data = await API.get('/dashboard/school-head');
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div class="grid grid-2">
      ${data.teachers.map(t => `
        <div class="card" style="margin-bottom:0">
          <div class="card-header">
            <h3>${t.full_name}</h3>
            <span style="color:var(--gray-500);font-size:0.85rem">${t.department || ''}</span>
          </div>
          <div class="card-body">
            <div style="display:flex;justify-content:space-between;margin-bottom:16px">
              <div>
                <div style="font-size:0.8rem;color:var(--gray-500)">Subject</div>
                <div style="font-weight:500">${t.subject}</div>
              </div>
              <div style="text-align:center">
                <div style="font-size:0.8rem;color:var(--gray-500)">Score</div>
                <div style="font-size:1.5rem;font-weight:700;color:${scoreColor(t.scores.final_score || 0)}">${t.scores.final_score || 'N/A'}</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:0.8rem;color:var(--gray-500)">Reviews</div>
                <div style="font-weight:500">${t.scores.review_count}</div>
              </div>
            </div>
            ${['avg_clarity', 'avg_engagement', 'avg_fairness', 'avg_supportiveness'].map(key => {
              const label = key.replace('avg_', '');
              const val = t.scores[key] || 0;
              return `<div style="margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:3px">
                  <span style="text-transform:capitalize">${label}</span><span style="font-weight:600">${val}/5</span>
                </div>
                <div class="progress-bar"><div class="progress-fill blue" style="width:${(val/5)*100}%"></div></div>
              </div>`;
            }).join('')}
            ${t.trend ? `<div style="margin-top:12px;font-size:0.85rem">Trend: ${trendArrow(t.trend.trend)} <span class="trend-${t.trend.trend === 'improving' ? 'up' : t.trend.trend === 'declining' ? 'down' : 'stable'}">${t.trend.trend}</span></div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

async function renderHeadClassrooms() {
  const data = await API.get('/dashboard/school-head');
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div class="card">
      <div class="table-container">
        <table>
          <thead><tr><th>Subject</th><th>Teacher</th><th>Grade</th><th>Term</th><th>Students</th></tr></thead>
          <tbody>
            ${data.classrooms.map(c => `
              <tr>
                <td><strong>${c.subject}</strong></td>
                <td>${c.teacher_name}</td>
                <td>${c.grade_level}</td>
                <td>${c.term_name}</td>
                <td>${c.student_count}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function renderHeadAnalytics() {
  const data = await API.get('/dashboard/school-head');
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div class="card">
      <div class="card-header"><h3>Performance Heatmap</h3></div>
      <div class="card-body">
        <table>
          <thead>
            <tr><th>Teacher</th><th>Clarity</th><th>Engagement</th><th>Fairness</th><th>Supportiveness</th><th>Final</th></tr>
          </thead>
          <tbody>
            ${data.teachers.map(t => {
              const s = t.scores;
              const cell = (val) => {
                const bg = !val ? 'var(--gray-100)' : val >= 4 ? 'var(--success-bg)' : val >= 3 ? 'var(--warning-bg)' : 'var(--danger-bg)';
                const color = !val ? 'var(--gray-400)' : val >= 4 ? '#047857' : val >= 3 ? '#92400e' : '#dc2626';
                return `<td style="background:${bg};color:${color};font-weight:600;text-align:center">${val || '-'}</td>`;
              };
              return `<tr><td><strong>${t.full_name}</strong></td>${cell(s.avg_clarity)}${cell(s.avg_engagement)}${cell(s.avg_fairness)}${cell(s.avg_supportiveness)}${cell(s.final_score)}</tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ============ ADMIN VIEWS ============
async function renderAdminHome() {
  const stats = await API.get('/admin/stats');
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:28px">
      <div class="stat-card"><div class="stat-label">Total Users</div><div class="stat-value">${stats.total_users}</div></div>
      <div class="stat-card"><div class="stat-label">Students</div><div class="stat-value">${stats.total_students}</div></div>
      <div class="stat-card"><div class="stat-label">Teachers</div><div class="stat-value">${stats.total_teachers}</div></div>
      <div class="stat-card"><div class="stat-label">Classrooms</div><div class="stat-value">${stats.total_classrooms}</div></div>
    </div>
    <div class="grid grid-4" style="margin-bottom:28px">
      <div class="stat-card" style="border-left:4px solid var(--warning)">
        <div class="stat-label">Pending Reviews</div>
        <div class="stat-value" style="color:var(--warning)">${stats.pending_reviews}</div>
      </div>
      <div class="stat-card" style="border-left:4px solid var(--danger)">
        <div class="stat-label">Flagged Reviews</div>
        <div class="stat-value" style="color:var(--danger)">${stats.flagged_reviews}</div>
      </div>
      <div class="stat-card" style="border-left:4px solid var(--success)">
        <div class="stat-label">Approved Reviews</div>
        <div class="stat-value" style="color:var(--success)">${stats.approved_reviews}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg Rating</div>
        <div class="stat-value">${stats.average_rating || 'N/A'}</div>
      </div>
    </div>
    <div class="card">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <strong>Student Participation</strong>
            <p style="font-size:0.85rem;color:var(--gray-500)">${stats.reviewing_students} of ${stats.enrolled_students} enrolled students submitted feedback</p>
          </div>
          <div style="font-size:2rem;font-weight:700;color:${stats.participation_rate >= 70 ? 'var(--success)' : 'var(--warning)'}">${stats.participation_rate}%</div>
        </div>
        <div class="progress-bar" style="margin-top:12px">
          <div class="progress-fill ${stats.participation_rate >= 70 ? 'green' : stats.participation_rate >= 40 ? 'yellow' : 'red'}" style="width:${stats.participation_rate}%"></div>
        </div>
      </div>
    </div>
  `;
}

async function renderAdminUsers() {
  const users = await API.get('/admin/users');
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm ${!window._userFilter ? 'btn-primary' : 'btn-outline'}" onclick="window._userFilter=null;renderAdminUsers()">All</button>
        ${['student', 'teacher', 'school_head', 'admin'].map(r =>
          `<button class="btn btn-sm ${window._userFilter === r ? 'btn-primary' : 'btn-outline'}" onclick="window._userFilter='${r}';renderAdminUsers()">${r.replace('_', ' ')}</button>`
        ).join('')}
      </div>
      <button class="btn btn-primary" onclick="showCreateUser()">+ Add User</button>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Grade/Position</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${users.filter(u => !window._userFilter || u.role === window._userFilter).map(u => `
              <tr>
                <td><strong>${u.full_name}</strong></td>
                <td style="font-size:0.8rem;color:var(--gray-500)">${u.email}</td>
                <td><span class="badge ${u.role === 'admin' ? 'badge-flagged' : u.role === 'teacher' ? 'badge-active' : u.role === 'school_head' ? 'badge-approved' : 'badge-pending'}">${u.role.replace('_', ' ')}</span></td>
                <td>${u.grade_or_position || '-'}</td>
                <td>${u.suspended ? '<span class="badge badge-rejected">Suspended</span>' : '<span class="badge badge-approved">Active</span>'}</td>
                <td>
                  <button class="btn btn-sm btn-outline" onclick='editUser(${JSON.stringify(u)})'>Edit</button>
                  <button class="btn btn-sm btn-outline" onclick="resetPassword(${u.id}, '${u.full_name}')">Reset PW</button>
                  <button class="btn btn-sm ${u.suspended ? 'btn-success' : 'btn-danger'}" onclick="toggleSuspend(${u.id})" ${u.id === currentUser.id ? 'disabled' : ''}>
                    ${u.suspended ? 'Unsuspend' : 'Suspend'}
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function showCreateUser() {
  openModal(`
    <div class="modal-header"><h3>Create User</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>Full Name</label>
        <input type="text" class="form-control" id="newUserName" required>
      </div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" class="form-control" id="newUserEmail" required>
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" class="form-control" id="newUserPassword" required>
      </div>
      <div class="form-group">
        <label>Role</label>
        <select class="form-control" id="newUserRole" onchange="document.getElementById('teacherFields').style.display=this.value==='teacher'?'block':'none'">
          <option value="student">Student</option>
          <option value="teacher">Teacher</option>
          <option value="school_head">School Head</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <div class="form-group">
        <label>Grade / Position</label>
        <input type="text" class="form-control" id="newUserGrade" placeholder="e.g. Grade 10 or Mathematics Teacher">
      </div>
      <div id="teacherFields" style="display:none">
        <div class="form-group"><label>Subject</label><input type="text" class="form-control" id="newTeacherSubject"></div>
        <div class="form-group"><label>Department</label><input type="text" class="form-control" id="newTeacherDept"></div>
        <div class="form-group"><label>Years of Experience</label><input type="number" class="form-control" id="newTeacherExp" min="0"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createUser()">Create</button>
    </div>
  `);
}

async function createUser() {
  const body = {
    full_name: document.getElementById('newUserName').value,
    email: document.getElementById('newUserEmail').value,
    password: document.getElementById('newUserPassword').value,
    role: document.getElementById('newUserRole').value,
    grade_or_position: document.getElementById('newUserGrade').value
  };
  if (body.role === 'teacher') {
    body.subject = document.getElementById('newTeacherSubject').value;
    body.department = document.getElementById('newTeacherDept').value;
    body.experience_years = parseInt(document.getElementById('newTeacherExp').value) || 0;
  }
  if (!body.full_name || !body.email || !body.password) return toast('Fill required fields', 'error');
  try {
    await API.post('/admin/users', body);
    toast('User created');
    closeModal();
    renderAdminUsers();
  } catch (err) { toast(err.message, 'error'); }
}

function editUser(user) {
  openModal(`
    <div class="modal-header"><h3>Edit User: ${user.full_name}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>Full Name</label>
        <input type="text" class="form-control" id="editUserName" value="${user.full_name}">
      </div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" class="form-control" id="editUserEmail" value="${user.email}">
      </div>
      <div class="form-group">
        <label>Grade / Position</label>
        <input type="text" class="form-control" id="editUserGrade" value="${user.grade_or_position || ''}">
      </div>
      <div class="form-group">
        <label>Role</label>
        <select class="form-control" id="editUserRole">
          <option value="student" ${user.role === 'student' ? 'selected' : ''}>Student</option>
          <option value="teacher" ${user.role === 'teacher' ? 'selected' : ''}>Teacher</option>
          <option value="school_head" ${user.role === 'school_head' ? 'selected' : ''}>School Head</option>
          <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveUserEdit(${user.id})">Save Changes</button>
    </div>
  `);
}

async function saveUserEdit(userId) {
  const body = {
    full_name: document.getElementById('editUserName').value,
    email: document.getElementById('editUserEmail').value,
    grade_or_position: document.getElementById('editUserGrade').value,
    role: document.getElementById('editUserRole').value
  };
  if (!body.full_name || !body.email) return toast('Name and email required', 'error');
  try {
    await API.put(`/admin/users/${userId}`, body);
    toast('User updated successfully');
    closeModal();
    renderAdminUsers();
  } catch (err) { toast(err.message, 'error'); }
}

function resetPassword(userId, userName) {
  const newPassword = prompt(`Enter new password for ${userName}:`);
  if (!newPassword) return;
  if (newPassword.length < 8) return toast('Password must be at least 8 characters', 'error');

  if (!confirm(`Reset password for ${userName}?`)) return;

  API.post(`/admin/users/${userId}/reset-password`, { new_password: newPassword })
    .then(() => toast('Password reset successfully'))
    .catch(err => toast(err.message, 'error'));
}

async function toggleSuspend(userId) {
  try {
    const data = await API.put(`/admin/users/${userId}/suspend`);
    toast(data.message);
    renderAdminUsers();
  } catch (err) { toast(err.message, 'error'); }
}

async function renderAdminTerms() {
  const terms = await API.get('/admin/terms');
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:24px">
      <button class="btn btn-primary" onclick="showCreateTerm()">+ Create Term</button>
    </div>
    ${terms.map(term => `
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div>
            <h3>${term.name}</h3>
            <span style="font-size:0.8rem;color:var(--gray-500)">${term.start_date} to ${term.end_date}</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <span class="badge ${term.active_status ? 'badge-active' : 'badge-inactive'}">${term.active_status ? 'Active' : 'Inactive'}</span>
            <span class="badge ${term.feedback_visible ? 'badge-approved' : 'badge-flagged'}">${term.feedback_visible ? 'Feedback Visible' : 'Feedback Hidden'}</span>
            <button class="btn btn-sm btn-outline" onclick="editTerm(${term.id}, '${term.name}', '${term.start_date}', '${term.end_date}', ${term.active_status}, ${term.feedback_visible})">Edit</button>
            <button class="btn btn-sm btn-danger" onclick="deleteTerm(${term.id}, '${term.name}')">Delete</button>
          </div>
        </div>
        <div class="card-body">
          <h4 style="font-size:0.85rem;color:var(--gray-500);margin-bottom:12px">Feedback Periods</h4>
          <div class="grid grid-3">
            ${term.periods.map(p => `
              <div style="padding:16px;border:2px solid ${p.active_status ? 'var(--success)' : 'var(--gray-200)'};border-radius:10px;text-align:center">
                <div style="font-weight:600;margin-bottom:4px">${p.name}</div>
                <span class="badge ${p.active_status ? 'badge-active' : 'badge-inactive'}">${p.active_status ? 'Active' : 'Closed'}</span>
                <div style="margin-top:12px;display:flex;gap:6px;justify-content:center">
                  ${p.active_status
                    ? `<button class="btn btn-sm btn-danger" onclick="togglePeriod(${p.id}, 0)">Close</button>`
                    : `<button class="btn btn-sm btn-success" onclick="togglePeriod(${p.id}, 1)">Open</button>`}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `).join('')}
  `;
}

function showCreateTerm() {
  openModal(`
    <div class="modal-header"><h3>Create Term</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Term Name</label><input type="text" class="form-control" id="termName" placeholder="e.g. Term 2 2025-2026"></div>
      <div class="form-group"><label>Start Date</label><input type="date" class="form-control" id="termStart"></div>
      <div class="form-group"><label>End Date</label><input type="date" class="form-control" id="termEnd"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createTerm()">Create</button>
    </div>
  `);
}

async function createTerm() {
  const name = document.getElementById('termName').value;
  const start_date = document.getElementById('termStart').value;
  const end_date = document.getElementById('termEnd').value;
  if (!name || !start_date || !end_date) return toast('Fill all fields', 'error');
  try {
    await API.post('/admin/terms', { name, start_date, end_date });
    toast('Term created with 3 feedback periods');
    closeModal();
    renderAdminTerms();
  } catch (err) { toast(err.message, 'error'); }
}

async function activateTerm(termId) {
  try {
    await API.put(`/admin/terms/${termId}`, { active_status: 1 });
    toast('Term activated');
    renderAdminTerms();
  } catch (err) { toast(err.message, 'error'); }
}

async function togglePeriod(periodId, status) {
  try {
    await API.put(`/admin/feedback-periods/${periodId}`, { active_status: status });
    toast(status ? 'Period opened' : 'Period closed');
    renderAdminTerms();
  } catch (err) { toast(err.message, 'error'); }
}

function editTerm(termId, name, startDate, endDate, activeStatus, feedbackVisible) {
  openModal(`
    <div class="modal-header"><h3>Edit Term</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Term Name</label><input type="text" class="form-control" id="editTermName" value="${name}"></div>
      <div class="form-group"><label>Start Date</label><input type="date" class="form-control" id="editTermStart" value="${startDate}"></div>
      <div class="form-group"><label>End Date</label><input type="date" class="form-control" id="editTermEnd" value="${endDate}"></div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="editTermActive" ${activeStatus ? 'checked' : ''}>
          <span>Term Active</span>
        </label>
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="editTermFeedbackVisible" ${feedbackVisible ? 'checked' : ''}>
          <span>Feedback Visible to Teachers</span>
        </label>
        <p style="font-size:0.85rem;color:var(--gray-500);margin-top:4px">When unchecked, feedback from this term will be hidden from teacher dashboards</p>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="updateTerm(${termId})">Save Changes</button>
    </div>
  `);
}

async function updateTerm(termId) {
  const name = document.getElementById('editTermName').value;
  const start_date = document.getElementById('editTermStart').value;
  const end_date = document.getElementById('editTermEnd').value;
  const active_status = document.getElementById('editTermActive').checked ? 1 : 0;
  const feedback_visible = document.getElementById('editTermFeedbackVisible').checked ? 1 : 0;

  if (!name || !start_date || !end_date) return toast('Fill all fields', 'error');

  try {
    await API.put(`/admin/terms/${termId}`, { name, start_date, end_date, active_status, feedback_visible });
    toast('Term updated successfully');
    closeModal();
    renderAdminTerms();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteTerm(termId, termName) {
  const confirmed = confirm(
    `⚠️ DELETE TERM: "${termName}"?\n\n` +
    `This will permanently delete:\n` +
    `• All feedback periods for this term\n` +
    `• All student reviews from this term\n` +
    `• All classrooms linked to this term\n\n` +
    `This action CANNOT be undone!\n\n` +
    `Type "DELETE" to confirm:`
  );

  if (!confirmed) return;

  // Additional confirmation with text input
  const doubleConfirm = prompt(`To confirm deletion of "${termName}", type DELETE in capital letters:`);

  if (doubleConfirm !== 'DELETE') {
    return toast('Deletion cancelled', 'info');
  }

  try {
    await API.delete(`/admin/terms/${termId}`);
    toast('Term and all associated data deleted', 'success');
    renderAdminTerms();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function renderAdminClassrooms() {
  const classrooms = await API.get('/admin/classrooms');
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <h2>Classroom Management (${classrooms.length})</h2>
      <button class="btn btn-primary" onclick="showCreateClassroom()">+ Create Classroom</button>
    </div>
    <div class="card">
      <div class="table-container">
        <table>
          <thead><tr><th>Subject</th><th>Teacher</th><th>Grade</th><th>Term</th><th>Students</th><th>Join Code</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${classrooms.map(c => `
              <tr>
                <td><strong>${c.subject}</strong></td>
                <td>${c.teacher_name || '-'}</td>
                <td>${c.grade_level}</td>
                <td>${c.term_name}</td>
                <td>${c.student_count || 0}</td>
                <td><code style="background:var(--gray-100);padding:2px 8px;border-radius:4px">${c.join_code}</code></td>
                <td><span class="badge ${c.active_status ? 'badge-active' : 'badge-inactive'}">${c.active_status ? 'Active' : 'Inactive'}</span></td>
                <td>
                  <button class="btn btn-sm btn-outline" onclick='editClassroom(${JSON.stringify(c)})'>Edit</button>
                  <button class="btn btn-sm btn-danger" onclick="deleteClassroom(${c.id}, '${c.subject}')">Delete</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function showCreateClassroom() {
  // Get teachers and terms for dropdown
  Promise.all([
    API.get('/admin/teachers'),
    API.get('/admin/terms')
  ]).then(([teachers, terms]) => {
    const activeTerms = terms.filter(t => t.active_status === 1);
    openModal(`
      <div class="modal-header"><h3>Create Classroom</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
      <div class="modal-body">
        <div class="form-group">
          <label>Subject *</label>
          <input type="text" class="form-control" id="newClassroomSubject" placeholder="e.g. Mathematics, English">
        </div>
        <div class="form-group">
          <label>Grade Level *</label>
          <input type="text" class="form-control" id="newClassroomGrade" placeholder="e.g. Grade 10, Year 12">
        </div>
        <div class="form-group">
          <label>Teacher *</label>
          <select class="form-control" id="newClassroomTeacher">
            <option value="">Select teacher...</option>
            ${teachers.map(t => `<option value="${t.id}">${t.full_name} - ${t.subject || 'No subject'}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Term *</label>
          <select class="form-control" id="newClassroomTerm">
            <option value="">Select term...</option>
            ${terms.map(t => `<option value="${t.id}" ${t.active_status ? 'selected' : ''}>${t.name} ${t.active_status ? '(Active)' : ''}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="createClassroom()">Create</button>
      </div>
    `);
  });
}

async function createClassroom() {
  const body = {
    subject: document.getElementById('newClassroomSubject').value,
    grade_level: document.getElementById('newClassroomGrade').value,
    teacher_id: parseInt(document.getElementById('newClassroomTeacher').value),
    term_id: parseInt(document.getElementById('newClassroomTerm').value)
  };
  if (!body.subject || !body.grade_level || !body.teacher_id || !body.term_id) {
    return toast('All fields are required', 'error');
  }
  try {
    await API.post('/classrooms', body);
    toast('Classroom created successfully');
    closeModal();
    renderAdminClassrooms();
  } catch (err) { toast(err.message, 'error'); }
}

function editClassroom(classroom) {
  Promise.all([
    API.get('/admin/teachers'),
    API.get('/admin/terms')
  ]).then(([teachers, terms]) => {
    openModal(`
      <div class="modal-header"><h3>Edit Classroom: ${classroom.subject}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
      <div class="modal-body">
        <div class="form-group">
          <label>Subject</label>
          <input type="text" class="form-control" id="editClassroomSubject" value="${classroom.subject}">
        </div>
        <div class="form-group">
          <label>Grade Level</label>
          <input type="text" class="form-control" id="editClassroomGrade" value="${classroom.grade_level}">
        </div>
        <div class="form-group">
          <label>Teacher</label>
          <select class="form-control" id="editClassroomTeacher">
            ${teachers.map(t => `<option value="${t.id}" ${t.id === classroom.teacher_id ? 'selected' : ''}>${t.full_name} - ${t.subject || 'No subject'}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Term</label>
          <select class="form-control" id="editClassroomTerm">
            ${terms.map(t => `<option value="${t.id}" ${t.id === classroom.term_id ? 'selected' : ''}>${t.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Status</label>
          <select class="form-control" id="editClassroomStatus">
            <option value="1" ${classroom.active_status ? 'selected' : ''}>Active</option>
            <option value="0" ${!classroom.active_status ? 'selected' : ''}>Inactive</option>
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveClassroomEdit(${classroom.id})">Save Changes</button>
      </div>
    `);
  });
}

async function saveClassroomEdit(classroomId) {
  const body = {
    subject: document.getElementById('editClassroomSubject').value,
    grade_level: document.getElementById('editClassroomGrade').value,
    teacher_id: parseInt(document.getElementById('editClassroomTeacher').value),
    term_id: parseInt(document.getElementById('editClassroomTerm').value),
    active_status: parseInt(document.getElementById('editClassroomStatus').value)
  };
  try {
    await API.put(`/admin/classrooms/${classroomId}`, body);
    toast('Classroom updated successfully');
    closeModal();
    renderAdminClassrooms();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteClassroom(classroomId, subject) {
  if (!confirm(`Delete classroom "${subject}"? This will remove all student enrollments.`)) return;
  try {
    await API.delete(`/admin/classrooms/${classroomId}`);
    toast('Classroom deleted successfully');
    renderAdminClassrooms();
  } catch (err) { toast(err.message, 'error'); }
}

async function renderAdminModerate() {
  const reviews = await API.get('/admin/reviews/pending');
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <p style="color:var(--gray-500)">${reviews.length} review(s) awaiting moderation</p>
      ${reviews.length > 0 ? `<button class="btn btn-success" onclick="bulkApproveAll(${JSON.stringify(reviews.map(r => r.id))})">✓ Approve All (${reviews.length})</button>` : ''}
    </div>
    ${reviews.length === 0
      ? '<div class="card"><div class="card-body"><div class="empty-state"><h3>All clear!</h3><p>No reviews pending moderation</p></div></div></div>'
      : reviews.map(r => `
        <div class="card" style="margin-bottom:16px">
          <div class="card-body">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
              <div>
                <div><strong>${r.teacher_name}</strong> <span style="color:var(--gray-500);font-size:0.85rem">&middot; ${r.classroom_subject} (${r.grade_level}) &middot; ${r.period_name}</span></div>
                <div style="font-size:0.85rem;color:var(--gray-500);margin-top:4px">From: <strong>${r.student_name}</strong> (${r.student_email})</div>
              </div>
              ${badgeHTML(r.flagged_status)}
            </div>
            <div class="review-ratings" style="margin-bottom:12px">
              <div class="rating-item"><span>Overall</span> ${starsHTML(r.overall_rating)}</div>
              <div class="rating-item"><span>Clarity</span><span>${r.clarity_rating}/5</span></div>
              <div class="rating-item"><span>Engagement</span><span>${r.engagement_rating}/5</span></div>
              <div class="rating-item"><span>Fairness</span><span>${r.fairness_rating}/5</span></div>
              <div class="rating-item"><span>Supportiveness</span><span>${r.supportiveness_rating}/5</span></div>
            </div>
            ${r.feedback_text ? `<div class="review-text">${r.feedback_text}</div>` : '<p style="color:var(--gray-400);font-size:0.85rem;font-style:italic">No written feedback</p>'}
            ${JSON.parse(r.tags || '[]').length > 0 ? `
              <div class="review-tags" style="margin-bottom:16px">
                ${JSON.parse(r.tags).map(t => `<span class="tag">${t}</span>`).join('')}
              </div>
            ` : ''}
            <div style="display:flex;gap:8px;margin-top:16px">
              <button class="btn btn-success" onclick="moderateReview(${r.id}, 'approve')">Approve</button>
              <button class="btn btn-danger" onclick="moderateReview(${r.id}, 'reject')">Reject</button>
              <button class="btn btn-outline" onclick="if(confirm('Permanently delete?'))deleteReview(${r.id})">Delete</button>
            </div>
          </div>
        </div>
      `).join('')}
  `;
}

async function renderAdminFlagged() {
  const reviews = await API.get('/admin/reviews/flagged');
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div style="margin-bottom:16px">
      <p style="color:var(--gray-500)">${reviews.length} flagged review(s) need attention</p>
    </div>
    ${reviews.length === 0
      ? '<div class="card"><div class="card-body"><div class="empty-state"><h3>No flagged reviews</h3><p>All reviews are clean</p></div></div></div>'
      : reviews.map(r => `
        <div class="card" style="margin-bottom:16px;border-left:4px solid var(--danger)">
          <div class="card-body">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
              <div>
                <div><strong>${r.teacher_name}</strong> <span style="color:var(--gray-500);font-size:0.85rem">&middot; ${r.classroom_subject} &middot; ${r.period_name}</span></div>
                <div style="font-size:0.85rem;color:var(--gray-500);margin-top:4px">From: <strong>${r.student_name}</strong> (${r.student_email})</div>
              </div>
              <span class="badge badge-flagged">Flagged</span>
            </div>
            <div class="review-ratings" style="margin-bottom:12px">
              <div class="rating-item"><span>Overall</span>${starsHTML(r.overall_rating)}</div>
              <div class="rating-item"><span>Clarity</span><span>${r.clarity_rating}/5</span></div>
              <div class="rating-item"><span>Engagement</span><span>${r.engagement_rating}/5</span></div>
              <div class="rating-item"><span>Fairness</span><span>${r.fairness_rating}/5</span></div>
            </div>
            ${r.feedback_text ? `<div class="review-text" style="border-left:3px solid var(--danger)">${r.feedback_text}</div>` : ''}
            <div style="display:flex;gap:8px;margin-top:16px">
              <button class="btn btn-success" onclick="moderateReview(${r.id}, 'approve')">Approve Anyway</button>
              <button class="btn btn-danger" onclick="moderateReview(${r.id}, 'reject')">Reject</button>
              <button class="btn btn-outline" onclick="if(confirm('Permanently delete?'))deleteReview(${r.id})">Delete</button>
            </div>
          </div>
        </div>
      `).join('')}
  `;
}

async function moderateReview(id, action) {
  try {
    await API.put(`/admin/reviews/${id}/${action}`);
    toast(`Review ${action}d`);
    if (currentView === 'admin-moderate') renderAdminModerate();
    else if (currentView === 'admin-flagged') renderAdminFlagged();
  } catch (err) { toast(err.message, 'error'); }
}

async function bulkApproveAll(reviewIds) {
  if (!confirm(`Approve all ${reviewIds.length} pending reviews at once?`)) return;
  try {
    await API.post('/admin/reviews/bulk-approve', { review_ids: reviewIds });
    toast(`Successfully approved ${reviewIds.length} reviews!`, 'success');
    renderAdminModerate();
  } catch (err) { toast(err.message, 'error'); }
}

async function deleteReview(id) {
  try {
    await API.delete(`/admin/reviews/${id}`);
    toast('Review deleted');
    if (currentView === 'admin-moderate') renderAdminModerate();
    else if (currentView === 'admin-flagged') renderAdminFlagged();
  } catch (err) { toast(err.message, 'error'); }
}

function editTeacher(teacher) {
  openModal(`
    <div class="modal-header"><h3>Edit Teacher: ${teacher.full_name}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label>Full Name</label>
        <input type="text" class="form-control" id="editTeacherName" value="${teacher.full_name}">
      </div>
      <div class="form-group">
        <label>Subject</label>
        <input type="text" class="form-control" id="editTeacherSubject" value="${teacher.subject || ''}">
      </div>
      <div class="form-group">
        <label>Department</label>
        <input type="text" class="form-control" id="editTeacherDept" value="${teacher.department || ''}">
      </div>
      <div class="form-group">
        <label>Years of Experience</label>
        <input type="number" class="form-control" id="editTeacherExp" value="${teacher.experience_years || 0}" min="0">
      </div>
      <div class="form-group">
        <label>Bio</label>
        <textarea class="form-control" id="editTeacherBio" rows="3">${teacher.bio || ''}</textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveTeacherEdit(${teacher.id})">Save Changes</button>
    </div>
  `);
}

async function saveTeacherEdit(teacherId) {
  const body = {
    full_name: document.getElementById('editTeacherName').value,
    subject: document.getElementById('editTeacherSubject').value,
    department: document.getElementById('editTeacherDept').value,
    experience_years: parseInt(document.getElementById('editTeacherExp').value) || 0,
    bio: document.getElementById('editTeacherBio').value
  };
  if (!body.full_name) return toast('Name is required', 'error');
  try {
    await API.put(`/admin/teachers/${teacherId}`, body);
    toast('Teacher profile updated successfully');
    closeModal();
    renderAdminTeachers();
  } catch (err) { toast(err.message, 'error'); }
}

// ============ ADMIN: TEACHER FEEDBACK VIEWER ============
async function renderAdminTeachers() {
  const teachers = await API.get('/admin/teachers');
  const el = document.getElementById('contentArea');

  el.innerHTML = `
    <div class="card">
      <div class="card-header"><h3>All Teachers (${teachers.length})</h3></div>
      <div class="card-body">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Subject</th>
              <th>Department</th>
              <th>Avg Rating</th>
              <th>Reviews</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${teachers.map(t => `
              <tr>
                <td><strong>${t.full_name}</strong></td>
                <td>${t.subject || '-'}</td>
                <td>${t.department || '-'}</td>
                <td style="font-weight:600;color:${scoreColor(t.scores?.avg_overall || 0)}">${t.scores?.avg_overall || 'N/A'}</td>
                <td>${t.scores?.review_count || 0}</td>
                <td>
                  <button class="btn btn-sm btn-outline" onclick='editTeacher(${JSON.stringify(t)})'>Edit</button>
                  <button class="btn btn-sm btn-primary" onclick="viewTeacherFeedback(${t.id})">View Feedback</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function viewTeacherFeedback(teacherId) {
  const data = await API.get(`/admin/teacher/${teacherId}/feedback`);
  openModal(`
    <div class="modal-header">
      <h2>Feedback for ${data.teacher.full_name}</h2>
      <button onclick="closeModal()" style="background:none;border:none;font-size:1.5rem;cursor:pointer">&times;</button>
    </div>
    <div class="modal-body">
      <div style="margin-bottom:20px;padding:16px;background:var(--gray-50);border-radius:var(--radius-md)">
        <div style="display:flex;justify-content:space-around;text-align:center">
          <div>
            <div style="font-size:2rem;font-weight:700;color:${scoreColor(data.scores.avg_overall || 0)}">${data.scores.avg_overall || 'N/A'}</div>
            <div style="color:var(--gray-500);font-size:0.85rem">Overall Rating</div>
          </div>
          <div>
            <div style="font-size:2rem;font-weight:700">${data.scores.review_count}</div>
            <div style="color:var(--gray-500);font-size:0.85rem">Total Reviews</div>
          </div>
        </div>
      </div>

      <div style="max-height:400px;overflow-y:auto">
        ${data.reviews.length === 0 ? '<div class="empty-state"><p>No approved reviews yet</p></div>' : data.reviews.map(r => `
          <div style="padding:12px;border:1px solid var(--gray-200);border-radius:var(--radius-md);margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px">
              <div>
                <strong>${r.student_name}</strong>
                <span style="color:var(--gray-500);font-size:0.85rem"> (${r.student_email})</span>
              </div>
              ${starsHTML(r.overall_rating)}
            </div>
            <div style="font-size:0.85rem;color:var(--gray-500);margin-bottom:8px">
              ${r.classroom_subject} (${r.grade_level}) &middot; ${r.period_name}
            </div>
            ${r.feedback_text ? `<div style="padding:8px;background:var(--gray-50);border-radius:var(--radius-sm);font-size:0.9rem">${r.feedback_text}</div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `);
}

// ============ ADMIN: SUBMISSION TRACKING ============
async function renderAdminSubmissions() {
  const periods = await API.get('/admin/feedback-periods');
  const activePeriod = periods.find(p => p.active_status === 1);
  const el = document.getElementById('contentArea');

  if (!activePeriod) {
    el.innerHTML = '<div class="card"><div class="card-body"><div class="empty-state"><h3>No active feedback period</h3><p>Activate a feedback period to track submissions</p></div></div></div>';
    return;
  }

  const overview = await API.get(`/admin/submission-overview?feedback_period_id=${activePeriod.id}`);

  el.innerHTML = `
    <div class="card" style="margin-bottom:24px">
      <div class="card-header">
        <h3>Submission Overview - ${activePeriod.name} (${activePeriod.term_name})</h3>
      </div>
      <div class="card-body">
        <div class="grid grid-4" style="margin-bottom:24px">
          <div class="stat-card"><div class="stat-label">Total Classrooms</div><div class="stat-value">${overview.summary.total_classrooms}</div></div>
          <div class="stat-card"><div class="stat-label">Total Students</div><div class="stat-value">${overview.summary.total_students}</div></div>
          <div class="stat-card"><div class="stat-label">Submitted</div><div class="stat-value" style="color:var(--success)">${overview.summary.total_submitted}</div></div>
          <div class="stat-card"><div class="stat-label">Completion Rate</div><div class="stat-value" style="color:${overview.summary.overall_completion_rate >= 70 ? 'var(--success)' : 'var(--warning)'}">${overview.summary.overall_completion_rate}%</div></div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Classroom</th>
              <th>Teacher</th>
              <th>Total Students</th>
              <th>Submitted</th>
              <th>Not Submitted</th>
              <th>Completion Rate</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${overview.classrooms.map(c => `
              <tr>
                <td><strong>${c.subject} (${c.grade_level})</strong></td>
                <td>${c.teacher_name}</td>
                <td>${c.total_students}</td>
                <td style="color:var(--success);font-weight:600">${c.submitted_count}</td>
                <td style="color:${c.not_submitted > 0 ? 'var(--danger)' : 'var(--gray-400)'};font-weight:600">${c.not_submitted}</td>
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <div style="flex:1;height:8px;background:var(--gray-200);border-radius:4px;overflow:hidden">
                      <div style="width:${c.completion_rate}%;height:100%;background:${c.completion_rate >= 70 ? 'var(--success)' : 'var(--warning)'}"></div>
                    </div>
                    <span style="font-weight:600;min-width:40px">${c.completion_rate}%</span>
                  </div>
                </td>
                <td><button class="btn btn-sm btn-outline" onclick="viewClassroomSubmissions(${c.id}, ${activePeriod.id})">View Details</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function viewClassroomSubmissions(classroomId, periodId) {
  const data = await API.get(`/admin/submission-tracking?classroom_id=${classroomId}&feedback_period_id=${periodId}`);

  openModal(`
    <div class="modal-header">
      <h2>${data.classroom.subject} (${data.classroom.grade_level}) - ${data.classroom.teacher_name}</h2>
      <button onclick="closeModal()" style="background:none;border:none;font-size:1.5rem;cursor:pointer">&times;</button>
    </div>
    <div class="modal-body">
      <div style="margin-bottom:20px">
        <strong>${data.summary.submitted}/${data.summary.total_students}</strong> students submitted (${data.summary.completion_rate}%)
      </div>

      <div style="max-height:400px;overflow-y:auto">
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Grade</th>
              <th>Status</th>
              <th>Rating</th>
              <th>Submitted At</th>
            </tr>
          </thead>
          <tbody>
            ${data.students.map(s => `
              <tr>
                <td><strong>${s.full_name}</strong><br><span style="font-size:0.85rem;color:var(--gray-500)">${s.email}</span></td>
                <td>${s.grade_or_position || '-'}</td>
                <td>
                  ${s.submitted
                    ? `<span class="badge badge-approved">Submitted</span>`
                    : `<span class="badge badge-rejected">Not Submitted</span>`}
                </td>
                <td>${s.submitted ? starsHTML(s.overall_rating) : '-'}</td>
                <td>${s.submitted_at ? new Date(s.submitted_at).toLocaleString() : '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `);
}

// ============ ADMIN: SUPPORT MESSAGES ============
async function renderAdminSupport() {
  const { messages, total } = await API.get('/admin/support/messages?limit=100');
  const stats = await API.get('/admin/support/stats');
  const el = document.getElementById('contentArea');

  const categoryLabels = {
    technical: 'Technical Issue / Bug',
    account: 'Account & Login',
    question: 'General Question',
    feature: 'Feature Request',
    other: 'Other'
  };

  el.innerHTML = `
    <div class="stats-grid" style="margin-bottom:20px">
      <div class="stat-card">
        <div class="stat-label">Total Messages</div>
        <div class="stat-value">${stats.total}</div>
      </div>
      <div class="stat-card" style="background:var(--warning-light);border-left:4px solid var(--warning)">
        <div class="stat-label">New</div>
        <div class="stat-value">${stats.new}</div>
      </div>
      <div class="stat-card" style="background:#e3f2fd;border-left:4px solid var(--primary)">
        <div class="stat-label">In Progress</div>
        <div class="stat-value">${stats.in_progress}</div>
      </div>
      <div class="stat-card" style="background:var(--success-light);border-left:4px solid var(--success)">
        <div class="stat-label">Resolved</div>
        <div class="stat-value">${stats.resolved}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3>Support Messages (${total} total)</h3>
      </div>
      <div class="card-body">
        ${messages.length === 0 ? `
          <div class="empty-state">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>
            <h3>No Support Messages</h3>
            <p>When users submit support requests, they will appear here.</p>
          </div>
        ` : `
          <div style="overflow-x:auto">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>User</th>
                  <th>Category</th>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${messages.map(msg => `
                  <tr>
                    <td style="white-space:nowrap;font-size:0.85rem">${new Date(msg.created_at).toLocaleString()}</td>
                    <td>
                      <div><strong>${msg.user_name}</strong></div>
                      <div style="font-size:0.85rem;color:var(--gray-500)">${msg.user_email}</div>
                      <div><span class="badge badge-pending">${msg.user_role}</span></div>
                    </td>
                    <td><span class="badge badge-approved">${categoryLabels[msg.category]}</span></td>
                    <td style="max-width:300px">
                      <strong>${msg.subject}</strong>
                    </td>
                    <td>
                      <span class="badge ${
                        msg.status === 'new' ? 'badge-flagged' :
                        msg.status === 'in_progress' ? 'badge-pending' :
                        'badge-approved'
                      }">${msg.status.replace('_', ' ')}</span>
                    </td>
                    <td style="white-space:nowrap">
                      <button class="btn btn-sm btn-outline" onclick="viewSupportMessage(${msg.id})">View</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </div>
  `;
}

async function viewSupportMessage(id) {
  const message = await API.get(`/admin/support/messages?limit=1000`).then(data =>
    data.messages.find(m => m.id === id)
  );

  if (!message) {
    return toast('Message not found', 'error');
  }

  const categoryLabels = {
    technical: 'Technical Issue / Bug',
    account: 'Account & Login',
    question: 'General Question',
    feature: 'Feature Request',
    other: 'Other'
  };

  openModal(`
    <div class="modal-header">
      <h3>Support Message #${message.id}</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div class="modal-body">
      <div style="background:var(--gray-50);padding:16px;border-radius:8px;margin-bottom:20px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:12px">
          <div>
            <div style="font-size:0.75rem;color:var(--gray-500);margin-bottom:4px">FROM</div>
            <div style="font-weight:600">${message.user_name}</div>
            <div style="font-size:0.85rem;color:var(--gray-600)">${message.user_email}</div>
            <span class="badge badge-pending" style="margin-top:4px;display:inline-block">${message.user_role}</span>
          </div>
          <div>
            <div style="font-size:0.75rem;color:var(--gray-500);margin-bottom:4px">DATE</div>
            <div>${new Date(message.created_at).toLocaleString()}</div>
            <div style="margin-top:8px">
              <div style="font-size:0.75rem;color:var(--gray-500);margin-bottom:4px">CATEGORY</div>
              <span class="badge badge-approved">${categoryLabels[message.category]}</span>
            </div>
          </div>
        </div>

        <div style="margin-bottom:12px">
          <div style="font-size:0.75rem;color:var(--gray-500);margin-bottom:4px">STATUS</div>
          <span class="badge ${
            message.status === 'new' ? 'badge-flagged' :
            message.status === 'in_progress' ? 'badge-pending' :
            'badge-approved'
          }">${message.status.replace('_', ' ')}</span>
        </div>
      </div>

      <div style="margin-bottom:20px">
        <div style="font-weight:600;margin-bottom:8px">Subject:</div>
        <div style="font-size:1.1rem">${message.subject}</div>
      </div>

      <div style="margin-bottom:20px">
        <div style="font-weight:600;margin-bottom:8px">Message:</div>
        <div style="background:#fff;padding:16px;border:1px solid var(--gray-200);border-radius:8px;white-space:pre-wrap">${message.message}</div>
      </div>

      ${message.admin_notes ? `
        <div style="margin-bottom:20px">
          <div style="font-weight:600;margin-bottom:8px">Admin Notes:</div>
          <div style="background:var(--success-light);padding:16px;border-radius:8px;white-space:pre-wrap">${message.admin_notes}</div>
        </div>
      ` : ''}

      ${message.resolved_at ? `
        <div style="color:var(--gray-600);font-size:0.85rem">
          Resolved on ${new Date(message.resolved_at).toLocaleString()}
        </div>
      ` : ''}

      <div style="margin-top:20px">
        <label style="display:block;margin-bottom:8px;font-weight:600">Update Status:</label>
        <select class="form-control" id="supportMessageStatus" style="margin-bottom:12px">
          <option value="new" ${message.status === 'new' ? 'selected' : ''}>New</option>
          <option value="in_progress" ${message.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
          <option value="resolved" ${message.status === 'resolved' ? 'selected' : ''}>Resolved</option>
        </select>

        <label style="display:block;margin-bottom:8px;font-weight:600">Admin Notes (optional):</label>
        <textarea class="form-control" id="supportMessageNotes" rows="3" placeholder="Add internal notes about this support request...">${message.admin_notes || ''}</textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="deleteSupportMessage(${message.id})">Delete</button>
      <button class="btn btn-outline" onclick="closeModal()">Close</button>
      <button class="btn btn-primary" onclick="updateSupportMessage(${message.id})">Update</button>
    </div>
  `);
}

async function updateSupportMessage(id) {
  const status = document.getElementById('supportMessageStatus').value;
  const admin_notes = document.getElementById('supportMessageNotes').value;

  try {
    await API.put(`/admin/support/messages/${id}`, { status, admin_notes });
    toast('Support message updated successfully', 'success');
    closeModal();
    navigateTo('admin-support');
  } catch (error) {
    toast(error.message || 'Failed to update support message', 'error');
  }
}

async function deleteSupportMessage(id) {
  if (!confirm('Are you sure you want to delete this support message? This action cannot be undone.')) {
    return;
  }

  try {
    await API.delete(`/admin/support/messages/${id}`);
    toast('Support message deleted successfully', 'success');
    closeModal();
    navigateTo('admin-support');
  } catch (error) {
    toast(error.message || 'Failed to delete support message', 'error');
  }
}

// ============ ADMIN: AUDIT LOGS ============
let currentAuditPage = 1;
const LOGS_PER_PAGE = 50;

async function renderAdminAudit(page = 1) {
  currentAuditPage = page;
  const offset = (page - 1) * LOGS_PER_PAGE;

  // Get total count and logs for current page
  const [allLogs, pagedLogs] = await Promise.all([
    API.get('/admin/audit-logs?limit=10000'), // Get all to count total
    API.get(`/admin/audit-logs?limit=${LOGS_PER_PAGE}&offset=${offset}`)
  ]);

  const totalLogs = allLogs.length;
  const totalPages = Math.ceil(totalLogs / LOGS_PER_PAGE);
  const el = document.getElementById('contentArea');

  // Generate pagination buttons
  const paginationHTML = totalPages > 1 ? `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:20px;padding:0 16px">
      <div style="color:var(--gray-600);font-size:0.9rem">
        Showing ${offset + 1}-${Math.min(offset + LOGS_PER_PAGE, totalLogs)} of ${totalLogs} logs
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline btn-sm" onclick="renderAdminAudit(1)" ${page === 1 ? 'disabled' : ''}>First</button>
        <button class="btn btn-outline btn-sm" onclick="renderAdminAudit(${page - 1})" ${page === 1 ? 'disabled' : ''}>Previous</button>
        ${Array.from({length: Math.min(5, totalPages)}, (_, i) => {
          let pageNum;
          if (totalPages <= 5) {
            pageNum = i + 1;
          } else if (page <= 3) {
            pageNum = i + 1;
          } else if (page >= totalPages - 2) {
            pageNum = totalPages - 4 + i;
          } else {
            pageNum = page - 2 + i;
          }
          return `<button class="btn ${pageNum === page ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="renderAdminAudit(${pageNum})">${pageNum}</button>`;
        }).join('')}
        <button class="btn btn-outline btn-sm" onclick="renderAdminAudit(${page + 1})" ${page === totalPages ? 'disabled' : ''}>Next</button>
        <button class="btn btn-outline btn-sm" onclick="renderAdminAudit(${totalPages})" ${page === totalPages ? 'disabled' : ''}>Last</button>
      </div>
    </div>
  ` : '';

  el.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3>Audit Logs - All Actions (${totalLogs} total)</h3>
        <p style="margin:4px 0 0;color:var(--gray-600);font-size:0.9rem">Page ${page} of ${totalPages}</p>
      </div>
      <div class="card-body">
        <div style="overflow-x:auto">
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Role</th>
                <th>Action</th>
                <th>Description</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              ${pagedLogs.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--gray-400)">No audit logs yet</td></tr>' : pagedLogs.map(log => `
                <tr>
                  <td style="white-space:nowrap;font-size:0.85rem">${new Date(log.created_at).toLocaleString()}</td>
                  <td><strong>${log.user_name}</strong></td>
                  <td><span class="badge ${log.user_role === 'admin' ? 'badge-flagged' : 'badge-pending'}">${log.user_role}</span></td>
                  <td><code style="font-size:0.85rem">${log.action_type}</code></td>
                  <td style="max-width:300px">${log.action_description}</td>
                  <td>${log.target_type ? `<span class="badge badge-approved">${log.target_type} #${log.target_id}</span>` : '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${paginationHTML}
      </div>
    </div>
  `;
}

// ============ ACCOUNT DETAILS ============
async function renderAccount() {
  const data = await API.get('/auth/me');
  currentUser = data.user;
  const u = currentUser;
  const el = document.getElementById('contentArea');

  const memberSince = new Date(u.created_at).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  el.innerHTML = `
    <div class="grid grid-2">
      <!-- Profile Info -->
      <div class="card">
        <div class="card-header"><h3>Profile Information</h3></div>
        <div class="card-body">
          <div style="display:flex;align-items:center;gap:20px;margin-bottom:28px">
            <div style="width:72px;height:72px;background:var(--primary);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.5rem;font-weight:700;flex-shrink:0">
              ${u.full_name.split(' ').map(n => n[0]).join('')}
            </div>
            <div>
              <div style="font-size:1.25rem;font-weight:600">${u.full_name}</div>
              <div style="color:var(--gray-500);font-size:0.9rem">${u.email}</div>
              <div style="margin-top:6px">
                <span class="badge ${u.role === 'admin' ? 'badge-flagged' : u.role === 'teacher' ? 'badge-active' : u.role === 'school_head' ? 'badge-approved' : 'badge-pending'}">${u.role.replace('_', ' ')}</span>
              </div>
            </div>
          </div>

          <form onsubmit="updateProfile(event)">
            <div class="form-group">
              <label>Full Name</label>
              <input type="text" class="form-control" id="profileName" value="${u.full_name}" required>
            </div>
            <div class="form-group">
              <label>Email</label>
              <input type="email" class="form-control" value="${u.email}" disabled style="background:var(--gray-50);color:var(--gray-500)">
              <p style="font-size:0.75rem;color:var(--gray-400);margin-top:4px">Email cannot be changed</p>
            </div>
            <div class="form-group">
              <label>${u.role === 'student' ? 'Grade' : 'Position'}</label>
              <input type="text" class="form-control" id="profileGrade" value="${u.grade_or_position || ''}">
            </div>
            ${u.role === 'teacher' && data.teacher ? `
              <div class="form-group">
                <label>Subject</label>
                <input type="text" class="form-control" id="profileSubject" value="${data.teacher.subject || ''}" placeholder="e.g. Mathematics, English">
              </div>
              <div class="form-group">
                <label>Department</label>
                <input type="text" class="form-control" id="profileDepartment" value="${data.teacher.department || ''}" placeholder="e.g. Science, Arts">
              </div>
              <div class="form-group">
                <label>Bio</label>
                <textarea class="form-control" id="profileBio" rows="4" placeholder="Tell students about yourself...">${data.teacher.bio || ''}</textarea>
              </div>
            ` : ''}
            <div class="form-group">
              <label>Role</label>
              <input type="text" class="form-control" value="${u.role.replace('_', ' ')}" disabled style="background:var(--gray-50);color:var(--gray-500);text-transform:capitalize">
            </div>
            <div class="form-group">
              <label>Member Since</label>
              <input type="text" class="form-control" value="${memberSince}" disabled style="background:var(--gray-50);color:var(--gray-500)">
            </div>
            <button type="submit" class="btn btn-primary" id="saveProfileBtn">Save Changes</button>
          </form>
        </div>
      </div>

      <!-- Change Password -->
      <div>
        <div class="card" style="margin-bottom:24px">
          <div class="card-header"><h3>Change Password</h3></div>
          <div class="card-body">
            <form onsubmit="changePassword(event)">
              <div class="form-group">
                <label>Current Password</label>
                <input type="password" class="form-control" id="currentPassword" required placeholder="Enter current password">
              </div>
              <div class="form-group">
                <label>New Password</label>
                <input type="password" class="form-control" id="newPassword" required placeholder="Min. 8 characters" minlength="8">
                <p style="font-size:0.75rem;color:var(--gray-400);margin-top:4px">Must include uppercase, lowercase, and a number</p>
              </div>
              <div class="form-group">
                <label>Confirm New Password</label>
                <input type="password" class="form-control" id="confirmPassword" required placeholder="Re-enter new password">
              </div>
              <button type="submit" class="btn btn-primary" id="changePwBtn">Change Password</button>
            </form>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Account Status</h3></div>
          <div class="card-body">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--gray-100)">
              <span>Verification</span>
              <span class="badge badge-approved">Verified</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--gray-100)">
              <span>Account Status</span>
              <span class="badge ${u.suspended ? 'badge-rejected' : 'badge-approved'}">${u.suspended ? 'Suspended' : 'Active'}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0">
              <span>School ID</span>
              <span style="font-weight:600">${u.school_id}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function updateProfile(e) {
  e.preventDefault();
  const btn = document.getElementById('saveProfileBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    const body = {
      full_name: document.getElementById('profileName').value.trim(),
      grade_or_position: document.getElementById('profileGrade').value.trim()
    };

    // Add teacher-specific fields if teacher
    if (currentUser.role === 'teacher') {
      const subjectEl = document.getElementById('profileSubject');
      const deptEl = document.getElementById('profileDepartment');
      const bioEl = document.getElementById('profileBio');
      if (subjectEl) body.subject = subjectEl.value.trim();
      if (deptEl) body.department = deptEl.value.trim();
      if (bioEl) body.bio = bioEl.value.trim();
    }

    const data = await API.put('/auth/update-profile', body);
    currentUser = data.user;
    // Update sidebar
    document.getElementById('userName').textContent = data.user.full_name;
    document.getElementById('userAvatar').textContent = data.user.full_name.split(' ').map(n => n[0]).join('');
    toast('Profile updated');
  } catch (err) {
    toast(err.message, 'error');
  }
  btn.disabled = false;
  btn.textContent = 'Save Changes';
}

async function changePassword(e) {
  e.preventDefault();
  const newPw = document.getElementById('newPassword').value;
  const confirmPw = document.getElementById('confirmPassword').value;

  if (newPw !== confirmPw) {
    return toast('New passwords do not match', 'error');
  }

  const btn = document.getElementById('changePwBtn');
  btn.disabled = true;
  btn.textContent = 'Changing...';
  try {
    await API.put('/auth/change-password', {
      current_password: document.getElementById('currentPassword').value,
      new_password: newPw
    });
    toast('Password changed successfully');
    document.getElementById('currentPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
  } catch (err) {
    toast(err.message, 'error');
  }
  btn.disabled = false;
  btn.textContent = 'Change Password';
}

function showSupportModal() {
  openModal(`
    <div class="modal-header">
      <h3>Contact Support</h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div class="modal-body">
      <p style="margin-bottom:20px;color:var(--gray-600)">
        Have a question, found a bug, or need help? Fill out the form below and our support team will get back to you.
      </p>
      <form onsubmit="submitSupportRequest(event)">
        <div class="form-group">
          <label>Category *</label>
          <select class="form-control" id="supportCategory" required>
            <option value="">Select a category...</option>
            <option value="technical">Technical Issue / Bug</option>
            <option value="account">Account & Login</option>
            <option value="question">General Question</option>
            <option value="feature">Feature Request</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div class="form-group">
          <label>Subject *</label>
          <input type="text" class="form-control" id="supportSubject" required placeholder="Brief description of your issue">
        </div>
        <div class="form-group">
          <label>Message *</label>
          <textarea class="form-control" id="supportMessage" rows="6" required placeholder="Provide details about your question or issue..."></textarea>
        </div>
        <div style="background:var(--info-bg,#e0f2fe);border:1px solid var(--info,#06b6d4);border-radius:var(--radius-md);padding:12px;margin-top:16px">
          <div style="font-size:0.85rem;color:var(--gray-700)">
            <strong>Your info:</strong><br>
            Name: ${currentUser.full_name}<br>
            Email: ${currentUser.email}<br>
            Role: ${currentUser.role}
          </div>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitSupportRequest(event)">Send Request</button>
    </div>
  `);
}

async function submitSupportRequest(e) {
  if (e) e.preventDefault();

  const category = document.getElementById('supportCategory').value;
  const subject = document.getElementById('supportSubject').value;
  const message = document.getElementById('supportMessage').value;

  if (!category || !subject || !message) {
    return toast('Please fill in all fields', 'error');
  }

  if (subject.trim().length < 3) {
    return toast('Subject must be at least 3 characters', 'error');
  }

  if (message.trim().length < 10) {
    return toast('Message must be at least 10 characters', 'error');
  }

  try {
    await API.post('/support/message', { category, subject, message });
    toast('Support request submitted! An administrator will review it shortly.', 'success');
    closeModal();
  } catch (error) {
    toast(error.message || 'Failed to submit support request', 'error');
  }
}
