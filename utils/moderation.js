const PROFANITY_LIST = [
  'damn', 'hell', 'shit', 'fuck', 'ass', 'bitch', 'bastard', 'crap',
  'dick', 'piss', 'slut', 'whore', 'idiot', 'stupid', 'dumb',
  'moron', 'retard', 'kill', 'die', 'hate', 'suck', 'loser',
  'ugly', 'fat', 'disgusting', 'worthless', 'useless', 'pathetic'
];

const HARMFUL_PATTERNS = [
  /you\s+(should|need\s+to)\s+(die|kill|hurt)/i,
  /i\s+(hope|wish)\s+you\s+(die|get\s+hurt|fail)/i,
  /nobody\s+likes?\s+you/i,
  /worst\s+teacher\s+(ever|alive)/i,
  /go\s+(kill|hurt)\s+(yourself|urself)/i,
  /threat(en)?/i,
  /\b(racist|sexist|homophob)\w*/i,
];

const PERSONAL_INFO_PATTERNS = [
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,  // phone numbers
  /\b\d{3}[-]?\d{2}[-]?\d{4}\b/,     // SSN-like
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // email addresses
];

function moderateText(text) {
  if (!text || typeof text !== 'string') {
    return { flagged: false, reasons: [], severity: 'clean' };
  }

  const lower = text.toLowerCase();
  const reasons = [];
  let severity = 'clean';

  // Check profanity
  const foundProfanity = PROFANITY_LIST.filter(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    return regex.test(lower);
  });
  if (foundProfanity.length > 0) {
    reasons.push(`Contains inappropriate language: ${foundProfanity.join(', ')}`);
    severity = foundProfanity.length > 2 ? 'high' : 'medium';
  }

  // Check harmful patterns
  const harmfulMatches = HARMFUL_PATTERNS.filter(pattern => pattern.test(text));
  if (harmfulMatches.length > 0) {
    reasons.push('Contains potentially harmful or threatening language');
    severity = 'high';
  }

  // Check personal info
  const personalInfoMatches = PERSONAL_INFO_PATTERNS.filter(pattern => pattern.test(text));
  if (personalInfoMatches.length > 0) {
    reasons.push('May contain personal information (phone, email, etc.)');
    if (severity === 'clean') severity = 'medium';
  }

  // Check excessive caps (yelling)
  const capsRatio = (text.match(/[A-Z]/g) || []).length / text.length;
  if (text.length > 10 && capsRatio > 0.7) {
    reasons.push('Excessive use of capital letters');
    if (severity === 'clean') severity = 'low';
  }

  return {
    flagged: reasons.length > 0,
    reasons,
    severity,
    shouldAutoReject: severity === 'high'
  };
}

function sanitizeInput(text) {
  if (!text) return '';
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

module.exports = { moderateText, sanitizeInput };
