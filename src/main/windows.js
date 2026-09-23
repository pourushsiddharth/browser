const path = require('path');
const { BrowserWindow } = require('electron');

let mainWindow = null;
let shieldPopup = null;
let qrWindow = null;
let customContextMenuWin = null;
let lockPointerWin = null;
let locationNotificationWin = null;
let feedbackPopup = null;

function getMainWindow() {
  return mainWindow;
}

function setMainWindow(win) {
  mainWindow = win;
}

function getWindowRefs() {
  return {
    mainWindow,
    shieldPopup,
    qrWindow,
    customContextMenuWin,
    lockPointerWin,
    locationNotificationWin,
    feedbackPopup
  };
}

/**
 * Creates the primary browser window with frameless styling and hardened preferences
 */
function createMainWindow(preloadPath) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, '../../vayu_app_logo.png'),
    webPreferences: {
      preload: preloadPath || path.join(__dirname, '../../preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    backgroundColor: '#f3f4f6'
  });

  return mainWindow;
}

/**
 * Closes an auxiliary window safely if it exists and is not destroyed
 */
function closeWindowSafely(win) {
  if (win && !win.isDestroyed()) {
    try {
      win.close();
    } catch (e) {}
  }
}

module.exports = {
  getMainWindow,
  setMainWindow,
  getWindowRefs,
  createMainWindow,
  closeWindowSafely,
  mainWindow,
  shieldPopup,
  qrWindow,
  customContextMenuWin,
  lockPointerWin,
  locationNotificationWin,
  feedbackPopup
};
