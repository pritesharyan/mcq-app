const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ].includes(file.mimetype);
    cb(ok ? null : new Error('Upload an .xlsx or .xls file'), ok);
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => {
    const unique = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}-${unique}${path.extname(file.originalname)}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'application/pdf'].includes(file.mimetype);
    cb(ok ? null : new Error('Only PNG/JPG/WEBP images or PDF files are allowed'), ok);
  }
});

// Older records use "English//Gujarati"; prefer English when reducing them.
function textValue(value) {
  return String(value ?? '').trim();
}

function singleLanguage(value) {
  const text = textValue(value);
  if (!text.includes('//')) return text;
  const [english, ...gujarati] = text.split('//');
  return english.trim() || gujarati.join('//').trim();
}

function displayField(stored) {
  return { text: singleLanguage(stored) };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toDisplayQuestion(r) {
  return {
    id: r.id,
    book_id: r.bookId,
    book_name: r.book ? r.book.name : undefined,
    created_by: r.createdById,
    question: displayField(r.questionText),
    options: [r.option1, r.option2, r.option3, r.option4].map(displayField),
    correct_option: r.correctOption,
    explanation: displayField(r.explanation),
    attachment_url: r.attachmentPath ? `/uploads/${path.basename(r.attachmentPath)}` : null,
    attachment_type: r.attachmentType
  };
}

// GET /api/questions?book_id=&book_ids=1,2,3
//    &scope=mine (admin management view: regular admins see only their own; master admin always sees all)
//    &paginate=true&page=1&pageSize=10 (admin table pagination; quiz-taking omits this and gets a plain array)
// book_ids (comma-separated) is what Practice MCQ uses now that users pick multiple books directly.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { book_id, book_ids, scope, paginate, page = '1', pageSize = '10' } = req.query;

    const where = {};
    if (book_id) where.bookId = parseInt(book_id, 10);
    if (book_ids) {
      const ids = book_ids.split(',').map(s => parseInt(s, 10)).filter(Boolean);
      if (ids.length) where.bookId = { in: ids };
    }

    if (scope === 'mine' && req.session.user.role === 'admin') {
      where.createdById = req.session.user.id;
    }
    // master_admin ignores "mine" scope and always sees everything

    if (paginate === 'true') {
      const pageNum = Math.max(parseInt(page, 10) || 1, 1);
      const size = Math.max(parseInt(pageSize, 10) || 10, 1);
      const [total, rows] = await Promise.all([
        prisma.question.count({ where }),
        prisma.question.findMany({
          where,
          include: { book: true },
          orderBy: { id: 'asc' },
          skip: (pageNum - 1) * size,
          take: size
        })
      ]);
      return res.json({
        items: rows.map(r => toDisplayQuestion(r)),
        total,
        page: pageNum,
        pageSize: size,
        totalPages: Math.max(Math.ceil(total / size), 1)
      });
    }

    // Practice-quiz endpoint (not the admin table): shuffle question order every time,
    // so the same selection doesn't always start with the same question.
    const rows = await prisma.question.findMany({ where, include: { book: true }, orderBy: { id: 'asc' } });
    res.json(shuffle(rows).map(r => toDisplayQuestion(r)));
  } catch (err) { next(err); }
});

// GET /api/questions/:id/raw - single-language fields for the admin edit form
router.get('/:id/raw', requireAdmin, async (req, res, next) => {
  try {
    const r = await prisma.question.findUnique({ where: { id: parseInt(req.params.id, 10) } });
    if (!r) return res.status(404).json({ error: 'Not found' });
    if (req.session.user.role === 'admin' && r.createdById !== req.session.user.id) {
      return res.status(403).json({ error: 'You can only edit questions you created' });
    }
    res.json({
      id: r.id,
      book_id: r.bookId,
      question: singleLanguage(r.questionText),
      options: [r.option1, r.option2, r.option3, r.option4].map(singleLanguage),
      correct_option: r.correctOption,
      explanation: singleLanguage(r.explanation),
      attachment_url: r.attachmentPath ? `/uploads/${path.basename(r.attachmentPath)}` : null
    });
  } catch (err) { next(err); }
});

router.post('/', requireAdmin, upload.single('attachment'), async (req, res, next) => {
  try {
    const b = req.body;
    const questionText = textValue(b.question);
    const option1 = textValue(b.option1);
    const option2 = textValue(b.option2);
    const option3 = textValue(b.option3);
    const option4 = textValue(b.option4);
    const explanation = textValue(b.explanation);

    if (!questionText || !option1 || !option2 || !option3 || !option4 || !b.book_id || !b.correct_option) {
      return res.status(400).json({ error: 'Question, all 4 options, book and correct option are required' });
    }

    const attachmentPath = req.file ? req.file.path : null;
    const attachmentType = req.file ? (req.file.mimetype === 'application/pdf' ? 'pdf' : 'image') : null;

    const question = await prisma.question.create({
      data: {
        bookId: parseInt(b.book_id, 10),
        questionText, option1, option2, option3, option4,
        correctOption: parseInt(b.correct_option, 10),
        explanation,
        attachmentPath, attachmentType,
        createdById: req.session.user.id
      }
    });
    res.json({ id: question.id });
  } catch (err) { next(err); }
});

router.put('/:id', requireAdmin, upload.single('attachment'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.question.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (req.session.user.role === 'admin' && existing.createdById !== req.session.user.id) {
      return res.status(403).json({ error: 'You can only edit questions you created' });
    }

    const b = req.body;
    const questionText = textValue(b.question);
    const option1 = textValue(b.option1);
    const option2 = textValue(b.option2);
    const option3 = textValue(b.option3);
    const option4 = textValue(b.option4);
    const explanation = textValue(b.explanation);

    const attachmentPath = req.file ? req.file.path : existing.attachmentPath;
    const attachmentType = req.file ? (req.file.mimetype === 'application/pdf' ? 'pdf' : 'image') : existing.attachmentType;

    await prisma.question.update({
      where: { id },
      data: {
        bookId: parseInt(b.book_id, 10),
        questionText, option1, option2, option3, option4,
        correctOption: parseInt(b.correct_option, 10),
        explanation, attachmentPath, attachmentType
      }
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.question.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (req.session.user.role === 'admin' && existing.createdById !== req.session.user.id) {
      return res.status(403).json({ error: 'You can only delete questions you created' });
    }
    await prisma.question.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/questions/export?book_id=  -> downloads an .xlsx of matching questions.
// Regular admins only ever export questions they created; master admin exports everything (or the filtered subset).
router.get('/export', requireAdmin, async (req, res, next) => {
  try {
    const where = {};
    if (req.query.book_id) where.bookId = parseInt(req.query.book_id, 10);
    if (req.session.user.role === 'admin') where.createdById = req.session.user.id;

    const questions = await prisma.question.findMany({
      where,
      include: { book: true },
      orderBy: { id: 'asc' }
    });

    const rows = questions.map(q => {
      const qs = singleLanguage(q.questionText);
      const opts = [q.option1, q.option2, q.option3, q.option4].map(singleLanguage);
      const ex = singleLanguage(q.explanation);
      return {
        'Book Name': q.book.name,
        'Question': qs,
        'Option1': opts[0],
        'Option2': opts[1],
        'Option3': opts[2],
        'Option4': opts[3],
        'Correct Option (1-4)': q.correctOption,
        'Explanation': ex
      };
    });

    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Questions');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="questions-export.xlsx"');
    res.send(buffer);
  } catch (err) { next(err); }
});

// GET /api/questions/import-template -> a blank .xlsx with the right headers plus one example row.
router.get('/import-template', requireAdmin, async (req, res, next) => {
  try {
    const sample = [{
      'Book Name': '(exact existing book name)',
      'Question': 'What is 2 + 2?',
      'Option1': '3',
      'Option2': '4',
      'Option3': '5',
      'Option4': '6',
      'Correct Option (1-4)': 2,
      'Explanation': '2 + 2 = 4'
    }];
    const sheet = XLSX.utils.json_to_sheet(sample);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Questions');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="questions-import-template.xlsx"');
    res.send(buffer);
  } catch (err) { next(err); }
});

// POST /api/questions/import - multipart field "file" holding an .xlsx built like the template above.
// Every row becomes a NEW question (this does not update existing ones). The book must already
// exist and is matched by name (case-insensitive) - rows that don't match are skipped and reported.
router.post('/import', requireAdmin, importUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Upload an .xlsx file as "file"' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    const allBooks = await prisma.book.findMany();

    const results = { created: 0, errors: [] };
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2; // header is row 1
      const bookName = String(r['Book Name'] || '').trim();
      if (!bookName) { results.errors.push(`Row ${rowNum}: missing Book Name`); continue; }

      const book = allBooks.find(b => b.name.toLowerCase() === bookName.toLowerCase());
      if (!book) { results.errors.push(`Row ${rowNum}: book "${bookName}" not found`); continue; }

      const questionText = textValue(r.Question) || singleLanguage(`${r['Question EN'] || ''}//${r['Question GU'] || ''}`);
      const option1 = textValue(r.Option1) || singleLanguage(`${r['Option1 EN'] || ''}//${r['Option1 GU'] || ''}`);
      const option2 = textValue(r.Option2) || singleLanguage(`${r['Option2 EN'] || ''}//${r['Option2 GU'] || ''}`);
      const option3 = textValue(r.Option3) || singleLanguage(`${r['Option3 EN'] || ''}//${r['Option3 GU'] || ''}`);
      const option4 = textValue(r.Option4) || singleLanguage(`${r['Option4 EN'] || ''}//${r['Option4 GU'] || ''}`);
      const explanation = textValue(r.Explanation) || singleLanguage(`${r['Explanation EN'] || ''}//${r['Explanation GU'] || ''}`);
      const correctOption = parseInt(r['Correct Option (1-4)'], 10);

      if (!questionText || !option1 || !option2 || !option3 || !option4 || ![1, 2, 3, 4].includes(correctOption)) {
        results.errors.push(`Row ${rowNum}: missing a required field, or Correct Option isn't 1-4`);
        continue;
      }

      await prisma.question.create({
        data: {
          bookId: book.id, questionText, option1, option2, option3, option4,
          correctOption, explanation, createdById: req.session.user.id
        }
      });
      results.created++;
    }

    res.json(results);
  } catch (err) { next(err); }
});

module.exports = router;
