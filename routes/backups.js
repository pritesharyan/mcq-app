const fs = require('fs/promises');
const router = require('express').Router();
const prisma = require('../lib/prisma');
const { requireMasterAdmin } = require('../middleware/auth');
const { createBackup, listBackups, getBackupPath } = require('../lib/backups');

router.get('/', requireMasterAdmin, async (req, res, next) => {
  try {
    res.json({ backups: await listBackups() });
  } catch (error) { next(error); }
});

router.post('/', requireMasterAdmin, async (req, res, next) => {
  try {
    res.json({ backup: await createBackup(prisma, 'manual') });
  } catch (error) { next(error); }
});

router.get('/:filename/download', requireMasterAdmin, async (req, res, next) => {
  try {
    const backupPath = getBackupPath(req.params.filename);
    if (!backupPath) return res.status(400).json({ error: 'Invalid backup filename' });
    await fs.access(backupPath);
    res.download(backupPath, req.params.filename, error => {
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Backup not found' });
    next(error);
  }
});

module.exports = router;