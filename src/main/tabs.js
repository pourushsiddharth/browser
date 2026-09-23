const path = require('path');
const { WebContentsView, session } = require('electron');
const { getDb } = require('./db');
const { saveSessionState } = require('./session-manager');

const tabs = new Map(); // tabId -> tabObject
const webContentsToTabIdMap = new Map(); // webContents.id -> tabId
const recentlyClosedTabs = [];

function getTabsMap() {
  return tabs;
}

function getRecentlyClosedTabs() {
  return recentlyClosedTabs;
}

function getTabIdFromWebContents(webContents) {
  if (!webContents) return null;
  return webContentsToTabIdMap.get(webContents.id) || null;
}

/**
 * Creates and registers a new WebContentsView tab
 */
function createTabInstance(tabId, url, isIncognito = false, callbacks = {}) {
  const db = getDb();
  const sess = isIncognito ? session.fromPartition('incognito') : session.defaultSession;

  const view = new WebContentsView({
    webPreferences: {
      session: sess,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, '../../preload-tab.js')
    }
  });

  const tab = {
    id: tabId,
    url: url || 'orbit://newtab',
    title: 'New Tab',
    view: view,
    isIncognito: isIncognito,
    blockedCount: 0,
    blockedTrackers: [],
    readerModeEnabled: false,
    readerCssKeys: [],
    adBlockEnabled: db.settings ? db.settings.adBlockEnabled : true,
    isCrashed: false
  };

  tabs.set(tabId, tab);
  webContentsToTabIdMap.set(view.webContents.id, tabId);

  // Crash Recovery: detect renderer crash / OOM and provide graceful recovery
  view.webContents.on('render-process-gone', (event, details) => {
    tab.isCrashed = true;
    console.error(`[TabCrash] Tab ${tabId} crashed: reason=${details.reason}, exitCode=${details.exitCode}`);

    if (typeof callbacks.onTabCrashed === 'function') {
      callbacks.onTabCrashed(tab, details);
    }
  });

  return tab;
}

/**
 * Destroys a tab and cleans up all WebContents and listener references
 */
function destroyTabInstance(tabId, callbacks = {}) {
  if (!tabs.has(tabId)) return;
  const tab = tabs.get(tabId);

  // Save to recently closed if not incognito
  if (tab && !tab.isIncognito && tab.url && tab.url !== 'orbit://newtab' && !tab.url.startsWith('file://')) {
    recentlyClosedTabs.push({ url: tab.url, title: tab.title });
    if (recentlyClosedTabs.length > 20) {
      recentlyClosedTabs.shift();
    }
  }

  if (tab && tab.view && tab.view.webContents) {
    webContentsToTabIdMap.delete(tab.view.webContents.id);
    try {
      tab.view.webContents.destroy();
    } catch (e) {}
  }

  tabs.delete(tabId);

  // Incognito zero-trace check: if no active incognito tabs remain, purge incognito partition
  let remainingIncognito = false;
  for (const t of tabs.values()) {
    if (t.isIncognito) {
      remainingIncognito = true;
      break;
    }
  }
  if (!remainingIncognito) {
    try {
      const incognitoSession = session.fromPartition('incognito');
      incognitoSession.clearStorageData().catch(() => {});
      incognitoSession.clearCache().catch(() => {});
    } catch (e) {}
  }

  if (typeof callbacks.onTabDestroyed === 'function') {
    callbacks.onTabDestroyed(tabId);
  }
}

module.exports = {
  tabs,
  webContentsToTabIdMap,
  recentlyClosedTabs,
  getTabsMap,
  getRecentlyClosedTabs,
  getTabIdFromWebContents,
  createTabInstance,
  destroyTabInstance
};
