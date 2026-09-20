const router = require('express').Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { book_id } = req.query;
    const where = book_id ? { bookId: parseInt(book_id, 10) } : {};
    const chapters = await prisma.chapter.findMany({ where, orderBy: { name: 'asc' } });
    res.json(chapters);
  } catch (err) { next(err); }
});

router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { name, book_id } = req.body;
    if (!name || !name.trim() || !book_id) return res.status(400).json({ error: 'name and book_id required' });
    const chapter = await prisma.chapter.create({ data: { name: name.trim(), bookId: parseInt(book_id, 10) } });
    res.json(chapter);
  } catch (err) { next(err); }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { name, book_id } = req.body;
    if (!name || !name.trim() || !book_id) return res.status(400).json({ error: 'name and book_id required' });
    await prisma.chapter.update({
      where: { id: parseInt(req.params.id, 10) },
      data: { name: name.trim(), bookId: parseInt(book_id, 10) }
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    await prisma.chapter.delete({ where: { id: parseInt(req.params.id, 10) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
