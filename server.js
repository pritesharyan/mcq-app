const fs = require('fs');
const path = require('path');
const envFile = path.join(__dirname, '.env');
if (process.loadEnvFile && fs.existsSync(envFile)) process.loadEnvFile(envFile);
const databaseUrl = process.env.DATABASE_URL || '';
if (databaseUrl.startsWith('file:')) {
  const queryIndex = databaseUrl.indexOf('?');
  const urlPath = databaseUrl.slice(5, queryIndex === -1 ? undefined : queryIndex);
  if (!path.isAbsolute(urlPath)) {
    const projectPath = path.resolve(__dirname, decodeURIComponent(urlPath));
    const schemaRelativePath = path.relative(path.join(__dirname, 'prisma'), projectPath).replace(/\\/g, '/');
    const query = queryIndex === -1 ? '' : databaseUrl.slice(queryIndex);
    process.env.DATABASE_URL = `file:./${schemaRelativePath}${query}`;
  }
}

const express = require('express');
const session = require('express-session');
const { seedMasterAdmin } = require('./lib/seed');
const prisma = require('./lib/prisma');
const { startDailyBackups } = require('./lib/backups');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set in production');
}

app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8, httpOnly: true, sameSite: 'lax', secure: isProduction } // 8 hours
}));

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/papers', require('./routes/papers'));
app.use('/api/books', require('./routes/books'));
app.use('/api/questions', require('./routes/questions'));
app.use('/api/suggestions', require('./routes/suggestions'));
app.use('/api/test', require('./routes/test'));
app.use('/api/exam-materials', require('./routes/examMaterials'));
app.use('/api/practice', require('./routes/practice'));
app.use('/api/backups', require('./routes/backups'));

// Generic error handler (e.g. multer file-type/size rejections, Prisma errors)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || 'Something went wrong' });
});

const PORT = process.env.PORT || 3000;

seedMasterAdmin()
  .catch(err => console.error('Seed error:', err))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`MCQ app running at http://localhost:${PORT}`);
      startDailyBackups(prisma).catch(err => console.error('Backup scheduler error:', err));
    });
  });
