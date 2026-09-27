const prisma = require('../lib/prisma');

const HEARTBEAT_THROTTLE_MS = 60 * 1000; // write lastActiveAt at most once a minute per login

// Shared by all three guards below: loads the current DB row (never trusts the
// session alone), enforces live blocking, keeps the session's role in sync, and
// throttled-touches this login's UserSession.lastActiveAt for accurate "time spent".
// Returns the current user row, the string 'blocked', or null (not logged in).
async function loadAndTouch(req) {
  if (!req.session.user) return null;

  const current = await prisma.user.findUnique({ where: { id: req.session.user.id } });
  if (!current) { req.session.destroy(() => {}); return null; }
  if (current.status === 'blocked') { req.session.destroy(() => {}); return 'blocked'; }

  req.session.user.role = current.role; // in case an admin changed it since login
  req.user = current;

  if (req.session.sessionRecordId) {
    const now = Date.now();
    if (!req.session.lastHeartbeatAt || now - req.session.lastHeartbeatAt > HEARTBEAT_THROTTLE_MS) {
      req.session.lastHeartbeatAt = now;
      // Best-effort - never let a heartbeat write failure block the actual request.
      prisma.userSession.update({
        where: { id: req.session.sessionRecordId },
        data: { lastActiveAt: new Date() }
      }).catch(() => {});
    }
  }
  return current;
}

async function requireAuth(req, res, next) {
  try {
    const result = await loadAndTouch(req);
    if (result === 'blocked') return res.status(403).json({ error: 'Your account has been blocked. Contact an admin.' });
    if (!result) return res.status(401).json({ error: 'Not logged in' });
    next();
  } catch (err) { next(err); }
}

// 'admin' or 'master_admin' - now also re-checks live block status (previously
// this only checked the session's role, so a blocked admin kept admin access
// until their cookie expired; requireAuth-guarded routes already caught it).
async function requireAdmin(req, res, next) {
  try {
    const result = await loadAndTouch(req);
    if (result === 'blocked') return res.status(403).json({ error: 'Your account has been blocked. Contact an admin.' });
    if (!result || !['admin', 'master_admin'].includes(result.role)) {
      return res.status(403).json({ error: 'Admin only' });
    }
    next();
  } catch (err) { next(err); }
}

// 'master_admin' only - same live-status fix as requireAdmin.
async function requireMasterAdmin(req, res, next) {
  try {
    const result = await loadAndTouch(req);
    if (result === 'blocked') return res.status(403).json({ error: 'Your account has been blocked. Contact an admin.' });
    if (!result || result.role !== 'master_admin') {
      return res.status(403).json({ error: 'Master admin only' });
    }
    next();
  } catch (err) { next(err); }
}

module.exports = { requireAuth, requireAdmin, requireMasterAdmin };
