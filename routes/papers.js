const router = require('express').Router();
const prisma = require('../lib/prisma');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const papers = await prisma.paper.findMany({ orderBy: { name: 'asc' } });
    res.json(papers);
  } catch (err) { next(err); }
});

router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    const paper = await prisma.paper.create({ data: { name: name.trim() } });
    res.json(paper);
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ error: 'A paper with that name already exists' });
    next(err);
  }
});

router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    await prisma.paper.update({ where: { id: parseInt(req.params.id, 10) }, data: { name: name.trim() } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    await prisma.paper.delete({ where: { id: parseInt(req.params.id, 10) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
