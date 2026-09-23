const { getDb, setDbDirty, saveDb } = require('./db');

/**
 * Standardizes permission names across Electron and browser standards
 */
function normalizePermission(permission) {
  if (permission === 'geolocation') return 'location';
  if (permission === 'audio') return 'microphone';
  if (permission === 'video') return 'camera';
  return permission;
}

/**
 * Extracts normalized origin (e.g. 'https://example.com' or hostname)
 */
function getOrigin(urlOrOrigin) {
  try {
    const parsed = new URL(urlOrOrigin);
    return parsed.hostname;
  } catch (e) {
    return urlOrOrigin || '';
  }
}

/**
 * Registers permission handlers for a given Electron session
 */
function setupPermissionHandlers(sess, options = {}) {
  const { onPermissionDeniedTooltip } = options;

  sess.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const url = webContents.getURL();
    const domain = getOrigin(url);
    const mapped = normalizePermission(permission);
    const db = getDb();

    if (db.permissions && db.permissions[domain] && db.permissions[domain][mapped] !== undefined) {
      const state = db.permissions[domain][mapped];
      if (state === false || state === 'deny') {
        if (typeof onPermissionDeniedTooltip === 'function') {
          onPermissionDeniedTooltip('Click Lock Icon Here', `Enable ${mapped} for ${domain}`);
        }
        return callback(false);
      }
      if (state === true || state === 'allow') {
        return callback(true);
      }
    }

    // Sensitive permissions must be denied by default unless explicitly granted by user
    const SENSITIVE_PERMISSIONS = ['location', 'camera', 'microphone', 'clipboard-read'];
    if (SENSITIVE_PERMISSIONS.includes(mapped) || mapped === 'clipboard') {
      if (typeof onPermissionDeniedTooltip === 'function') {
        onPermissionDeniedTooltip('Permission Blocked', `Click lock icon to allow ${mapped} for ${domain}`);
      }
      return callback(false);
    }

    // Non-sensitive permissions (e.g. notifications/fullscreen) can default to prompt or allow
    callback(false);
  });

  sess.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const domain = getOrigin(requestingOrigin);
    const db = getDb();
    const mapped = normalizePermission(permission);

    if (db.permissions && db.permissions[domain]) {
      const perms = db.permissions[domain];

      if (permission === 'geolocation') {
        return perms.location === true || perms.location === 'allow';
      }

      if (permission === 'media') {
        const mediaType = details && details.mediaType;
        if (mediaType === 'video') {
          return perms.camera === true || perms.camera === 'allow';
        }
        if (mediaType === 'audio') {
          return perms.microphone === true || perms.microphone === 'allow';
        }
      }

      if (perms[mapped] !== undefined) {
        return perms[mapped] === true || perms[mapped] === 'allow';
      }
    }

    // Default to deny for sensitive checks
    const SENSITIVE_PERMISSIONS = ['geolocation', 'location', 'camera', 'microphone', 'media'];
    if (SENSITIVE_PERMISSIONS.includes(permission) || SENSITIVE_PERMISSIONS.includes(mapped)) {
      return false;
    }

    return false;
  });
}

/**
 * Saves a granular permission state for a domain
 */
function setPermission(domain, permission, value) {
  const db = getDb();
  if (!db.permissions) db.permissions = {};
  if (!db.permissions[domain]) db.permissions[domain] = {};

  db.permissions[domain][permission] = value;
  setDbDirty(true);
  saveDb();
}

/**
 * Gets the current permissions map for a domain (defaults to secure false for sensitive items)
 */
function getPermissionsForDomain(domain) {
  const db = getDb();
  const domainPerms = (db.permissions && db.permissions[domain]) || {};
  return {
    location: domainPerms.location === true || domainPerms.location === 'allow',
    downloads: domainPerms.downloads !== undefined ? (domainPerms.downloads === true || domainPerms.downloads === 'allow') : true,
    clipboard: domainPerms.clipboard === true || domainPerms.clipboard === 'allow',
    camera: domainPerms.camera === true || domainPerms.camera === 'allow',
    microphone: domainPerms.microphone === true || domainPerms.microphone === 'allow'
  };
}

module.exports = {
  setupPermissionHandlers,
  setPermission,
  getPermissionsForDomain,
  normalizePermission,
  getOrigin
};
