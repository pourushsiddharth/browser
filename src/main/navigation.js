const path = require('path');

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
  return url && typeof url === 'string' && url.includes('print-preview-') && url.endsWith('.pdf');
}

function getTitleForPrintPreview(url) {
  const filename = path.basename(url);
  const match = filename.match(/print-preview-(.+)-\d+\.pdf$/);
  if (match && match[1]) {
    return `Print Preview - ${match[1].replace(/_/g, ' ')}`;
  }
  return 'Print Preview';
}

/**
 * Normalizes input string to a valid loadable URL or Google search query
 */
function normalizeUrlOrSearch(input) {
  if (!input || input === 'orbit://newtab') {
    return { type: 'newtab', url: 'orbit://newtab' };
  }

  let targetUrl = input.trim();

  if (targetUrl.startsWith('view-source:')) {
    const nested = targetUrl.slice('view-source:'.length).trim();
    if (nested && !nested.startsWith('http://') && !nested.startsWith('https://') && !nested.startsWith('file://')) {
      targetUrl = 'view-source:https://' + nested;
    }
    return { type: 'view-source', url: targetUrl };
  }

  if (!targetUrl.includes('.') && !targetUrl.startsWith('http') && !targetUrl.startsWith('file://')) {
    return { type: 'search', url: `https://www.google.com/search?q=${encodeURIComponent(targetUrl)}` };
  }

  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://') && !targetUrl.startsWith('file://')) {
    targetUrl = 'https://' + targetUrl;
  }

  return { type: 'url', url: targetUrl };
}

module.exports = {
  getSiteNameForViewSource,
  isPrintPreviewUrl,
  getTitleForPrintPreview,
  normalizeUrlOrSearch
};
