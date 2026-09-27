const router = require('express').Router();
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { isTrialRestricted, TRIAL_PRACTICE_LIMIT } = require('../lib/trial');

// POST /api/practice/attempt { question_id, chosen_option }
// Records (upserts) that this user has practiced this question. Scored server-side.
// For trial-restricted accounts, refuses NEW questions once TRIAL_PRACTICE_LIMIT distinct
// questions have been practiced - re-answering an already-practiced question is always fine.
router.post('/attempt', requireAuth, async (req, res, next) => {
  try {
    const { question_id, chosen_option } = req.body;
    const questionId = parseInt(question_id, 10);
    const chosen = chosen_option ? parseInt(chosen_option, 10) : null;
    if (!questionId || !chosen) return res.status(400).json({ error: 'question_id and chosen_option are required' });

    const question = await prisma.question.findUnique({ where: { id: questionId } });
    if (!question) return res.status(404).json({ error: 'Question not found' });

    if (isTrialRestricted(req.user)) {
      const existing = await prisma.practiceAttempt.findUnique({
        where: { userId_questionId: { userId: req.session.user.id, questionId } }
      });
      if (!existing) {
        const distinctCount = await prisma.practiceAttempt.count({ where: { userId: req.session.user.id } });
        if (distinctCount >= TRIAL_PRACTICE_LIMIT) {
          return res.status(403).json({
            error: `You've reached the ${TRIAL_PRACTICE_LIMIT}-question practice limit for trial accounts. Ask an admin to upgrade your account for unlimited access.`,
            limitReached: true
          });
        }
      }
    }

    const isCorrect = chosen === question.correctOption;
    await prisma.practiceAttempt.upsert({
      where: { userId_questionId: { userId: req.session.user.id, questionId } },
      update: { isCorrect, chosenOption: chosen, lastAttemptAt: new Date() },
      create: {
        userId: req.session.user.id, questionId, bookId: question.bookId,
        isCorrect, chosenOption: chosen
      }
    });

    res.json({ ok: true, is_correct: isCorrect, correct_option: question.correctOption });
  } catch (err) { next(err); }
});

// GET /api/practice/log - per (paper, book) progress for the current user:
// total questions in that book vs how many distinct questions they've practiced, as a %.
// A book linked to multiple papers appears once per paper (same totals each time), since
// practice progress is tracked per book, not per paper. Books with no paper still appear.
router.get('/log', requireAuth, async (req, res, next) => {
  try {
    if (isTrialRestricted(req.user)) {
      return res.status(403).json({ error: 'Practice Log is available once your account is upgraded by an admin.' });
    }

    const [books, paperBooks, questionCounts, attempts] = await Promise.all([
      prisma.book.findMany(),
      prisma.paperBook.findMany({ include: { paper: true } }),
      prisma.question.groupBy({ by: ['bookId'], _count: { id: true } }),
      prisma.practiceAttempt.findMany({ where: { userId: req.session.user.id } })
    ]);

    const totalByBook = new Map(questionCounts.map(q => [q.bookId, q._count.id]));
    const attemptedByBook = new Map();
    const lastPracticedByBook = new Map();
    attempts.forEach(a => {
      attemptedByBook.set(a.bookId, (attemptedByBook.get(a.bookId) || 0) + 1);
      const prev = lastPracticedByBook.get(a.bookId);
      if (!prev || new Date(a.lastAttemptAt) > new Date(prev)) lastPracticedByBook.set(a.bookId, a.lastAttemptAt);
    });

    const paperIdsByBook = new Map();
    paperBooks.forEach(pb => {
      const list = paperIdsByBook.get(pb.bookId) || [];
      list.push(pb.paper);
      paperIdsByBook.set(pb.bookId, list);
    });

    const rows = [];
    books.forEach(book => {
      const total = totalByBook.get(book.id) || 0;
      const attended = Math.min(attemptedByBook.get(book.id) || 0, total); // safety clamp if questions were later removed
      const percentage = total > 0 ? Math.round((attended / total) * 100) : 0;
      const lastPracticedAt = lastPracticedByBook.get(book.id) || null;
      const papers = paperIdsByBook.get(book.id) || [];

      if (papers.length === 0) {
        rows.push({ paper_name: '', book_name: book.name, total_questions: total, attended_questions: attended, percentage, last_practiced_at: lastPracticedAt });
      } else {
        papers.forEach(p => {
          rows.push({ paper_name: p.name, book_name: book.name, total_questions: total, attended_questions: attended, percentage, last_practiced_at: lastPracticedAt });
        });
      }
    });

    rows.sort((a, b) => a.paper_name.localeCompare(b.paper_name) || a.book_name.localeCompare(b.book_name));

    const totals = rows.reduce((acc, r) => {
      acc.total_questions += r.total_questions;
      acc.attended_questions += r.attended_questions;
      return acc;
    }, { total_questions: 0, attended_questions: 0 });
    const overallPercentage = totals.total_questions > 0 ? Math.round((totals.attended_questions / totals.total_questions) * 100) : 0;

    res.json({
      items: rows.map((r, i) => ({ sr_no: i + 1, ...r })),
      totals: { ...totals, percentage: overallPercentage }
    });
  } catch (err) { next(err); }
});

module.exports = router;
