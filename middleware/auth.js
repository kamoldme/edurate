const jwt = require('jsonwebtoken');
const db = require('../database');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = '24h';

const ROLE_HIERARCHY = {
  'super_admin': 5,
  'org_admin': 4,
  'school_head': 3,
  'teacher': 2,
  'student': 1
};

const VALID_ROLES = Object.keys(ROLE_HIERARCHY);

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, org_id: user.org_id || null },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function authenticate(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT u.id, u.full_name, u.email, u.role, u.grade_or_position, u.school_id, u.org_id, u.verified_status, u.suspended, u.avatar_url, u.language, o.name as org_name FROM users u LEFT JOIN organizations o ON u.org_id = o.id WHERE u.id = ?').get(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    if (user.suspended) {
      return res.status(403).json({ error: 'Account suspended. Contact administrator.' });
    }
    if (!user.verified_status) {
      return res.status(403).json({ error: 'Email not verified' });
    }
    // Check organization subscription status for non-super_admin users
    if (user.role !== 'super_admin' && user.org_id) {
      const org = db.prepare('SELECT subscription_status FROM organizations WHERE id = ?').get(user.org_id);
      if (org && org.subscription_status === 'suspended') {
        return res.status(403).json({ error: 'Your organization has been suspended. Contact the platform administrator.' });
      }
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function authorizeOrg(req, res, next) {
  // super_admin can access any org (uses query param ?org_id=X to filter)
  if (req.user.role === 'super_admin') {
    req.orgId = req.query.org_id ? parseInt(req.query.org_id) : null;
    return next();
  }

  // For org_admin, school_head, teacher: enforce their own org
  if (['org_admin', 'school_head', 'teacher'].includes(req.user.role) && req.user.org_id) {
    req.orgId = req.user.org_id;
    return next();
  }

  // For students: derive org from context (query param or null)
  if (req.user.role === 'student') {
    req.orgId = req.query.org_id ? parseInt(req.query.org_id) : null;
    return next();
  }

  return res.status(403).json({ error: 'Organization context required' });
}

module.exports = { generateToken, authenticate, authorize, authorizeOrg, JWT_SECRET, ROLE_HIERARCHY, VALID_ROLES };
