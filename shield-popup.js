// Orbit Shield Popup Controller

const pageFaviconContainer = document.getElementById('page-favicon-container');
const pageDomainLabel = document.getElementById('page-domain');
const shieldToggle = document.getElementById('shield-toggle');
const statPageBlocked = document.getElementById('stat-page-blocked');
const statGlobalBlocked = document.getElementById('stat-global-blocked');
const trackersList = document.getElementById('trackers-list');
const btnClosePopup = document.getElementById('btn-close-popup');

// Extract clean host/domain for display
function getFriendlyUrl(urlString) {
  if (!urlString || urlString.startsWith('orbit://') || urlString.startsWith('file://')) {
    return 'orbit://newtab';
  }
  try {
    const url = new URL(urlString);
    let friendly = url.hostname;
    if (friendly.startsWith('www.')) {
      friendly = friendly.substring(4);
    }
    return friendly;
  } catch (e) {
    return urlString;
  }
}

// Request initial state on load
window.addEventListener('DOMContentLoaded', () => {
  api.send('get-shield-info');
});

// Close button
if (btnClosePopup) {
  btnClosePopup.addEventListener('click', () => {
    api.send('close-shield-popup');
  });
}

let currentTabId = null;

// Adblock Toggle switch
shieldToggle.addEventListener('change', () => {
  if (currentTabId) {
    api.send('toggle-adblock', { tabId: currentTabId });
  } else {
    api.send('toggle-adblock');
  }
});

// Update popup UI with payload data
api.on('shield-info-data', (payload) => {
  currentTabId = payload.tabId;

  // Update toggle state
  shieldToggle.checked = payload.adBlockEnabled;

  // Update URL domain label
  pageDomainLabel.textContent = getFriendlyUrl(payload.url);

  // Update favicon
  pageFaviconContainer.innerHTML = '';
  if (payload.url.startsWith('orbit://') || payload.url.startsWith('file://') || !payload.favicon) {
    // Show fallback globe icon
    pageFaviconContainer.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--text-secondary, #6b7280)" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
    `;
  } else {
    // Show website favicon image
    const img = document.createElement('img');
    img.src = payload.favicon;
    img.onerror = () => {
      pageFaviconContainer.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--text-secondary, #6b7280)" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
      `;
    };
    pageFaviconContainer.appendChild(img);
  }

  // Update counts
  statPageBlocked.textContent = payload.blockedCount || 0;
  statGlobalBlocked.textContent = payload.globalBlockedCount || 0;

  // Render blocked trackers list
  trackersList.innerHTML = '';
  const trackers = payload.blockedTrackers || [];

  if (trackers.length === 0) {
    trackersList.innerHTML = '<div class="empty-msg">No trackers blocked on this page.</div>';
  } else {
    trackers.forEach((t) => {
      const item = document.createElement('div');
      item.className = 'tracker-item';
      
      const faviconUrl = `https://www.google.com/s2/favicons?sz=32&domain=${t.hostname}&default=404`;
      const firstChar = t.hostname ? t.hostname[0].toUpperCase() : 'T';

      item.innerHTML = `
        <div class="tracker-left">
          <img class="tracker-icon" src="${faviconUrl}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
          <div class="tracker-icon-fallback" style="display:none">
            ${firstChar}
          </div>
          <span class="tracker-host" title="${t.hostname}">${t.hostname}</span>
        </div>
        <span class="blocked-tag">Blocked</span>
      `;
      trackersList.appendChild(item);
    });
  }
});
