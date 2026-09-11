const { contextBridge, ipcRenderer } = require('electron');

// Secure context bridge: only expose history/bookmarks lookup API to local newtab.html
if (window.location.protocol === 'file:' && window.location.pathname.endsWith('newtab.html')) {
  contextBridge.exposeInMainWorld('orbitNewTab', {
    getAutocomplete: (query) => ipcRenderer.invoke('get-autocomplete-suggestions', query),
    getSearchEngine: () => ipcRenderer.invoke('get-search-engine')
  });
}

// Automatically transform permission help dialogs (e.g. Google Meet) to show Vayu Lock icon
window.addEventListener('DOMContentLoaded', () => {
  const VAYU_LOCK_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#2d6a4f" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin:0 4px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;

  function transformPermissionDialogs() {
    try {
      // 1. Replace text mentioning "page info icon" or "page info" to "Lock icon"
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
      let node;
      while (node = walker.nextNode()) {
        if (node.nodeValue) {
          if (node.nodeValue.includes('page info icon')) {
            node.nodeValue = node.nodeValue.replace(/page info icon/g, 'Lock icon');
          } else if (node.nodeValue.includes('page info')) {
            node.nodeValue = node.nodeValue.replace(/page info/g, 'Lock icon');
          }
        }
      }

      // 2. Target any element that sits right before or inside "Click the [icon] Lock icon"
      const allEls = document.querySelectorAll('span, i, div, svg, img, p, li');
      allEls.forEach(el => {
        if (el.getAttribute('data-vayu-replaced')) return;

        const parentText = (el.parentElement ? el.parentElement.textContent : '') || '';
        const elText = el.textContent || '';

        // If parent text contains "Click the" and "Lock icon"
        if (parentText.includes('Click the') && parentText.includes('Lock icon')) {
          // Check if this specific element is the inline tune icon container
          if (el.tagName.toLowerCase() === 'svg' || el.tagName.toLowerCase() === 'img') {
            el.setAttribute('data-vayu-replaced', 'true');
            const lockSpan = document.createElement('span');
            lockSpan.innerHTML = VAYU_LOCK_SVG;
            el.replaceWith(lockSpan);
          } else if ((el.tagName.toLowerCase() === 'span' || el.tagName.toLowerCase() === 'i') && !elText.includes('Click') && !elText.includes('Lock')) {
            el.setAttribute('data-vayu-replaced', 'true');
            el.innerHTML = VAYU_LOCK_SVG;
          }
        }

        // 3. Target tune icons inside big illustration graphics inside dialogs
        const outer = el.outerHTML || '';
        if ((outer.includes('circle') && outer.includes('tune')) || outer.includes('o-o') || outer.includes('slider')) {
          if (el.closest('[role="dialog"]') || parentText.includes('blocked')) {
            el.setAttribute('data-vayu-replaced', 'true');
            if (el.tagName.toLowerCase() === 'svg' || el.tagName.toLowerCase() === 'img') {
              const lockSpan = document.createElement('span');
              lockSpan.innerHTML = VAYU_LOCK_SVG;
              el.replaceWith(lockSpan);
            }
          }
        }
      });
    } catch(e) {}
  }

  try {
    transformPermissionDialogs();
    const observer = new MutationObserver(() => transformPermissionDialogs());
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  } catch(e) {}
});
