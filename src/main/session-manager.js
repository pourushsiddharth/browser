const { getDb, setDbDirty, saveDb } = require('./db');

const DISALLOWED_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:'];

/**
 * Validates whether a URL is safe to persist and restore
 */
function isRestorableUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') return false;
  const lower = urlString.trim().toLowerCase();

  for (const scheme of DISALLOWED_SCHEMES) {
    if (lower.startsWith(scheme)) return false;
  }

  if (lower === 'orbit://newtab' || lower.includes('newtab.html')) {
    return true;
  }

  try {
    const parsed = new URL(urlString);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch (e) {
    return false;
  }
}

/**
 * Persists the current normal browsing session to db.session.
 * Strictly ignores incognito tabs.
 */
function saveSessionState(tabsMap, activeTabId) {
  const db = getDb();
  const restorableTabs = [];
  let activeIndex = 0;

  let index = 0;
  for (const [id, tab] of tabsMap.entries()) {
    // Incognito Exclusion: NEVER persist incognito tabs
    if (!tab.isIncognito && tab.url && isRestorableUrl(tab.url)) {
      restorableTabs.push({
        url: tab.url === 'orbit://newtab' || tab.url.includes('newtab.html') ? 'orbit://newtab' : tab.url,
        title: tab.title || 'New Tab'
      });
      if (id === activeTabId) {
        activeIndex = restorableTabs.length - 1;
      }
      index++;
    }
  }

  db.session = {
    tabs: restorableTabs,
    activeTabIndex: activeIndex,
    timestamp: Date.now()
  };

  setDbDirty(true);
}

/**
 * Retrieves the saved session if restoreSession is enabled and valid tabs exist
 */
function getRestorableSession() {
  const db = getDb();
  if (!db.settings || !db.settings.restoreSession) {
    return null;
  }

  if (!db.session || !Array.isArray(db.session.tabs) || db.session.tabs.length === 0) {
    return null;
  }

  // Filter out any unsafe URLs that might have been saved
  const safeTabs = db.session.tabs.filter(t => t && isRestorableUrl(t.url));
  if (safeTabs.length === 0) return null;

  return {
    tabs: safeTabs,
    activeTabIndex: Math.min(Math.max(0, db.session.activeTabIndex || 0), safeTabs.length - 1)
  };
}

/**
 * Clears saved session state
 */
function clearSessionState() {
  const db = getDb();
  db.session = { tabs: [], activeTabIndex: 0, timestamp: 0 };
  setDbDirty(true);
  saveDb();
}

module.exports = {
  isRestorableUrl,
  saveSessionState,
  getRestorableSession,
  clearSessionState
};
