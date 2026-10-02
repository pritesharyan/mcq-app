const router = require('express').Router();
const path = require('path');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { isTrialRestricted } = require('../lib/trial');

function singleLanguage(value) {
  const text = String(value ?? '').trim();
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

// GET /api/test?book_ids=1,2,3&count=25
// Pulls every question across the selected books, shuffles, and
// returns up to `count` of them in random order - the "Take a Test" pool.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { book_ids, count = '25' } = req.query;
    if (!book_ids) return res.status(400).json({ error: 'book_ids is required (comma-separated)' });
    const bookIds = book_ids.split(',').map(id => parseInt(id, 10)).filter(Boolean);
    if (!bookIds.length) return res.status(400).json({ error: 'No valid book_ids provided' });

    const rows = await prisma.question.findMany({
      where: { bookId: { in: bookIds } },
      include: { book: true }
    });

    const wanted = Math.max(parseInt(count, 10) || 25, 1);
    const picked = shuffle(rows).slice(0, wanted);

    const out = picked.map(r => ({
      id: r.id,
      book_id: r.bookId,
      book_name: r.book.name,
      question: displayField(r.questionText),
      options: [r.option1, r.option2, r.option3, r.option4].map(displayField),
      correct_option: r.correctOption,
      explanation: displayField(r.explanation),
      attachment_url: r.attachmentPath ? `/uploads/${path.basename(r.attachmentPath)}` : null,
      attachment_type: r.attachmentType
    }));

    res.json({ questions: out, requested: wanted, available: rows.length });
  } catch (err) { next(err); }
});

// POST /api/test/submit - scores the test SERVER-SIDE (never trusts a score the client
// computed) and saves it so the user can review it later under "My Test Results".
// Body: { answers: [{ question_id, chosen_option }], duration_seconds, total_questions }
router.post('/submit', requireAuth, async (req, res, next) => {
  try {
    const { answers = [], duration_seconds = 0, total_questions } = req.body;
    if (!Array.isArray(answers)) return res.status(400).json({ error: 'answers must be an array' });

    const questionIds = answers.map(a => parseInt(a.question_id, 10)).filter(Boolean);
    const questions = await prisma.question.findMany({ where: { id: { in: questionIds } } });
    const byId = new Map(questions.map(q => [q.id, q]));

    const graded = answers.map(a => {
      const q = byId.get(parseInt(a.question_id, 10));
      const chosen = a.chosen_option ? parseInt(a.chosen_option, 10) : null;
      const correctOption = q ? q.correctOption : null;
      return { questionId: a.question_id, chosenOption: chosen, correctOption, isCorrect: !!chosen && chosen === correctOption };
    });

    const attempted = graded.filter(g => g.chosenOption).length;
    const correctCount = graded.filter(g => g.isCorrect).length;

    const attempt = await prisma.testAttempt.create({
      data: {
        userId: req.session.user.id,
        totalQuestions: total_questions || graded.length,
        attempted,
        correctCount,
        durationSeconds: parseInt(duration_seconds, 10) || 0,
        answersJson: JSON.stringify(graded)
      }
    });

    res.json({ id: attempt.id, totalQuestions: attempt.totalQuestions, attempted, correctCount });
  } catch (err) { next(err); }
});

// GET /api/test/attempts?page=1&pageSize=10 - the current user's own past test results.
// Trial-restricted accounts (see lib/trial.js) don't get this feature until an admin lifts the cap.
router.get('/attempts', requireAuth, async (req, res, next) => {
  try {
    if (isTrialRestricted(req.user)) {
      return res.status(403).json({ error: 'My Test Results is available once your account is upgraded by an admin.' });
    }
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.max(parseInt(req.query.pageSize, 10) || 10, 1);
    const where = { userId: req.session.user.id };

    const [total, rows] = await Promise.all([
      prisma.testAttempt.count({ where }),
      prisma.testAttempt.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize, take: pageSize
      })
    ]);

    res.json({
      items: rows.map(r => ({
        id: r.id,
        total_questions: r.totalQuestions,
        attempted: r.attempted,
        correct_count: r.correctCount,
        duration_seconds: r.durationSeconds,
        created_at: r.createdAt
      })),
      total, page, pageSize, totalPages: Math.max(Math.ceil(total / pageSize), 1)
    });
  } catch (err) { next(err); }
});

// A user can delete their own past test result.
router.delete('/attempts/:id', requireAuth, async (req, res, next) => {
  try {
    const attempt = await prisma.testAttempt.findUnique({ where: { id: parseInt(req.params.id, 10) } });
    if (!attempt || attempt.userId !== req.session.user.id) return res.status(404).json({ error: 'Not found' });
    await prisma.testAttempt.delete({ where: { id: attempt.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// GET /api/test/attempts/:id - full detail (per-question answers) for the review screen.
// Only the user who took it can view it.
router.get('/attempts/:id', requireAuth, async (req, res, next) => {
  try {
    const attempt = await prisma.testAttempt.findUnique({ where: { id: parseInt(req.params.id, 10) } });
    if (!attempt || attempt.userId !== req.session.user.id) return res.status(404).json({ error: 'Not found' });

    const graded = JSON.parse(attempt.answersJson);
    const questionIds = graded.map(g => parseInt(g.questionId, 10)).filter(Boolean);
    const questions = await prisma.question.findMany({ where: { id: { in: questionIds } } });
    const byId = new Map(questions.map(q => [q.id, q]));

    const items = graded.map(g => {
      const q = byId.get(parseInt(g.questionId, 10));
      return {
        question: q ? displayField(q.questionText) : { text: '(question was deleted)' },
        options: q ? [q.option1, q.option2, q.option3, q.option4].map(displayField) : [],
        chosen_option: g.chosenOption,
        correct_option: g.correctOption,
        is_correct: g.isCorrect,
        explanation: q ? displayField(q.explanation) : { text: '' }
      };
    });

    res.json({
      id: attempt.id,
      total_questions: attempt.totalQuestions,
      attempted: attempt.attempted,
      correct_count: attempt.correctCount,
      duration_seconds: attempt.durationSeconds,
      created_at: attempt.createdAt,
      items
    });
  } catch (err) { next(err); }
});

module.exports = router;
