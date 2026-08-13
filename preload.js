const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  send: (channel, data) => {
    const validChannels = [
      'create-tab',
      'switch-tab',
      'close-tab',
      'navigate-tab',
      'back-tab',
      'forward-tab',
      'reload-tab',
      'get-history',
      'clear-history',
      'get-bookmarks',
      'add-bookmark',
      'remove-bookmark',
      'toggle-adblock',
      'get-settings',
      'save-settings',
      'window-minimize',
      'window-maximize',
      'window-close',
      'toggle-reader-mode',
      'sidebar-toggle',
      'toggle-immersive-mode',
      'toggle-collapse-chrome',
      'chrome-hover-status',
      'log-to-main',
      'toggle-shield-popup',
      'get-shield-info',
      'close-shield-popup',
      'show-bookmark-context-menu',
      'close-qr-window',
      'cancel-download',
      'pause-download',
      'resume-download',
      'open-download',
      'show-download-in-folder',
      'get-downloads',
      'clear-downloads'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  on: (channel, func) => {
    const validChannels = [
      'tab-created',
      'tab-created-external',
      'tab-updated',
      'tab-closed',
      'tab-focused',
      'history-data',
      'bookmarks-data',
      'settings-data',
      'blocked-count',
      'update-address',
      'tab-trackers-updated',
      'reader-mode-updated',
      'immersive-mode-updated',
      'collapse-chrome-updated',
      'window-maximized-status',
      'shield-info-data',
      'download-started',
      'download-updated',
      'download-done',
      'downloads-data'
    ];
    if (validChannels.includes(channel)) {
      const subscription = (event, ...args) => func(...args);
      ipcRenderer.on(channel, subscription);
      // Return unregister function
      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    }
  }
});
