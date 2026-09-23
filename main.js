const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu, MenuItem, safeStorage } = require('electron');
app.name = 'Vayu';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// Load environment variables safely from .env if present
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const idx = trimmed.indexOf('=');
          if (idx !== -1) {
            const key = trimmed.slice(0, idx).trim();
            const val = trimmed.slice(idx + 1).trim();
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      });
    }
  } catch (e) {}
}
loadEnv();

// Global error handlers to capture main process crashes/exceptions
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION IN MAIN PROCESS:', err);
  try {
    const logPath = path.join(app.getPath('userData'), 'orbit-error.log');
    fs.appendFileSync(logPath, `[UNCAUGHT EXCEPTION - ${new Date().toISOString()}] ${err.stack}\n`);
  } catch (e) {}
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION IN MAIN PROCESS:', reason);
  try {
    const logPath = path.join(app.getPath('userData'), 'orbit-error.log');
    fs.appendFileSync(logPath, `[UNHANDLED REJECTION - ${new Date().toISOString()}] ${reason.stack || reason}\n`);
  } catch (e) {}
});

// Modularized Subsystems
const dbModule = require('./src/main/db');
const { loadDb: initDb, saveDb: persistDb, encryptPassword, decryptPassword } = dbModule;
const security = require('./src/browser/security');
const adblocker = require('./src/browser/adblock');
const sessionManager = require('./src/main/session-manager');
const permissionsManager = require('./src/main/permissions');
const downloadsManager = require('./src/main/downloads');
const { initAutoUpdater } = require('./src/main/updater');

// Load custom widget promo banner background and logo
let vayuWidgetBase64 = '';
let vayuLogoBase64 = '';
try {
  const imagePath = path.join(__dirname, 'vayu_widget.jpg');
  if (fs.existsSync(imagePath)) {
    const fileBuffer = fs.readFileSync(imagePath);
    vayuWidgetBase64 = `data:image/jpeg;base64,${fileBuffer.toString('base64')}`;
  }
} catch (e) {
  console.error('Failed to load vayu_widget.jpg:', e);
}
try {
  const logoPath = path.join(__dirname, 'vayu_logo.png');
  if (fs.existsSync(logoPath)) {
    const fileBuffer = fs.readFileSync(logoPath);
    vayuLogoBase64 = `data:image/png;base64,${fileBuffer.toString('base64')}`;
  }
} catch (e) {
  console.error('Failed to load vayu_logo.png:', e);
}

// State
let mainWindow;
let shieldPopup = null;
let qrWindow = null;
const activeDownloads = new Map(); // id -> DownloadItem
const tabs = new Map(); // tabId -> { id, url, title, view, isIncognito, blockedCount }
let activeTabId = null;
const recentlyClosedTabs = [];
const webContentsToTabIdMap = new Map(); // webContentsId -> tabId
let isSidebarOpen = false;
let isChromeCollapsed = false;
let isChromeHovered = false;
let currentY = 124;
let animationInterval = null;

// Database instance proxy backed by modular storage
let db = dbModule.getDb();
let dbDirty = false;

function loadDb() {
  db = dbModule.loadDb();
  return db;
}

function saveDb() {
  dbModule.saveDb();
  dbDirty = false;
}

function queryRegistryDword(registryKey, valueName) {
  try {
    const output = execFileSync('reg', ['query', registryKey, '/v', valueName], {
      encoding: 'utf8',
      windowsHide: true
    });

    const line = output.split(/\r?\n/).find((entry) => entry.includes(valueName) && entry.includes('REG_DWORD'));
    if (!line) return null;

    const match = line.match(/REG_DWORD\s+0x([0-9a-fA-F]+)/);
    if (!match) return null;

    return parseInt(match[1], 16);
  } catch (err) {
    return null;
  }
}

function writeRegistryDword(registryKey, valueName, value) {
  try {
    execFileSync('reg', ['add', registryKey, '/v', valueName, '/t', 'REG_DWORD', '/d', String(value), '/f'], {
      encoding: 'utf8',
      windowsHide: true
    });
  } catch (err) {
    console.error(`Failed writing registry value ${valueName}:`, err);
  }
}

function applyInstallerPreferencesOnce() {
  if (process.platform !== 'win32') return;

  const registryKey = 'HKCU\\Software\\Vayu';
  const importedFlag = queryRegistryDword(registryKey, 'InstallerPrefsImported');
  if (importedFlag === 1) return;

  const installedFlag = queryRegistryDword(registryKey, 'Installed');
  if (installedFlag !== 1) return;

  const shieldPreference = queryRegistryDword(registryKey, 'EnablePrivacyShield');
  if (shieldPreference !== null) {
    db.settings.adBlockEnabled = shieldPreference === 1;
  }

  const setAsDefaultPreference = queryRegistryDword(registryKey, 'SetAsDefaultBrowser');
  if (setAsDefaultPreference !== null) {
    db.settings.setAsDefaultBrowserRequested = setAsDefaultPreference === 1;
  }

  db.settings.installerPrefsImported = true;
  dbDirty = true;
  saveDb();

  writeRegistryDword(registryKey, 'InstallerPrefsImported', 1);
}

// Auto-save database periodically if dirty
setInterval(() => {
  if (dbDirty) {
    saveDb();
  }
}, 5000);

// Helper: Get Tab ID from WebContents
function getTabIdFromWebContents(webContents) {
  if (!webContents) return null;
  return webContentsToTabIdMap.get(webContents.id);
}

function sendToShieldPopup(channel, data) {
  if (shieldPopup && !shieldPopup.isDestroyed()) {
    try {
      shieldPopup.webContents.send(channel, data);
    } catch (err) {
      console.error('Failed to send to shield popup', err);
    }
  }
}

// AdBlocker Request Interception
function setupAdBlocker(sess) {
  sess.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    if (details.resourceType === 'mainFrame') {
      return callback({ cancel: false });
    }

    const tabId = getTabIdFromWebContents(details.webContents);
    let tabAdBlockEnabled = db.settings.adBlockEnabled;
    if (tabId && tabs.has(tabId)) {
      tabAdBlockEnabled = tabs.get(tabId).adBlockEnabled;
    }

    if (tabAdBlockEnabled && adblocker.isBlocked(details.url)) {
      // Increment global stats
      db.stats.totalBlocked = (db.stats.totalBlocked || 0) + 1;
      dbDirty = true;

      if (tabId && tabs.has(tabId)) {
        const tab = tabs.get(tabId);
        tab.blockedCount = (tab.blockedCount || 0) + 1;
        
        let trackerHost = '';
        try {
          trackerHost = new URL(details.url).hostname;
        } catch (e) {
          trackerHost = details.url;
        }

        if (!Array.isArray(tab.blockedTrackers)) {
          tab.blockedTrackers = [];
        }

        const exists = tab.blockedTrackers.some(t => t.hostname === trackerHost);
        if (!exists) {
          tab.blockedTrackers.push({
            hostname: trackerHost,
            url: details.url,
            timestamp: Date.now()
          });
        }
        
        // Notify renderer of new blocked count & tracker list
        if (mainWindow) {
          mainWindow.webContents.send('blocked-count', { tabId, count: tab.blockedCount, globalCount: db.stats.totalBlocked });
          mainWindow.webContents.send('tab-trackers-updated', {
            tabId,
            blockedCount: tab.blockedCount,
            blockedTrackers: tab.blockedTrackers
          });
        }

        // Notify shield popup in real-time
        if (activeTabId === tabId) {
          sendToShieldPopup('shield-info-data', {
            adBlockEnabled: tab.adBlockEnabled,
            blockedCount: tab.blockedCount || 0,
            blockedTrackers: tab.blockedTrackers || [],
            globalBlockedCount: db.stats ? db.stats.totalBlocked : 0,
            favicon: tab.favicon || '',
            url: tab.url || ''
          });
        }
      }
      return callback({ cancel: true });
    }

    callback({ cancel: false });
  });
}

function getSiteNameForViewSource(url) {
  if (!url || !url.startsWith('view-source:')) return '';
  const nestedUrl = url.slice('view-source:'.length).trim();
  try {
    if (nestedUrl.startsWith('file://')) {
      const parts = nestedUrl.split('/');
      return parts[parts.length - 1] || 'local file';
    }
    const parsed = new URL(nestedUrl);
    return parsed.hostname;
  } catch (e) {
    return nestedUrl;
  }
}

function isPrintPreviewUrl(url) {
  return url && url.startsWith('file://') && url.includes('print-preview-') && url.endsWith('.pdf');
}

function getTitleForPrintPreview(url) {
  const filename = path.basename(url);
  const match = filename.match(/print-preview-(.+)-\d+\.pdf$/);
  if (match && match[1]) {
    return `Print Preview - ${match[1].replace(/_/g, ' ')}`;
  }
  return 'Print Preview';
}

function showPrintPreview(targetWebContents) {
  const originalTitle = targetWebContents.getTitle() || 'Page';
  const safeTitle = originalTitle.replace(/[^a-zA-Z0-9]/g, '_');
  
  const options = {
    margins: {
      marginType: 'default'
    },
    printBackground: true,
    preferCSSPageSize: true
  };

  targetWebContents.printToPDF(options)
    .then(data => {
      const tempPdfPath = path.join(app.getPath('userData'), `print-preview-${safeTitle}-${Date.now()}.pdf`);
      fs.writeFileSync(tempPdfPath, data);
      
      if (mainWindow) {
        mainWindow.webContents.send('tab-created-external', { url: `file://${tempPdfPath}` });
      }
    })
    .catch(error => {
      console.error('Failed to generate PDF for print preview:', error);
    });
}

let customContextMenuWin = null;
const sarvamContextMenuCache = new Map();

function getLocalHeuristicFeatures(params) {
  const features = ['copy', 'print', 'qr_code', 'translate', 'view_source', 'inspect'];
  if (params.linkURL) {
    features.push('link_options');
  }
  if (params.mediaType === 'image' || params.srcURL) {
    features.push('save_image');
  }
  return features;
}

function getSarvamContextMenuFeatures(params, webContents) {
  const url = webContents.getURL() || '';
  let domain = 'vayu.in';
  try { domain = new URL(url).hostname; } catch(e) {}

  const cacheKey = `${domain}_${params.mediaType}_${!!params.selectionText}_${!!params.linkURL}_${params.isEditable}`;
  if (sarvamContextMenuCache.has(cacheKey)) {
    return Promise.resolve(sarvamContextMenuCache.get(cacheKey));
  }

  // Fast local default fallback - instantly resolve to eliminate lag
  const fastFeatures = getLocalHeuristicFeatures(params);

  // Trigger API update in the background for future clicks (non-blocking)
  fetch('https://api.sarvam.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-subscription-key': SARVAM_API_KEY,
      'Authorization': `Bearer ${SARVAM_API_KEY}`
    },
    body: JSON.stringify({
      model: 'sarvam-105b',
      messages: [
        {
          role: 'system',
          content: 'You are the right-click context menu AI filter for Vayu Browser. Based on page URL, media type, selection text, link, and editable state, select which context menu options should be shown to give the cleanest user experience. Choose strictly a subset from: ["copy", "link_options", "save_image", "print", "qr_code", "translate", "view_source", "inspect"]. Respond ONLY with valid JSON array of strings.'
        },
        {
          role: 'user',
          content: JSON.stringify({
            domain,
            url,
            mediaType: params.mediaType,
            hasSelection: !!params.selectionText,
            selectionSnippet: params.selectionText ? params.selectionText.substring(0, 100) : '',
            hasLink: !!params.linkURL,
            isEditable: params.isEditable
          })
        }
      ],
      temperature: 0.1
    })
  }).then(res => res.json()).then(data => {
    if (data && data.choices && data.choices[0] && data.choices[0].message) {
      const text = data.choices[0].message.content.trim();
      const match = text.match(/\[.*?\]/s);
      if (match) {
        const array = JSON.parse(match[0]);
        if (Array.isArray(array) && array.length > 0) {
          sarvamContextMenuCache.set(cacheKey, array);
        }
      }
    }
  }).catch(() => {});

  return Promise.resolve(fastFeatures);
}

function setupContextMenu(webContents) {
  webContents.on('context-menu', (event, params) => {
    event.preventDefault();

    if (customContextMenuWin && !customContextMenuWin.isDestroyed()) {
      try { customContextMenuWin.close(); } catch(e) {}
    }

    const { screen } = require('electron');
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const workArea = display.workArea;

    const winW = 240;
    const winH = 340;

    let x = cursor.x;
    let y = cursor.y;

    if (x + winW > workArea.x + workArea.width) {
      x = cursor.x - winW;
      if (x < workArea.x) {
        x = workArea.x;
      }
    }

    if (y + winH > workArea.y + workArea.height) {
      y = cursor.y - winH;
      if (y < workArea.y) {
        y = workArea.y;
      }
    }

    customContextMenuWin = new BrowserWindow({
      width: winW,
      height: winH,
      x: x,
      y: y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      parent: mainWindow,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    let domain = 'vayu.in';
    try { domain = new URL(webContents.getURL()).hostname; } catch(e) {}

    const cacheKey = `${domain}_${params.mediaType}_${!!params.selectionText}_${!!params.linkURL}_${params.isEditable}`;
    const cachedAllowed = sarvamContextMenuCache.get(cacheKey) || null;

    customContextMenuWin.loadFile('context-menu.html', {
      query: {
        params: encodeURIComponent(JSON.stringify(params)),
        allowed: cachedAllowed ? encodeURIComponent(JSON.stringify(cachedAllowed)) : ''
      }
    });

    customContextMenuWin.on('blur', () => {
      if (customContextMenuWin && !customContextMenuWin.isDestroyed()) {
        customContextMenuWin.close();
      }
    });

    customContextMenuWin.on('closed', () => {
      customContextMenuWin = null;
    });

    // Asynchronously call Sarvam AI to filter & show items (or update menu from skeleton loader)
    getSarvamContextMenuFeatures(params, webContents).then(allowedFeatures => {
      if (customContextMenuWin && !customContextMenuWin.isDestroyed()) {
        customContextMenuWin.webContents.send('sarvam-contextmenu-resolved', allowedFeatures);
      }
    });
  });
}

ipcMain.on('context-menu-action', (event, data) => {
  if (customContextMenuWin && !customContextMenuWin.isDestroyed()) {
    customContextMenuWin.close();
  }

  const activeTab = tabs.get(activeTabId);
  const targetWebContents = (activeTab && activeTab.view && activeTab.view.webContents) ? activeTab.view.webContents : mainWindow.webContents;
  const { action, params } = data;

  switch (action) {
    case 'copy':
      if (params.selectionText) {
        const { clipboard } = require('electron');
        clipboard.writeText(params.selectionText);
      } else {
        targetWebContents.copy();
      }
      break;
    case 'cut':
      targetWebContents.cut();
      break;
    case 'paste':
      targetWebContents.paste();
      break;
    case 'select_all':
      targetWebContents.selectAll();
      break;
    case 'copy_link':
      if (params.linkURL) {
        const { clipboard } = require('electron');
        clipboard.writeText(params.linkURL);
      }
      break;
    case 'save_link':
      if (params.linkURL) targetWebContents.downloadURL(params.linkURL);
      break;
    case 'copy_image':
      targetWebContents.copyImageAt(params.x, params.y);
      break;
    case 'copy_image_addr':
      if (params.srcURL) {
        const { clipboard } = require('electron');
        clipboard.writeText(params.srcURL);
      }
      break;
    case 'save_image':
      if (params.srcURL) targetWebContents.downloadURL(params.srcURL);
      break;
    case 'back':
      if (targetWebContents.canGoBack()) targetWebContents.goBack();
      break;
    case 'forward':
      if (targetWebContents.canGoForward()) targetWebContents.goForward();
      break;
    case 'reload':
      targetWebContents.reload();
      break;
    case 'print':
      showPrintPreview(targetWebContents);
      break;
    case 'qr':
      const url = targetWebContents.getURL();
      if (qrWindow && !qrWindow.isDestroyed()) {
        qrWindow.focus();
        return;
      }
      qrWindow = new BrowserWindow({
        width: 360,
        height: 460,
        frame: false,
        transparent: true,
        resizable: false,
        minimizable: false,
        parent: mainWindow,
        modal: true,
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          nodeIntegration: false,
          contextIsolation: true
        }
      });
      qrWindow.loadFile(path.join(__dirname, 'qr.html'), { query: { url } });
      qrWindow.on('closed', () => { qrWindow = null; });
      break;
    case 'translate':
      const targetUrl = targetWebContents.getURL();
      targetWebContents.loadURL(`https://translate.google.com/translate?sl=auto&tl=en&u=${encodeURIComponent(targetUrl)}`);
      break;
    case 'view_source':
      const srcUrl = targetWebContents.getURL();
      if (mainWindow) {
        mainWindow.webContents.send('tab-created-external', { url: `view-source:${srcUrl}` });
      }
      break;
    case 'inspect':
      targetWebContents.inspectElement(params.x, params.y);
      break;
  }
});

function applyReaderMode(tab) {
  const webContents = tab.view.webContents;

  const readerScript = `
    (() => {
      try {
        // Prevent double injection
        if (document.getElementById('orbit-reader-overlay')) {
          console.log('[reader] Reader overlay already exists');
          return;
        }

        console.log('[reader] Initializing reader mode extraction...');

        // 1. Content extraction logic
        function extractArticle() {
          let title = '';
          const h1 = document.querySelector('h1');
          if (h1) {
            title = h1.innerText.trim();
          } else {
            title = document.title.trim();
          }
          
          let contentEl = null;
          if (window.location.hostname.includes('wikipedia.org')) {
            contentEl = document.querySelector('#mw-content-text > .mw-parser-output') || document.getElementById('mw-content-text') || document.querySelector('.mw-parser-output');
          } else {
            const selectors = [
              'article', 'main', '[role="main"]', '.post-content', 
              '.article-content', '.entry-content', '#content', '#main'
            ];
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el) { contentEl = el; break; }
            }
          }
          
          if (!contentEl) {
            let maxParagraphs = 0;
            document.querySelectorAll('div, section').forEach(el => {
              const pCount = el.querySelectorAll('p').length;
              if (pCount > maxParagraphs) {
                maxParagraphs = pCount;
                contentEl = el;
              }
            });
          }
          
          if (!contentEl) {
            contentEl = document.body;
          }
          
          console.log('[reader] Content element found:', contentEl.tagName, contentEl.id, contentEl.className);

          // Clone the content container to clean it
          const clone = contentEl.cloneNode(true);
          
          // Remove noise selectors
          const noiseSelectors = [
            'script', 'style', 'iframe', 'noscript', 'canvas', 'svg', 'nav', 'header', 'footer', 'aside',
            '.ads', '.ad-box', '.advertisement', '.sidebar', '.menu', '.nav', '#mw-navigation', '#mw-head', '#vector-toc', '.toc', '.mw-jump-link',
            '.reflist', '.printfooter', '.catlinks', '.mw-empty-elt', '.infobox', '.ambox', '.navbox', '.metadata', '.portal', '.mw-editsection',
            '.reference', '.reference-text', '.gallery', '.thumb', '.noprint', '.hatnote', '.sisterproject', '.stub', '.navbox-styles', '.mbox-small',
            'form', 'input', 'button', 'select', 'textarea'
          ];
          noiseSelectors.forEach(sel => {
            clone.querySelectorAll(sel).forEach(el => el.remove());
          });
          
          // Clean elements in place (recursively strip styles, classes, resolve images/links)
          function cleanTree(node) {
            if (node.nodeType === 1) { // Element Node
              node.removeAttribute('style');
              node.removeAttribute('id');
              
              const tagName = node.tagName.toUpperCase();
              
              if (tagName !== 'IMG') {
                node.removeAttribute('class');
              }
              
              if (tagName === 'IMG') {
                let src = node.src || node.getAttribute('data-src') || node.getAttribute('src');
                if (src) {
                  if (src.startsWith('//')) {
                    src = window.location.protocol + src;
                  } else if (src.startsWith('/')) {
                    src = window.location.origin + src;
                  }
                  node.setAttribute('src', src);
                }
                // Strip other junk attributes
                const attrs = Array.from(node.attributes);
                for (const attr of attrs) {
                  if (attr.name !== 'src' && attr.name !== 'alt') {
                    node.removeAttribute(attr.name);
                  }
                }
                node.classList.add('reader-image');
              } else if (tagName === 'A') {
                let href = node.getAttribute('href');
                if (href) {
                  try {
                    node.setAttribute('href', new URL(href, window.location.href).href);
                  } catch(e) {}
                }
                node.setAttribute('target', '_blank');
              }
              
              for (let i = 0; i < node.childNodes.length; i++) {
                cleanTree(node.childNodes[i]);
              }
            }
          }
          
          cleanTree(clone);
          
          let contentHtml = clone.innerHTML.trim();
          if (contentHtml.length < 100) {
            console.log('[reader] Parsed content too short, falling back to innerText paragraphs');
            contentHtml = document.body.innerText.split('\\n\\n').map(p => \`<p>\${p.trim()}</p>\`).join('');
          }
          
          const text = clone.textContent || '';
          const wordCount = text.split(/\\s+/).filter(w => w.length > 0).length;
          const readingTime = Math.max(1, Math.round(wordCount / 200));
          
          console.log('[reader] Article successfully extracted. Word count:', wordCount, 'Reading time:', readingTime, 'HTML length:', contentHtml.length, 'Snippet:', contentHtml.substring(0, 200));

          return {
            title,
            content: contentHtml,
            readingTime
          };
        }
        
        const article = extractArticle();
        
        // Create reader overlay element
        const overlay = document.createElement('div');
        overlay.id = 'orbit-reader-overlay';
        
        const shadow = overlay.attachShadow({ mode: 'open' });
        
        // Load user preferences from sandboxed localStorage
        let theme = localStorage.getItem('orbit-reader-theme') || 'sepia';
        let fontSize = parseInt(localStorage.getItem('orbit-reader-font-size')) || 18;
        let fontFamily = localStorage.getItem('orbit-reader-font-family') || 'serif';
        
        function applyPreferences() {
          overlay.style.setProperty('--font-size', fontSize + 'px');
          overlay.style.setProperty('--font-family', fontFamily === 'serif' ? 'Georgia, serif' : 'system-ui, sans-serif');
          
          if (theme === 'light') {
            overlay.style.setProperty('--bg-color', '#ffffff');
            overlay.style.setProperty('--text-color', '#1a1a1a');
            overlay.style.setProperty('--link-color', '#7c3aed');
            overlay.style.setProperty('--border-color', 'rgba(0,0,0,0.08)');
            overlay.style.setProperty('--toolbar-bg', 'rgba(255,255,255,0.85)');
            overlay.style.setProperty('--toolbar-btn-hover', 'rgba(0,0,0,0.05)');
          } else if (theme === 'sepia') {
            overlay.style.setProperty('--bg-color', '#f7f0e3');
            overlay.style.setProperty('--text-color', '#2c251b');
            overlay.style.setProperty('--link-color', '#b45309');
            overlay.style.setProperty('--border-color', 'rgba(0,0,0,0.06)');
            overlay.style.setProperty('--toolbar-bg', 'rgba(247,240,227,0.85)');
            overlay.style.setProperty('--toolbar-btn-hover', 'rgba(0,0,0,0.04)');
          } else if (theme === 'dark') {
            overlay.style.setProperty('--bg-color', '#121212');
            overlay.style.setProperty('--text-color', '#e0e0e0');
            overlay.style.setProperty('--link-color', '#a78bfa');
            overlay.style.setProperty('--border-color', 'rgba(255,255,255,0.1)');
            overlay.style.setProperty('--toolbar-bg', 'rgba(18,18,18,0.85)');
            overlay.style.setProperty('--toolbar-btn-hover', 'rgba(255,255,255,0.08)');
          }
          
          // Save to localStorage
          localStorage.setItem('orbit-reader-theme', theme);
          localStorage.setItem('orbit-reader-font-size', fontSize);
          localStorage.setItem('orbit-reader-font-family', fontFamily);
          
          // Update active UI classes in toolbar
          shadow.querySelectorAll('.theme-dot').forEach(el => {
            if (el.dataset.theme === theme) el.classList.add('active');
            else el.classList.remove('active');
          });
          
          shadow.querySelectorAll('.font-family-btn').forEach(el => {
            if (el.dataset.family === fontFamily) el.classList.add('active');
            else el.classList.remove('active');
          });
        }
        
        // Inject Styles & HTML into Shadow DOM
        const styles = document.createElement('style');
        styles.textContent = \`
          :host {
            display: block !important;
            width: 100% !important;
            height: 100% !important;
            box-sizing: border-box !important;
          }
          
          .reader-scroll-container {
            max-width: 680px;
            margin: 0 auto;
            padding: 80px 24px 120px 24px;
            animation: fadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            box-sizing: border-box !important;
          }
          
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(15px); }
            to { opacity: 1; transform: translateY(0); }
          }
          
          .header {
            margin-bottom: 40px;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 24px;
          }
          
          .title {
            font-size: 2.2em;
            font-weight: 700;
            line-height: 1.25;
            margin: 0 0 16px 0;
            letter-spacing: -0.5px;
            color: inherit;
          }
          
          .meta {
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 13px;
            color: #888888;
            display: flex;
            gap: 20px;
          }
          
          .content p {
            margin: 0 0 28px 0;
            word-wrap: break-word;
            color: inherit;
          }
          
          .content h1, .content h2, .content h3, .content h4 {
            font-family: system-ui, -apple-system, sans-serif;
            font-weight: 700;
            margin-top: 48px;
            margin-bottom: 16px;
            line-height: 1.3;
            color: inherit;
          }
          
          .content h1 { font-size: 1.8em; }
          .content h2 { font-size: 1.5em; border-bottom: 1px solid var(--border-color); padding-bottom: 8px; }
          .content h3 { font-size: 1.3em; }
          .content h4 { font-size: 1.1em; }
          
          .reader-image {
            max-width: 100%;
            height: auto;
            border-radius: 8px;
            margin: 36px auto;
            display: block;
            box-shadow: 0 10px 30px rgba(0,0,0,0.06);
          }
          
          .content ul, .content ol {
            margin: 0 0 28px 0;
            padding-left: 28px;
            color: inherit;
          }
          
          .content li {
            margin-bottom: 10px;
            color: inherit;
          }
          
          .content a {
            color: var(--link-color);
            text-decoration: none;
            border-bottom: 1px solid rgba(124, 58, 237, 0.2);
            transition: all 0.2s;
          }
          
          .content a:hover {
            opacity: 0.8;
            border-bottom-color: var(--link-color);
          }
          
          .content blockquote {
            margin: 36px 0;
            padding: 4px 0 4px 20px;
            border-left: 4px solid var(--link-color);
            font-style: italic;
            opacity: 0.85;
            color: inherit;
          }
          
          /* Floating toolbar styling */
          .toolbar {
            position: fixed;
            top: 24px;
            right: 24px;
            display: flex;
            align-items: center;
            gap: 8px;
            background: var(--toolbar-bg);
            border: 1px solid var(--border-color);
            padding: 6px 12px;
            border-radius: 30px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.08);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            z-index: 10000;
            font-family: system-ui, -apple-system, sans-serif;
            user-select: none;
            transition: opacity 0.3s ease;
            opacity: 1;
          }
          
          .toolbar-group {
            display: flex;
            align-items: center;
            gap: 4px;
            border-right: 1px solid var(--border-color);
            padding-right: 8px;
            margin-right: 4px;
          }
          
          .toolbar-group:last-child {
            border-right: none;
            padding-right: 0;
            margin-right: 0;
          }
          
          .btn {
            background: transparent;
            border: none;
            color: var(--text-color);
            cursor: pointer;
            padding: 6px 10px;
            font-size: 13px;
            font-weight: 500;
            border-radius: 15px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
          }
          
          .btn:hover {
            background: var(--toolbar-btn-hover);
          }
          
          .btn.active {
            background: var(--link-color) !important;
            color: #ffffff !important;
          }
          
          .btn-close {
            width: 28px;
            height: 28px;
            padding: 0;
            border-radius: 50%;
            font-weight: bold;
          }
          
          .theme-dot {
            width: 18px;
            height: 18px;
            border-radius: 50%;
            border: 2px solid transparent;
            cursor: pointer;
            transition: border-color 0.2s, transform 0.2s;
            box-sizing: border-box;
          }
          
          .theme-dot:hover {
            transform: scale(1.1);
          }
          
          .theme-dot.active {
            border-color: var(--link-color);
            transform: scale(1.05);
          }
        \`;
        
        const htmlContent = document.createElement('div');
        htmlContent.className = 'reader-scroll-container';
        htmlContent.innerHTML = \`
          <div class="header">
            <h1 class="title"></h1>
            <div class="meta">
              <span class="meta-time"></span>
              <span class="meta-domain"></span>
            </div>
          </div>
          <div class="content"></div>
        \`;
        
        // Populate extracted content safely
        htmlContent.querySelector('.title').textContent = article.title;
        htmlContent.querySelector('.meta-time').textContent = '📖 ' + article.readingTime + ' min read';
        htmlContent.querySelector('.meta-domain').textContent = '🌐 ' + window.location.hostname;
        htmlContent.querySelector('.content').innerHTML = article.content;
        
        const toolbar = document.createElement('div');
        toolbar.className = 'toolbar';
        toolbar.innerHTML = \`
          <!-- Font Family Group -->
          <div class="toolbar-group">
            <button class="btn font-family-btn" data-family="serif">Serif</button>
            <button class="btn font-family-btn" data-family="sans">Sans</button>
          </div>
          
          <!-- Font Size Group -->
          <div class="toolbar-group">
            <button class="btn font-size-btn-dec" title="Decrease Font Size">Aa-</button>
            <button class="btn font-size-btn-inc" title="Increase Font Size">Aa+</button>
          </div>
          
          <!-- Theme Group -->
          <div class="toolbar-group" style="display:flex; gap: 6px; align-items:center;">
            <div class="theme-dot theme-dot-light" style="background:#ffffff; border:1px solid rgba(0,0,0,0.15);" data-theme="light" title="Light Theme"></div>
            <div class="theme-dot theme-dot-sepia" style="background:#f7f0e3; border:1px solid rgba(0,0,0,0.1);" data-theme="sepia" title="Sepia Theme"></div>
            <div class="theme-dot theme-dot-dark" style="background:#121212; border:1px solid rgba(255,255,255,0.15);" data-theme="dark" title="Dark Theme"></div>
          </div>
          
          <!-- Close Group -->
          <div class="toolbar-group">
            <button class="btn btn-close" title="Exit Reader Mode">
              <svg viewBox="0 0 10 10" width="10" height="10" stroke="currentColor" stroke-width="1.5" fill="none">
                <path d="M1,1 L9,9 M9,1 L1,9" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        \`;
        
        shadow.appendChild(styles);
        shadow.appendChild(htmlContent);
        shadow.appendChild(toolbar);
        
        // Inject global stylesheet to hide original page body contents and style the overlay root securely
        const pageStyle = document.createElement('style');
        pageStyle.id = 'orbit-reader-global-style';
        pageStyle.textContent = \`
          html.orbit-reader-active, body.orbit-reader-active {
            overflow: hidden !important;
            margin: 0 !important;
            padding: 0 !important;
            height: 100% !important;
            width: 100% !important;
          }
          body.orbit-reader-active > :not(#orbit-reader-overlay) {
            display: none !important;
          }
          #orbit-reader-overlay {
            all: initial !important;
            display: block !important;
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            z-index: 2147483647 !important;
            background-color: var(--bg-color) !important;
            color: var(--text-color) !important;
            font-family: var(--font-family) !important;
            font-size: var(--font-size) !important;
            line-height: 1.85 !important;
            overflow-y: auto !important;
            box-sizing: border-box !important;
            transition: background-color 0.25s ease, color 0.25s ease !important;
          }
        \`;
        document.head.appendChild(pageStyle);
        
        // Append overlay to document root
        document.body.appendChild(overlay);
        
        // Apply active classes
        document.body.classList.add('orbit-reader-active');
        document.documentElement.classList.add('orbit-reader-active');
        
        // Apply Preferences
        applyPreferences();
        
        // Setup Interaction Event Listeners inside Shadow DOM
        toolbar.querySelectorAll('.font-family-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            fontFamily = btn.dataset.family;
            applyPreferences();
          });
        });
        
        toolbar.querySelector('.font-size-btn-dec').addEventListener('click', () => {
          fontSize = Math.max(12, fontSize - 1);
          applyPreferences();
        });
        
        toolbar.querySelector('.font-size-btn-inc').addEventListener('click', () => {
          fontSize = Math.min(30, fontSize + 1);
          applyPreferences();
        });
        
        toolbar.querySelectorAll('.theme-dot').forEach(dot => {
          dot.addEventListener('click', () => {
            theme = dot.dataset.theme;
            applyPreferences();
          });
        });
        
        toolbar.querySelector('.btn-close').addEventListener('click', () => {
          console.log('orbit-action:exit-reader');
          
          // Local removal in case console log takes time
          document.body.classList.remove('orbit-reader-active');
          document.documentElement.classList.remove('orbit-reader-active');
          overlay.remove();
          pageStyle.remove();
        });
        
        // Smooth fade out toolbar on scrolling/inactivity
        let toolbarHideTimeout;
        function showToolbar() {
          toolbar.style.opacity = '1';
          clearTimeout(toolbarHideTimeout);
          toolbarHideTimeout = setTimeout(() => {
            if (!toolbar.matches(':hover')) {
              toolbar.style.opacity = '0.15';
            }
          }, 2000);
        }
        
        window.addEventListener('mousemove', showToolbar);
        overlay.addEventListener('scroll', showToolbar, true);
        showToolbar();
      } catch (err) {
        console.error('[reader] Error during Reader Mode initialization:', err.stack || err);
      }
    })();
  `;

  webContents.executeJavaScript(readerScript).catch(err => {
    console.error('Reader Mode injection failed', err);
  });
}

function removeReaderMode(tab) {
  const webContents = tab.view.webContents;

  const revertScript = `
    (() => {
      document.body.classList.remove('orbit-reader-active');
      document.documentElement.classList.remove('orbit-reader-active');
      const overlay = document.getElementById('orbit-reader-overlay');
      if (overlay) overlay.remove();
      const pageStyle = document.getElementById('orbit-reader-global-style');
      if (pageStyle) pageStyle.remove();
    })();
  `;

  webContents.executeJavaScript(revertScript).catch(err => {
    webContents.reload();
  });
}

let isImmersiveMode = false;
let isImmersiveSearchOpen = false;

function toggleImmersiveMode(tabId, forceState) {
  try {
    fs.appendFileSync('c:\\Users\\pouru\\OneDrive\\Desktop\\Project\\browser\\orbit-error.log', `toggleImmersiveMode called for tabId: ${tabId}, forceState: ${forceState}. isImmersiveMode state is changing from ${isImmersiveMode} to ${forceState !== undefined ? forceState : !isImmersiveMode}\n`);
  } catch (e) {}

  const tab = tabs.get(tabId || activeTabId);
  if (!tab) return;
  
  const oldState = isImmersiveMode;
  isImmersiveMode = forceState !== undefined ? forceState : !isImmersiveMode;
  
  if (oldState !== isImmersiveMode) {
    // Notify renderer to hide/show chrome
    if (mainWindow) {
      mainWindow.webContents.send('immersive-mode-updated', {
        tabId: tab.id,
        isImmersiveMode
      });
    }
    
    // Resize the tab view
    resizeActiveTab();
    
    // If entered immersive mode, inject the UI immediately. If exited, remove it.
    if (isImmersiveMode) {
      injectImmersiveUi(tab);
    } else {
      isImmersiveSearchOpen = false;
      for (const t of tabs.values()) {
        removeImmersiveUi(t);
      }
    }
  }
}

function injectImmersiveUi(tab) {
  const webContents = tab.view.webContents;
  
  try {
    fs.appendFileSync('c:\\Users\\pouru\\OneDrive\\Desktop\\Project\\browser\\orbit-error.log', `injectImmersiveUi called for tab ${tab.id}, url: ${webContents.getURL()}\n`);
  } catch (e) {}

  const script = `
    (() => {
      if (document.getElementById('orbit-immersive-container')) return;
      
      const container = document.createElement('div');
      container.id = 'orbit-immersive-container';
      container.style.setProperty('display', 'block', 'important');
      container.style.setProperty('visibility', 'visible', 'important');
      container.style.setProperty('opacity', '1', 'important');
      container.style.setProperty('position', 'fixed', 'important');
      container.style.setProperty('top', '0', 'important');
      container.style.setProperty('left', '0', 'important');
      container.style.setProperty('width', '100%', 'important');
      container.style.setProperty('height', '100%', 'important');
      container.style.setProperty('z-index', '2147483647', 'important');
      container.style.setProperty('pointer-events', 'none', 'important');
      
      const shadow = container.attachShadow({ mode: 'open' });
      
      const style = document.createElement('style');
      style.appendChild(document.createTextNode(
        '#float-btn { position: fixed; bottom: 24px; right: 24px; width: 48px; height: 48px; border-radius: 50%; background: rgba(255, 255, 255, 0.75); border: 1px solid rgba(0, 0, 0, 0.08); box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.5) inset; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; color: #7c3aed; cursor: pointer; transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); z-index: 2147483647; animation: float-pulse 3s infinite ease-in-out; pointer-events: auto !important; } ' +
        '#float-btn:hover { transform: scale(1.1); background: rgba(255, 255, 255, 0.9); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.8) inset; color: #6d28d9; } ' +
        '#float-btn:active { transform: scale(0.95); } ' +
        '@keyframes float-pulse { 0% { box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1), 0 0 0 0 rgba(124, 58, 237, 0.2); } 50% { box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1), 0 0 0 8px rgba(124, 58, 237, 0); } 100% { box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1), 0 0 0 0 rgba(124, 58, 237, 0); } } ' +
        '#overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(243, 244, 246, 0.7); backdrop-filter: blur(25px); -webkit-backdrop-filter: blur(25px); z-index: 2147483646; display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0; pointer-events: none !important; transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); } ' +
        '#overlay.show { opacity: 1; pointer-events: auto !important; } ' +
        '#search-box { width: 90%; max-width: 600px; background: #ffffff; border: 1px solid rgba(0, 0, 0, 0.08); border-radius: 20px; padding: 6px 18px; display: flex; align-items: center; gap: 12px; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(255, 255, 255, 0.5) inset; transform: translateY(20px) scale(0.98); transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1); } ' +
        '#overlay.show #search-box { transform: translateY(0) scale(1); } ' +
        '#search-box svg { color: #7c3aed; flex-shrink: 0; } ' +
        '#search-input { flex-grow: 1; background: transparent; border: none; outline: none; color: #1f2937; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; height: 48px; width: 100%; } ' +
        '#search-input::placeholder { color: #9ca3af; } ' +
        '#actions-row { display: flex; align-items: center; gap: 12px; margin-top: 20px; opacity: 0; transform: translateY(10px); transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1) 0.1s; } ' +
        '#overlay.show #actions-row { opacity: 1; transform: translateY(0); } ' +
        '.action-btn { background: #ffffff; border: 1px solid rgba(0, 0, 0, 0.08); color: #4b5563; padding: 8px 16px; border-radius: 12px; font-size: 11px; font-weight: 600; font-family: inherit; cursor: pointer; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.02); transition: all 0.2s; } ' +
        '.action-btn:hover { background: #7c3aed; color: #ffffff; border-color: #7c3aed; transform: translateY(-1px); } ' +
        '.action-btn.danger:hover { background: #ef4444; border-color: #ef4444; } ' +
        '.tip-text { font-size: 10px; color: #9ca3af; margin-top: 12px; font-family: inherit; opacity: 0; transition: opacity 0.3s ease 0.2s; } ' +
        '#overlay.show .tip-text { opacity: 1; }'
      ));
      shadow.appendChild(style);
      
      const floatBtn = document.createElement('div');
      floatBtn.id = 'float-btn';
      floatBtn.title = 'Open Search (Immersive Mode)';
      
      function createSearchIcon() {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("width", "20");
        svg.setAttribute("height", "20");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "2.5");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", "11");
        circle.setAttribute("cy", "11");
        circle.setAttribute("r", "8");
        svg.appendChild(circle);
        
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", "21");
        line.setAttribute("y1", "21");
        line.setAttribute("x2", "16.65");
        line.setAttribute("y2", "16.65");
        svg.appendChild(line);
        
        return svg;
      }
      
      floatBtn.appendChild(createSearchIcon());
      shadow.appendChild(floatBtn);
      
      const overlay = document.createElement('div');
      overlay.id = 'overlay';
      
      const searchBox = document.createElement('div');
      searchBox.id = 'search-box';
      searchBox.appendChild(createSearchIcon());
      
      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.id = 'search-input';
      searchInput.placeholder = 'Type URL or search query...';
      searchInput.autocomplete = 'off';
      searchInput.spellcheck = false;
      searchBox.appendChild(searchInput);
      
      const actionsRow = document.createElement('div');
      actionsRow.id = 'actions-row';
      
      const btnCloseOverlay = document.createElement('button');
      btnCloseOverlay.id = 'btn-close-overlay';
      btnCloseOverlay.className = 'action-btn';
      btnCloseOverlay.textContent = 'Close Search';
      actionsRow.appendChild(btnCloseOverlay);
      
      const btnExitImmersive = document.createElement('button');
      btnExitImmersive.id = 'btn-exit-immersive';
      btnExitImmersive.className = 'action-btn danger';
      btnExitImmersive.textContent = 'Exit Immersive Mode';
      actionsRow.appendChild(btnExitImmersive);
      
      const tipText = document.createElement('div');
      tipText.className = 'tip-text';
      tipText.textContent = 'Press Enter to navigate • Esc to exit full screen';
      
      overlay.appendChild(searchBox);
      overlay.appendChild(actionsRow);
      overlay.appendChild(tipText);
      shadow.appendChild(overlay);
      
      const openSearch = () => {
        overlay.classList.add('show');
        console.log('orbit-action:search-open');
        setTimeout(() => searchInput.focus(), 50);
      };
      
      const closeSearch = () => {
        overlay.classList.remove('show');
        console.log('orbit-action:search-close');
        searchInput.value = '';
      };
      
      const exitImmersive = () => {
        console.log('orbit-action:exit-immersive');
      };
      
      floatBtn.addEventListener('click', () => {
        if (overlay.classList.contains('show')) {
          closeSearch();
        } else {
          openSearch();
        }
      });
      btnCloseOverlay.addEventListener('click', closeSearch);
      btnExitImmersive.addEventListener('click', exitImmersive);
      
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          let query = searchInput.value.trim();
          if (query) {
            let targetUrl = query;
            if (!query.includes('.') && !query.startsWith('http') && !query.startsWith('file://')) {
              targetUrl = 'https://www.google.com/search?q=' + encodeURIComponent(query);
            } else if (!query.startsWith('http://') && !query.startsWith('https://') && !query.startsWith('file://')) {
              targetUrl = 'https://' + query;
            }
            closeSearch();
            window.location.href = targetUrl;
          }
        } else if (e.key === 'Escape') {
          closeSearch();
          e.stopPropagation();
        }
      });
      
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (overlay.classList.contains('show')) {
            closeSearch();
          } else {
            exitImmersive();
          }
        }
      }, true);
      
      const appendToTarget = () => {
        try {
          const targetParent = document.fullscreenElement || document.documentElement;
          if (container.parentElement !== targetParent && targetParent) {
            targetParent.appendChild(container);
          }
        } catch (err) {}
      };
      
      appendToTarget();
      
      document.addEventListener('fullscreenchange', appendToTarget);
      
      const observer = new MutationObserver(() => {
        const targetParent = document.fullscreenElement || document.documentElement;
        if (container.parentElement !== targetParent && targetParent) {
          appendToTarget();
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    })();
  `;
  
  try {
    fs.writeFileSync('c:\\Users\\pouru\\OneDrive\\Desktop\\Project\\browser\\injected-script-debug.js', script);
  } catch (e) {}

  webContents.executeJavaScript(script).catch(err => {
    console.error('Immersive injection failed', err);
    try {
      fs.appendFileSync('c:\\Users\\pouru\\OneDrive\\Desktop\\Project\\browser\\orbit-error.log', `Immersive injection failed for URL: ${webContents.getURL()}. Error: ${err.toString()}\n`);
    } catch (e) {}
  });
}

function removeImmersiveUi(tab) {
  const webContents = tab.view.webContents;
  webContents.executeJavaScript(`
    const el = document.getElementById('orbit-immersive-container');
    if (el) el.remove();
  `).catch(err => {});
}

function registerDownloadHandler(sess, isIncognito) {
  downloadsManager.setupDownloadManager(sess, isIncognito, {
    onBrowserDownloadDetected: (filename, url) => {
      showLockPointerTooltip('Optimized for you', 'Vayu Browser is already optimized for you. Why switch?');
    },
    onDownloadStarted: (downloadState) => {
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('download-started', downloadState);
      }
    },
    onDownloadUpdated: (update) => {
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('download-updated', update);
      }
    },
    onDownloadDone: (downloadState) => {
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('download-done', downloadState);
      }
    }
  });
}

function createWindow() {
  // Load settings & init adblocker
  loadDb();
  applyInstallerPreferencesOnce();
  adblocker.init();
  
  // Setup default session adblocker
  setupAdBlocker(session.defaultSession);
  // Setup incognito session adblocker
  setupAdBlocker(session.fromPartition('incognito'));

  // Set standard Chrome user agent to prevent Google Meet blocks
  const chromeUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  session.defaultSession.setUserAgent(chromeUserAgent);
  session.fromPartition('incognito').setUserAgent(chromeUserAgent);

  // Cleanup old print preview files from userData directory
  try {
    const userDataPath = app.getPath('userData');
    const files = fs.readdirSync(userDataPath);
    for (const file of files) {
      if (file.startsWith('print-preview-') && file.endsWith('.pdf')) {
        fs.unlinkSync(path.join(userDataPath, file));
      }
    }
  } catch (e) {
    console.error('Failed to clean up old print previews:', e);
  }

  // Setup downloads
  registerDownloadHandler(session.defaultSession, false);
  registerDownloadHandler(session.fromPartition('incognito'), true);

  let lockPointerWin = null;
  let lastLockPointerTime = 0;

  function showLockPointerTooltip(title, desc) {
    const now = Date.now();
    if (now - lastLockPointerTime < 4000) return;
    lastLockPointerTime = now;

    if (lockPointerWin && !lockPointerWin.isDestroyed()) {
      try { lockPointerWin.close(); } catch(e) {}
    }

    if (locationNotificationWin && !locationNotificationWin.isDestroyed()) {
      return;
    }

    const winBounds = mainWindow.getBounds();
    const winW = 310;
    const winH = 85;
    
    const x = winBounds.x + 135;
    const y = winBounds.y + 78;

    lockPointerWin = new BrowserWindow({
      width: winW,
      height: winH,
      x: Math.round(x),
      y: Math.round(y),
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      parent: mainWindow,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    lockPointerWin.loadFile('lock-pointer-tooltip.html', {
      query: { title, desc }
    });

    lockPointerWin.on('blur', () => {
      if (lockPointerWin && !lockPointerWin.isDestroyed()) {
        lockPointerWin.close();
      }
    });

    setTimeout(() => {
      if (lockPointerWin && !lockPointerWin.isDestroyed()) {
        try { lockPointerWin.close(); } catch(e) {}
      }
    }, 6000);
  }

  let lastNoticeTime = 0;
  function triggerLocationPopup(url) {
    const now = Date.now();
    if ((!locationNotificationWin || locationNotificationWin.isDestroyed()) && (now - lastNoticeTime > 4000)) {
      lastNoticeTime = now;
      showLocationNotification(url);
    }
  }

  const handlePermissionRequest = (webContents, permission, callback, details) => {
    const url = webContents.getURL();
    try {
      const domain = new URL(url).hostname;
      let mapped = permission;
      if (permission === 'geolocation') mapped = 'location';
      else if (permission === 'audio') mapped = 'microphone';
      else if (permission === 'video') mapped = 'camera';

      if (db.permissions && db.permissions[domain] && db.permissions[domain][mapped] !== undefined) {
        if (db.permissions[domain][mapped] === false) {
          showLockPointerTooltip('Click Lock Icon Here', `Enable ${mapped} for ${domain}`);
        }
        callback(db.permissions[domain][mapped]);
        return;
      }
    } catch (e) {}
    callback(true);
  };

  const handlePermissionCheck = (webContents, permission, requestingOrigin, details) => {
    try {
      const domain = new URL(requestingOrigin).hostname;
      if (db.permissions && db.permissions[domain]) {
        const perms = db.permissions[domain];
        
        if (permission === 'geolocation') {
          if (perms.location === false) {
            showLockPointerTooltip('Click Lock Icon Here', `Enable location for ${domain}`);
            return false;
          }
        }
        
        if (permission === 'media') {
          const mediaType = details && details.mediaType;
          if (mediaType === 'video' && perms.camera === false) {
            showLockPointerTooltip('Click Lock Icon Here', `Enable camera for ${domain}`);
            return false;
          }
          if (mediaType === 'audio' && perms.microphone === false) {
            showLockPointerTooltip('Click Lock Icon Here', `Enable microphone for ${domain}`);
            return false;
          }
          if (perms.camera === false || perms.microphone === false) {
            showLockPointerTooltip('Click Lock Icon Here', `Enable permissions for ${domain}`);
            return false;
          }
        }
        
        let mapped = permission;
        if (permission === 'audio') mapped = 'microphone';
        else if (permission === 'video') mapped = 'camera';
        
        if (perms[mapped] === false) {
          showLockPointerTooltip('Click Lock Icon Here', `Enable ${mapped} for ${domain}`);
          return false;
        }
      }
    } catch (e) {}
    return true;
  };

  permissionsManager.setupPermissionHandlers(session.defaultSession, {
    onPermissionDeniedTooltip: showLockPointerTooltip
  });
  permissionsManager.setupPermissionHandlers(session.fromPartition('incognito'), {
    onPermissionDeniedTooltip: showLockPointerTooltip
  });

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false, // Frameless for custom header/tabs UI
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, 'vayu_app_logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#f3f4f6' // Match browser background light theme
  });

  mainWindow.loadFile('index.html');
  setupContextMenu(mainWindow.webContents);

  // Session Restore: if restoreSession is enabled and previous tabs exist, restore them
  mainWindow.webContents.once('did-finish-load', () => {
    const savedSession = sessionManager.getRestorableSession();
    if (savedSession && Array.isArray(savedSession.tabs) && savedSession.tabs.length > 0) {
      console.log(`[SessionRestore] Restoring ${savedSession.tabs.length} tabs from previous session.`);
      savedSession.tabs.forEach((t, idx) => {
        mainWindow.webContents.send('tab-created-external', {
          url: t.url,
          isIncognito: false
        });
      });
    }

    // Auto-update checker initialization
    initAutoUpdater(mainWindow);
  });

  mainWindow.on('focus', () => {
    if (activeTabId && tabs.has(activeTabId)) {
      const tab = tabs.get(activeTabId);
      if (tab && tab.view && tab.view.webContents) {
        tab.view.webContents.focus();
      }
    }
  });

  mainWindow.on('resize', () => {
    resizeActiveTab();
  });

  mainWindow.on('maximize', () => {
    resizeActiveTab();
    mainWindow.webContents.send('window-maximized-status', true);
  });

  mainWindow.on('unmaximize', () => {
    resizeActiveTab();
    mainWindow.webContents.send('window-maximized-status', false);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Cleanup tabs
    for (const tab of tabs.values()) {
      tab.view.webContents.destroy();
    }
    tabs.clear();
    webContentsToTabIdMap.clear();
  });
}

const fetchWithRetry = async (url, options, maxRetries = 3, initialDelay = 1000) => {
  let retries = 0;
  while (true) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return response;
      }
      
      // If we get a server-side error (5xx) or rate limit (429), retry
      if (response.status >= 500 || response.status === 429) {
        if (retries < maxRetries) {
          retries++;
          const delay = initialDelay * Math.pow(2, retries);
          console.warn(`[main] API request failed with status ${response.status}. Retrying in ${delay}ms (attempt ${retries}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      return response; // Return anyway if max retries reached or if it's a client error (e.g. 400, 403)
    } catch (err) {
      if (retries < maxRetries) {
        retries++;
        const delay = initialDelay * Math.pow(2, retries);
        console.warn(`[main] Network error: ${err.message}. Retrying in ${delay}ms (attempt ${retries}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
};

function showShieldPopup(rect) {
  if (shieldPopup && !shieldPopup.isDestroyed()) {
    shieldPopup.close();
    shieldPopup = null;
    return;
  }

  // Calculate screen position of shield icon
  const winBounds = mainWindow.getBounds();
  
  // Center it relative to shield icon, or align left edge
  const popupX = winBounds.x + rect.left - 10;
  const popupY = winBounds.y + rect.bottom + 5; 

  shieldPopup = new BrowserWindow({
    width: 320,
    height: 380,
    x: Math.round(popupX),
    y: Math.round(popupY),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    parent: mainWindow, // Make it a child window
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  shieldPopup.loadFile('shield-popup.html');

  shieldPopup.on('blur', () => {
    if (shieldPopup && !shieldPopup.isDestroyed()) {
      shieldPopup.close();
    }
  });

  shieldPopup.on('closed', () => {
    shieldPopup = null;
  });
}

const SARVAM_API_KEY = process.env.SARVAM_API_KEY || '';
const sarvamBrainCache = new Map();

function getLocalFastRecommendations(domain) {
  const d = domain.toLowerCase();
  if (d.includes('meet') || d.includes('zoom') || d.includes('teams') || d.includes('whereby')) return ['camera', 'microphone'];
  if (d.includes('map') || d.includes('earth') || d.includes('gps')) return ['location'];
  if (d.includes('github') || d.includes('drive') || d.includes('dropbox')) return ['downloads', 'clipboard'];
  if (d.includes('youtube') || d.includes('netflix') || d.includes('spotify')) return ['downloads'];
  return ['location', 'downloads', 'clipboard', 'camera', 'microphone'];
}

function fetchSarvamAiRecommendations(domain) {
  if (sarvamBrainCache.has(domain)) {
    return sarvamBrainCache.get(domain);
  }

  const fastFallback = getLocalFastRecommendations(domain);
  sarvamBrainCache.set(domain, fastFallback);

  // Non-blocking async fetch to Sarvam AI to refine recommendation
  fetch('https://api.sarvam.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-subscription-key': SARVAM_API_KEY,
      'Authorization': `Bearer ${SARVAM_API_KEY}`
    },
    body: JSON.stringify({
      model: 'sarvam-105b',
      messages: [
        {
          role: 'system',
          content: 'You are the intelligent feature filter brain of Vayu Browser. Given a domain, analyze and determine which permission features are necessary for the user to see. Choose ONLY from: ["location", "camera", "microphone", "clipboard", "downloads"]. Respond ONLY with valid JSON array of strings, e.g. ["camera", "microphone"].'
        },
        {
          role: 'user',
          content: `Domain: ${domain}`
        }
      ],
      temperature: 0.1
    })
  }).then(res => res.json()).then(data => {
    if (data && data.choices && data.choices[0] && data.choices[0].message) {
      const text = data.choices[0].message.content.trim();
      const match = text.match(/\[.*?\]/s);
      if (match) {
        const array = JSON.parse(match[0]);
        if (Array.isArray(array) && array.length > 0) {
          sarvamBrainCache.set(domain, array);
          if (locationNotificationWin && !locationNotificationWin.isDestroyed()) {
            locationNotificationWin.webContents.send('sarvam-update', array);
          }
        }
      }
    }
  }).catch(err => {});

  return fastFallback;
}

let locationNotificationWin = null;

function showLocationNotification(url) {
  if (locationNotificationWin && !locationNotificationWin.isDestroyed()) {
    try { locationNotificationWin.close(); } catch(e) {}
  }

  let domain = 'vayu.in';
  try {
    const urlObj = new URL(url);
    domain = urlObj.hostname;
  } catch(e) {}

  const winBounds = mainWindow.getBounds();
  const winW = 380;
  const winH = 560;
  
  // Position it to drop down from the shield/URL bar area
  const x = winBounds.x + 175;
  const y = winBounds.y + 48;

  locationNotificationWin = new BrowserWindow({
    width: winW,
    height: winH,
    x: Math.round(x),
    y: Math.round(y),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    parent: mainWindow, // Make it a child of main window
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const permissions = getPermissionsForDomain(domain);
  const relevantOptions = fetchSarvamAiRecommendations(domain);

  locationNotificationWin.loadFile('location-notification.html', {
    query: {
      domain,
      location: permissions.location === true ? 'true' : 'false',
      downloads: permissions.downloads === true ? 'true' : 'false',
      clipboard: permissions.clipboard === true ? 'true' : 'false',
      camera: permissions.camera === true ? 'true' : 'false',
      microphone: permissions.microphone === true ? 'true' : 'false',
      relevant: JSON.stringify(relevantOptions)
    }
  });

  locationNotificationWin.on('blur', () => {
    if (locationNotificationWin && !locationNotificationWin.isDestroyed()) {
      locationNotificationWin.close();
    }
  });

  locationNotificationWin.on('closed', () => {
    locationNotificationWin = null;
  });
}

let feedbackPopup = null;

function showFeedbackPopup(rect) {
  if (feedbackPopup && !feedbackPopup.isDestroyed()) {
    try { feedbackPopup.close(); } catch(e) {}
    feedbackPopup = null;
    return;
  }

  const winBounds = mainWindow.getBounds();
  
  // Position it right below the feedback profile button on the top right
  const popupX = winBounds.x + rect.left - 290;
  const popupY = winBounds.y + rect.bottom + 5; 

  feedbackPopup = new BrowserWindow({
    width: 320,
    height: 350,
    x: Math.round(popupX),
    y: Math.round(popupY),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    parent: mainWindow,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  feedbackPopup.loadFile('feedback-popup.html');

  feedbackPopup.on('blur', () => {
    if (feedbackPopup && !feedbackPopup.isDestroyed()) {
      feedbackPopup.close();
    }
  });

  feedbackPopup.on('closed', () => {
    feedbackPopup = null;
  });
}

function getTargetHeaderHeight() {
  if (isImmersiveMode) {
    return 0;
  } else if (isChromeCollapsed && !isSidebarOpen) {
    return isChromeHovered ? (db.bookmarks && db.bookmarks.length > 0 ? 120 : 90) : 5;
  } else {
    return db.bookmarks && db.bookmarks.length > 0 ? 120 : 90;
  }
}

function resizeActiveTab() {
  if (!mainWindow || !activeTabId || !tabs.has(activeTabId)) return;
  const tab = tabs.get(activeTabId);
  const bounds = mainWindow.getContentBounds();
  
  const headerHeight = getTargetHeaderHeight();
  const sidebarWidth = isImmersiveMode ? 0 : (isSidebarOpen ? 320 : 0);
  
  if (animationInterval) {
    clearInterval(animationInterval);
    animationInterval = null;
  }
  currentY = headerHeight;
  
  tab.view.setBounds({
    x: 0,
    y: headerHeight,
    width: Math.max(0, bounds.width - sidebarWidth),
    height: Math.max(0, bounds.height - headerHeight)
  });
}

function animateActiveTabY(target) {
  if (animationInterval) {
    clearInterval(animationInterval);
    animationInterval = null;
  }
  
  if (!mainWindow || !activeTabId || !tabs.has(activeTabId)) {
    currentY = target;
    return;
  }
  
  const tab = tabs.get(activeTabId);
  const bounds = mainWindow.getContentBounds();
  const sidebarWidth = isImmersiveMode ? 0 : (isSidebarOpen ? 320 : 0);
  const width = Math.max(0, bounds.width - sidebarWidth);
  const windowHeight = bounds.height;
  
  const duration = 250; // ms
  const frameRate = 1000 / 60; // 60 fps
  const steps = duration / frameRate;
  let step = 0;
  const startY = currentY;
  const diffY = target - startY;
  
  if (Math.abs(diffY) < 1) {
    currentY = target;
    tab.view.setBounds({
      x: 0,
      y: Math.round(currentY),
      width: width,
      height: Math.max(0, windowHeight - Math.round(currentY))
    });
    return;
  }
  
  animationInterval = setInterval(() => {
    step++;
    const progress = step / steps;
    // Cubic ease out curve
    const ease = 1 - Math.pow(1 - progress, 3);
    
    currentY = startY + diffY * ease;
    
    if (step >= steps) {
      currentY = target;
      clearInterval(animationInterval);
      animationInterval = null;
    }
    
    if (mainWindow && activeTabId && tabs.has(activeTabId)) {
      const activeTab = tabs.get(activeTabId);
      const currentBounds = mainWindow.getContentBounds();
      const currentSidebarWidth = isImmersiveMode ? 0 : (isSidebarOpen ? 320 : 0);
      activeTab.view.setBounds({
        x: 0,
        y: Math.round(currentY),
        width: Math.max(0, currentBounds.width - currentSidebarWidth),
        height: Math.max(0, currentBounds.height - Math.round(currentY))
      });
    }
  }, frameRate);
}

// Create new tab WebContentsView
function createTab(tabId, url, isIncognito = false) {
  const sess = isIncognito ? session.fromPartition('incognito') : session.defaultSession;
  
  const view = new WebContentsView({
    webPreferences: {
      session: sess,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload-tab.js')
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
    adBlockEnabled: db.settings.adBlockEnabled
  };

  tabs.set(tabId, tab);
  webContentsToTabIdMap.set(view.webContents.id, tabId);
  setupContextMenu(view.webContents);

  // Navigation guards: prevent untrusted navigation to file: or orbit: schemes from web content
  view.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      const parsed = new URL(navigationUrl);
      if (parsed.protocol === 'file:' || (parsed.protocol === 'orbit:' && parsed.hostname !== 'newtab' && !navigationUrl.includes('newtab.html'))) {
        event.preventDefault();
        return;
      }
    } catch (e) {
      event.preventDefault();
      return;
    }
  });

  // Set window open handler to prevent popups and redirect target="_blank" links to new tabs safely
  view.webContents.setWindowOpenHandler((details) => {
    try {
      const parsed = new URL(details.url);
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        return { action: 'deny' };
      }
    } catch (e) {
      return { action: 'deny' };
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tab-created-external', { url: details.url, isIncognito });
    }
    return { action: 'deny' };
  });

  // Secure console-message bridge for exiting immersive/reader mode from the web page sandbox
  view.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (message === 'orbit-action:exit-immersive') {
      toggleImmersiveMode(tabId, false);
    } else if (message === 'orbit-action:search-open') {
      isImmersiveSearchOpen = true;
    } else if (message === 'orbit-action:search-close') {
      isImmersiveSearchOpen = false;
    } else if (message === 'orbit-action:exit-reader') {
      if (tab.readerModeEnabled) {
        tab.readerModeEnabled = false;
        removeReaderMode(tab);
        if (mainWindow) {
          mainWindow.webContents.send('reader-mode-updated', {
            tabId: tab.id,
            readerModeEnabled: false
          });
        }
      }
    } else if (!isIncognito) {
      try {
        fs.appendFileSync('c:\\Users\\pouru\\OneDrive\\Desktop\\Project\\browser\\orbit-error.log', `[console tab-${tabId}] level: ${level}, message: ${message} (line: ${line}, source: ${sourceId})\n`);
      } catch (e) {}
    }
  });

  // Intercept key events globally within the web view (Escape for immersive/search exit, Ctrl+U for view-source)
  view.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      if (input.key === 'Escape') {
        if (isImmersiveMode) {
          if (isImmersiveSearchOpen) {
            // Close search overlay via JS execution safely
            view.webContents.executeJavaScript(`
              const el = document.getElementById('orbit-immersive-container');
              if (el && el.shadowRoot) {
                const overlay = el.shadowRoot.getElementById('overlay');
                const sInput = el.shadowRoot.getElementById('search-input');
                if (overlay && overlay.classList.contains('show')) {
                  overlay.classList.remove('show');
                  sInput.value = '';
                  console.log('orbit-action:search-close');
                }
              }
            `).catch(() => {});
            event.preventDefault();
          } else {
            toggleImmersiveMode(tabId, false);
            event.preventDefault();
          }
        }
      } else if ((input.control || input.meta) && input.key.toLowerCase() === 'u') {
        const url = view.webContents.getURL();
        if (mainWindow) {
          mainWindow.webContents.send('tab-created-external', { url: `view-source:${url}` });
        }
        event.preventDefault();
      } else if ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 't') {
        if (recentlyClosedTabs.length > 0) {
          const lastClosed = recentlyClosedTabs.pop();
          if (mainWindow) {
            mainWindow.webContents.send('tab-created-external', { url: lastClosed.url, isIncognito: false });
          }
        }
        event.preventDefault();
      } else if ((input.control || input.meta) && input.key.toLowerCase() === 'r') {
        view.webContents.reload();
        event.preventDefault();
      } else if ((input.control || input.meta) && input.key.toLowerCase() === 'p') {
        showPrintPreview(view.webContents);
        event.preventDefault();
      } else if (input.alt && (input.key === 'ArrowLeft' || input.key === 'Left')) {
        if (view.webContents.canGoBack()) {
          view.webContents.goBack();
        }
        event.preventDefault();
      } else if (input.alt && (input.key === 'ArrowRight' || input.key === 'Right')) {
        if (view.webContents.canGoForward()) {
          view.webContents.goForward();
        }
        event.preventDefault();
      }
    }
  });

  view.webContents.on('did-start-loading', () => {
    tab.isLoading = true;
    tab.blockedCount = 0;
    tab.blockedTrackers = [];
    tab.readerCssKeys = []; // Reset styling keys since page reloads
    isImmersiveSearchOpen = false; // Reset search overlay state on new page load
    if (mainWindow) {
      mainWindow.webContents.send('tab-updated', {
        id: tabId,
        url: view.webContents.getURL(),
        title: tab.title,
        isLoading: true,
        canGoBack: view.webContents.canGoBack(),
        canGoForward: view.webContents.canGoForward(),
        blockedCount: tab.blockedCount,
        adBlockEnabled: tab.adBlockEnabled
      });
      mainWindow.webContents.send('tab-trackers-updated', {
        tabId: tabId,
        blockedCount: 0,
        blockedTrackers: []
      });
    }
  });

  view.webContents.on('did-stop-loading', () => {
    tab.isLoading = false;
    const currentUrl = view.webContents.getURL();
    
    // Normalize new tab page display
    let displayUrl = currentUrl;
    if (currentUrl.includes('newtab.html') && !currentUrl.startsWith('view-source:')) {
      displayUrl = 'orbit://newtab';
      tab.title = 'New Tab';
    } else if (currentUrl.includes('error.html')) {
      try {
        const urlObj = new URL(currentUrl);
        displayUrl = urlObj.searchParams.get('url') || currentUrl;
      } catch (e) {}
      tab.title = 'Connection Error';
    } else if (currentUrl.startsWith('view-source:')) {
      const siteName = getSiteNameForViewSource(currentUrl);
      tab.title = `Page source - ${siteName}`;
    } else if (isPrintPreviewUrl(currentUrl)) {
      tab.title = getTitleForPrintPreview(currentUrl);
    } else {
      tab.title = view.webContents.getTitle() || currentUrl;
    }

    tab.url = displayUrl;

    if (mainWindow) {
      mainWindow.webContents.send('tab-updated', {
        id: tabId,
        url: displayUrl,
        title: tab.title,
        isLoading: false,
        canGoBack: view.webContents.canGoBack(),
        canGoForward: view.webContents.canGoForward(),
        blockedCount: tab.blockedCount,
        adBlockEnabled: tab.adBlockEnabled
      });
    }
  });

  const handlePageLoadOrNavigation = () => {
    try {
      fs.appendFileSync('c:\\Users\\pouru\\OneDrive\\Desktop\\Project\\browser\\orbit-error.log', `did-finish-load/did-navigate-in-page: url=${view.webContents.getURL()}, isImmersiveMode=${isImmersiveMode}\n`);
    } catch (e) {}

    // Inject Vayu Lock Icon replacement for website permission dialogs (e.g. Google Meet)
    const lockIconInjectScript = `
      (() => {
        function replaceTuneWithVayuLock() {
          const dialogs = document.querySelectorAll('[role="dialog"], div');
          dialogs.forEach(d => {
            if (d.textContent && (d.textContent.includes('blocked from using') || d.textContent.includes('page info icon'))) {
              const svgs = d.querySelectorAll('svg');
              svgs.forEach(svg => {
                if (!svg.getAttribute('data-vayu-lock')) {
                  svg.setAttribute('data-vayu-lock', 'true');
                  svg.outerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#2d6a4f" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin:0 4px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
                }
              });
            }
          });
        }
        try {
          replaceTuneWithVayuLock();
          const obs = new MutationObserver(() => replaceTuneWithVayuLock());
          if (document.body) obs.observe(document.body, { childList: true, subtree: true });
        } catch(e) {}
      })();
    `;
    view.webContents.executeJavaScript(lockIconInjectScript).catch(() => {});
    
    // Inject script to hide Google Speed Test widget
    const currentUrl = view.webContents.getURL();
    if (currentUrl.includes('google.com/search') || currentUrl.includes('google.co.in/search') || currentUrl.includes('bing.com/search') || currentUrl.includes('search.yahoo.com/search') || currentUrl.includes('qmamu.com')) {
      const hideCode = `
        (() => {
          const hideGoogleWidgets = () => {
            // Hide Google Speed Test
            const cards = document.querySelectorAll('g-card, div.g, div.obg-card, .obg-card');
            for (const card of cards) {
              if (card.textContent.includes('Internet speed test') || card.textContent.includes('RUN SPEED TEST')) {
                card.style.setProperty('display', 'none', 'important');
              }
            }
          };
          hideGoogleWidgets();
          const observer = new MutationObserver(hideGoogleWidgets);
          observer.observe(document.body, { childList: true, subtree: true });
        })();
      `;
      view.webContents.executeJavaScript(hideCode).catch(err => console.error('Failed to inject Google widgets hiding script:', err));

      // Shift Qmamu homepage search elements to the left
      if (currentUrl.includes('qmamu.com') && !currentUrl.includes('qmamu.com/search')) {
        const leftAlignCode = `
          (() => {
            if (document.getElementById('vayu-left-align-homepage')) return;
            const style = document.createElement('style');
            style.id = 'vayu-left-align-homepage';
            style.textContent = \`
              .sc-b2a5tv-0, [class*="sc-b2a5tv-0"] {
                align-items: flex-start !important;
                padding-left: 8% !important;
              }
              .sc-b2a5tv-4, [class*="sc-b2a5tv-4"] {
                margin: 50px 0 !important;
              }
              .sc-b2a5tv-5, [class*="sc-b2a5tv-5"] {
                margin: 0 !important;
              }
            \`;
            document.head.appendChild(style);
          })();
        `;
        view.webContents.executeJavaScript(leftAlignCode).catch(() => {});
      }

      // Inject search widgets sidebar on Qmamu search page
      if (currentUrl.includes('qmamu.com/search')) {
        const sidebarCode = `
          (() => {
            let lastQuery = '';
            const injectSidebar = async () => {
              const homeStyle = document.getElementById('vayu-left-align-homepage');
              if (homeStyle) homeStyle.remove();

              const url = new URL(window.location.href);
              const q = url.searchParams.get('q') || url.searchParams.get('p') || '';
              const cleanQ = q.trim();

              if (!window.location.href.includes('qmamu.com/search') || !cleanQ) {
                const existing = document.getElementById('vayu-search-sidebar');
                if (existing) existing.remove();
                const existingResultsStyle = document.getElementById('vayu-left-align-results');
                if (existingResultsStyle) existingResultsStyle.remove();
                lastQuery = '';
                return;
              }
              
              if (!document.getElementById('vayu-left-align-results')) {
                const resultsStyle = document.createElement('style');
                resultsStyle.id = 'vayu-left-align-results';
                resultsStyle.textContent = \`
                  .sc-7aqnu-1, [class*="sc-7aqnu-"] {
                    margin-left: 80px !important;
                    margin-right: auto !important;
                  }
                  div:has(> .sc-7aqnu-1), div:has(> [class*="sc-7aqnu-"]) {
                    justify-content: flex-start !important;
                  }
                  html, body {
                    overflow-x: hidden !important;
                  }
                \`;
                document.head.appendChild(resultsStyle);
              }

              let sidebar = document.getElementById('vayu-search-sidebar');
              let shadow;
              if (!sidebar) {
                const resultsCol = document.querySelector('.sc-7aqnu-1') || document.querySelector('div[class*="sc-7aqnu-"]') || document.getElementById('search') || document.querySelector('.results');
                if (!resultsCol) return;

                sidebar = document.createElement('div');
                sidebar.id = 'vayu-search-sidebar';
                sidebar.style.cssText = 'position: absolute !important; width: 360px !important; display: flex !important; flex-direction: column !important; gap: 20px !important; box-sizing: border-box !important;';
                
                const updatePosition = () => {
                  const currentResultsCol = document.querySelector('.sc-7aqnu-1') || document.querySelector('div[class*="sc-7aqnu-"]') || document.getElementById('search') || document.querySelector('.results');
                  if (!currentResultsCol) return;
                  const rect = currentResultsCol.getBoundingClientRect();
                  const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
                  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                  sidebar.style.left = (rect.left + rect.width + 95 + scrollLeft) + 'px';
                  sidebar.style.top = (rect.top + 9 + scrollTop) + 'px';
                };
                
                document.body.appendChild(sidebar);
                updatePosition();
                
                window.addEventListener('resize', updatePosition);
                window.addEventListener('scroll', updatePosition);
                
                shadow = sidebar.attachShadow({ mode: 'open' });
              } else {
                shadow = sidebar.shadowRoot;
              }

              if (lastQuery !== cleanQ) {
                lastQuery = cleanQ;
                shadow.innerHTML = '';

                const style = document.createElement('style');
                style.textContent = \`
                  .knowledge-panel {
                    background: linear-gradient(135deg, rgba(255, 255, 255, 0.70) 0%, rgba(255, 255, 255, 0.60) 100%), url(${vayuWidgetBase64}) no-repeat center / cover !important;
                    border: none !important;
                    border-radius: 16px !important;
                    padding: 20px !important;
                    box-shadow: rgba(0, 0, 0, 0.12) 0px 1px 3px, rgba(0, 0, 0, 0.24) 0px 1px 2px !important;
                    font-family: Arial, sans-serif !important;
                    color: #202124 !important;
                    box-sizing: border-box !important;
                    width: 360px !important;
                    backdrop-filter: blur(8px) !important;
                    transition: all 0.3s ease !important;
                  }
                  .knowledge-panel:hover {
                    box-shadow: rgba(0, 0, 0, 0.16) 0px 3px 6px, rgba(0, 0, 0, 0.30) 0px 3px 6px !important;
                    transform: translateY(-2px) !important;
                  }
                  .header-section {
                    display: flex !important;
                    align-items: flex-start !important;
                    justify-content: space-between !important;
                    gap: 12px !important;
                    margin-bottom: 12px !important;
                  }
                  .title-area {
                    flex: 1 !important;
                  }
                  .main-title {
                    font-size: 23px !important;
                    font-weight: 700 !important;
                    color: #1b4d3e !important;
                    margin: 0 0 4px 0 !important;
                    line-height: 1.25 !important;
                  }
                  .subtitle {
                    font-size: 13px !important;
                    color: #55585b !important;
                    line-height: 1.4 !important;
                  }
                  .kp-banner-img {
                    width: 100% !important;
                    height: 170px !important;
                    object-fit: cover !important;
                    border-radius: 10px !important;
                    margin: 6px 0 12px 0 !important;
                    border: 1px solid rgba(45, 106, 79, 0.15) !important;
                    box-shadow: rgba(0, 0, 0, 0.05) 0px 4px 12px !important;
                  }
                  .divider {
                    border-top: 1px solid rgba(45, 106, 79, 0.15) !important;
                    margin: 12px 0 !important;
                  }
                  .extract-text {
                    font-size: 13.5px !important;
                    color: #2b2d2f !important;
                    line-height: 1.6 !important;
                    margin-bottom: 8px !important;
                  }
                  .source-link {
                    font-size: 12px !important;
                    color: #55585b !important;
                  }
                  .source-link a {
                    color: #2d6a4f !important;
                    text-decoration: none !important;
                    font-weight: 600 !important;
                  }
                  .source-link a:hover {
                    text-decoration: underline !important;
                  }
                  .translate-section {
                    margin-top: 12px !important;
                  }
                  .translate-header {
                    font-size: 12px !important;
                    color: #2d6a4f !important;
                    margin-bottom: 6px !important;
                    display: flex !important;
                    align-items: center !important;
                    gap: 4px !important;
                  }
                  .translate-title {
                    font-weight: 700 !important;
                  }
                  .translate-text {
                    font-size: 13.5px !important;
                    color: #2b2d2f !important;
                    line-height: 1.6 !important;
                  }
                \`;
                shadow.appendChild(style);

                let searchTitle = cleanQ.replace(/\\b(download|setup|install|free|latest|version|search|find|how to)\\b/gi, '').trim();
                if (searchTitle) {
                  try {
                    const wikiUrl = \`https://en.wikipedia.org/api/rest_v1/page/summary/\${encodeURIComponent(searchTitle)}\`;
                    const response = await fetch(wikiUrl);
                    if (response.ok) {
                      const data = await response.json();
                      if (data.type === 'standard' || data.extract) {
                        let hindiText = '';
                        try {
                          const transUrl = \`https://api.mymemory.translated.net/get?q=\${encodeURIComponent(data.extract.slice(0, 450))}&langpair=en|hi\`;
                          const transRes = await fetch(transUrl);
                          if (transRes.ok) {
                            const transData = await transRes.json();
                            hindiText = transData.responseData.translatedText;
                          }
                        } catch (transErr) {}
                        
                        const imgSource = data.originalimage ? data.originalimage.source : (data.thumbnail ? data.thumbnail.source : '');
                        
                        const kp = document.createElement('div');
                        kp.className = 'knowledge-panel';
                        kp.innerHTML = \`
                          <div class="header-section">
                            <div class="title-area">
                              <h2 class="main-title">\${data.title}</h2>
                              <div class="subtitle">\${data.description || 'Information'}</div>
                            </div>
                          </div>
                          \${imgSource ? \`<img src="\${imgSource}" class="kp-banner-img" />\` : ''}
                          <div class="divider"></div>
                          <div class="extract-section">
                            <div class="extract-text">\${data.extract}</div>
                            <div class="source-link">Source: <a href="\${data.content_urls.desktop.page}" target="_blank">Wikipedia</a></div>
                          </div>
                          \${hindiText ? \`
                          <div class="divider"></div>
                          <div class="translate-section">
                            <div class="translate-header">
                              <span class="translate-title">Translated by Vayu AI (Hindi)</span>
                            </div>
                            <div class="translate-text">\${hindiText}</div>
                          </div>
                          \` : ''}
                        \`;
                        const existingKp = shadow.querySelector('.knowledge-panel');
                        if (existingKp) existingKp.remove();
                        shadow.appendChild(kp);
                      }
                    }
                  } catch (wikiErr) {}
                }
              }
            };
            injectSidebar();
            const observer = new MutationObserver(injectSidebar);
            observer.observe(document.body, { childList: true, subtree: true });
          })();
        `;
        view.webContents.executeJavaScript(sidebarCode).catch(err => console.error('Failed to inject Qmamu search sidebar:', err));
      }

      // Inject promotional widget banner
      try {
        const urlObj = new URL(currentUrl);
        const query = urlObj.searchParams.get('q') || urlObj.searchParams.get('p') || '';
        const normalizedQuery = query.toLowerCase().trim();
        
        const isSpeed = normalizedQuery.includes('internet speed') || normalizedQuery.includes('speed test');
        let isBrowserDl = normalizedQuery.includes('download chrome') || 
                          normalizedQuery.includes('download firefox') || 
                          normalizedQuery.includes('download edge') || 
                          normalizedQuery.includes('download opera') || 
                          normalizedQuery.includes('download brave') || 
                          normalizedQuery.includes('download safari') || 
                          (normalizedQuery.includes('download') && normalizedQuery.includes('browser'));

        const renderPromoBanner = () => {
          const promoCode = `
            (() => {
              const injectBanner = () => {
                const url = new URL(window.location.href);
                const q = url.searchParams.get('q') || url.searchParams.get('p') || '';
                const cleanQ = q.trim().toLowerCase();
                
                const competitorBrowsers = ['chrome', 'firefox', 'edge', 'opera', 'brave', 'safari', 'vivaldi', 'tor browser', 'internet explorer', 'browser'];
                const isMatch = competitorBrowsers.some(b => cleanQ.includes(b));
                
                if (!cleanQ || !isMatch) {
                  const existing = document.getElementById('vayu-custom-widget-banner');
                  if (existing) existing.remove();
                  return;
                }

                if (document.getElementById('vayu-custom-widget-banner')) return;
                const topStuff = document.getElementById('QmamuAll') || document.getElementById('topstuff') || document.getElementById('search') || document.getElementById('b_results') || document.getElementById('web') || document.getElementById('results') || document.getElementById('results-list') || document.querySelector('.results') || document.querySelector('div[class*="sc-meawca-"]') || document.body;
                if (topStuff) {
                  const container = document.createElement('div');
                  container.id = 'vayu-custom-widget-banner';
                  container.style.cssText = 'width: 100% !important; max-width: 652px !important; margin: 15px auto !important; display: block !important;';
                  
                  const shadow = container.attachShadow({ mode: 'open' });
                  
                  const style = document.createElement('style');
                  style.textContent = \`
                    .banner {
                      display: flex !important;
                      align-items: center !important;
                      justify-content: flex-end !important;
                      width: 100% !important;
                      height: 95px !important;
                      border-radius: 14px !important;
                      background: url(${vayuWidgetBase64}) no-repeat center / cover !important;
                      border: 1.5px solid #2d6a4f !important;
                      box-shadow: rgba(0, 0, 0, 0.12) 0px 1px 3px, rgba(0, 0, 0, 0.24) 0px 1px 2px !important;
                      position: relative !important;
                      overflow: hidden !important;
                      font-family: "Outfit", sans-serif !important;
                      padding: 0 24px !important;
                      box-sizing: border-box !important;
                    }
                    .banner-content {
                      display: flex !important;
                      flex-direction: column !important;
                      align-items: flex-end !important;
                      justify-content: center !important;
                      gap: 6px !important;
                      text-align: right !important;
                    }
                    .text-container {
                      font-size: 14px !important;
                      font-weight: 700 !important;
                      color: #0d1b2a !important;
                      text-align: right !important;
                      line-height: 1.3 !important;
                      white-space: normal !important;
                    }
                    .action-button {
                      background: #2d6a4f !important;
                      color: white !important;
                      border: none !important;
                      border-radius: 20px !important;
                      padding: 6px 16px !important;
                      font-size: 11px !important;
                      font-weight: 700 !important;
                      cursor: pointer !important;
                      box-shadow: 0 2px 8px rgba(45, 106, 79, 0.25) !important;
                      flex-shrink: 0 !important;
                      height: fit-content !important;
                      display: inline-block !important;
                      transition: background-color 0.2s ease, transform 0.1s ease !important;
                      outline: none !important;
                      width: fit-content !important;
                    }
                    .action-button:hover {
                      background: #1b4d3e !important;
                      transform: translateY(-1px) !important;
                    }
                    .action-button:active {
                      transform: translateY(0) !important;
                    }
                  \`;
                  shadow.appendChild(style);
                  
                  const banner = document.createElement('div');
                  banner.className = 'banner';
                  
                  const bannerContent = document.createElement('div');
                  bannerContent.className = 'banner-content';
                  
                  const centerText = document.createElement('div');
                  centerText.className = 'text-container';
                  centerText.innerText = 'Vayu Browser is already optimized for you. Why switch?';
                  bannerContent.appendChild(centerText);

                  const btn = document.createElement('button');
                  btn.className = 'action-button';
                  btn.innerText = 'Explore Vayu';
                  btn.onclick = () => {
                    container.style.display = 'none';
                  };
                  bannerContent.appendChild(btn);
                  
                  banner.appendChild(bannerContent);
                  shadow.appendChild(banner);
                  
                  if (topStuff === document.body) {
                    topStuff.insertBefore(container, topStuff.firstChild);
                  } else {
                    topStuff.parentNode.insertBefore(container, topStuff);
                  }
                }
              };
              injectBanner();
              const observer = new MutationObserver(injectBanner);
              observer.observe(document.body, { childList: true, subtree: true });
            })();
          `;
          view.webContents.executeJavaScript(promoCode).catch(() => {});
        };

        if (normalizedQuery.length > 2 && !isSpeed) {
          // Fast-path: Check locally first to show the banner instantly
          if (isBrowserDl || normalizedQuery.includes('chrome') || normalizedQuery.includes('firefox') || normalizedQuery.includes('edge') || normalizedQuery.includes('brave') || normalizedQuery.includes('opera') || normalizedQuery.includes('safari')) {
            renderPromoBanner();
          } else {
            // Slow-path: Query Sarvam AI for complex queries
            fetch('https://api.sarvam.ai/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'api-subscription-key': SARVAM_API_KEY,
                'Authorization': `Bearer ${SARVAM_API_KEY}`
              },
              body: JSON.stringify({
                model: 'sarvam-105b',
                messages: [
                  {
                    role: 'system',
                    content: 'You are the intelligence of Vayu Browser. Classify if the user query is looking to search, setup or download competitor web browsers (e.g. Chrome, Firefox, Edge, Safari, Brave, Opera, etc.). Respond strictly with JSON: {"isBrowserSearch": true} or {"isBrowserSearch": false}.'
                  },
                  {
                    role: 'user',
                    content: `Query: ${query}`
                  }
                ],
                temperature: 0.1
              })
            }).then(res => res.json()).then(data => {
              if (data && data.choices && data.choices[0] && data.choices[0].message) {
                const text = data.choices[0].message.content.trim();
                const match = text.match(/\{.*?\}/s);
                if (match) {
                  const result = JSON.parse(match[0]);
                  if (result && result.isBrowserSearch === true) {
                    renderPromoBanner();
                  }
                }
              }
            }).catch(() => {});
          }
        }
      } catch (err) {
        console.error('Failed to process promo banner injection:', err);
      }
    }

    if (isImmersiveMode) {
      injectImmersiveUi(tab);
    }
  };

  view.webContents.on('did-finish-load', handlePageLoadOrNavigation);
  view.webContents.on('did-navigate-in-page', handlePageLoadOrNavigation);

  view.webContents.on('page-title-updated', (event, title) => {
    const currentUrl = view.webContents.getURL();
    if (currentUrl.startsWith('view-source:')) {
      const siteName = getSiteNameForViewSource(currentUrl);
      tab.title = `Page source - ${siteName}`;
    } else if (isPrintPreviewUrl(currentUrl)) {
      tab.title = getTitleForPrintPreview(currentUrl);
    } else if (currentUrl.includes('newtab.html')) {
      tab.title = 'New Tab';
    } else {
      tab.title = title;
    }
    if (mainWindow) {
      mainWindow.webContents.send('tab-updated', {
        id: tabId,
        url: tab.url,
        title: tab.title,
        isLoading: tab.isLoading,
        canGoBack: view.webContents.canGoBack(),
        canGoForward: view.webContents.canGoForward(),
        blockedCount: tab.blockedCount,
        adBlockEnabled: tab.adBlockEnabled
      });
    }
  });

  view.webContents.on('will-submit-form', (event, details) => {
    if (!details || tab.isIncognito) return;
    const pageUrl = view.webContents.getURL();
    if (!pageUrl || !pageUrl.startsWith('https://')) return;
    const pageTitle = view.webContents.getTitle();
    savePasswordEntryIfPresent(details, pageUrl, pageTitle);
  });

  view.webContents.on('page-favicon-updated', (event, favicons) => {
    if (favicons && favicons.length > 0) {
      tab.favicon = favicons[0];
      if (mainWindow) {
        mainWindow.webContents.send('tab-updated', {
          id: tabId,
          favicon: favicons[0]
        });
      }
    }
  });

  view.webContents.on('did-navigate', (event, currentUrl) => {
    logHistory(tab, currentUrl, view.webContents.getTitle());
    let displayUrl = currentUrl;
    if (currentUrl.includes('newtab.html') && !currentUrl.startsWith('view-source:')) {
      displayUrl = 'orbit://newtab';
    } else if (currentUrl.includes('error.html')) {
      try {
        const urlObj = new URL(currentUrl);
        displayUrl = urlObj.searchParams.get('url') || currentUrl;
      } catch (e) {}
    }
    tab.url = displayUrl;
    if (currentUrl.startsWith('view-source:')) {
      const siteName = getSiteNameForViewSource(currentUrl);
      tab.title = `Page source - ${siteName}`;
    } else if (isPrintPreviewUrl(currentUrl)) {
      tab.title = getTitleForPrintPreview(currentUrl);
    }
    if (mainWindow) {
      mainWindow.webContents.send('update-address', { id: tabId, url: displayUrl });
    }
    // Update session state for crash recovery & session restore
    sessionManager.saveSessionState(tabs, activeTabId);
  });

  view.webContents.on('did-navigate-in-page', (event, currentUrl) => {
    let displayUrl = currentUrl;
    if (currentUrl.includes('newtab.html')) {
      displayUrl = 'orbit://newtab';
    }
    tab.url = displayUrl;
    if (mainWindow) {
      mainWindow.webContents.send('update-address', { id: tabId, url: displayUrl });
    }
  });

  view.webContents.on('dom-ready', () => {
    if (db.settings.adBlockEnabled) {
      let css = `
        #tads, #tadsb, #ads, .ads-ad, .uEerd, .commercial-unit-desktop,
        div[data-ad-block], div[data-ad-banner], div[data-google-query-id],
        div[class*="ads-ad"], div[id*="taw"] {
          display: none !important;
          height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          visibility: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }
      `;

      if (view.webContents.getURL().includes('youtube.com')) {
        css += `
          #masthead-ad,
          ytd-rich-section-renderer:has(#masthead-ad),
          ytd-rich-section-renderer:has(.ytd-ad-slot-renderer),
          ytd-rich-section-renderer:has(ytd-display-ad-render-element),
          ytd-rich-section-renderer:has(ytd-banner-promo-renderer),
          ytd-rich-item-renderer:has(.ytd-ad-slot-renderer),
          .ytd-ad-slot-renderer,
          ytd-display-ad-render-element,
          ytd-companion-card-renderer,
          ytd-promoted-sparkles-web-renderer,
          .ytp-ad-overlay-container,
          .ytp-ad-message-container {
            display: none !important;
            height: 0 !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
          }
        `;
      }
      view.webContents.insertCSS(css).catch(err => console.error('insertCSS failed', err));

      const js = `
        (() => {
          const hideGoogleAds = () => {
            document.querySelectorAll('span, div, a, h1, h2, h3, h4').forEach(el => {
              const text = el.textContent ? el.textContent.trim().toLowerCase() : '';
              if (
                text === 'sponsored' || 
                text === 'sponsored result' || 
                text === 'sponsored results' || 
                text === 'sponsored links' ||
                text === 'ad' || 
                text === 'ads' || 
                text === 'advertisement'
              ) {
                let parent = el.parentElement;
                while (parent) {
                  if (
                    parent.id === 'center_col' || 
                    parent.id === 'search' || 
                    parent.id === 'rcnt' || 
                    parent.id === 'viewport' || 
                    parent.tagName === 'BODY'
                  ) {
                    break;
                  }
                  
                  const hasAdClass = parent.classList && Array.from(parent.classList).some(cls => {
                    const lowercaseCls = cls.toLowerCase();
                    return lowercaseCls === 'ad' || 
                           lowercaseCls === 'ads' || 
                           lowercaseCls.startsWith('ad-') || 
                           lowercaseCls.startsWith('ads-') || 
                           lowercaseCls.includes('-ad-') || 
                           lowercaseCls.includes('-ads-') ||
                           lowercaseCls.includes('commercial') || 
                           lowercaseCls === 'uEerd';
                  });
                  
                  if (parent.id === 'tads' || parent.id === 'tadsb' || parent.id === 'ads' || hasAdClass) {
                    parent.remove();
                    break;
                  }
                  
                  if (parent.parentElement && (
                    parent.parentElement.id === 'taw' || 
                    parent.parentElement.id === 'tads' || 
                    parent.parentElement.id === 'tadsb'
                  )) {
                    parent.remove();
                    break;
                  }
                  
                  parent = parent.parentElement;
                }
              }
            });
          };
          hideGoogleAds();
          const observer = new MutationObserver(hideGoogleAds);
          observer.observe(document.body, { childList: true, subtree: true });
        })();
      `;
      view.webContents.executeJavaScript(js).catch(err => console.error('executeJavaScript failed', err));

      // Inject YouTube specific ad-skipper if on YouTube
      if (view.webContents.getURL().includes('youtube.com')) {
        const ytAdSkipper = `
          (() => {
            const skipYoutubeAds = () => {
              // 1. Hide overlay and banner elements
              const adSelectors = [
                '.ytp-ad-overlay-container',
                '.ytp-ad-message-container',
                'ytd-promoted-sparkles-web-renderer',
                'ytd-display-ad-render-element',
                '#masthead-ad',
                'ytd-companion-card-renderer',
                '.ytd-ad-slot-renderer'
              ];
              adSelectors.forEach(sel => {
                document.querySelectorAll(sel).forEach(el => {
                  el.style.setProperty('display', 'none', 'important');
                  el.style.setProperty('height', '0', 'important');
                  el.style.setProperty('margin', '0', 'important');
                  el.style.setProperty('padding', '0', 'important');
                });
              });

              // 2. Collapse parent wrapper renderers
              document.querySelectorAll('ytd-rich-section-renderer, ytd-rich-item-renderer').forEach(el => {
                if (el.querySelector('#masthead-ad, .ytd-ad-slot-renderer, ytd-display-ad-render-element, ytd-banner-promo-renderer')) {
                  el.style.setProperty('display', 'none', 'important');
                  el.style.setProperty('height', '0', 'important');
                  el.style.setProperty('margin', '0', 'important');
                  el.style.setProperty('padding', '0', 'important');
                }
              });

              // 3. Fast-forward video ads
              const player = document.getElementById('movie_player');
              const video = document.querySelector('#movie_player video');
              
              if (player && video && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) {
                video.muted = true;
                if (video.playbackRate < 16) {
                  video.playbackRate = 16;
                }
                
                const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-hover, .ytp-ad-skip-button-modern');
                if (skipBtn) {
                  skipBtn.click();
                } else if (video.currentTime > 0.5 && isFinite(video.duration)) {
                  video.currentTime = video.duration;
                }
              }
            };

            setInterval(skipYoutubeAds, 300);
          })();
        `;
        view.webContents.executeJavaScript(ytAdSkipper).catch(err => console.error('YouTube ad skipper failed', err));
      }
    }
    
    // Automatically apply Reader Mode stylesheet/JS on page DOM reload if active
    if (tab.readerModeEnabled) {
      applyReaderMode(tab);
    }

    try {
      fs.appendFileSync('c:\\Users\\pouru\\OneDrive\\Desktop\\Project\\browser\\orbit-error.log', `dom-ready: url=${view.webContents.getURL()}, isImmersiveMode=${isImmersiveMode}\n`);
    } catch (e) {}

    // Automatically apply Immersive Mode UI on page DOM reload if active
    if (isImmersiveMode) {
      injectImmersiveUi(tab);
    }

    // Inject global blocked stats if loading the new tab page
    if (view.webContents.getURL().includes('newtab.html')) {
      const totalBlocked = db.stats ? db.stats.totalBlocked : 0;
      view.webContents.executeJavaScript(`
        if (window.setGlobalBlockedCount) {
          window.setGlobalBlockedCount(${totalBlocked});
        }
      `).catch(err => console.error('Failed to inject global blocked count', err));
    }
  });

  // Crash Recovery: detect renderer crash / OOM and provide graceful recovery UI
  view.webContents.on('render-process-gone', (event, details) => {
    tab.isCrashed = true;
    console.error(`[TabCrash] Tab ${tabId} crashed: reason=${details.reason}, exitCode=${details.exitCode}`);
    const errorUrl = `file://${path.join(__dirname, 'error.html')}?url=${encodeURIComponent(tab.url || '')}&error=${encodeURIComponent('The page stopped responding (' + details.reason + ')')}`;
    view.webContents.loadURL(errorUrl).catch(() => {});
  });

  // Handle connection and load failures by showing custom error page
  view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    if (errorCode === -3) return; // Ignore ERR_ABORTED
    if (validatedURL.includes('error.html')) return;

    const errorUrl = `file://${path.join(__dirname, 'error.html')}?url=${encodeURIComponent(validatedURL)}&error=${encodeURIComponent(errorDescription)} (${errorCode})`;
    view.webContents.loadURL(errorUrl).catch(err => {
      console.error('Failed to load custom error page in did-fail-load', err);
    });
  });

  // Load Initial URL
  navigateTab(tab, url);

  return tab;
}

function navigateTab(tab, url) {
  tab.blockedCount = 0; // Reset blocked count on navigation
  if (mainWindow) {
    mainWindow.webContents.send('blocked-count', { tabId: tab.id, count: 0 });
  }

  if (url && url.startsWith('view-source:')) {
    const siteName = getSiteNameForViewSource(url);
    tab.title = `Page source - ${siteName}`;
  } else if (isPrintPreviewUrl(url)) {
    tab.title = getTitleForPrintPreview(url);
  }

  if (!url || url === 'orbit://newtab') {
    tab.view.webContents.loadFile(path.join(__dirname, 'newtab.html'));
  } else {
    // Basic URL validation & parsing
    let targetUrl = url.trim();
    if (targetUrl.startsWith('view-source:')) {
      const nestedUrl = targetUrl.slice('view-source:'.length).trim();
      if (nestedUrl && !nestedUrl.startsWith('http://') && !nestedUrl.startsWith('https://') && !nestedUrl.startsWith('file://')) {
        targetUrl = 'view-source:https://' + nestedUrl;
      }
    } else if (!targetUrl.includes('.') && !targetUrl.startsWith('http') && !targetUrl.startsWith('file://')) {
      // Search query
      targetUrl = `https://www.google.com/search?q=${encodeURIComponent(targetUrl)}`;
    } else if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://') && !targetUrl.startsWith('file://')) {
      targetUrl = 'https://' + targetUrl;
    }
    
    tab.view.webContents.loadURL(targetUrl).catch(err => {
      console.error(`Failed to load URL: ${targetUrl}`, err);
      const errorUrl = `file://${path.join(__dirname, 'error.html')}?url=${encodeURIComponent(targetUrl)}&error=${encodeURIComponent(err.message)}`;
      tab.view.webContents.loadURL(errorUrl).catch(e => console.error('Failed to load error page', e));
    });
  }
}

function normalizePasswordFieldName(name) {
  return String(name || '').trim().toLowerCase();
}

function getPasswordFieldValue(fields, candidates) {
  const lookup = Object.entries(fields || {}).reduce((acc, [key, value]) => {
    const normalizedKey = normalizePasswordFieldName(key);
    if (value !== undefined && value !== null && value !== '') {
      acc[normalizedKey] = value;
    }
    return acc;
  }, {});

  for (const candidate of candidates) {
    const val = lookup[candidate];
    if (typeof val === 'string' && val.trim()) {
      return val.trim();
    }
    if (Array.isArray(val)) {
      const first = val.find(item => typeof item === 'string' && item.trim());
      if (first) return String(first).trim();
    }
  }

  return '';
}

function parseSubmittedFormData(details) {
  const raw = details && (details.postData || details.formData || details.data || details.body);
  if (!raw) return {};

  if (typeof raw === 'string') {
    const params = new URLSearchParams(raw);
    return Object.fromEntries(Array.from(params.entries()));
  }

  if (Array.isArray(raw)) {
    return raw.reduce((acc, entry) => {
      if (entry && typeof entry === 'object') {
        Object.assign(acc, parseSubmittedFormData(entry));
      }
      return acc;
    }, {});
  }

  if (raw instanceof URLSearchParams) {
    return Object.fromEntries(Array.from(raw.entries()));
  }

  if (typeof raw === 'object') {
    const entries = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        entries[key] = String(value);
      } else if (Array.isArray(value)) {
        entries[key] = value.map(item => typeof item === 'string' ? item : String(item));
      }
    }
    return entries;
  }

  return {};
}

function isTrustedSender(event) {
  if (!event || !event.sender) return false;
  if (mainWindow && !mainWindow.isDestroyed() && event.sender.id === mainWindow.webContents.id) {
    return true;
  }
  const trustedWindows = [customContextMenuWin, lockPointerWin, locationNotificationWin, feedbackPopup];
  for (const win of trustedWindows) {
    if (win && !win.isDestroyed() && event.sender.id === win.webContents.id) {
      return true;
    }
  }
  return false;
}

function savePasswordEntryIfPresent(details, pageUrl, pageTitle) {
  if (!details || !pageUrl) return;

  try {
    const parsedUrl = new URL(pageUrl);
    const url = parsedUrl.origin || parsedUrl.href;
    const fields = parseSubmittedFormData(details);
    const username = getPasswordFieldValue(fields, ['username', 'email', 'login', 'user', 'user_name', 'userid', 'phone', 'account']);
    const password = getPasswordFieldValue(fields, ['password', 'pass', 'passwd', 'pwd']);

    if (!username || !password) return;

    const site = url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const encryptedPassword = encryptPassword(password);
    const normalizedEntry = {
      id: `pw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url: site,
      title: pageTitle || parsedUrl.hostname,
      username,
      password: encryptedPassword,
      createdAt: Date.now()
    };

    const exists = db.passwords.some((item) => item.url === site && item.username === username && decryptPassword(item.password) === password);
    if (!exists) {
      db.passwords.unshift(normalizedEntry);
      if (db.passwords.length > 200) {
        db.passwords = db.passwords.slice(0, 200);
      }
      saveDb();
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        const decryptedList = db.passwords.map(p => ({
          ...p,
          password: decryptPassword(p.password)
        }));
        mainWindow.webContents.send('passwords-data', decryptedList);
      }
    }
  } catch (err) {
    console.warn('Failed to save submitted password entry:', err);
  }
}

function logHistory(tab, url, title) {
  // Do not log history for incognito or orbit internal urls
  if (!tab || tab.isIncognito) return;
  if (!url || url.startsWith('file://') || url.includes('newtab.html') || url.startsWith('orbit:')) return;

  const historyItem = {
    url,
    title: title || url,
    timestamp: Date.now()
  };

  // Remove duplicates to keep history clean
  db.history = db.history.filter(item => item.url !== url);
  db.history.unshift(historyItem);

  // Keep history max 500 items
  if (db.history.length > 500) {
    db.history.pop();
  }

  saveDb();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('history-data', db.history);
  }
}

// IPC Channel Handlers
ipcMain.on('create-tab', (event, { id, url, isIncognito }) => {
  if (!isTrustedSender(event)) return;
  createTab(id, url, isIncognito);
  sessionManager.saveSessionState(tabs, activeTabId);
});

ipcMain.on('switch-tab', (event, tabId) => {
  if (!isTrustedSender(event)) return;
  if (activeTabId && tabs.has(activeTabId)) {
    const oldTab = tabs.get(activeTabId);
    mainWindow.contentView.removeChildView(oldTab.view);
  }

  activeTabId = tabId;

  if (activeTabId && tabs.has(activeTabId)) {
    const newTab = tabs.get(activeTabId);
    mainWindow.contentView.addChildView(newTab.view);
    resizeActiveTab();
    newTab.view.webContents.focus();
    
    // Inject immersive UI if switched to a tab while immersive mode is active
    if (isImmersiveMode) {
      isImmersiveSearchOpen = false;
      injectImmersiveUi(newTab);
    }
    
    // Send update
    mainWindow.webContents.send('tab-focused', activeTabId);
    mainWindow.webContents.send('blocked-count', { tabId: activeTabId, count: newTab.blockedCount || 0 });
    sessionManager.saveSessionState(tabs, activeTabId);
  }
});

ipcMain.on('close-tab', (event, tabId) => {
  if (!isTrustedSender(event)) return;
  if (tabs.has(tabId)) {
    const tab = tabs.get(tabId);
    
    // Save to recently closed if not incognito and has a valid non-newtab URL
    if (tab && !tab.isIncognito && tab.url && tab.url !== 'orbit://newtab' && !isPrintPreviewUrl(tab.url)) {
      recentlyClosedTabs.push({ url: tab.url });
      if (recentlyClosedTabs.length > 20) {
        recentlyClosedTabs.shift();
      }
    }
    
    webContentsToTabIdMap.delete(tab.view.webContents.id);
    
    if (activeTabId === tabId) {
      mainWindow.contentView.removeChildView(tab.view);
      activeTabId = null;
    }
    
    tab.view.webContents.destroy();
    tabs.delete(tabId);

    // Incognito privacy cleanup: if no active incognito tabs remain, purge incognito partition storage & cache
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

    sessionManager.saveSessionState(tabs, activeTabId);
  }
});

ipcMain.on('navigate-tab', (event, { id, url }) => {
  if (!isTrustedSender(event)) return;
  if (tabs.has(id)) {
    const tab = tabs.get(id);
    navigateTab(tab, url);
  }
});

ipcMain.on('back-tab', (event, tabId) => {
  if (!isTrustedSender(event)) return;
  if (tabs.has(tabId)) {
    const tab = tabs.get(tabId);
    if (tab.view.webContents.canGoBack()) {
      tab.view.webContents.goBack();
    }
  }
});

ipcMain.on('forward-tab', (event, tabId) => {
  if (!isTrustedSender(event)) return;
  if (tabs.has(tabId)) {
    const tab = tabs.get(tabId);
    if (tab.view.webContents.canGoForward()) {
      tab.view.webContents.goForward();
    }
  }
});

ipcMain.on('reload-tab', (event, tabId) => {
  if (!isTrustedSender(event)) return;
  if (tabs.has(tabId)) {
    const tab = tabs.get(tabId);
    tab.view.webContents.reload();
  }
});

// History & Bookmarks IPCs
ipcMain.on('get-history', (event) => {
  if (!isTrustedSender(event)) return;
  event.reply('history-data', db.history);
});

ipcMain.on('clear-history', (event) => {
  if (!isTrustedSender(event)) return;
  db.history = [];
  saveDb();
  event.reply('history-data', db.history);
});

ipcMain.on('get-bookmarks', (event) => {
  if (!isTrustedSender(event)) return;
  event.reply('bookmarks-data', db.bookmarks);
});

ipcMain.on('get-passwords', (event) => {
  if (!isTrustedSender(event)) return;
  const decryptedList = (db.passwords || []).map(p => ({
    ...p,
    password: decryptPassword(p.password)
  }));
  event.reply('passwords-data', decryptedList);
});

ipcMain.on('clear-passwords', (event) => {
  db.passwords = [];
  saveDb();
  event.reply('passwords-data', db.passwords);
  if (mainWindow && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('passwords-data', db.passwords);
  }
});

ipcMain.on('add-bookmark', (event, { url, title }) => {
  const hadBookmarks = db.bookmarks.length > 0;
  // Check if already bookmarked
  const exists = db.bookmarks.some(b => b.url === url);
  if (!exists) {
    db.bookmarks.push({ url, title: title || url });
    saveDb();
  }
  event.reply('bookmarks-data', db.bookmarks);
  
  const hasBookmarks = db.bookmarks.length > 0;
  if (hadBookmarks !== hasBookmarks) {
    resizeActiveTab();
  }
});

ipcMain.on('remove-bookmark', (event, url) => {
  const hadBookmarks = db.bookmarks.length > 0;
  db.bookmarks = db.bookmarks.filter(b => b.url !== url);
  saveDb();
  event.reply('bookmarks-data', db.bookmarks);
  
  const hasBookmarks = db.bookmarks.length > 0;
  if (hadBookmarks !== hasBookmarks) {
    resizeActiveTab();
  }
});

// Settings & Adblock
ipcMain.on('toggle-adblock', (event, args) => {
  const targetTabId = (args && args.tabId) ? args.tabId : null;
  const isGlobal = (args && args.global) ? true : false;

  if (isGlobal || !targetTabId) {
    db.settings.adBlockEnabled = !db.settings.adBlockEnabled;
    saveDb();
    
    // Propagate to all tabs
    for (const tab of tabs.values()) {
      tab.adBlockEnabled = db.settings.adBlockEnabled;
    }
  } else {
    // Tab specific toggle
    if (tabs.has(targetTabId)) {
      const tab = tabs.get(targetTabId);
      tab.adBlockEnabled = !tab.adBlockEnabled;
    }
  }

  // Reply settings-data
  event.reply('settings-data', {
    ...db.settings,
    globalBlockedCount: db.stats ? db.stats.totalBlocked : 0
  });

  // Reply tab update/shield info
  const activeTab = tabs.get(activeTabId);
  if (activeTab) {
    // Notify main renderer of tab update (this will update its toolbar badge/color)
    if (mainWindow) {
      mainWindow.webContents.send('tab-updated', {
        id: activeTab.id,
        adBlockEnabled: activeTab.adBlockEnabled
      });
    }

    sendToShieldPopup('shield-info-data', {
      tabId: activeTab.id,
      adBlockEnabled: activeTab.adBlockEnabled,
      blockedCount: activeTab.blockedCount || 0,
      blockedTrackers: activeTab.blockedTrackers || [],
      globalBlockedCount: db.stats ? db.stats.totalBlocked : 0,
      favicon: activeTab.favicon || '',
      url: activeTab.url || ''
    });

    // Reload target/active tab to apply
    if (targetTabId && tabs.has(targetTabId)) {
      tabs.get(targetTabId).view.webContents.reload();
    } else if (activeTabId && tabs.has(activeTabId)) {
      tabs.get(activeTabId).view.webContents.reload();
    }
  }
});

ipcMain.on('toggle-shield-popup', (event, rect) => {
  showShieldPopup(rect);
});

ipcMain.on('toggle-site-info-popup', (event, { url }) => {
  showLocationNotification(url);
});

ipcMain.on('toggle-feedback-popup', (event, rect) => {
  showFeedbackPopup(rect);
});

ipcMain.on('get-shield-info', (event) => {
  if (!activeTabId || !tabs.has(activeTabId)) return;
  const tab = tabs.get(activeTabId);
  const payload = {
    tabId: tab.id,
    adBlockEnabled: tab.adBlockEnabled,
    blockedCount: tab.blockedCount || 0,
    blockedTrackers: tab.blockedTrackers || [],
    globalBlockedCount: db.stats ? db.stats.totalBlocked : 0,
    favicon: tab.favicon || '',
    url: tab.url || ''
  };
  sendToShieldPopup('shield-info-data', payload);
});

ipcMain.on('close-shield-popup', () => {
  if (shieldPopup && !shieldPopup.isDestroyed()) {
    shieldPopup.close();
  }
});

ipcMain.on('close-qr-window', () => {
  if (qrWindow && !qrWindow.isDestroyed()) {
    qrWindow.close();
    qrWindow = null;
  }
});

ipcMain.on('get-settings', (event) => {
  const settingsData = { ...db.settings, globalBlockedCount: db.stats ? db.stats.totalBlocked : 0 };
  event.reply('settings-data', settingsData);
});

ipcMain.handle('get-search-engine', (event) => {
  return (db.settings && db.settings.searchEngine) || 'https://www.google.com/search?q=';
});

ipcMain.handle('get-autocomplete-suggestions', (event, query) => {
  if (!query) return [];
  const normalizedQuery = query.toLowerCase();

  const formatUrl = (urlString) => {
    try {
      const url = new URL(urlString);
      let friendly = url.hostname;
      if (url.pathname && url.pathname !== '/') friendly += url.pathname;
      if (friendly.startsWith('www.')) friendly = friendly.substring(4);
      return friendly;
    } catch (e) {
      return urlString;
    }
  };

  const suggestions = [];
  const seenUrls = new Set();

  for (const b of db.bookmarks) {
    if (!b.url) continue;
    const friendly = formatUrl(b.url);
    if (friendly.toLowerCase().includes(normalizedQuery) || (b.title && b.title.toLowerCase().includes(normalizedQuery))) {
      if (!seenUrls.has(b.url)) {
        seenUrls.add(b.url);
        suggestions.push({ url: b.url, friendly, title: b.title, type: 'bookmark' });
      }
    }
  }

  for (const h of db.history) {
    if (!h.url) continue;
    const friendly = formatUrl(h.url);
    if (friendly.toLowerCase().includes(normalizedQuery) || (h.title && h.title.toLowerCase().includes(normalizedQuery))) {
      if (!seenUrls.has(h.url)) {
        seenUrls.add(h.url);
        suggestions.push({ url: h.url, friendly, title: h.title, type: 'history' });
      }
    }
  }

  return suggestions.slice(0, 8);
});

ipcMain.on('save-settings', (event, settings) => {
  db.settings = { ...db.settings, ...settings };
  saveDb();
  event.reply('settings-data', db.settings);
  if (mainWindow && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('settings-data', db.settings);
  }
});

ipcMain.on('save-permission', (event, { domain, permission, value }) => {
  if (!db.permissions) db.permissions = {};
  if (!db.permissions[domain]) db.permissions[domain] = {};
  db.permissions[domain][permission] = value;
  saveDb();

  // Reload all open tabs for this domain whenever any permission button is turned ON or OFF
  for (const tab of tabs.values()) {
    try {
      const tabUrl = tab.view.webContents.getURL();
      const tabDomain = new URL(tabUrl).hostname;
      if (tabDomain === domain) {
        tab.view.webContents.reload();
      }
    } catch (e) {}
  }
});

ipcMain.on('toggle-reader-mode', (event, tabId) => {
  if (tabs.has(tabId)) {
    const tab = tabs.get(tabId);
    tab.readerModeEnabled = !tab.readerModeEnabled;

    if (tab.readerModeEnabled) {
      applyReaderMode(tab);
    } else {
      removeReaderMode(tab);
    }

    if (mainWindow) {
      mainWindow.webContents.send('reader-mode-updated', {
        tabId: tab.id,
        readerModeEnabled: tab.readerModeEnabled
      });
    }
  }
});

ipcMain.on('toggle-immersive-mode', (event, tabId) => {
  toggleImmersiveMode(tabId);
});

ipcMain.on('toggle-collapse-chrome', (event) => {
  isChromeCollapsed = !isChromeCollapsed;
  if (!isChromeCollapsed) {
    isChromeHovered = false;
  }
  const target = getTargetHeaderHeight();
  animateActiveTabY(target);
  if (mainWindow) {
    mainWindow.webContents.send('collapse-chrome-updated', isChromeCollapsed);
  }
});

ipcMain.on('chrome-hover-status', (event, isHovered) => {
  isChromeHovered = isHovered;
  const target = getTargetHeaderHeight();
  animateActiveTabY(target);
});

ipcMain.on('sidebar-toggle', (event, isOpen) => {
  isSidebarOpen = isOpen;
  resizeActiveTab();
});

ipcMain.on('show-bookmark-context-menu', (event, { url }) => {
  const menu = new Menu();
  menu.append(new MenuItem({
    label: 'Open in New Tab',
    click: () => {
      if (mainWindow) {
        mainWindow.webContents.send('tab-created-external', { url, isIncognito: false });
      }
    }
  }));
  menu.append(new MenuItem({
    label: 'Open in Incognito Tab',
    click: () => {
      if (mainWindow) {
        mainWindow.webContents.send('tab-created-external', { url, isIncognito: true });
      }
    }
  }));
  menu.append(new MenuItem({ type: 'separator' }));
  menu.append(new MenuItem({
    label: 'Remove Bookmark',
    click: () => {
      db.bookmarks = db.bookmarks.filter(b => b.url !== url);
      saveDb();
      if (mainWindow) {
        mainWindow.webContents.send('bookmarks-data', db.bookmarks);
      }
    }
  }));
  menu.popup({ window: mainWindow });
});

// Custom Frame IPC handlers
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  try {
    const incognitoSession = session.fromPartition('incognito');
    incognitoSession.clearStorageData().catch(() => {});
    incognitoSession.clearCache().catch(() => {});
  } catch (e) {}
});

ipcMain.on('get-downloads', (event) => {
  if (!isTrustedSender(event)) return;
  event.reply('downloads-data', db.downloads || []);
});

ipcMain.on('clear-downloads', (event) => {
  if (!isTrustedSender(event)) return;
  db.downloads = [];
  saveDb();
  event.reply('downloads-data', []);
});

ipcMain.on('pause-download', (event, id) => {
  if (!isTrustedSender(event)) return;
  const item = downloadsManager.getActiveDownload(id);
  if (item) {
    item.pause();
  }
});

ipcMain.on('resume-download', (event, id) => {
  if (!isTrustedSender(event)) return;
  const item = downloadsManager.getActiveDownload(id);
  if (item) {
    item.resume();
  }
});

ipcMain.on('cancel-download', (event, id) => {
  if (!isTrustedSender(event)) return;
  const item = downloadsManager.getActiveDownload(id);
  if (item) {
    item.cancel();
  }
});

ipcMain.on('open-download', (event, filePath) => {
  if (!isTrustedSender(event)) return;
  if (!filePath) return;
  const { shell } = require('electron');
  shell.openPath(filePath).catch(err => {
    console.error('Failed to open download file:', err);
  });
});

ipcMain.on('show-download-in-folder', (event, filePath) => {
  if (!isTrustedSender(event)) return;
  if (!filePath) return;
  const { shell } = require('electron');
  shell.showItemInFolder(filePath);
});

ipcMain.on('log-to-main', (event, msg) => {
  if (!isTrustedSender(event)) return;
  console.log('[renderer]', msg);
  try {
    fs.appendFileSync('c:\\Users\\pouru\\OneDrive\\Desktop\\Project\\browser\\orbit-error.log', `[renderer] ${msg}\n`);
  } catch (e) {}
});
