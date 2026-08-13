const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Curated list of common ad/tracker domains for immediate offline use
const DEFAULT_BLOCKED_DOMAINS = new Set([
  // Google Ads & Tracking
  'doubleclick.net', 'google-analytics.com', 'googletagservices.com', 'googletagmanager.com',
  'adservice.google.com', 'pagead2.googlesyndication.com', 'googleads.g.doubleclick.net',
  'analytics.google.com', 'clickserve.dartsearch.net',
  
  // Facebook Tracking
  'connect.facebook.net', 'facebook.com/tr',
  
  // Other Major Ad Networks
  'adnxs.com', 'pubmatic.com', 'rubiconproject.com', 'criteo.com', 'criteo.net',
  'casalemedia.com', 'outbrain.com', 'outbrainimg.com', 'taboola.com', 'quantserve.com',
  'scorecardresearch.com', 'bluekai.com', 'amazon-adsystem.com', 'advertising.com',
  'popads.net', 'popcash.net', 'adcolony.com', 'applovin.com', 'unityads.unity3d.com',
  'bidswitch.net', 'openx.net', 'indexww.com', 'smaato.net', 'smartadserver.com',
  'media.net', 'adtech.de', 'conversantmedia.com', 'sovrn.com', 'yieldmo.com',
  
  // Analytics & Tracking
  'hotjar.com', 'mixpanel.com', 'amplitude.com', 'segment.io', 'optimizely.com',
  'crazyegg.com', 'intercom.io', 'newrelic.com', 'sentry.io', 'bugsnag.com',
  'mouseflow.com', 'luckyorange.com', 'clck.yandex.ru', 'mc.yandex.ru',
  
  // Script / CSS blockers
  'carbonads.net', 'srv.carbonads.net', 'nativeads.com', 'adzerk.net',
]);

// Common URL path substrings that indicate ads/tracking
const BLOCKED_PATTERNS = [
  '/ads/', '/adserver', '/googleads', 'pixel.gif', '/track?', '/telemetry',
  'utm_source=', 'utm_medium=', 'utm_campaign=', '/advert', '/banner',
  'ads.js', 'analytics.js', 'telemetry.js', 'tracker.js'
];

let blockedDomains = new Set(DEFAULT_BLOCKED_DOMAINS);
const hostCachePath = () => path.join(app.getPath('userData'), 'blocked-hosts.json');

/**
 * Normalizes a hostname to check for matches or subdomain matches
 */
function isDomainBlocked(hostname) {
  if (!hostname) return false;
  
  // Convert hostname to lowercase
  hostname = hostname.toLowerCase();
  
  // Check direct match
  if (blockedDomains.has(hostname)) return true;
  
  // Check subdomain matches (e.g. ad.doubleclick.net -> doubleclick.net)
  const parts = hostname.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const parentDomain = parts.slice(i).join('.');
    if (blockedDomains.has(parentDomain)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Checks if a given URL should be blocked
 * @param {string} urlString 
 * @returns {boolean} True if the URL should be blocked
 */
function isBlocked(urlString) {
  try {
    const url = new URL(urlString);
    
    // Always allow chrome extensions, devtools, and local resources
    if (url.protocol === 'chrome-extension:' || url.protocol === 'devtools:' || url.protocol === 'file:') {
      return false;
    }
    
    // Check hostname
    if (isDomainBlocked(url.hostname)) {
      return true;
    }
    
    // Check path and query patterns
    const fullPath = url.pathname + url.search;
    for (const pattern of BLOCKED_PATTERNS) {
      if (fullPath.includes(pattern)) {
        return true;
      }
    }
    
    return false;
  } catch (e) {
    return false; // Invalid URL, don't block
  }
}

/**
 * Loads the cached blocklist from disk if it exists
 */
function loadCachedBlocklist() {
  try {
    const filePath = hostCachePath();
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      const domains = JSON.parse(data);
      if (Array.isArray(domains) && domains.length > 0) {
        blockedDomains = new Set([...DEFAULT_BLOCKED_DOMAINS, ...domains]);
        console.log(`AdBlocker: Loaded ${domains.length} cached domains from disk.`);
      }
    }
  } catch (err) {
    console.error('AdBlocker: Failed to load cached blocklist', err);
  }
}

/**
 * Updates the blocklist from StevenBlack's hosts file asynchronously
 */
async function updateBlocklist() {
  const url = 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts';
  console.log('AdBlocker: Fetching updated hosts list...');
  
  try {
    // Import electron-fetch dynamically or use standard fetch if available (Node 18+)
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    
    const text = await response.text();
    const lines = text.split('\n');
    const newDomains = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip comments or empty lines
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      // Hosts format: 0.0.0.0 domain-name
      // or 127.0.0.1 domain-name
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        const ip = parts[0];
        const domain = parts[1].toLowerCase();
        
        if ((ip === '0.0.0.0' || ip === '127.0.0.1') && domain !== 'localhost') {
          newDomains.push(domain);
        }
      }
    }
    
    if (newDomains.length > 0) {
      blockedDomains = new Set([...DEFAULT_BLOCKED_DOMAINS, ...newDomains]);
      console.log(`AdBlocker: Updated! Total blocked domains: ${blockedDomains.size}`);
      
      // Save cache to disk
      fs.writeFileSync(hostCachePath(), JSON.stringify(newDomains), 'utf8');
    }
  } catch (err) {
    console.error('AdBlocker: Failed to update blocklist from server (offline or rate-limited). Using cache.', err);
    // Fallback to cache
    loadCachedBlocklist();
  }
}

/**
 * Initializes the AdBlocker
 */
function init() {
  loadCachedBlocklist();
  // Fetch update in the background after 5 seconds to not block startup
  setTimeout(() => {
    updateBlocklist().catch(err => console.error('AdBlocker update failed', err));
  }, 5000);
}

module.exports = {
  init,
  isBlocked,
  getBlockedCount: () => blockedDomains.size
};
