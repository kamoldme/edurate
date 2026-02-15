const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Initialize database (creates tables on import)
require('./database');

const authRoutes = require('./routes/auth');
const classroomRoutes = require('./routes/classrooms');
const reviewRoutes = require('./routes/reviews');
const dashboardRoutes = require('./routes/dashboard');
const adminRoutes = require('./routes/admin');
const supportRoutes = require('./routes/support');
const teacherRoutes = require('./routes/teachers');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts. Please try again later.' }
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/classrooms', classroomRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/teachers', teacherRoutes);

// SPA fallback - serve app.html for /app routes
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 handler
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n  EduRate Server running at http://localhost:${PORT}\n`);
  console.log('  Test Accounts:');
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
});
