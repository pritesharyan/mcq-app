const express = require('express');
const session = require('express-session');
const path = require('path');
const { seedMasterAdmin } = require('./lib/seed');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 hours
}));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
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

// Generic error handler (e.g. multer file-type/size rejections, Prisma errors)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || 'Something went wrong' });
});

const PORT = process.env.PORT || 3000;

seedMasterAdmin()
  .catch(err => console.error('Seed error:', err))
  .finally(() => {
    app.listen(PORT, () => console.log(`MCQ app running at http://localhost:${PORT}`));
  });
