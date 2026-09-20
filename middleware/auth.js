const prisma = require('../lib/prisma');

// Any logged-in, non-blocked user. Blocking takes effect immediately (not just
// at next login) because we check the current DB row, not just the session.
async function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const current = await prisma.user.findUnique({ where: { id: req.session.user.id } });
    if (!current) { req.session.destroy(() => {}); return res.status(401).json({ error: 'Not logged in' }); }
    if (current.status === 'blocked') {
      req.session.destroy(() => {});
      return res.status(403).json({ error: 'Your account has been blocked. Contact an admin.' });
    }
    // keep session role in sync in case an admin changed it since login
    req.session.user.role = current.role;
    req.user = current;
    next();
  } catch (err) {
    next(err);
  }
}

// 'admin' or 'master_admin'
function requireAdmin(req, res, next) {
  if (!req.session.user || !['admin', 'master_admin'].includes(req.session.user.role)) {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

// 'master_admin' only
function requireMasterAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'master_admin') {
    return res.status(403).json({ error: 'Master admin only' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireMasterAdmin };
