const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { sendMail } = require('../lib/mailer');
const { isTrialRestricted, TRIAL_PRACTICE_LIMIT } = require('../lib/trial');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', async (req, res, next) => {
  try {
    const { name, username, mobile, email, password, confirmPassword } = req.body;

    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    if (!username || !username.trim()) return res.status(400).json({ error: 'Username is required' });
    if (!mobile || !mobile.trim()) return res.status(400).json({ error: 'Mobile number is required' }); 
    if (!email || !EMAIL_RE.test(email.trim())) {
      return res.status(400).json({ error: 'A valid email is required (used to recover your username/password later)' });
    }
    if (!password) return res.status(400).json({ error: 'Password is required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match' });

    const existingUsername = await prisma.user.findUnique({ where: { username: username.trim() } });
    if (existingUsername) return res.status(409).json({ error: 'Username already taken' });
    const existingEmail = await prisma.user.findUnique({ where: { email: email.trim() } });
    if (existingEmail) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        username: username.trim(),
        mobile: mobile ? mobile.trim() : null,
        email: email.trim(),
        password: hash,
        role: 'user'
      }
    });

    req.session.user = { id: user.id, username: user.username, name: user.name, role: user.role };
    const sessionRecord = await prisma.userSession.create({ data: { userId: user.id } });
    req.session.sessionRecordId = sessionRecord.id;
    res.json({ user: req.session.user });
  } catch (err) { next(err); }
});

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const user = await prisma.user.findUnique({ where: { username: (username || '').trim() } });
    if (!user || !bcrypt.compareSync(password || '', user.password)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    if (user.status === 'blocked') {
      return res.status(403).json({ error: 'Your account has been blocked. Contact an admin.' });
    }
    req.session.user = { id: user.id, username: user.username, name: user.name, role: user.role };

    const sessionRecord = await prisma.userSession.create({ data: { userId: user.id } });
    req.session.sessionRecordId = sessionRecord.id;

    res.json({ user: req.session.user });
  } catch (err) { next(err); }
});

router.post('/logout', async (req, res) => {
  if (req.session.sessionRecordId) {
    await prisma.userSession.update({
      where: { id: req.session.sessionRecordId },
      data: { logoutAt: new Date(), lastActiveAt: new Date() }
    }).catch(() => {}); // best-effort - don't block logout if this fails
  }
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', async (req, res, next) => {
  try {
    if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
    const user = await prisma.user.findUnique({ where: { id: req.session.user.id } });
    if (!user) return res.status(401).json({ error: 'Not logged in' });

    const restricted = isTrialRestricted(user);
    let practiceUsed = null;
    if (restricted) {
      practiceUsed = await prisma.practiceAttempt.count({ where: { userId: user.id } });
    }

    res.json({
      user: req.session.user,
      trial: { restricted, limit: TRIAL_PRACTICE_LIMIT, used: practiceUsed }
    });
  } catch (err) { next(err); }
});

// Logged-in user changes their own password (requires current password)
router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    if (newPassword !== confirmPassword) return res.status(400).json({ error: 'New passwords do not match' });

    const user = await prisma.user.findUnique({ where: { id: req.session.user.id } });
    if (!bcrypt.compareSync(currentPassword || '', user.password)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { password: hash } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Forgot username/password: enter your email, get your username + a freshly generated
// password by email. NOTE: this can never send back your ORIGINAL password - passwords
// are hashed (one-way), so nobody, including the app itself, can recover the original
// value. This generates a new one instead, exactly like the admin "reset password" flow.
// The response is deliberately the same whether or not the email is registered, so this
// endpoint can't be used to check which emails have accounts.
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    const generic = { ok: true, message: 'If that email is registered, we\'ve sent the username and a new password to it.' };
    if (!email || !EMAIL_RE.test(email.trim())) return res.json(generic);

    const user = await prisma.user.findUnique({ where: { email: email.trim() } });
    if (!user) return res.json(generic);

    const tempPassword = crypto.randomBytes(5).toString('hex');
    const hash = await bcrypt.hash(tempPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { password: hash } });

    await sendMail({
      to: user.email,
      subject: 'Your Higher Grade Pay - ITI login details',
      text: `Hi ${user.name},\n\nYour username is: ${user.username}\nYour new temporary password is: ${tempPassword}\n\nPlease log in and change your password from the Change Password tab.\n\n- Higher Grade Pay - ITI`
    });

    res.json(generic);
  } catch (err) { next(err); }
});

// Full profile fields for the "edit profile" form (session.user only carries the basics)
router.get('/profile', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.session.user.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ name: user.name, username: user.username, mobile: user.mobile, email: user.email });
  } catch (err) { next(err); }
});

// Logged-in user updates their own profile (name, mobile, email - email is mandatory).
// Username stays fixed since it's the login identifier - ask an admin if it needs to change.
router.put('/profile', requireAuth, async (req, res, next) => {
  try {
    const { name, mobile, email } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    if (!email || !EMAIL_RE.test(email.trim())) return res.status(400).json({ error: 'A valid email is required' });
    if (!mobile || !mobile.trim()) return res.status(400).json({ error: 'Mobile number is required' });   
    const existingEmail = await prisma.user.findFirst({
      where: { email: email.trim(), NOT: { id: req.session.user.id } }
    });
    if (existingEmail) return res.status(409).json({ error: 'That email is already registered to another account' });

    const updated = await prisma.user.update({
      where: { id: req.session.user.id },
      data: { name: name.trim(), mobile: mobile.trim(), email: email.trim() }
    });

    req.session.user.name = updated.name;
    res.json({ user: { id: updated.id, name: updated.name, username: updated.username, mobile: updated.mobile, email: updated.email, role: updated.role } });
  } catch (err) { next(err); }
});

module.exports = router;
