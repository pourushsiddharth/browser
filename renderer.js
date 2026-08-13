// Orbit Browser Renderer Script

// State
const tabs = new Map(); // tabId -> { id, url, title, isLoading, canGoBack, canGoForward, favicon, isIncognito, blockedCount, blockedTrackers: [] }
let activeTabId = null;
let historyData = [];
let bookmarksData = [];
let settingsData = { adBlockEnabled: true, homepage: 'orbit://newtab' };
let isChromeCollapsed = false;
let isFirstTabSpawned = false;

// Sidebar Panels & Header back button
const panelControlCenter = document.getElementById('panel-control-center');
const panelShield = document.getElementById('panel-shield');
const btnSidebarBack = document.getElementById('btn-sidebar-back');

// Sidebar Control Center elements
const sidebarToggleImmersive = document.getElementById('sidebar-toggle-immersive');
const sidebarToggleReader = document.getElementById('sidebar-toggle-reader');
const sidebarToggleCollapseChrome = document.getElementById('sidebar-toggle-collapse-chrome');
const sidebarBtnBookmarks = document.getElementById('sidebar-btn-bookmarks');
const sidebarBtnHistory = document.getElementById('sidebar-btn-history');
const sidebarBtnSettings = document.getElementById('sidebar-btn-settings');

// Sidebar Shield elements
const sidebarShieldToggle = document.getElementById('sidebar-shield-toggle');
const sidebarBlockedCountLabel = document.getElementById('sidebar-blocked-count');
const sidebarTrackersList = document.getElementById('sidebar-trackers-list');

// DOM Elements
const btnMinimize = document.getElementById('btn-minimize');
const btnMaximize = document.getElementById('btn-maximize');
const btnClose = document.getElementById('btn-close');

const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const btnReload = document.getElementById('btn-reload');
const btnHome = document.getElementById('btn-home');

const addressContainer = document.getElementById('address-container');
const addressBar = document.getElementById('address-bar');
const adblockShield = document.getElementById('adblock-shield');
const blockedCountBadge = document.getElementById('blocked-count-badge');
const btnBookmark = document.getElementById('btn-bookmark');

// Control Center elements
const btnControlCenter = document.getElementById('btn-control-center');
const chromeHoverSensor = document.getElementById('chrome-hover-sensor');
const browserChrome = document.getElementById('browser-chrome');

const tabsList = document.getElementById('tabs-list');
const btnNewTab = document.getElementById('btn-new-tab');
const btnNewIncognitoTab = document.getElementById('btn-new-incognito-tab');
const bookmarksBarList = document.getElementById('bookmarks-list');

const sidebar = document.getElementById('sidebar');
const sidebarTitle = document.getElementById('sidebar-title');
const btnCloseSidebar = document.getElementById('btn-close-sidebar');
const panelHistory = document.getElementById('panel-history');
const panelBookmarks = document.getElementById('panel-bookmarks');
const panelSettings = document.getElementById('panel-settings');
const historyItemsList = document.getElementById('history-items-list');
const bookmarksItemsList = document.getElementById('bookmarks-items-list');
const btnClearHistory = document.getElementById('btn-clear-history');
const btnDownloadsNav = document.getElementById('btn-downloads-nav');
const downloadsBadge = document.getElementById('downloads-badge');
const sidebarBtnDownloads = document.getElementById('sidebar-btn-downloads');
const panelDownloads = document.getElementById('panel-downloads');
const downloadsItemsList = document.getElementById('downloads-items-list');
const btnClearDownloads = document.getElementById('btn-clear-downloads');
let downloadsData = [];
const toggleAdblockSetting = document.getElementById('toggle-adblock-setting');
const selectSearchEngine = document.getElementById('select-search-engine');

let globalBlockedCount = 0;

// --- Helper Functions ---

// Generate Unique Tab ID
function generateTabId() {
  return 'tab-' + Math.random().toString(36).substr(2, 9);
}

// Format/Clean Display URL (e.g. hide https:// and trailings)
function getFriendlyUrl(urlString) {
  if (!urlString || urlString.startsWith('orbit://') || urlString.startsWith('file://')) {
    return 'orbit://newtab';
  }
  try {
    const url = new URL(urlString);
    let friendly = url.hostname;
    if (url.pathname && url.pathname !== '/') {
      friendly += url.pathname;
    }
    if (friendly.startsWith('www.')) {
      friendly = friendly.substring(4);
    }
    return friendly;
  } catch (e) {
    return urlString;
  }
}

// Create & Switch Tab
function createNewTab(url = 'orbit://newtab', isIncognito = false) {
  const tabId = generateTabId();
  tabs.set(tabId, {
    id: tabId,
    url: url,
    title: 'New Tab',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    isIncognito: isIncognito,
    blockedCount: 0,
    blockedTrackers: [],
    readerModeEnabled: false,
    adBlockEnabled: settingsData.adBlockEnabled
  });

  api.send('create-tab', { id: tabId, url, isIncognito });
  api.send('switch-tab', tabId);
  renderTabs();
}

// Render Tabs in the Chrome UI
function renderTabs() {
  tabsList.innerHTML = '';
  
  tabs.forEach((tab) => {
    const tabEl = document.createElement('div');
    tabEl.className = `tab ${tab.id === activeTabId ? 'active' : ''} ${tab.isIncognito ? 'incognito' : ''}`;
    tabEl.id = `ui-${tab.id}`;
    tabEl.setAttribute('draggable', 'true');
    
    // Click events
    tabEl.addEventListener('click', (e) => {
      // Don't switch if clicking the close button
      if (e.target.closest('.tab-close')) return;
      switchTab(tab.id);
    });

    // Drag and Drop reordering events
    tabEl.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', tab.id);
      tabEl.classList.add('dragging');
    });

    tabEl.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    tabEl.addEventListener('drop', (e) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData('text/plain');
      if (draggedId && draggedId !== tab.id) {
        const tabKeys = Array.from(tabs.keys());
        const fromIdx = tabKeys.indexOf(draggedId);
        const toIdx = tabKeys.indexOf(tab.id);
        
        if (fromIdx !== -1 && toIdx !== -1) {
          tabKeys.splice(fromIdx, 1);
          tabKeys.splice(toIdx, 0, draggedId);
          
          const temp = new Map(tabs);
          tabs.clear();
          tabKeys.forEach(key => {
            tabs.set(key, temp.get(key));
          });
          
          renderTabs();
        }
      }
    });

    tabEl.addEventListener('dragend', () => {
      tabEl.classList.remove('dragging');
    });

    // Favicon or Fallback
    let faviconHtml = '';
    if (tab.isIncognito) {
      // Spy sunglasses icon for Incognito favicon fallback
      faviconHtml = `
        <div class="tab-favicon-fallback">
          <svg viewBox="0 0 24 24" width="10" height="10">
            <circle cx="6" cy="12" r="3" fill="currentColor"/>
            <circle cx="18" cy="12" r="3" fill="currentColor"/>
            <path d="M6 15c2.5 0 3-2 6-2s3.5 2 6 2M12 9l2-3M12 9l-2-3" stroke="currentColor" stroke-width="1.5"/>
          </svg>
        </div>
      `;
    } else if (tab.favicon) {
      faviconHtml = `<img class="tab-favicon" src="${tab.favicon}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">`;
      // hidden fallback inside
      faviconHtml += `
        <div class="tab-favicon-fallback" style="display:none">
          <svg viewBox="0 0 24 24" width="10" height="10">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" fill="none" stroke="currentColor" stroke-width="1.5"/>
          </svg>
        </div>
      `;
    } else {
      faviconHtml = `
        <div class="tab-favicon-fallback">
          <svg viewBox="0 0 24 24" width="10" height="10">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" fill="none" stroke="currentColor" stroke-width="1.5"/>
          </svg>
        </div>
      `;
    }

    // Title
    const titleEl = document.createElement('span');
    titleEl.className = 'tab-title';
    titleEl.textContent = tab.title || 'New Tab';
    
    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.innerHTML = `
      <svg viewBox="0 0 8 8" width="8" height="8">
        <path d="M1.5,1.5 L6.5,6.5 M6.5,1.5 L1.5,6.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
    `;
    closeBtn.title = 'Close tab';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });

    tabEl.appendChild(document.createRange().createContextualFragment(faviconHtml));
    tabEl.appendChild(titleEl);
    tabEl.appendChild(closeBtn);
    
    tabsList.appendChild(tabEl);
  });
}

function switchTab(tabId) {
  if (tabId === activeTabId) return;
  activeTabId = tabId;
  api.send('switch-tab', tabId);
  renderTabs();
  updateToolbar();
}

function closeTab(tabId) {
  const tabKeys = Array.from(tabs.keys());
  const closingIdx = tabKeys.indexOf(tabId);
  
  api.send('close-tab', tabId);
  tabs.delete(tabId);

  // If we closed the active tab, find a new one to focus
  if (activeTabId === tabId) {
    if (tabs.size > 0) {
      // Pick previous tab or next tab
      const nextActiveIdx = Math.max(0, closingIdx - 1);
      const newActiveId = Array.from(tabs.keys())[nextActiveIdx];
      switchTab(newActiveId);
    } else {
      // Closed all tabs, create a fresh one
      activeTabId = null;
      createNewTab();
    }
  } else {
    renderTabs();
  }
}

// Update Address/Navigation Bar Controls based on Active Tab
function updateToolbar() {
  if (!activeTabId || !tabs.has(activeTabId)) return;
  const tab = tabs.get(activeTabId);

  // Navigation button states
  btnBack.disabled = !tab.canGoBack;
  btnForward.disabled = !tab.canGoForward;
  
  // Reload button spinner reset
  if (tab.isLoading) {
    btnReload.classList.add('loading-spin');
  } else {
    btnReload.classList.remove('loading-spin');
  }

  // Address Bar text (don't overwrite if user is actively writing)
  if (document.activeElement !== addressBar) {
    addressBar.value = tab.url === 'orbit://newtab' ? '' : tab.url;
  }

  // Bookmark Button state
  const isBookmarked = bookmarksData.some(b => b.url === tab.url);
  if (isBookmarked) {
    btnBookmark.classList.add('active');
  } else {
    btnBookmark.classList.remove('active');
  }

  // Shield & Block Count state
  blockedCountBadge.textContent = tab.blockedCount || 0;
  if (tab.adBlockEnabled) {
    adblockShield.classList.remove('disabled');
  } else {
    adblockShield.classList.add('disabled');
  }

  // Control Center & Reader Mode state sync
  const isImmersive = document.body.classList.contains('immersive-mode');
  sidebarToggleReader.checked = tab.readerModeEnabled || false;
  sidebarToggleImmersive.checked = isImmersive;
  sidebarToggleCollapseChrome.checked = isChromeCollapsed;
  sidebarShieldToggle.checked = tab.adBlockEnabled;

  if (tab.readerModeEnabled || isImmersive || isChromeCollapsed) {
    btnControlCenter.classList.add('active');
  } else {
    btnControlCenter.classList.remove('active');
  }
}

// Sidebar panel switching
function toggleSidebar(panelName) {
  const isHidden = sidebar.classList.contains('sidebar-hidden');
  
  // Hide all panels first
  panelHistory.classList.remove('active');
  panelBookmarks.classList.remove('active');
  panelSettings.classList.remove('active');
  panelControlCenter.classList.remove('active');
  panelShield.classList.remove('active');
  panelDownloads.classList.remove('active');

  let targetPanel;
  if (panelName === 'history') {
    sidebarTitle.textContent = 'History';
    targetPanel = panelHistory;
    api.send('get-history');
  } else if (panelName === 'bookmarks') {
    sidebarTitle.textContent = 'Bookmarks';
    targetPanel = panelBookmarks;
    api.send('get-bookmarks');
  } else if (panelName === 'settings') {
    sidebarTitle.textContent = 'Settings';
    targetPanel = panelSettings;
    api.send('get-settings');
  } else if (panelName === 'control-center') {
    sidebarTitle.textContent = 'Control Center';
    targetPanel = panelControlCenter;
  } else if (panelName === 'shield') {
    sidebarTitle.textContent = 'Orbit Shield';
    targetPanel = panelShield;
    if (activeTabId && tabs.has(activeTabId)) {
      const tab = tabs.get(activeTabId);
      sidebarBlockedCountLabel.textContent = tab.blockedCount || 0;
      renderShieldSidebarContent(tab);
    }
  } else if (panelName === 'downloads') {
    sidebarTitle.textContent = 'Downloads';
    targetPanel = panelDownloads;
    api.send('get-downloads');
  }

  if (targetPanel) targetPanel.classList.add('active');

  // If sidebar is hidden, open it.
  // If already open with the same panel, toggle close.
  // If already open but with a different panel, just keep it open.
  const activePanelTitle = sidebarTitle.dataset.activePanel;
  let newHiddenState = isHidden;
  if (isHidden) {
    sidebar.classList.remove('sidebar-hidden');
    document.body.classList.add('sidebar-open');
    sidebarTitle.dataset.activePanel = panelName;
    newHiddenState = false;
  } else if (activePanelTitle === panelName) {
    sidebar.classList.add('sidebar-hidden');
    document.body.classList.remove('sidebar-open');
    sidebarTitle.dataset.activePanel = '';
    newHiddenState = true;
  } else {
    sidebarTitle.dataset.activePanel = panelName;
    newHiddenState = false;
  }
  
  // Toggle visibility of the back button
  if (panelName === 'control-center') {
    btnSidebarBack.style.display = 'none';
  } else {
    btnSidebarBack.style.display = 'flex';
  }

  // Notify main process to resize tab
  api.send('sidebar-toggle', !newHiddenState);

  // Update solid icons status
  updateSidebarButtonStates();
}

function updateSidebarButtonStates() {
  // No-op (consolidated toolbar)
}

// Render Sidebar lists
function renderHistory(history) {
  historyData = history;
  historyItemsList.innerHTML = '';

  if (history.length === 0) {
    historyItemsList.innerHTML = '<div class="empty-list-msg" style="color: var(--text-muted); font-size:11px; padding:20px; text-align:center;">No history recorded yet.</div>';
    return;
  }

  history.forEach(item => {
    const itemEl = document.createElement('div');
    itemEl.className = 'list-item';
    
    // Format timestamp
    const date = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    itemEl.innerHTML = `
      <div class="list-item-details">
        <span class="list-item-title" title="${item.title}">${item.title}</span>
        <span class="list-item-url" title="${item.url}">${date} &bull; ${getFriendlyUrl(item.url)}</span>
      </div>
    `;

    itemEl.addEventListener('click', () => {
      if (activeTabId) {
        api.send('navigate-tab', { id: activeTabId, url: item.url });
      }
    });

    historyItemsList.appendChild(itemEl);
  });
}

function renderBookmarks(bookmarks) {
  bookmarksData = bookmarks;
  
  if (bookmarks.length > 0) {
    document.body.classList.add('has-bookmarks');
  } else {
    document.body.classList.remove('has-bookmarks');
  }
  
  // Render Sidebar
  bookmarksItemsList.innerHTML = '';
  if (bookmarks.length === 0) {
    bookmarksItemsList.innerHTML = '<div class="empty-list-msg" style="color: var(--text-muted); font-size:11px; padding:20px; text-align:center;">No bookmarks saved yet.</div>';
  } else {
    bookmarks.forEach(item => {
      let faviconUrl = '';
      try {
        const urlObj = new URL(item.url);
        faviconUrl = `https://www.google.com/s2/favicons?sz=32&domain=${urlObj.hostname}`;
      } catch (e) {
        faviconUrl = `https://www.google.com/s2/favicons?sz=32&domain=${item.url}`;
      }

      const cardEl = document.createElement('div');
      cardEl.className = 'bookmark-card';
      cardEl.innerHTML = `
        <button class="bookmark-card-remove" title="Remove bookmark">
          <svg viewBox="0 0 10 10" width="10" height="10">
            <path d="M1,1 L9,9 M9,1 L1,9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </button>
        <div class="bookmark-card-info">
          <div class="bookmark-card-favicon">
            <img src="${faviconUrl}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
            <svg style="display:none" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" fill="none" stroke="currentColor" stroke-width="1.5"/>
            </svg>
          </div>
          <div class="bookmark-card-details">
            <span class="bookmark-card-title" title="${item.title}">${item.title}</span>
            <span class="bookmark-card-url" title="${item.url}">${getFriendlyUrl(item.url)}</span>
          </div>
        </div>
      `;

      cardEl.addEventListener('click', (e) => {
        if (e.target.closest('.bookmark-card-remove')) {
          e.stopPropagation();
          api.send('remove-bookmark', item.url);
        } else if (activeTabId) {
          api.send('navigate-tab', { id: activeTabId, url: item.url });
        }
      });

      cardEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        api.send('show-bookmark-context-menu', { url: item.url });
      });

      bookmarksItemsList.appendChild(cardEl);
    });
  }

  // Render horizontal Quick Bookmarks bar
  bookmarksBarList.innerHTML = '';
  bookmarks.slice(0, 10).forEach(item => {
    let faviconUrl = '';
    try {
      const urlObj = new URL(item.url);
      faviconUrl = `https://www.google.com/s2/favicons?sz=32&domain=${urlObj.hostname}`;
    } catch (e) {
      faviconUrl = `https://www.google.com/s2/favicons?sz=32&domain=${item.url}`;
    }

    const itemEl = document.createElement('div');
    itemEl.className = 'bookmark-item';
    itemEl.innerHTML = `
      <img class="bookmark-favicon" src="${faviconUrl}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
      <!-- Fallback globe icon -->
      <svg style="display:none" class="bookmark-favicon" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" fill="none" stroke="currentColor" stroke-width="1.5"/>
      </svg>
      <span>${item.title.substring(0, 15)}${item.title.length > 15 ? '...' : ''}</span>
    `;

    itemEl.addEventListener('click', () => {
      if (activeTabId) {
        api.send('navigate-tab', { id: activeTabId, url: item.url });
      }
    });

    itemEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      api.send('show-bookmark-context-menu', { url: item.url });
    });

    bookmarksBarList.appendChild(itemEl);
  });

  // Refresh active bookmark star status
  updateToolbar();
}

function renderDownloads(downloads) {
  downloadsData = downloads;
  downloadsItemsList.innerHTML = '';

  const activeCount = downloads.filter(d => d.status === 'progressing').length;
  if (activeCount > 0) {
    downloadsBadge.textContent = activeCount;
    downloadsBadge.className = 'downloads-badge-visible';
  } else {
    downloadsBadge.className = 'downloads-badge-hidden';
  }

  if (downloads.length === 0) {
    downloadsItemsList.innerHTML = '<div class="empty-list-msg" style="color: var(--text-muted); font-size:11px; padding:20px; text-align:center;">No downloads yet.</div>';
    return;
  }

  downloads.forEach(item => {
    const itemEl = document.createElement('div');
    itemEl.className = 'list-item download-item';

    const received = formatBytes(item.receivedBytes);
    const total = formatBytes(item.totalBytes);
    
    let statusText = '';
    let isProgressing = item.status === 'progressing';
    let progressPercent = 0;
    
    if (item.totalBytes > 0) {
      progressPercent = Math.round((item.receivedBytes / item.totalBytes) * 100);
    }
    
    if (item.status === 'progressing') {
      statusText = `${progressPercent}% &bull; ${received} of ${total}`;
    } else if (item.status === 'completed') {
      statusText = `Completed &bull; ${total}`;
    } else if (item.status === 'cancelled') {
      statusText = `Cancelled &bull; ${received}`;
    } else if (item.status === 'failed') {
      statusText = `Failed`;
    } else if (item.status === 'interrupted') {
      statusText = `Paused &bull; ${received} of ${total}`;
    }

    const friendlyDate = new Date(item.date).toLocaleDateString([], { month: 'short', day: 'numeric' });

    itemEl.innerHTML = `
      <div class="list-item-details" style="width: 100%; display: flex; flex-direction: column; gap: 4px;">
        <div style="display:flex; justify-content:space-between; align-items:center; width: 100%;">
          <span class="list-item-title" title="${item.filename}" style="font-weight: 500; font-size: 12px; color: var(--text-dark); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 180px;">${item.filename}</span>
          <span style="font-size: 10px; color: var(--text-muted);">${friendlyDate}</span>
        </div>
        <span class="list-item-url" style="font-size: 10px; color: var(--text-muted); word-break: break-all;">${statusText}</span>
        
        ${isProgressing ? `
          <div class="download-progress-container" style="width: 100%; height: 4px; background-color: rgba(0,0,0,0.05); border-radius: 2px; margin-top: 4px; overflow: hidden;">
            <div class="download-progress-bar" style="width: ${progressPercent}%; height: 100%; background: linear-gradient(135deg, var(--accent-color), #3b82f6); transition: width 0.15s ease;"></div>
          </div>
        ` : ''}

        <div class="download-actions" style="display: flex; gap: 8px; margin-top: 6px; align-items: center;">
          ${item.status === 'progressing' ? `
            <button class="dl-action-btn secondary dl-pause-btn" data-id="${item.id}">Pause</button>
            <button class="dl-action-btn secondary dl-cancel-btn" data-id="${item.id}">Cancel</button>
          ` : ''}
          ${item.status === 'interrupted' ? `
            <button class="dl-action-btn primary dl-resume-btn" data-id="${item.id}">Resume</button>
            <button class="dl-action-btn secondary dl-cancel-btn" data-id="${item.id}">Cancel</button>
          ` : ''}
          ${item.status === 'completed' ? `
            <button class="dl-action-btn primary dl-open-btn" data-path="${item.savePath}">Open</button>
            <button class="dl-action-btn secondary dl-show-btn" data-path="${item.savePath}">Folder</button>
          ` : ''}
        </div>
      </div>
    `;

    const pauseBtn = itemEl.querySelector('.dl-pause-btn');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        api.send('pause-download', item.id);
      });
    }

    const cancelBtn = itemEl.querySelector('.dl-cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        api.send('cancel-download', item.id);
      });
    }

    const resumeBtn = itemEl.querySelector('.dl-resume-btn');
    if (resumeBtn) {
      resumeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        api.send('resume-download', item.id);
      });
    }

    const openBtn = itemEl.querySelector('.dl-open-btn');
    if (openBtn) {
      openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        api.send('open-download', item.savePath);
      });
    }

    const showBtn = itemEl.querySelector('.dl-show-btn');
    if (showBtn) {
      showBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        api.send('show-download-in-folder', item.savePath);
      });
    }

    downloadsItemsList.appendChild(itemEl);
  });
}

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// --- IPC Listeners (events from main) ---

api.on('tab-created', ({ id, url, isIncognito }) => {
  tabs.set(id, {
    id,
    url,
    title: 'New Tab',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    isIncognito,
    blockedCount: 0,
    blockedTrackers: [],
    readerModeEnabled: false
  });
  switchTab(id);
});

api.on('tab-updated', (updatedData) => {
  if (tabs.has(updatedData.id)) {
    const oldTab = tabs.get(updatedData.id);
    const merged = { ...oldTab, ...updatedData };
    tabs.set(updatedData.id, merged);
    
    // Re-render UI list
    renderTabs();
    
    if (activeTabId === updatedData.id) {
      updateToolbar();
    }
  }
});

api.on('tab-focused', (tabId) => {
  activeTabId = tabId;
  renderTabs();
  updateToolbar();
});

api.on('tab-closed', (tabId) => {
  closeTab(tabId);
});

api.on('tab-created-external', ({ url, isIncognito }) => {
  createNewTab(url, isIncognito);
});

api.on('history-data', (history) => {
  renderHistory(history);
});

api.on('bookmarks-data', (bookmarks) => {
  renderBookmarks(bookmarks);
});

api.on('download-started', (download) => {
  api.send('get-downloads');
  toggleSidebar('downloads');
});

api.on('download-updated', (update) => {
  const item = downloadsData.find(d => d.id === update.id);
  if (item) {
    item.receivedBytes = update.receivedBytes;
    item.status = update.status;
    if (update.savePath) item.savePath = update.savePath;
    renderDownloads(downloadsData);
  } else {
    api.send('get-downloads');
  }
});

api.on('download-done', (download) => {
  api.send('get-downloads');
});

api.on('downloads-data', (downloads) => {
  renderDownloads(downloads);
});

function applyTheme(theme) {
  if (!theme) return;
  const root = document.documentElement;
  
  if (theme.type === 'preset') {
    const presets = {
      light: {
        '--bg-primary': '#ffffff',
        '--bg-secondary': '#f3f4f6',
        '--bg-tertiary': '#e5e7eb',
        '--bg-active': '#d1d5db',
        '--bg-sidebar': 'rgba(255, 255, 255, 0.85)',
        '--text-primary': '#1f2937',
        '--text-secondary': '#4b5563',
        '--text-muted': '#9ca3af',
        '--accent-color': '#7c3aed',
        '--accent-hover': '#6d28d9',
        '--accent-muted': 'rgba(124, 58, 237, 0.15)',
        '--address-bar-bg': '#f3f4f6',
        '--icons-color': '#4b5563',
        '--border-color': 'rgba(0, 0, 0, 0.08)'
      },
      dark: {
        '--bg-primary': '#0f172a',
        '--bg-secondary': '#1e293b',
        '--bg-tertiary': '#334155',
        '--bg-active': '#475569',
        '--bg-sidebar': 'rgba(30, 41, 59, 0.85)',
        '--text-primary': '#f8fafc',
        '--text-secondary': '#cbd5e1',
        '--text-muted': '#64748b',
        '--accent-color': '#38bdf8',
        '--accent-hover': '#0ea5e9',
        '--accent-muted': 'rgba(56, 189, 248, 0.15)',
        '--address-bar-bg': '#0f172a',
        '--icons-color': '#cbd5e1',
        '--border-color': 'rgba(255, 255, 255, 0.08)'
      },
      sakura: {
        '--bg-primary': '#fff5f7',
        '--bg-secondary': '#ffe4e6',
        '--bg-tertiary': '#fecdd3',
        '--bg-active': '#fda4af',
        '--bg-sidebar': 'rgba(255, 228, 230, 0.85)',
        '--text-primary': '#4c0519',
        '--text-secondary': '#881337',
        '--text-muted': '#fb7185',
        '--accent-color': '#db2777',
        '--accent-hover': '#be185d',
        '--accent-muted': 'rgba(219, 39, 119, 0.15)',
        '--address-bar-bg': '#fff1f2',
        '--icons-color': '#881337',
        '--border-color': 'rgba(219, 39, 119, 0.1)'
      },
      cyberpunk: {
        '--bg-primary': '#0b0c10',
        '--bg-secondary': '#1f2833',
        '--bg-tertiary': '#2d3748',
        '--bg-active': '#45f3ff',
        '--bg-sidebar': 'rgba(31, 40, 51, 0.85)',
        '--text-primary': '#00ffcc',
        '--text-secondary': '#66fcf1',
        '--text-muted': '#c5c6c7',
        '--accent-color': '#ff007f',
        '--accent-hover': '#ff3399',
        '--accent-muted': 'rgba(255, 0, 127, 0.15)',
        '--address-bar-bg': '#0b0c10',
        '--icons-color': '#66fcf1',
        '--border-color': 'rgba(0, 255, 204, 0.15)'
      },
      forest: {
        '--bg-primary': '#f0fdf4',
        '--bg-secondary': '#dcfce7',
        '--bg-tertiary': '#bbf7d0',
        '--bg-active': '#86efac',
        '--bg-sidebar': 'rgba(220, 252, 231, 0.85)',
        '--text-primary': '#14532d',
        '--text-secondary': '#166534',
        '--text-muted': '#4ade80',
        '--accent-color': '#059669',
        '--accent-hover': '#047857',
        '--accent-muted': 'rgba(5, 150, 105, 0.15)',
        '--address-bar-bg': '#f0fdf4',
        '--icons-color': '#166534',
        '--border-color': 'rgba(5, 150, 105, 0.1)'
      },
      gold: {
        '--bg-primary': '#fafaf9',
        '--bg-secondary': '#f5f5f4',
        '--bg-tertiary': '#e7e5e4',
        '--bg-active': '#d6d3d1',
        '--bg-sidebar': 'rgba(245, 245, 244, 0.85)',
        '--text-primary': '#1c1917',
        '--text-secondary': '#44403c',
        '--text-muted': '#a8a29e',
        '--accent-color': '#d97706',
        '--accent-hover': '#b45309',
        '--accent-muted': 'rgba(217, 119, 6, 0.15)',
        '--address-bar-bg': '#fafaf9',
        '--icons-color': '#44403c',
        '--border-color': 'rgba(217, 119, 6, 0.1)'
      }
    };
    
    const preset = presets[theme.presetName] || presets.light;
    Object.keys(preset).forEach(key => {
      root.style.setProperty(key, preset[key]);
    });
  } else if (theme.type === 'custom' && theme.customColors) {
    const c = theme.customColors;
    root.style.setProperty('--bg-primary', c.bgPrimary);
    root.style.setProperty('--bg-secondary', c.bgChrome);
    root.style.setProperty('--bg-tertiary', adjustBrightness(c.bgChrome, -10));
    root.style.setProperty('--bg-active', adjustBrightness(c.bgChrome, -20));
    root.style.setProperty('--bg-sidebar', hexToRgba(c.bgChrome, 0.85));
    root.style.setProperty('--text-primary', c.text);
    root.style.setProperty('--text-secondary', adjustBrightness(c.text, 20));
    root.style.setProperty('--text-muted', adjustBrightness(c.text, 40));
    root.style.setProperty('--accent-color', c.accent);
    root.style.setProperty('--accent-hover', adjustBrightness(c.accent, -15));
    root.style.setProperty('--accent-muted', hexToRgba(c.accent, 0.15));
    root.style.setProperty('--address-bar-bg', c.searchBg || c.bgPrimary);
    root.style.setProperty('--icons-color', c.icons || adjustBrightness(c.text, 10));
    root.style.setProperty('--border-color', hexToRgba(c.text, 0.1));
  }
}

function adjustBrightness(hex, percent) {
  if (!hex || hex[0] !== '#') return hex;
  let R = parseInt(hex.substring(1, 3), 16) || 0;
  let G = parseInt(hex.substring(3, 5), 16) || 0;
  let B = parseInt(hex.substring(5, 7), 16) || 0;

  R = parseInt(R * (100 + percent) / 100);
  G = parseInt(G * (100 + percent) / 100);
  B = parseInt(B * (100 + percent) / 100);

  R = (R < 255) ? R : 255;
  G = (G < 255) ? G : 255;
  B = (B < 255) ? B : 255;

  R = (R > 0) ? R : 0;
  G = (G > 0) ? G : 0;
  B = (B > 0) ? B : 0;

  const rHex = R.toString(16).padStart(2, '0');
  const gHex = G.toString(16).padStart(2, '0');
  const bHex = B.toString(16).padStart(2, '0');

  return `#${rHex}${gHex}${bHex}`;
}

function hexToRgba(hex, alpha) {
  if (!hex || hex[0] !== '#') return hex;
  const R = parseInt(hex.substring(1, 3), 16) || 0;
  const G = parseInt(hex.substring(3, 5), 16) || 0;
  const B = parseInt(hex.substring(5, 7), 16) || 0;
  return `rgba(${R}, ${G}, ${B}, ${alpha})`;
}

api.on('settings-data', (settings) => {
  settingsData = settings;
  toggleAdblockSetting.checked = settings.adBlockEnabled;
  sidebarShieldToggle.checked = settings.adBlockEnabled;
  if (settings.globalBlockedCount !== undefined) {
    globalBlockedCount = settings.globalBlockedCount;
  }
  if (settings.theme) {
    applyTheme(settings.theme);
  }
  
  if (!isFirstTabSpawned) {
    isFirstTabSpawned = true;
    createNewTab();
  } else {
    updateToolbar();
  }
});

api.on('tab-trackers-updated', ({ tabId, blockedCount, blockedTrackers }) => {
  if (tabs.has(tabId)) {
    const tab = tabs.get(tabId);
    tab.blockedCount = blockedCount;
    tab.blockedTrackers = blockedTrackers;
    
    if (activeTabId === tabId) {
      blockedCountBadge.textContent = blockedCount;
      sidebarBlockedCountLabel.textContent = blockedCount;
      
      // Live-update list if sidebar shield panel is open
      if (sidebarTitle.dataset.activePanel === 'shield') {
        renderShieldSidebarContent(tab);
      }
    }
  }
});

api.on('reader-mode-updated', ({ tabId, readerModeEnabled }) => {
  if (tabs.has(tabId)) {
    tabs.get(tabId).readerModeEnabled = readerModeEnabled;
    if (activeTabId === tabId) {
      updateToolbar();
    }
  }
});

api.on('immersive-mode-updated', ({ tabId, isImmersiveMode }) => {
  if (isImmersiveMode) {
    document.body.classList.add('immersive-mode');
  } else {
    document.body.classList.remove('immersive-mode');
  }
  updateToolbar();
});

api.on('collapse-chrome-updated', (collapsed) => {
  isChromeCollapsed = collapsed;
  if (isChromeCollapsed) {
    document.body.classList.add('chrome-collapsed');
  } else {
    document.body.classList.remove('chrome-collapsed');
    document.body.classList.remove('chrome-hovered');
  }
  updateToolbar();
});

api.on('blocked-count', ({ tabId, count, globalCount }) => {
  if (tabs.has(tabId)) {
    tabs.get(tabId).blockedCount = count;
  }
  if (globalCount !== undefined) {
    globalBlockedCount = globalCount;
  }
  if (activeTabId === tabId) {
    blockedCountBadge.textContent = count;
  }
});

api.on('update-address', ({ id, url }) => {
  if (tabs.has(id)) {
    tabs.get(id).url = url;
  }
  if (activeTabId === id && document.activeElement !== addressBar) {
    addressBar.value = url === 'orbit://newtab' ? '' : url;
  }
});

// --- UI Event Bindings ---

// Window actions
btnMinimize.addEventListener('click', () => api.send('window-minimize'));
btnMaximize.addEventListener('click', () => api.send('window-maximize'));
btnClose.addEventListener('click', () => api.send('window-close'));

// Navigation controls
btnBack.addEventListener('click', () => api.send('back-tab', activeTabId));
btnForward.addEventListener('click', () => api.send('forward-tab', activeTabId));
btnReload.addEventListener('click', () => api.send('reload-tab', activeTabId));
btnHome.addEventListener('click', () => {
  if (activeTabId) {
    api.send('navigate-tab', { id: activeTabId, url: 'orbit://newtab' });
  }
});

// New tabs
btnNewTab.addEventListener('click', () => createNewTab('orbit://newtab', false));
btnNewIncognitoTab.addEventListener('click', () => createNewTab('orbit://newtab', true));

// Address Bar actions
addressBar.addEventListener('keydown', (e) => {
  const isSuggestionsOpen = !autocompleteDropdown.classList.contains('autocomplete-hidden');

  if (isSuggestionsOpen) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedSuggestionIndex = (selectedSuggestionIndex + 1) % currentSuggestions.length;
      updateSuggestionHighlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedSuggestionIndex = (selectedSuggestionIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
      updateSuggestionHighlight();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideSuggestions();
    } else if (e.key === 'Enter') {
      if (selectedSuggestionIndex !== -1) {
        e.preventDefault();
        const selected = currentSuggestions[selectedSuggestionIndex];
        navigateAddress(selected.url);
        hideSuggestions();
        return;
      }
    }
  }

  if (e.key === 'Enter') {
    let url = addressBar.value.trim();
    if (url && activeTabId) {
      // Check for search engine query construction
      if (!url.includes('.') && !url.startsWith('http') && !url.startsWith('file://')) {
        const queryEngine = selectSearchEngine.value;
        url = `${queryEngine}${encodeURIComponent(url)}`;
      }
      api.send('navigate-tab', { id: activeTabId, url });
      addressBar.blur();
      hideSuggestions();
    }
  }
});

addressBar.addEventListener('input', () => {
  showSuggestions(addressBar.value.trim());
});

addressBar.addEventListener('focus', () => {
  addressContainer.classList.add('focused');
  // Auto-select text on focus (like Chrome)
  setTimeout(() => addressBar.select(), 50);
});

addressBar.addEventListener('blur', () => {
  addressContainer.classList.remove('focused');
  // Restore current tab URL if not blanked
  if (!addressBar.value.trim() && activeTabId && tabs.has(activeTabId)) {
    const tab = tabs.get(activeTabId);
    addressBar.value = tab.url === 'orbit://newtab' ? '' : tab.url;
  }
});

// Sidebar navigation back button
btnSidebarBack.addEventListener('click', () => {
  toggleSidebar('control-center');
});

// Shield Adblocker popup overlay
adblockShield.addEventListener('click', (e) => {
  e.stopPropagation();
  const rect = adblockShield.getBoundingClientRect();
  api.send('toggle-shield-popup', {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height
  });
});

sidebarShieldToggle.addEventListener('change', () => {
  if (activeTabId) {
    api.send('toggle-adblock', { tabId: activeTabId });
  }
});

function renderShieldSidebarContent(tab) {
  sidebarTrackersList.innerHTML = '';
  
  const trackers = tab.blockedTrackers || [];
  if (trackers.length === 0) {
    sidebarTrackersList.innerHTML = '<div class="empty-popover-msg">Clean page. No trackers blocked!</div>';
    return;
  }
  
  trackers.forEach((tracker, idx) => {
    const row = document.createElement('div');
    row.className = 'tracker-row';
    row.style.setProperty('--i', idx); // CSS stagger variable
    
    // Get favicon from Google resolver (cleaner than local scraping)
    const faviconUrl = `https://www.google.com/s2/favicons?sz=32&domain=${tracker.hostname}&default=404`;
    
    row.innerHTML = `
      <div class="tracker-info">
        <img class="tracker-favicon" src="${faviconUrl}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
        <div class="tracker-favicon-fallback" style="display:none">
          ${tracker.hostname[0].toUpperCase()}
        </div>
        <span class="tracker-name" title="${tracker.hostname}">${tracker.hostname}</span>
      </div>
      <span class="blocked-badge" style="--i: ${idx}">Blocked</span>
    `;
    
    sidebarTrackersList.appendChild(row);
  });
}



// Bookmark star toggle
btnBookmark.addEventListener('click', () => {
  if (!activeTabId || !tabs.has(activeTabId)) return;
  const tab = tabs.get(activeTabId);
  const isBookmarked = bookmarksData.some(b => b.url === tab.url);
  
  if (isBookmarked) {
    api.send('remove-bookmark', tab.url);
  } else {
    api.send('add-bookmark', { url: tab.url, title: tab.title });
  }
});

btnControlCenter.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleSidebar('control-center');
});

sidebarToggleImmersive.addEventListener('change', () => {
  if (activeTabId) {
    api.send('toggle-immersive-mode', activeTabId);
  }
});

sidebarToggleReader.addEventListener('change', () => {
  if (activeTabId) {
    api.send('toggle-reader-mode', activeTabId);
  }
});

sidebarToggleCollapseChrome.addEventListener('change', () => {
  api.send('toggle-collapse-chrome');
});

// Hover reveal sensor handlers
let chromeHideTimeout = null;

chromeHoverSensor.addEventListener('mouseenter', () => {
  if (isChromeCollapsed) {
    document.body.classList.add('chrome-hovered');
    api.send('chrome-hover-status', true);
  }
});

browserChrome.addEventListener('mouseenter', () => {
  if (isChromeCollapsed) {
    if (chromeHideTimeout) {
      clearTimeout(chromeHideTimeout);
      chromeHideTimeout = null;
    }
    document.body.classList.add('chrome-hovered');
    api.send('chrome-hover-status', true);
  }
});

browserChrome.addEventListener('mouseleave', () => {
  if (isChromeCollapsed) {
    chromeHideTimeout = setTimeout(() => {
      document.body.classList.remove('chrome-hovered');
      api.send('chrome-hover-status', false);
    }, 350);
  }
});

sidebarBtnBookmarks.addEventListener('click', () => {
  toggleSidebar('bookmarks');
});

sidebarBtnHistory.addEventListener('click', () => {
  toggleSidebar('history');
});

sidebarBtnSettings.addEventListener('click', () => {
  toggleSidebar('settings');
});

btnDownloadsNav.addEventListener('click', () => {
  toggleSidebar('downloads');
});

sidebarBtnDownloads.addEventListener('click', () => {
  toggleSidebar('downloads');
});

btnClearDownloads.addEventListener('click', () => {
  if (confirm('Are you sure you want to clear your downloads log?')) {
    api.send('clear-downloads');
  }
});

btnCloseSidebar.addEventListener('click', () => {
  sidebar.classList.add('sidebar-hidden');
  document.body.classList.remove('sidebar-open');
  api.send('sidebar-toggle', false);
  updateSidebarButtonStates();
});

// Clear history action
btnClearHistory.addEventListener('click', () => {
  if (confirm('Are you sure you want to clear your local history?')) {
    api.send('clear-history');
  }
});

// Settings interactions
toggleAdblockSetting.addEventListener('change', () => {
  api.send('toggle-adblock', { global: true });
});

selectSearchEngine.addEventListener('change', () => {
  api.send('save-settings', { searchEngine: selectSearchEngine.value });
});



// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  // Request metadata
  api.send('get-history');
  api.send('get-bookmarks');
  api.send('get-settings');
  api.send('get-downloads');
});

// Fallback Escape listener for when focus is outside the webview (on the browser chrome/frame)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.body.classList.contains('immersive-mode') && activeTabId) {
      api.send('toggle-immersive-mode', activeTabId);
    }
  }
});

api.on('window-maximized-status', (isMaximized) => {
  const btnMaximize = document.getElementById('btn-maximize');
  if (btnMaximize) {
    if (isMaximized) {
      btnMaximize.classList.add('maximized');
      btnMaximize.title = 'Restore';
    } else {
      btnMaximize.classList.remove('maximized');
      btnMaximize.title = 'Maximize';
    }
  }
});

// Autocomplete logic helper functions
const autocompleteDropdown = document.getElementById('autocomplete-dropdown');
let selectedSuggestionIndex = -1;
let currentSuggestions = [];

function hideSuggestions() {
  autocompleteDropdown.classList.add('autocomplete-hidden');
  selectedSuggestionIndex = -1;
}

function showSuggestions(query) {
  if (!query) {
    hideSuggestions();
    return;
  }

  // Filter history items containing query
  const matches = historyData.filter(item => 
    (item.title && item.title.toLowerCase().includes(query.toLowerCase())) ||
    (item.url && item.url.toLowerCase().includes(query.toLowerCase()))
  ).slice(0, 5);

  currentSuggestions = [];

  // Default Search Engine Search row
  const searchEngineUrl = selectSearchEngine ? selectSearchEngine.value : 'https://www.google.com/search?q=';
  currentSuggestions.push({
    type: 'search',
    title: `Search for "${query}"`,
    url: `${searchEngineUrl}${encodeURIComponent(query)}`,
    icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`
  });

  // History matches rows
  matches.forEach(match => {
    currentSuggestions.push({
      type: 'history',
      title: match.title,
      url: match.url,
      icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`
    });
  });

  autocompleteDropdown.innerHTML = '';
  currentSuggestions.forEach((item, index) => {
    const itemEl = document.createElement('div');
    itemEl.className = 'autocomplete-item';
    itemEl.dataset.index = index;
    
    itemEl.innerHTML = `
      <div class="autocomplete-item-icon">${item.icon}</div>
      <div class="autocomplete-item-details">
        <span class="autocomplete-item-title">${item.title}</span>
        <span class="autocomplete-item-url">${getFriendlyUrl(item.url)}</span>
      </div>
    `;

    itemEl.addEventListener('mousedown', (e) => {
      // Prevent blur event from firing before click registers
      e.preventDefault();
      navigateAddress(item.url);
      hideSuggestions();
    });

    autocompleteDropdown.appendChild(itemEl);
  });

  // Dynamically position and size matching the address bar
  const rect = addressContainer.getBoundingClientRect();
  autocompleteDropdown.style.left = `${rect.left}px`;
  autocompleteDropdown.style.width = `${rect.width}px`;
  autocompleteDropdown.classList.remove('autocomplete-hidden');
  selectedSuggestionIndex = -1;
}

function updateSuggestionHighlight() {
  const items = autocompleteDropdown.querySelectorAll('.autocomplete-item');
  items.forEach((item, index) => {
    if (index === selectedSuggestionIndex) {
      item.classList.add('selected');
      const selected = currentSuggestions[index];
      // Set value without triggering input event
      addressBar.value = selected.type === 'search' ? addressBar.value : selected.url;
    } else {
      item.classList.remove('selected');
    }
  });
}

function navigateAddress(url) {
  if (url && activeTabId) {
    api.send('navigate-tab', { id: activeTabId, url });
    addressBar.blur();
  }
}

// Global click listener to close suggestions
document.addEventListener('click', (e) => {
  if (!e.target.closest('#address-container') && !e.target.closest('#autocomplete-dropdown')) {
    hideSuggestions();
  }
});



