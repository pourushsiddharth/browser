const { app, BrowserWindow, safeStorage } = require('electron');

/**
 * Validates whether an IPC event originates from a trusted internal browser window
 * (mainWindow or internal auxiliary popups).
 */
function isTrustedSender(event, windowRefs = {}) {
  if (!event || !event.sender) return false;
  const senderId = event.sender.id;

  const {
    mainWindow,
    customContextMenuWin,
    lockPointerWin,
    locationNotificationWin,
    feedbackPopup,
    shieldPopup,
    qrWindow
  } = windowRefs;

  if (mainWindow && !mainWindow.isDestroyed() && senderId === mainWindow.webContents.id) {
    return true;
  }

  const auxiliaryWindows = [
    customContextMenuWin,
    lockPointerWin,
    locationNotificationWin,
    feedbackPopup,
    shieldPopup,
    qrWindow
  ];

  for (const win of auxiliaryWindows) {
    if (win && !win.isDestroyed() && senderId === win.webContents.id) {
      return true;
    }
  }

  return false;
}

/**
 * Validates that an argument is a safe string without unexpected types
 */
function isValidString(val, maxLength = 2048) {
  return typeof val === 'string' && val.length > 0 && val.length <= maxLength;
}

/**
 * Validates a web URL scheme
 */
function isValidNavigationUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') return false;
  if (urlString.startsWith('orbit://') || urlString.startsWith('view-source:') || urlString.startsWith('file://')) {
    return true;
  }
  try {
    const parsed = new URL(urlString);
    return ['http:', 'https:', 'about:', 'data:'].includes(parsed.protocol);
  } catch (e) {
    // If not a full URL, it could be a search term
    return !urlString.includes('\0');
  }
}

module.exports = {
  isTrustedSender,
  isValidString,
  isValidNavigationUrl
};
