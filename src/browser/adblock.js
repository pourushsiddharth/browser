const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Common ad and tracker domains for offline & immediate filtering
const DEFAULT_BLOCKED_DOMAINS = new Set([
  // Google Ads & Analytics
  'doubleclick.net', 'google-analytics.com', 'googletagservices.com', 'googletagmanager.com',
  'adservice.google.com', 'pagead2.googlesyndication.com', 'googleads.g.doubleclick.net',
  'analytics.google.com', 'clickserve.dartsearch.net',
  
  // Facebook / Meta Trackers
  'connect.facebook.net', 'facebook.com/tr',
  
  // Major Advertising Networks
  'adnxs.com', 'pubmatic.com', 'rubiconproject.com', 'criteo.com', 'criteo.net',
  'casalemedia.com', 'outbrain.com', 'outbrainimg.com', 'taboola.com', 'quantserve.com',
  'scorecardresearch.com', 'bluekai.com', 'amazon-adsystem.com', 'advertising.com',
  'popads.net', 'popcash.net', 'adcolony.com', 'applovin.com', 'unityads.unity3d.com',
  'bidswitch.net', 'openx.net', 'indexww.com', 'smaato.net', 'smartadserver.com',
  'media.net', 'adtech.de', 'conversantmedia.com', 'sovrn.com', 'yieldmo.com',
  
  // Telemetry & User Session Recorders
  'hotjar.com', 'mixpanel.com', 'amplitude.com', 'segment.io', 'optimizely.com',
  'crazyegg.com', 'intercom.io', 'newrelic.com', 'sentry.io', 'bugsnag.com',
  'mouseflow.com', 'luckyorange.com', 'clck.yandex.ru', 'mc.yandex.ru',
  
  // Script / CSS Ad Servicing
  'carbonads.net', 'srv.carbonads.net', 'nativeads.com', 'adzerk.net'
]);

// Substrings commonly present in tracking and banner delivery endpoints
const BLOCKED_PATTERNS = [
  '/ads/', '/adserver', '/googleads', 'pixel.gif', '/track?', '/telemetry',
  'utm_source=', 'utm_medium=', 'utm_campaign=', '/advert', '/banner',
  'ads.js', 'analytics.js', 'telemetry.js', 'tracker.js'
];

let blockedDomains = new Set(DEFAULT_BLOCKED_DOMAINS);
const hostCachePath = () => path.join(app.getPath('userData'), 'blocked-hosts.json');

/**
 * Checks if a hostname or any of its parent domain segments matches the blocked set.
 */
function isDomainBlocked(hostname) {
  if (!hostname) return false;
  hostname = hostname.toLowerCase();

  if (blockedDomains.has(hostname)) return true;

  const parts = hostname.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join('.');
    if (blockedDomains.has(parent)) {
      return true;
    }
  }

  return false;
}

/**
 * High-performance network request checker.
 * Returns true if the request should be blocked.
 */
function isBlocked(urlString) {
  try {
    const url = new URL(urlString);

    // Always allow chrome extensions, devtools, and local resource protocols
    if (url.protocol === 'chrome-extension:' || url.protocol === 'devtools:' || url.protocol === 'file:' || url.protocol === 'orbit:') {
      return false;
    }

    // Never block core first-party Google or gstatic infrastructure (excluding ads/analytics)
    const isGoogleCore = (url.hostname.includes('google.') || url.hostname === 'google.com' || url.hostname.includes('gstatic')) &&
                         !url.hostname.includes('googleads') &&
                         !url.hostname.includes('googlesyndication') &&
                         !url.hostname.includes('google-analytics') &&
                         !url.hostname.includes('googletag') &&
                         !url.hostname.includes('doubleclick');
    if (isGoogleCore) {
      return false;
    }

    // Never block M-Lab speed test domains
    if (url.hostname.endsWith('measurementlab.net') || url.hostname.includes('measurementlab')) {
      return false;
    }

    // Check domain list
    if (isDomainBlocked(url.hostname)) {
      return true;
    }

    // Check path & query patterns
    const fullPath = url.pathname + url.search;
    for (const pattern of BLOCKED_PATTERNS) {
      if (fullPath.includes(pattern)) {
        return true;
      }
    }

    return false;
  } catch (e) {
    return false;
  }
}

/**
 * Loads cached hostnames from local disk cache safely.
 */
function loadCachedBlocklist() {
  try {
    const filePath = hostCachePath();
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      const domains = JSON.parse(data);
      if (Array.isArray(domains) && domains.length > 0) {
        blockedDomains = new Set([...DEFAULT_BLOCKED_DOMAINS, ...domains]);
        console.log(`[AdBlock] Loaded ${domains.length} cached domains from disk.`);
      }
    }
  } catch (err) {
    console.error('[AdBlock] Failed to load cached blocklist:', err);
  }
}

/**
 * Asynchronously updates the blocklist in the background.
 * Validates the download and falls back to cached data on network error.
 */
async function updateBlocklist() {
  const url = 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts';
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);

    const text = await response.text();
    const lines = text.split('\n');
    const newDomains = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

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
      console.log(`[AdBlock] Updated blocklist: ${blockedDomains.size} domains active.`);
      try {
        fs.writeFileSync(hostCachePath(), JSON.stringify(newDomains), 'utf8');
      } catch (saveErr) {}
    }
  } catch (err) {
    console.warn('[AdBlock] Background list update skipped (offline or network error). Retaining cache.', err.message);
    loadCachedBlocklist();
  }
}

/**
 * Non-blocking initialization of the adblocker engine.
 */
function init() {
  loadCachedBlocklist();
  // Delay remote fetch by 5 seconds so browser startup is never blocked
  setTimeout(() => {
    updateBlocklist().catch(() => {});
  }, 5000);
}

module.exports = {
  init,
  isBlocked,
  isDomainBlocked,
  getBlockedCount: () => blockedDomains.size
};
