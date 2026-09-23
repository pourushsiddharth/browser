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

    // Default to allow if not explicitly denied (consistent with current user experience)
    callback(true);
  });

  sess.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const domain = getOrigin(requestingOrigin);
    const db = getDb();

    if (db.permissions && db.permissions[domain]) {
      const perms = db.permissions[domain];

      if (permission === 'geolocation' && (perms.location === false || perms.location === 'deny')) {
        if (typeof onPermissionDeniedTooltip === 'function') {
          onPermissionDeniedTooltip('Click Lock Icon Here', `Enable location for ${domain}`);
        }
        return false;
      }

      if (permission === 'media') {
        const mediaType = details && details.mediaType;
        if (mediaType === 'video' && (perms.camera === false || perms.camera === 'deny')) {
          if (typeof onPermissionDeniedTooltip === 'function') {
            onPermissionDeniedTooltip('Click Lock Icon Here', `Enable camera for ${domain}`);
          }
          return false;
        }
        if (mediaType === 'audio' && (perms.microphone === false || perms.microphone === 'deny')) {
          if (typeof onPermissionDeniedTooltip === 'function') {
            onPermissionDeniedTooltip('Click Lock Icon Here', `Enable microphone for ${domain}`);
          }
          return false;
        }
      }

      const mapped = normalizePermission(permission);
      if (perms[mapped] === false || perms[mapped] === 'deny') {
        if (typeof onPermissionDeniedTooltip === 'function') {
          onPermissionDeniedTooltip('Click Lock Icon Here', `Enable ${mapped} for ${domain}`);
        }
        return false;
      }
    }

    return true;
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
 * Gets the current permissions map for a domain
 */
function getPermissionsForDomain(domain) {
  const db = getDb();
  return (db.permissions && db.permissions[domain]) || {
    location: true,
    downloads: true,
    clipboard: true,
    camera: true,
    microphone: true
  };
}

module.exports = {
  setupPermissionHandlers,
  setPermission,
  getPermissionsForDomain,
  normalizePermission,
  getOrigin
};
