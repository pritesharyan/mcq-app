const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync, backup } = require('node:sqlite');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
const BACKUP_NAME_RE = /^mcqapp-(automatic|manual)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{6}\.sqlite$/;
let schedulerStarted = false;

async function getDatabaseFile(prisma) {
  const databases = await prisma.$queryRawUnsafe('PRAGMA database_list');
  const mainDatabase = databases.find(database => database.name === 'main');
  if (!mainDatabase || !mainDatabase.file) {
    throw new Error('The active SQLite database file could not be found.');
  }
  return path.resolve(mainDatabase.file);
}

function makeBackupName(kind) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `mcqapp-${kind}-${timestamp}-${crypto.randomBytes(3).toString('hex')}.sqlite`;
}

function backupInfo(filename, stats) {
  const match = filename.match(BACKUP_NAME_RE);
  return {
    filename,
    type: match[1] === 'automatic' ? 'Automatic' : 'Manual',
    createdAt: stats.mtime.toISOString(),
    sizeBytes: stats.size
  };
}

async function createBackup(prisma, kind = 'manual') {
  if (!['automatic', 'manual'].includes(kind)) throw new Error('Invalid backup type.');

  const sourcePath = await getDatabaseFile(prisma);
  await fs.mkdir(BACKUP_DIR, { recursive: true });

  const filename = makeBackupName(kind);
  const destinationPath = path.join(BACKUP_DIR, filename);
  const temporaryPath = `${destinationPath}.partial`;
  let source;

  try {
    source = new DatabaseSync(sourcePath, { readOnly: true });
    await backup(source, temporaryPath);
    source.close();
    source = null;

    const stats = await fs.stat(temporaryPath);
    if (stats.size === 0) throw new Error('The backup file is empty.');
    await fs.rename(temporaryPath, destinationPath);
    return backupInfo(filename, await fs.stat(destinationPath));
  } catch (error) {
    if (source) {
      try { source.close(); } catch {}
    }
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function listBackups() {
  let entries;
  try {
    entries = await fs.readdir(BACKUP_DIR, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const backups = await Promise.all(entries
    .filter(entry => entry.isFile() && BACKUP_NAME_RE.test(entry.name))
    .map(async entry => backupInfo(entry.name, await fs.stat(path.join(BACKUP_DIR, entry.name)))));
  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function getBackupPath(filename) {
  if (typeof filename !== 'string' || !BACKUP_NAME_RE.test(filename) || path.basename(filename) !== filename) {
    return null;
  }
  return path.join(BACKUP_DIR, filename);
}

async function startDailyBackups(prisma) {
  if (schedulerStarted) return;
  schedulerStarted = true;

  async function checkAndSchedule() {
    let delay = RETRY_MS;
    try {
      const backups = await listBackups();
      const latestAutomatic = backups.find(item => item.type === 'Automatic');
      const elapsed = latestAutomatic ? Date.now() - new Date(latestAutomatic.createdAt).getTime() : DAY_MS;

      if (elapsed >= DAY_MS) {
        const created = await createBackup(prisma, 'automatic');
        console.log(`Automatic database backup saved: ${created.filename}`);
        delay = DAY_MS;
      } else {
        delay = Math.max(elapsed >= 0 ? DAY_MS - elapsed : DAY_MS, 1000);
      }
    } catch (error) {
      console.error('Automatic database backup failed:', error.message);
    }

    const timer = setTimeout(checkAndSchedule, delay);
    if (typeof timer.unref === 'function') timer.unref();
  }

  await checkAndSchedule();
}

module.exports = { BACKUP_DIR, createBackup, listBackups, getBackupPath, startDailyBackups };