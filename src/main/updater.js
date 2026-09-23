const { ipcMain, app } = require('electron');

/**
 * Initializes auto-update handlers with electron-updater if installed,
 * or provides a graceful no-op fallback when running in unpackaged development mode.
 */
function initAutoUpdater(mainWindow) {
  let autoUpdater;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (err) {
    // electron-updater optional or dev mode
    console.log('[AutoUpdater] electron-updater not installed or dev mode active.');
    return;
  }

  if (!app.isPackaged) {
    console.log('[AutoUpdater] App is not packaged. Skipping update checks.');
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] Update available:', info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-available', info);
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[AutoUpdater] Browser is up to date.');
  });

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] Error checking updates:', err.message);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-download-progress', progressObj);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] Update downloaded:', info.version);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded', info);
    }
  });

  ipcMain.on('check-for-updates', () => {
    try {
      autoUpdater.checkForUpdates().catch(() => {});
    } catch (e) {}
  });

  ipcMain.on('download-update', () => {
    try {
      autoUpdater.downloadUpdate().catch(() => {});
    } catch (e) {}
  });

  ipcMain.on('install-update', () => {
    try {
      autoUpdater.quitAndInstall();
    } catch (e) {}
  });

  // Check for updates 10 seconds after launch
  setTimeout(() => {
    try {
      autoUpdater.checkForUpdates().catch(() => {});
    } catch (e) {}
  }, 10000);
}

module.exports = {
  initAutoUpdater
};
