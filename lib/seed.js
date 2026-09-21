const bcrypt = require('bcryptjs');
const prisma = require('./prisma');

// Runs once at server startup. Only ever creates the very first account -
// once at least one user exists, this is a no-op every time after.
async function seedMasterAdmin() {
  const userCount = await prisma.user.count();
  if (userCount > 0) return;

  const hash = await bcrypt.hash('admin123', 10);
  await prisma.user.create({
    data: {
      name: 'Master Admin',
      username: 'admin',
      password: hash,
      role: 'master_admin',
      email: "pritesh@gmail.com" // <-- ADD THIS LINE
    }
  });
  console.log('Seeded first master admin -> username: admin / password: admin123 (change this!)');
}

module.exports = { seedMasterAdmin };
