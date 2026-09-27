const bcrypt = require('bcryptjs');
const prisma = require('./prisma');

// Runs once at server startup. Only ever creates the very first account -
// once at least one user exists, this is a no-op every time after.
async function seedMasterAdmin() {
  const userCount = await prisma.user.count();
  if (userCount > 0) return;

  const initialPassword = process.env.INITIAL_ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? null : 'admin123');
  if (!initialPassword || initialPassword.length < 12) {
    throw new Error('INITIAL_ADMIN_PASSWORD must be set to at least 12 characters before creating the first admin');
  }

  const hash = await bcrypt.hash(initialPassword, 10);
  await prisma.user.create({
    data: {
      name: 'Master Admin',
      username: 'admin',
      email: 'admin@example.com',
      password: hash,
      role: 'master_admin'
    }
  });
  console.log('Seeded the first master admin account. Change the initial password after signing in.');
}

module.exports = { seedMasterAdmin };
