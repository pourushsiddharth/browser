/**
 * Formats a raw URL string into a user-friendly display string
 */
export function getFriendlyUrl(urlString) {
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

/**
 * Initializes address bar auto-completion and suggestion dropdown
 */
export function initAddressBar({ addressBar, addressContainer, api, onNavigate }) {
  if (!addressBar || !addressContainer) return;

  const autocompleteDropdown = document.getElementById('autocomplete-dropdown');
  let selectedSuggestionIndex = -1;
  let currentSuggestions = [];

  function hideSuggestions() {
    if (autocompleteDropdown) {
      autocompleteDropdown.classList.add('autocomplete-hidden');
    }
    selectedSuggestionIndex = -1;
  }

  function showSuggestions(query, historyData = []) {
    if (!query || !autocompleteDropdown) {
      hideSuggestions();
      return;
    }

    const matches = historyData.filter(item =>
      (item.title && item.title.toLowerCase().includes(query.toLowerCase())) ||
      (item.url && item.url.toLowerCase().includes(query.toLowerCase()))
    ).slice(0, 5);

    currentSuggestions = [];

    // Search Engine row
    currentSuggestions.push({
      type: 'search',
      title: `Search for "${query}"`,
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
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
        e.preventDefault();
        if (typeof onNavigate === 'function') {
          onNavigate(item.url);
        }
        hideSuggestions();
      });

      autocompleteDropdown.appendChild(itemEl);
    });

    const rect = addressContainer.getBoundingClientRect();
    autocompleteDropdown.style.left = `${rect.left}px`;
    autocompleteDropdown.style.width = `${rect.width}px`;
    autocompleteDropdown.classList.remove('autocomplete-hidden');
    selectedSuggestionIndex = -1;
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#address-container') && !e.target.closest('#autocomplete-dropdown')) {
      hideSuggestions();
    }
  });

  return {
    showSuggestions,
    hideSuggestions,
    getFriendlyUrl
  };
}
