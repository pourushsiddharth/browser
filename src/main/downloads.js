const path = require('path');
const { getDb, setDbDirty, saveDb } = require('./db');

const DANGEROUS_EXTENSIONS = new Set([
  '.exe', '.msi', '.bat', '.cmd', '.vbs', '.ps1', '.scr', '.com', '.pif', '.hta', '.cpl', '.jar'
]);

const activeDownloads = new Map(); // downloadId -> DownloadItem

/**
 * Sanitizes suggested filenames to prevent path traversal or invalid Windows characters
 */
function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return `download_${Date.now()}`;
  }
  // Strip path traversal attempts and directory separators
  let clean = path.basename(filename);
  clean = clean.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  // Trim spaces and dots from ends
  clean = clean.replace(/^[\s.]+|[\s.]+$/g, '');
  if (!clean) clean = `download_${Date.now()}`;
  return clean;
}

/**
 * Checks if a filename has a potentially dangerous executable extension
 */
function isDangerousFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return DANGEROUS_EXTENSIONS.has(ext);
}

/**
 * Registers download handlers on an Electron session
 */
function setupDownloadManager(sess, isIncognito, callbacks = {}) {
  const { onDownloadStarted, onDownloadUpdated, onDownloadDone, onBrowserDownloadDetected } = callbacks;

  sess.on('will-download', (event, item, webContents) => {
    const rawFilename = item.getFilename();
    const filename = sanitizeFilename(rawFilename);
    const url = item.getURL();

    // Check if user is downloading a competitor browser
    const lowercaseFn = filename.toLowerCase();
    const lowercaseUrl = url.toLowerCase();
    const isBrowserDownload =
      lowercaseFn.includes('chrome') || lowercaseFn.includes('firefox') ||
      lowercaseFn.includes('opera') || lowercaseFn.includes('brave') ||
      lowercaseFn.includes('safari') || lowercaseFn.includes('edge') ||
      lowercaseUrl.includes('chrome') || lowercaseUrl.includes('firefox') ||
      lowercaseUrl.includes('opera') || lowercaseUrl.includes('brave') ||
      lowercaseUrl.includes('edge');

    if (isBrowserDownload && typeof onBrowserDownloadDetected === 'function') {
      onBrowserDownloadDetected(filename, url);
    }

    const downloadId = 'dl-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
    activeDownloads.set(downloadId, item);

    const totalBytes = item.getTotalBytes();
    const date = new Date().toISOString();
    const isDangerous = isDangerousFile(filename);

    const downloadState = {
      id: downloadId,
      filename: filename,
      totalBytes: totalBytes,
      receivedBytes: 0,
      status: 'progressing',
      url: url,
      savePath: item.getSavePath() || '',
      date: date,
      isIncognito: isIncognito,
      isDangerous: isDangerous
    };

    // Incognito privacy guarantee: strictly avoid persisting incognito downloads to disk DB
    if (!isIncognito) {
      const db = getDb();
      if (!db.downloads) db.downloads = [];
      db.downloads.unshift(downloadState);
      setDbDirty(true);
    }

    if (typeof onDownloadStarted === 'function') {
      onDownloadStarted(downloadState);
    }

    item.on('updated', (event, state) => {
      if (state === 'interrupted') {
        downloadState.status = 'interrupted';
      } else if (state === 'progressing') {
        downloadState.status = 'progressing';
        downloadState.receivedBytes = item.getReceivedBytes();
        downloadState.savePath = item.getSavePath();
      }

      if (!isIncognito) {
        const db = getDb();
        const idx = db.downloads.findIndex(d => d.id === downloadId);
        if (idx !== -1) {
          db.downloads[idx] = { ...db.downloads[idx], ...downloadState };
          setDbDirty(true);
        }
      }

      if (typeof onDownloadUpdated === 'function') {
        onDownloadUpdated({
          id: downloadId,
          receivedBytes: downloadState.receivedBytes,
          status: downloadState.status,
          savePath: downloadState.savePath
        });
      }
    });

    item.once('done', (event, state) => {
      activeDownloads.delete(downloadId);

      if (state === 'completed') {
        downloadState.status = 'completed';
        downloadState.receivedBytes = totalBytes || item.getReceivedBytes();
        downloadState.savePath = item.getSavePath();
      } else if (state === 'cancelled') {
        downloadState.status = 'cancelled';
      } else {
        downloadState.status = 'failed';
      }

      if (!isIncognito) {
        const db = getDb();
        const idx = db.downloads.findIndex(d => d.id === downloadId);
        if (idx !== -1) {
          db.downloads[idx] = { ...db.downloads[idx], ...downloadState };
          setDbDirty(true);
          saveDb();
        }
      }

      if (typeof onDownloadDone === 'function') {
        onDownloadDone(downloadState);
      }
    });
  });
}

function getActiveDownload(id) {
  return activeDownloads.get(id);
}

module.exports = {
  setupDownloadManager,
  sanitizeFilename,
  isDangerousFile,
  getActiveDownload,
  activeDownloads
};
