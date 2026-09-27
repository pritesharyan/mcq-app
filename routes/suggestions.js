const router = require('express').Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');

function toRow(r, includeUsername) {
  const row = {
    id: r.id,
    question_id: r.questionId,
    book_name: r.question.book.name,
    question_preview: (r.question.questionText || '').split('//')[0].slice(0, 100),
    suggestion_text: r.suggestionText,
    status: r.status,
    admin_note: r.adminNote,
    created_at: r.createdAt
  };
  if (includeUsername) row.username = r.user.username;
  return row;
}

// Any logged-in user can suggest a correction/update for a specific question
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { question_id, suggestion_text } = req.body;
    if (!question_id || !suggestion_text || !suggestion_text.trim()) {
      return res.status(400).json({ error: 'question_id and suggestion_text are required' });
    }
    const question = await prisma.question.findUnique({ where: { id: parseInt(question_id, 10) } });
    if (!question) return res.status(404).json({ error: 'Question not found' });

    const row = await prisma.questionSuggestion.create({
      data: { questionId: question.id, userId: req.session.user.id, suggestionText: suggestion_text.trim() }
    });
    res.json({ id: row.id });
  } catch (err) { next(err); }
});

// A user's own suggestions, paginated. GET /api/suggestions/mine?page=1&pageSize=10
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.max(parseInt(req.query.pageSize, 10) || 10, 1);
    const where = { userId: req.session.user.id };

    const [total, rows] = await Promise.all([
      prisma.questionSuggestion.count({ where }),
      prisma.questionSuggestion.findMany({
        where,
        include: { question: { include: { book: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);

    res.json({
      items: rows.map(r => toRow(r, false)),
      total, page, pageSize, totalPages: Math.max(Math.ceil(total / pageSize), 1)
    });
  } catch (err) { next(err); }
});

// Admin: list all suggestions, optionally filtered by status, paginated.
// GET /api/suggestions?status=pending&page=1&pageSize=10
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const { status } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.max(parseInt(req.query.pageSize, 10) || 10, 1);
    const where = status ? { status } : {};

    const [total, rows] = await Promise.all([
      prisma.questionSuggestion.count({ where }),
      prisma.questionSuggestion.findMany({
        where,
        include: { user: true, question: { include: { book: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);

    res.json({
      items: rows.map(r => toRow(r, true)),
      total, page, pageSize, totalPages: Math.max(Math.ceil(total / pageSize), 1)
    });
  } catch (err) { next(err); }
});

// Admin: count of pending suggestions only, for the tab badge (unpaginated - just a number)
router.get('/pending-count', requireAdmin, async (req, res, next) => {
  try {
    const count = await prisma.questionSuggestion.count({ where: { status: 'pending' } });
    res.json({ count });
  } catch (err) { next(err); }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { status, admin_note } = req.body;
    const existing = await prisma.questionSuggestion.findUnique({ where: { id: parseInt(req.params.id, 10) } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const newStatus = status || existing.status;
    if (!['pending', 'reviewed', 'resolved'].includes(newStatus)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    await prisma.questionSuggestion.update({
      where: { id: existing.id },
      data: { status: newStatus, adminNote: admin_note !== undefined ? admin_note : existing.adminNote }
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    await prisma.questionSuggestion.delete({ where: { id: parseInt(req.params.id, 10) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
