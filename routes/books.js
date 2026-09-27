const router = require('express').Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { paper_id } = req.query;
    const where = paper_id ? { papers: { some: { paperId: parseInt(paper_id, 10) } } } : {};
    const books = await prisma.book.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { papers: true }
    });
    res.json(books.map(b => ({ id: b.id, name: b.name, paper_ids: b.papers.map(p => p.paperId) })));
  } catch (err) { next(err); }
});

router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { name, paper_ids = [] } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    const book = await prisma.book.create({
      data: {
        name: name.trim(),
        papers: { create: (paper_ids || []).map(pid => ({ paperId: parseInt(pid, 10) })) }
      }
    });
    res.json({ id: book.id, name: book.name, paper_ids });
  } catch (err) { next(err); }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { name, paper_ids = [] } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    const bookId = parseInt(req.params.id, 10);
    await prisma.book.update({ where: { id: bookId }, data: { name: name.trim() } });
    await prisma.paperBook.deleteMany({ where: { bookId } });
    if (paper_ids && paper_ids.length) {
      await prisma.paperBook.createMany({
        data: paper_ids.map(pid => ({ paperId: parseInt(pid, 10), bookId }))
      });
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    await prisma.book.delete({ where: { id: parseInt(req.params.id, 10) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
