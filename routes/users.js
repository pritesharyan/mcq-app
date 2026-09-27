const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { requireAdmin, requireMasterAdmin } = require('../middleware/auth');
const { isTrialRestricted, TRIAL_PRACTICE_LIMIT } = require('../lib/trial');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Any admin or master admin can see the full (paginated, searchable) user list.
// GET /api/users?page=1&pageSize=10&q=jane
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.max(parseInt(req.query.pageSize, 10) || 10, 1);
    const { q } = req.query;

    const where = {};
    if (q && q.trim()) {
      const term = q.trim();
      where.OR = [
        { name: { contains: term } },
        { username: { contains: term } },
        { mobile: { contains: term } },
        { email: { contains: term } }
      ];
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { id: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, name: true, username: true, mobile: true, email: true, role: true, status: true, unlimitedAccess: true, createdAt: true }
      })
    ]);

    res.json({
      items: users.map(u => ({ ...u, trialRestricted: isTrialRestricted(u) })),
      total, page, pageSize, totalPages: Math.max(Math.ceil(total / pageSize), 1)
    });
  } catch (err) { next(err); }
});

// Admin creates a new user account directly (rather than the user self-registering).
// A random password is generated and returned ONCE - hand it to the user directly.
// Regular admins can only create role "user"; only a master admin can create role "admin" here too.
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { name, username, mobile, email, role } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    if (!username || !username.trim()) return res.status(400).json({ error: 'Username is required' });
    if (!email || !EMAIL_RE.test(email.trim())) return res.status(400).json({ error: 'A valid email is required' });

    let finalRole = 'user';
    if (role === 'admin') {
      if (req.session.user.role !== 'master_admin') {
        return res.status(403).json({ error: 'Only a master admin can create admin accounts' });
      }
      finalRole = 'admin';
    }

    const existingUsername = await prisma.user.findUnique({ where: { username: username.trim() } });
    if (existingUsername) return res.status(409).json({ error: 'Username already taken' });
    const existingEmail = await prisma.user.findUnique({ where: { email: email.trim() } });
    if (existingEmail) return res.status(409).json({ error: 'Email already registered' });

    const tempPassword = crypto.randomBytes(5).toString('hex');
    const hash = await bcrypt.hash(tempPassword, 10);
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        username: username.trim(),
        mobile: mobile ? mobile.trim() : null,
        email: email.trim(),
        password: hash,
        role: finalRole
      }
    });

    res.json({ id: user.id, tempPassword });
  } catch (err) { next(err); }
});

// Block or grant (unblock) a user's access to the quiz app. Any admin can do this.
router.put('/:id/status', requireAdmin, async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['active', 'blocked'].includes(status)) {
      return res.status(400).json({ error: 'status must be "active" or "blocked"' });
    }
    const target = await prisma.user.findUnique({ where: { id: parseInt(req.params.id, 10) } });
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'master_admin') return res.status(400).json({ error: 'Cannot block a master admin' });

    await prisma.user.update({ where: { id: target.id }, data: { status } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Only a master admin can promote/demote between user <-> admin.
router.put('/:id/role', requireMasterAdmin, async (req, res, next) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Role must be "user" or "admin" (master admins are set up separately)' });
    }
    const target = await prisma.user.findUnique({ where: { id: parseInt(req.params.id, 10) } });
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'master_admin') return res.status(400).json({ error: "Cannot change a master admin's role" });

    await prisma.user.update({ where: { id: target.id }, data: { role } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Admin resets a locked-out user's password to a freshly generated one and
// gets shown that value ONCE, to hand to the user. Nobody's original
// password is ever stored or viewable - only this generated reset value.
router.put('/:id/reset-password', requireAdmin, async (req, res, next) => {
  try {
    const target = await prisma.user.findUnique({ where: { id: parseInt(req.params.id, 10) } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    const tempPassword = crypto.randomBytes(5).toString('hex');
    const hash = await bcrypt.hash(tempPassword, 10);
    await prisma.user.update({ where: { id: target.id }, data: { password: hash } });
    res.json({ ok: true, tempPassword });
  } catch (err) { next(err); }
});

// Grant (or revoke) unlimited access, lifting the 24h/50-question trial cap for a "user"
// account early. Any admin can do this - it's an access-control action like block/grant,
// not a role change. Has no effect on admin/master_admin accounts (never trial-restricted).
router.put('/:id/unlimited-access', requireAdmin, async (req, res, next) => {
  try {
    const { unlimitedAccess } = req.body;
    if (typeof unlimitedAccess !== 'boolean') return res.status(400).json({ error: 'unlimitedAccess must be true or false' });
    const target = await prisma.user.findUnique({ where: { id: parseInt(req.params.id, 10) } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    await prisma.user.update({ where: { id: target.id }, data: { unlimitedAccess } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000; // no heartbeat in 5 min = treat as no longer "currently online"

function sessionDurationSeconds(s) {
  const end = s.logoutAt || s.lastActiveAt;
  return Math.max(Math.round((new Date(end) - new Date(s.loginAt)) / 1000), 0);
}
function isCurrentlyOnline(s) {
  return !s.logoutAt && (Date.now() - new Date(s.lastActiveAt).getTime()) < ACTIVE_THRESHOLD_MS;
}

// Master admin: per-user engagement summary (total sessions, total time, last login,
// currently-online flag), sorted by most time spent first. Paginated.
// GET /api/users/engagement?page=1&pageSize=10
router.get('/engagement', requireMasterAdmin, async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.max(parseInt(req.query.pageSize, 10) || 10, 1);

    const [users, sessions] = await Promise.all([
      prisma.user.findMany({ select: { id: true, name: true, username: true, role: true } }),
      prisma.userSession.findMany()
    ]);

    const byUser = new Map();
    sessions.forEach(s => {
      const entry = byUser.get(s.userId) || { totalSessions: 0, totalSeconds: 0, lastLoginAt: null, online: false };
      entry.totalSessions++;
      entry.totalSeconds += sessionDurationSeconds(s);
      if (!entry.lastLoginAt || new Date(s.loginAt) > new Date(entry.lastLoginAt)) entry.lastLoginAt = s.loginAt;
      if (isCurrentlyOnline(s)) entry.online = true;
      byUser.set(s.userId, entry);
    });

    let rows = users.map(u => {
      const stats = byUser.get(u.id) || { totalSessions: 0, totalSeconds: 0, lastLoginAt: null, online: false };
      return { id: u.id, name: u.name, username: u.username, role: u.role, ...stats };
    });
    rows.sort((a, b) => b.totalSeconds - a.totalSeconds);

    const total = rows.length;
    const paged = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    res.json({ items: paged, total, page, pageSize, totalPages: Math.max(Math.ceil(total / pageSize), 1) });
  } catch (err) { next(err); }
});

// Master admin: one user's individual login sessions, paginated, newest first.
// GET /api/users/:id/sessions?page=1&pageSize=10
router.get('/:id/sessions', requireMasterAdmin, async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.max(parseInt(req.query.pageSize, 10) || 10, 1);

    const [total, sessions] = await Promise.all([
      prisma.userSession.count({ where: { userId } }),
      prisma.userSession.findMany({
        where: { userId }, orderBy: { loginAt: 'desc' },
        skip: (page - 1) * pageSize, take: pageSize
      })
    ]);

    res.json({
      items: sessions.map(s => ({
        id: s.id,
        login_at: s.loginAt,
        logout_at: s.logoutAt,
        duration_seconds: sessionDurationSeconds(s),
        currently_online: isCurrentlyOnline(s)
      })),
      total, page, pageSize, totalPages: Math.max(Math.ceil(total / pageSize), 1)
    });
  } catch (err) { next(err); }
});

module.exports = router;
