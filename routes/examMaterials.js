const router = require('express').Router();
const multer = require('multer');
const XLSX = require('xlsx');
const prisma = require('../lib/prisma');
const { requireAuth, requireMasterAdmin } = require('../middleware/auth');

const MATERIAL_COLUMNS = ['Paper Name', 'Material Name', 'Keywords', 'Download URL'];
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

function sendMaterialsWorkbook(res, rows, filename) {
  const worksheet = XLSX.utils.aoa_to_sheet([
    MATERIAL_COLUMNS,
    ...rows.map(row => MATERIAL_COLUMNS.map(column => row[column] || ''))
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Exam Materials');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

// Public landing-page view: exposes published material details only, without account metadata.
router.get('/public', async (req, res, next) => {
  try {
    const rows = await prisma.examMaterial.findMany({
      include: { paper: true },
      orderBy: { id: 'asc' }
    });
    res.json({
      items: rows.map((row, index) => ({
        sr_no: index + 1,
        paper_name: row.paper ? row.paper.name : '',
        material_name: row.materialName,
        keywords: row.keywords || '',
        download_url: row.downloadLink
      }))
    });
  } catch (err) { next(err); }
});

// Any logged-in user can browse/search the exam material download table.
// GET /api/materials?q=algebra&page=1&pageSize=10
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { q, paper_id } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.max(parseInt(req.query.pageSize, 10) || 10, 1);

    const where = {};
    if (paper_id) where.paperId = parseInt(paper_id, 10);
    if (q && q.trim()) {
      const term = q.trim();
      where.OR = [
        { materialName: { contains: term } },
        { keywords: { contains: term } },
        { paper: { name: { contains: term } } }
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.examMaterial.count({ where }),
      prisma.examMaterial.findMany({
        where,
        include: { paper: true },
        orderBy: { id: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);

    res.json({
      items: rows.map((r, i) => ({
        sr_no: (page - 1) * pageSize + i + 1,
        id: r.id,
        paper_name: r.paper ? r.paper.name : '',
        paper_id: r.paperId,
        material_name: r.materialName,
        keywords: r.keywords || '',
        download_url: r.downloadLink
      })),
      total, page, pageSize, totalPages: Math.max(Math.ceil(total / pageSize), 1)
    });
  } catch (err) { next(err); }
});

router.get('/export', requireMasterAdmin, async (req, res, next) => {
  try {
    const materials = await prisma.examMaterial.findMany({
      include: { paper: true },
      orderBy: { id: 'asc' }
    });
    const rows = materials.map(material => ({
      'Paper Name': material.paper ? material.paper.name : '',
      'Material Name': material.materialName,
      'Keywords': material.keywords || '',
      'Download URL': material.downloadLink
    }));
    sendMaterialsWorkbook(res, rows, 'exam-materials.xlsx');
  } catch (err) { next(err); }
});

router.get('/import-template', requireMasterAdmin, (req, res) => {
  sendMaterialsWorkbook(res, [], 'exam-materials-template.xlsx');
});

router.post('/import', requireMasterAdmin, importUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Upload an .xlsx file as "file"' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return res.status(400).json({ error: 'Workbook has no worksheets' });
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const papers = await prisma.paper.findMany();
    const papersByName = new Map(papers.map(paper => [paper.name.toLowerCase(), paper]));
    const results = { created: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const paperName = String(row['Paper Name'] || '').trim();
      const materialName = String(row['Material Name'] || '').trim();
      const downloadUrl = String(row['Download URL'] || '').trim();
      const keywords = String(row.Keywords || '').trim();

      if (!materialName || !downloadUrl) {
        results.errors.push(`Row ${rowNum}: Material Name and Download URL are required`);
        continue;
      }

      const paper = paperName ? papersByName.get(paperName.toLowerCase()) : null;
      if (paperName && !paper) {
        results.errors.push(`Row ${rowNum}: paper "${paperName}" not found`);
        continue;
      }

      await prisma.examMaterial.create({
        data: {
          paperId: paper ? paper.id : null,
          materialName,
          downloadLink: downloadUrl,
          keywords: keywords || null,
          addedById: req.session.user.id
        }
      });
      results.created++;
    }

    res.json(results);
  } catch (err) { next(err); }
});

// Only the master admin adds/edits/removes rows in this table.
router.post('/', requireMasterAdmin, async (req, res, next) => {
  try {
    const { paper_id, material_name, download_url, keywords } = req.body;
    if (!material_name || !material_name.trim() || !download_url || !download_url.trim()) {
      return res.status(400).json({ error: 'material_name and download_url are required' });
    }
    const row = await prisma.examMaterial.create({
      data: {
        paperId: paper_id ? parseInt(paper_id, 10) : null,
        materialName: material_name.trim(),
        downloadLink: download_url.trim(),
        keywords: keywords ? keywords.trim() : null,
        addedById: req.session.user.id
      }
    });
    res.json({ id: row.id });
  } catch (err) { next(err); }
});

router.put('/:id', requireMasterAdmin, async (req, res, next) => {
  try {
    const { paper_id, material_name, download_url, keywords } = req.body;
    if (!material_name || !material_name.trim() || !download_url || !download_url.trim()) {
      return res.status(400).json({ error: 'material_name and download_url are required' });
    }
    await prisma.examMaterial.update({
      where: { id: parseInt(req.params.id, 10) },
      data: {
        paperId: paper_id ? parseInt(paper_id, 10) : null,
        materialName: material_name.trim(),
        downloadLink: download_url.trim(),
        keywords: keywords ? keywords.trim() : null
      }
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', requireMasterAdmin, async (req, res, next) => {
  try {
    await prisma.examMaterial.delete({ where: { id: parseInt(req.params.id, 10) } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
