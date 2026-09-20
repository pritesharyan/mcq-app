const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { requireAdmin, requireMasterAdmin } = require('../middleware/auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Any admin or master admin can see the full (paginated) user list, to block/grant access.
// GET /api/users?page=1&pageSize=10
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.max(parseInt(req.query.pageSize, 10) || 10, 1);

    const [total, users] = await Promise.all([
      prisma.user.count(),
      prisma.user.findMany({
        orderBy: { id: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, name: true, username: true, mobile: true, email: true, role: true, status: true, createdAt: true }
      })
    ]);

    res.json({ items: users, total, page, pageSize, totalPages: Math.max(Math.ceil(total / pageSize), 1) });
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

module.exports = router;
