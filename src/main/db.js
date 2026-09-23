const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const electron = require('electron');
const app = electron.app;
const safeStorage = electron.safeStorage;

const CURRENT_SCHEMA_VERSION = 2;

let dbPath = '';
let bakPath = '';
let tmpPath = '';

function getUserDataPath() {
  if (app && typeof app.getPath === 'function') {
    try {
      return app.getPath('userData');
    } catch (e) {}
  }
  return process.env.VAYU_USER_DATA || path.join(require('os').tmpdir(), 'vayu-browser-data');
}

function initDbPaths() {
  const userData = getUserDataPath();
  if (!fs.existsSync(userData)) {
    try { fs.mkdirSync(userData, { recursive: true }); } catch (e) {}
  }
  dbPath = path.join(userData, 'orbit-data.json');
  bakPath = path.join(userData, 'orbit-data.json.bak');
  tmpPath = path.join(userData, 'orbit-data.json.tmp');
}

const defaultDb = () => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  history: [],
  bookmarks: [],
  settings: {
    adBlockEnabled: true,
    homepage: 'orbit://newtab',
    restoreSession: false
  },
  stats: {
    totalBlocked: 0
  },
  permissions: {},
  passwords: [],
  downloads: [],
  session: {
    tabs: [],
    activeTabIndex: 0,
    timestamp: 0
  }
});

let db = defaultDb();
let dbDirty = false;

// Native Encryption for Passwords using safeStorage (DPAPI) with AES-256-GCM fallback
function encryptPassword(password) {
  if (!password) return '';
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(password).toString('base64');
    }
  } catch (e) {
    console.error('safeStorage encryption failed, falling back:', e);
  }
  try {
    const key = crypto.scryptSync(getUserDataPath(), 'vayu-pass-salt', 32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return 'gcm:' + Buffer.concat([iv, tag, enc]).toString('base64');
  } catch (e) {
    console.error('Fallback password encryption failed:', e);
    return password;
  }
}

function decryptPassword(stored) {
  if (!stored) return '';
  if (typeof stored !== 'string') return '';
  try {
    if (stored.startsWith('enc:') && safeStorage && safeStorage.isEncryptionAvailable()) {
      const buf = Buffer.from(stored.slice(4), 'base64');
      return safeStorage.decryptString(buf);
    }
    if (stored.startsWith('gcm:')) {
      const data = Buffer.from(stored.slice(4), 'base64');
      const iv = data.subarray(0, 12);
      const tag = data.subarray(12, 28);
      const enc = data.subarray(28);
      const key = crypto.scryptSync(getUserDataPath(), 'vayu-pass-salt', 32);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    }
  } catch (e) {
    console.error('Password decryption failed:', e);
  }
  return stored;
}

function sanitizeAndMigrateDb(loaded) {
  if (!loaded || typeof loaded !== 'object') {
    return defaultDb();
  }

  // Schema version migration
  const version = loaded.schemaVersion || 1;
  if (version < 2) {
    // Migration v1 -> v2: Add session schema and restoreSession setting
    if (!loaded.session) {
      loaded.session = { tabs: [], activeTabIndex: 0, timestamp: 0 };
    }
    if (loaded.settings && loaded.settings.restoreSession === undefined) {
      loaded.settings.restoreSession = false;
    }
    loaded.schemaVersion = 2;
    dbDirty = true;
  }

  if (!Array.isArray(loaded.history)) {
    loaded.history = [];
  } else {
    loaded.history = loaded.history.filter(item => item && typeof item === 'object' && typeof item.url === 'string');
  }

  if (!Array.isArray(loaded.bookmarks)) {
    loaded.bookmarks = [];
  } else {
    loaded.bookmarks = loaded.bookmarks.filter(item => item && typeof item === 'object' && typeof item.url === 'string');
  }

  if (!Array.isArray(loaded.downloads)) {
    loaded.downloads = [];
  } else {
    loaded.downloads = loaded.downloads.filter(item => item && typeof item === 'object' && typeof item.id === 'string' && !item.isIncognito);
  }

  if (!Array.isArray(loaded.passwords)) {
    loaded.passwords = [];
  } else {
    loaded.passwords = loaded.passwords.filter(item => item && typeof item === 'object' && typeof item.url === 'string');
    let migratedAny = false;
    loaded.passwords.forEach(item => {
      if (item && item.password && !item.password.startsWith('enc:') && !item.password.startsWith('gcm:')) {
        item.password = encryptPassword(item.password);
        migratedAny = true;
      }
    });
    if (migratedAny) dbDirty = true;
  }

  if (!loaded.settings || typeof loaded.settings !== 'object') {
    loaded.settings = { adBlockEnabled: true, homepage: 'orbit://newtab', restoreSession: false };
  }
  if (!loaded.stats || typeof loaded.stats !== 'object') {
    loaded.stats = { totalBlocked: 0 };
  }
  if (!loaded.permissions || typeof loaded.permissions !== 'object') {
    loaded.permissions = {};
  }
  if (!loaded.session || typeof loaded.session !== 'object') {
    loaded.session = { tabs: [], activeTabIndex: 0, timestamp: 0 };
  }

  return loaded;
}

function loadDb() {
  if (!dbPath) initDbPaths();

  let parsed = null;

  // 1. Try reading primary database file
  if (fs.existsSync(dbPath)) {
    try {
      const data = fs.readFileSync(dbPath, 'utf8');
      parsed = JSON.parse(data);
    } catch (err) {
      console.error('[DB] Primary database file is corrupted, attempting recovery from .bak:', err);
    }
  }

  // 2. If primary failed or missing, try reading backup file (.bak)
  if (!parsed && fs.existsSync(bakPath)) {
    try {
      const bakData = fs.readFileSync(bakPath, 'utf8');
      parsed = JSON.parse(bakData);
      console.log('[DB] Successfully recovered database from .bak!');
    } catch (bakErr) {
      console.error('[DB] Backup database file is also corrupted:', bakErr);
    }
  }

  // 3. If both invalid or missing, initialize with clean defaults
  if (!parsed) {
    console.log('[DB] Initializing new database with defaults.');
    db = defaultDb();
    saveDb();
    return db;
  }

  db = sanitizeAndMigrateDb(parsed);

  // If migration dirtied the db, save immediately
  if (dbDirty) {
    saveDb();
  }

  return db;
}

// Atomic file save: writes to .tmp, creates .bak from current db, then atomic renames .tmp -> dbPath
function saveDb() {
  if (!dbPath) initDbPaths();

  try {
    const payload = JSON.stringify(db, null, 2);
    
    // Write temporary file completely and flush
    fs.writeFileSync(tmpPath, payload, 'utf8');

    // Create / update single valid backup (.bak) from the existing db file before overwriting
    if (fs.existsSync(dbPath)) {
      try {
        fs.copyFileSync(dbPath, bakPath);
      } catch (copyErr) {
        // Non-fatal if backup copy fails
      }
    }

    // Atomic rename: replaces target file
    fs.renameSync(tmpPath, dbPath);
    dbDirty = false;
  } catch (err) {
    console.error('[DB] Atomic save failed:', err);
    // Cleanup dangling tmp file if it still exists
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (e) {}
  }
}

function getDb() {
  return db;
}

function setDbDirty(val = true) {
  dbDirty = val;
}

function isDbDirty() {
  return dbDirty;
}

module.exports = {
  loadDb,
  saveDb,
  getDb,
  setDbDirty,
  isDbDirty,
  encryptPassword,
  decryptPassword,
  CURRENT_SCHEMA_VERSION
};
