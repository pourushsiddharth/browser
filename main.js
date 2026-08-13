const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu, MenuItem } = require('electron');
const path = require('path');
const fs = require('fs');
const adblocker = require('./adblocker');

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

// Database Path
const dbPath = path.join(app.getPath('userData'), 'orbit-data.json');
let db = {
  history: [],
  bookmarks: [],
  settings: {
    adBlockEnabled: true,
    homepage: 'orbit://newtab'
  },
  stats: {
    totalBlocked: 0
  }
};

let dbDirty = false;

// Load Database
function loadDb() {
  try {
    if (fs.existsSync(dbPath)) {
      const data = fs.readFileSync(dbPath, 'utf8');
      db = JSON.parse(data);
      // Ensure arrays/objects exist
      if (!Array.isArray(db.history)) db.history = [];
      if (!Array.isArray(db.bookmarks)) db.bookmarks = [];
      if (!Array.isArray(db.downloads)) db.downloads = [];
      if (!db.settings) db.settings = { adBlockEnabled: true, homepage: 'orbit://newtab' };
      if (!db.stats) db.stats = { totalBlocked: 0 };
    }
  } catch (err) {
    console.error('Failed to load browser data database', err);
  }
}

// Save Database
function saveDb() {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
    dbDirty = false;
  } catch (err) {
    console.error('Failed to save browser data database', err);
  }
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

function setupContextMenu(webContents) {
  webContents.on('context-menu', (event, params) => {
    const menu = new Menu();
    let hasMediaOrSelection = false;

    // 1. Text Selection Copy (for non-editable elements)
    if (!params.isEditable && params.selectionText && params.selectionText.trim() !== '') {
      menu.append(new MenuItem({
        label: 'Copy',
        role: 'copy'
      }));
      hasMediaOrSelection = true;
    }

    // 2. Link Options
    if (params.linkURL) {
      menu.append(new MenuItem({
        label: 'Copy link address',
        click: () => {
          const { clipboard } = require('electron');
          clipboard.writeText(params.linkURL);
        }
      }));
      menu.append(new MenuItem({
        label: 'Save link as...',
        click: () => {
          webContents.downloadURL(params.linkURL);
        }
      }));
      hasMediaOrSelection = true;
    }

    // 3. Image Options
    if (params.mediaType === 'image' || (params.srcURL && params.mediaType !== 'none')) {
      if (hasMediaOrSelection) {
        menu.append(new MenuItem({ type: 'separator' }));
      }
      menu.append(new MenuItem({
        label: 'Copy image',
        click: () => {
          webContents.copyImageAt(params.x, params.y);
        }
      }));
      menu.append(new MenuItem({
        label: 'Copy image address',
        click: () => {
          const { clipboard } = require('electron');
          clipboard.writeText(params.srcURL);
        }
      }));
      menu.append(new MenuItem({
        label: 'Save the image',
        click: () => {
          webContents.downloadURL(params.srcURL);
        }
      }));
      hasMediaOrSelection = true;
    }

    if (hasMediaOrSelection) {
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // 4. Editable Text Tools (like Chrome)
    if (params.isEditable) {
      menu.append(new MenuItem({
        label: 'Cut',
        role: 'cut',
        enabled: params.editFlags.canCut
      }));
      menu.append(new MenuItem({
        label: 'Copy',
        role: 'copy',
        enabled: params.editFlags.canCopy
      }));
      menu.append(new MenuItem({
        label: 'Paste',
        role: 'paste',
        enabled: params.editFlags.canPaste
      }));
      menu.append(new MenuItem({
        label: 'Select All',
        role: 'selectall'
      }));
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // 5. Standard navigation options (Back, Forward, Reload)
    menu.append(new MenuItem({
      label: 'Back',
      accelerator: 'Alt+Left',
      enabled: webContents.canGoBack(),
      click: () => webContents.goBack()
    }));
    menu.append(new MenuItem({
      label: 'Forward',
      accelerator: 'Alt+Right',
      enabled: webContents.canGoForward(),
      click: () => webContents.goForward()
    }));
    menu.append(new MenuItem({
      label: 'Reload',
      accelerator: 'CmdOrCtrl+R',
      click: () => webContents.reload()
    }));
    
    menu.append(new MenuItem({ type: 'separator' }));
    
    // Page-level "Save as..." is removed from here
    
    menu.append(new MenuItem({
      label: 'Print...',
      accelerator: 'CmdOrCtrl+P',
      click: () => {
        showPrintPreview(webContents);
      }
    }));
    menu.append(new MenuItem({
      label: 'Cast...',
      enabled: false
    }));
    
    menu.append(new MenuItem({ type: 'separator' }));
    
    menu.append(new MenuItem({
      label: 'Create QR Code for this page',
      click: () => {
        const url = webContents.getURL();
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
        qrWindow.on('closed', () => {
          qrWindow = null;
        });
      }
    }));
    
    menu.append(new MenuItem({ type: 'separator' }));
    
    menu.append(new MenuItem({
      label: 'Translate to English',
      click: () => {
        const url = webContents.getURL();
        webContents.loadURL(`https://translate.google.com/translate?sl=auto&tl=en&u=${encodeURIComponent(url)}`);
      }
    }));
    
    menu.append(new MenuItem({ type: 'separator' }));
    
    menu.append(new MenuItem({
      label: 'View page source',
      accelerator: 'CmdOrCtrl+U',
      click: () => {
        const url = webContents.getURL();
        if (mainWindow) {
          mainWindow.webContents.send('tab-created-external', { url: `view-source:${url}` });
        }
      }
    }));
    menu.append(new MenuItem({
      label: 'Inspect',
      click: () => {
        webContents.inspectElement(params.x, params.y);
      }
    }));
    
    menu.popup();
  });
}

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
  sess.on('will-download', (event, item, webContents) => {
    const downloadId = 'dl-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
    activeDownloads.set(downloadId, item);

    const filename = item.getFilename();
    const totalBytes = item.getTotalBytes();
    const url = item.getURL();
    const date = new Date().toISOString();

    const downloadState = {
      id: downloadId,
      filename: filename,
      totalBytes: totalBytes,
      receivedBytes: 0,
      status: 'progressing',
      url: url,
      savePath: item.getSavePath() || '',
      date: date,
      isIncognito: isIncognito
    };

    if (!isIncognito) {
      if (!db.downloads) db.downloads = [];
      db.downloads.unshift(downloadState);
      dbDirty = true;
    }

    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('download-started', downloadState);
    }

    item.on('updated', (event, state) => {
      if (state === 'interrupted') {
        downloadState.status = 'interrupted';
      } else if (state === 'progressing') {
        downloadState.status = 'progressing';
        downloadState.receivedBytes = item.getReceivedBytes();
        downloadState.savePath = item.getSavePath();
      }

      if (!isIncognito) {
        const idx = db.downloads.findIndex(d => d.id === downloadId);
        if (idx !== -1) {
          db.downloads[idx] = { ...db.downloads[idx], ...downloadState };
          dbDirty = true;
        }
      }

      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('download-updated', {
          id: downloadId,
          receivedBytes: downloadState.receivedBytes,
          status: downloadState.status,
          savePath: downloadState.savePath
        });
      }
    });

    item.once('done', (event, state) => {
      activeDownloads.delete(downloadId);
      
      if (state === 'completed') {
        downloadState.status = 'completed';
        downloadState.receivedBytes = totalBytes || item.getReceivedBytes();
        downloadState.savePath = item.getSavePath();
      } else if (state === 'cancelled') {
        downloadState.status = 'cancelled';
      } else {
        downloadState.status = 'failed';
      }

      if (!isIncognito) {
        const idx = db.downloads.findIndex(d => d.id === downloadId);
        if (idx !== -1) {
          db.downloads[idx] = { ...db.downloads[idx], ...downloadState };
          dbDirty = true;
          saveDb();
        }
      }

      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('download-done', downloadState);
      }
    });
  });
}

function createWindow() {
  // Load settings & init adblocker
  loadDb();
  adblocker.init();
  
  // Setup default session adblocker
  setupAdBlocker(session.defaultSession);
  // Setup incognito session adblocker
  setupAdBlocker(session.fromPartition('incognito'));

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

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false, // Frameless for custom header/tabs UI
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#f3f4f6' // Match browser background light theme
  });

  mainWindow.loadFile('index.html');
  setupContextMenu(mainWindow.webContents);
  // initGeminiNotifications();

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
      sandbox: true
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

  // Set window open handler to prevent popups and redirect target="_blank" links to new tabs
  view.webContents.setWindowOpenHandler((details) => {
    if (mainWindow) {
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
    } else {
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

  view.webContents.on('did-finish-load', () => {
    try {
      fs.appendFileSync('c:\\Users\\pouru\\OneDrive\\Desktop\\Project\\browser\\orbit-error.log', `did-finish-load: url=${view.webContents.getURL()}, isImmersiveMode=${isImmersiveMode}\n`);
    } catch (e) {}
    if (isImmersiveMode) {
      injectImmersiveUi(tab);
    }
  });

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
    logHistory(currentUrl, view.webContents.getTitle());
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
                  
                  const hasAdClass = Array.from(parent.classList).some(cls => 
                    cls.toLowerCase().includes('ad') || 
                    cls.toLowerCase().includes('commercial') || 
                    cls === 'uEerd'
                  );
                  
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

function logHistory(url, title) {
  // Do not log history for incognito or orbit internal urls
  if (activeTabId && tabs.has(activeTabId)) {
    const tab = tabs.get(activeTabId);
    if (tab.isIncognito) return;
  }

  if (!url || url.startsWith('file://') || url.includes('newtab.html')) return;

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
  if (mainWindow) {
    mainWindow.webContents.send('history-data', db.history);
  }
}

// IPC Channel Handlers
ipcMain.on('create-tab', (event, { id, url, isIncognito }) => {
  createTab(id, url, isIncognito);
});

ipcMain.on('switch-tab', (event, tabId) => {
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
  }
});

ipcMain.on('close-tab', (event, tabId) => {
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
  }
});

ipcMain.on('navigate-tab', (event, { id, url }) => {
  if (tabs.has(id)) {
    const tab = tabs.get(id);
    navigateTab(tab, url);
  }
});

ipcMain.on('back-tab', (event, tabId) => {
  if (tabs.has(tabId)) {
    const tab = tabs.get(tabId);
    if (tab.view.webContents.canGoBack()) {
      tab.view.webContents.goBack();
    }
  }
});

ipcMain.on('forward-tab', (event, tabId) => {
  if (tabs.has(tabId)) {
    const tab = tabs.get(tabId);
    if (tab.view.webContents.canGoForward()) {
      tab.view.webContents.goForward();
    }
  }
});

ipcMain.on('reload-tab', (event, tabId) => {
  if (tabs.has(tabId)) {
    const tab = tabs.get(tabId);
    tab.view.webContents.reload();
  }
});

// History & Bookmarks IPCs
ipcMain.on('get-history', (event) => {
  event.reply('history-data', db.history);
});

ipcMain.on('clear-history', (event) => {
  db.history = [];
  saveDb();
  event.reply('history-data', db.history);
});

ipcMain.on('get-bookmarks', (event) => {
  event.reply('bookmarks-data', db.bookmarks);
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

ipcMain.on('save-settings', (event, settings) => {
  db.settings = { ...db.settings, ...settings };
  saveDb();
  event.reply('settings-data', db.settings);
  if (mainWindow && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('settings-data', db.settings);
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

ipcMain.on('get-downloads', (event) => {
  event.reply('downloads-data', db.downloads || []);
});

ipcMain.on('clear-downloads', (event) => {
  db.downloads = [];
  saveDb();
  event.reply('downloads-data', []);
});

ipcMain.on('pause-download', (event, id) => {
  const item = activeDownloads.get(id);
  if (item) {
    item.pause();
  }
});

ipcMain.on('resume-download', (event, id) => {
  const item = activeDownloads.get(id);
  if (item) {
    item.resume();
  }
});

ipcMain.on('cancel-download', (event, id) => {
  const item = activeDownloads.get(id);
  if (item) {
    item.cancel();
  }
});

ipcMain.on('open-download', (event, filePath) => {
  if (!filePath) return;
  const { shell } = require('electron');
  shell.openPath(filePath).catch(err => {
    console.error('Failed to open download file:', err);
  });
});

ipcMain.on('show-download-in-folder', (event, filePath) => {
  if (!filePath) return;
  const { shell } = require('electron');
  shell.showItemInFolder(filePath);
});

ipcMain.on('log-to-main', (event, msg) => {
  console.log('[renderer]', msg);
  try {
    fs.appendFileSync('c:\\Users\\pouru\\OneDrive\\Desktop\\Project\\browser\\orbit-error.log', `[renderer] ${msg}\n`);
  } catch (e) {}
});
