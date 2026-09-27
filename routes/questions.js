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

// Combine English + Gujarati input into the single "//"-separated stored string.
function combine(en, gu) {
  en = (en || '').trim();
  gu = (gu || '').trim();
  if (en && gu) return `${en}//${gu}`;
  return en || gu || '';
}

// Split a stored "//"-separated string back into { en, gu, hasEn, hasGu }
function split(stored) {
  if (!stored) return { en: '', gu: '', hasEn: false, hasGu: false };
  const parts = stored.split('//');
  if (parts.length >= 2) {
    return { en: parts[0], gu: parts.slice(1).join('//'), hasEn: !!parts[0], hasGu: !!parts.slice(1).join('//') };
  }
  return { en: parts[0], gu: '', hasEn: !!parts[0], hasGu: false };
}

// What to show a user, given their requested lang preference. If a question
// only has one language stored, that language shows regardless of preference.
function displayField(stored, lang) {
  const s = split(stored);
  if (!s.hasEn && !s.hasGu) return { text: '', lang: null };
  if (s.hasEn && s.hasGu) {
    if (lang === 'en') return { text: s.en, lang: 'en' };
    if (lang === 'gu') return { text: s.gu, lang: 'gu' };
    return { text: `EN: ${s.en}\nGU: ${s.gu}`, lang: 'both', en: s.en, gu: s.gu };
  }
  return { text: s.hasEn ? s.en : s.gu, lang: s.hasEn ? 'en' : 'gu', fallback: true };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toDisplayQuestion(r, lang) {
  return {
    id: r.id,
    book_id: r.bookId,
    book_name: r.book ? r.book.name : undefined,
    created_by: r.createdById,
    question: displayField(r.questionText, lang),
    options: [r.option1, r.option2, r.option3, r.option4].map(o => displayField(o, lang)),
    correct_option: r.correctOption,
    explanation: displayField(r.explanation, lang),
    attachment_url: r.attachmentPath ? `/uploads/${path.basename(r.attachmentPath)}` : null,
    attachment_type: r.attachmentType
  };
}

// GET /api/questions?book_id=&book_ids=1,2,3&lang=both|en|gu
//    &scope=mine (admin management view: regular admins see only their own; master admin always sees all)
//    &paginate=true&page=1&pageSize=10 (admin table pagination; quiz-taking omits this and gets a plain array)
// book_ids (comma-separated) is what Practice MCQ uses now that users pick multiple books directly.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { book_id, book_ids, lang = 'both', scope, paginate, page = '1', pageSize = '10' } = req.query;

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
        items: rows.map(r => toDisplayQuestion(r, lang)),
        total,
        page: pageNum,
        pageSize: size,
        totalPages: Math.max(Math.ceil(total / size), 1)
      });
    }

    // Practice-quiz endpoint (not the admin table): shuffle question order every time,
    // so the same selection doesn't always start with the same question.
    const rows = await prisma.question.findMany({ where, include: { book: true }, orderBy: { id: 'asc' } });
    res.json(shuffle(rows).map(r => toDisplayQuestion(r, lang)));
  } catch (err) { next(err); }
});

// GET /api/questions/:id/raw - unsplit EN/GU fields, for the admin edit form
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
      question: split(r.questionText),
      options: [r.option1, r.option2, r.option3, r.option4].map(split),
      correct_option: r.correctOption,
      explanation: split(r.explanation),
      attachment_url: r.attachmentPath ? `/uploads/${path.basename(r.attachmentPath)}` : null
    });
  } catch (err) { next(err); }
});

router.post('/', requireAdmin, upload.single('attachment'), async (req, res, next) => {
  try {
    const b = req.body;
    const questionText = combine(b.question_en, b.question_gu);
    const option1 = combine(b.opt1_en, b.opt1_gu);
    const option2 = combine(b.opt2_en, b.opt2_gu);
    const option3 = combine(b.opt3_en, b.opt3_gu);
    const option4 = combine(b.opt4_en, b.opt4_gu);
    const explanation = combine(b.explanation_en, b.explanation_gu);

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
    const questionText = combine(b.question_en, b.question_gu);
    const option1 = combine(b.opt1_en, b.opt1_gu);
    const option2 = combine(b.opt2_en, b.opt2_gu);
    const option3 = combine(b.opt3_en, b.opt3_gu);
    const option4 = combine(b.opt4_en, b.opt4_gu);
    const explanation = combine(b.explanation_en, b.explanation_gu);

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
      const qs = split(q.questionText);
      const opts = [q.option1, q.option2, q.option3, q.option4].map(split);
      const ex = split(q.explanation);
      return {
        'Book Name': q.book.name,
        'Question EN': qs.en, 'Question GU': qs.gu,
        'Option1 EN': opts[0].en, 'Option1 GU': opts[0].gu,
        'Option2 EN': opts[1].en, 'Option2 GU': opts[1].gu,
        'Option3 EN': opts[2].en, 'Option3 GU': opts[2].gu,
        'Option4 EN': opts[3].en, 'Option4 GU': opts[3].gu,
        'Correct Option (1-4)': q.correctOption,
        'Explanation EN': ex.en, 'Explanation GU': ex.gu
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
      'Question EN': 'What is 2 + 2?', 'Question GU': '',
      'Option1 EN': '3', 'Option1 GU': '',
      'Option2 EN': '4', 'Option2 GU': '',
      'Option3 EN': '5', 'Option3 GU': '',
      'Option4 EN': '6', 'Option4 GU': '',
      'Correct Option (1-4)': 2,
      'Explanation EN': '2 + 2 = 4', 'Explanation GU': ''
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

      const questionText = combine(r['Question EN'], r['Question GU']);
      const option1 = combine(r['Option1 EN'], r['Option1 GU']);
      const option2 = combine(r['Option2 EN'], r['Option2 GU']);
      const option3 = combine(r['Option3 EN'], r['Option3 GU']);
      const option4 = combine(r['Option4 EN'], r['Option4 GU']);
      const explanation = combine(r['Explanation EN'], r['Explanation GU']);
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
