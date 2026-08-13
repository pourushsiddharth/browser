// Orbit Browser - New Tab Dashboard script

const clock = document.getElementById('clock');
const greeting = document.getElementById('greeting');
const logoSection = document.getElementById('logo-section');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const focusToggle = document.getElementById('focus-toggle');

// Customizer Elements
const settingsToggle = document.getElementById('settings-toggle');
const customizerPanel = document.getElementById('customizer-panel');
const customizerClose = document.getElementById('customizer-close');

const centerpieceSelect = document.getElementById('centerpiece-select');
const toggleSpeedDials = document.getElementById('toggle-speed-dials');
const toggleShieldStats = document.getElementById('toggle-shield-stats');
const toggleComparison = document.getElementById('toggle-comparison');

const speedDialsContainer = document.getElementById('speed-dials');
const dashboardContainer = document.getElementById('dashboard-widgets');
const statsCard = document.querySelector('.stats-card');
const comparisonCard = document.querySelector('.comparison-card');

// Update Clock & Greeting
function updateTimeAndGreeting() {
  const now = new Date();
  
  // Format Time (HH:MM)
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  if (clock) clock.textContent = `${hours}:${minutes}`;

  // Greeting based on time of day
  const hour = now.getHours();
  let greetText = 'Welcome, Explorer';
  if (hour < 12) {
    greetText = 'Good morning, Explorer';
  } else if (hour < 18) {
    greetText = 'Good afternoon, Explorer';
  } else {
    greetText = 'Good evening, Explorer';
  }
  if (greeting) greeting.textContent = greetText;
}

// Handle search form submission
searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const query = searchInput.value.trim();
  if (query) {
    if (query.includes('.') && !query.includes(' ') && !query.startsWith('http')) {
      window.location.href = 'https://' + query;
    } else if (query.startsWith('http://') || query.startsWith('https://')) {
      window.location.href = query;
    } else {
      window.location.href = 'https://www.google.com/search?q=' + encodeURIComponent(query);
    }
  }
});

// Focus Mode Toggle (local storage persistent)
focusToggle.addEventListener('click', () => {
  document.body.classList.toggle('focus-mode');
  const isFocusMode = document.body.classList.contains('focus-mode');
  localStorage.setItem('focus-mode', isFocusMode);
  if (isFocusMode) {
    customizerPanel.classList.remove('active');
  }
});

// Load Focus Mode preference on start
function initFocusMode() {
  const isFocusMode = localStorage.getItem('focus-mode') === 'true';
  if (isFocusMode) {
    document.body.classList.add('focus-mode');
  }
}

// Customizer panel toggling
settingsToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  customizerPanel.classList.toggle('active');
});

customizerClose.addEventListener('click', () => {
  customizerPanel.classList.remove('active');
});

// Close customizer when clicking outside
document.addEventListener('click', (e) => {
  if (customizerPanel.classList.contains('active') && 
      !customizerPanel.contains(e.target) && 
      !settingsToggle.contains(e.target)) {
    customizerPanel.classList.remove('active');
  }
});

// Prevent clicks inside panel from closing it
customizerPanel.addEventListener('click', (e) => {
  e.stopPropagation();
});

// Update dashboard layout classes based on active cards
function updateDashboardLayout(showShield, showComp) {
  if (!dashboardContainer) return;
  
  if (!showShield && !showComp) {
    dashboardContainer.classList.add('all-hidden');
    dashboardContainer.classList.remove('single-widget');
  } else if (!showShield || !showComp) {
    dashboardContainer.classList.remove('all-hidden');
    dashboardContainer.classList.add('single-widget');
  } else {
    dashboardContainer.classList.remove('all-hidden');
    dashboardContainer.classList.remove('single-widget');
  }
}

// Apply centerpiece visibility
function applyCenterpiece(mode) {
  const timeGreetingSection = document.querySelector('.time-greeting-section');
  if (mode === 'logo') {
    if (logoSection) logoSection.style.display = 'flex';
    if (timeGreetingSection) timeGreetingSection.style.display = 'none';
  } else {
    if (logoSection) logoSection.style.display = 'none';
    if (timeGreetingSection) timeGreetingSection.style.display = 'flex';
  }
}

// Customizer Settings Logic
function initCustomizer() {
  // Load settings (default to true/clock if not set)
  const centerpiece = localStorage.getItem('centerpiece-mode') || 'clock';
  const showSpeedDials = localStorage.getItem('show-speed-dials') !== 'false';
  const showShieldStats = localStorage.getItem('show-shield-stats') !== 'false';
  const showComparison = localStorage.getItem('show-comparison') !== 'false';

  // Apply inputs check state
  if (centerpieceSelect) centerpieceSelect.value = centerpiece;
  toggleSpeedDials.checked = showSpeedDials;
  toggleShieldStats.checked = showShieldStats;
  toggleComparison.checked = showComparison;

  // Apply elements visibility
  applyCenterpiece(centerpiece);
  if (!showSpeedDials) speedDialsContainer.classList.add('hide-card');
  if (!showShieldStats) statsCard.classList.add('hide-card');
  if (!showComparison) comparisonCard.classList.add('hide-card');

  // Update layout grid
  updateDashboardLayout(showShieldStats, showComparison);

  // Set up event listeners for inputs
  if (centerpieceSelect) {
    centerpieceSelect.addEventListener('change', () => {
      const mode = centerpieceSelect.value;
      localStorage.setItem('centerpiece-mode', mode);
      applyCenterpiece(mode);
    });
  }

  toggleSpeedDials.addEventListener('change', () => {
    const isVisible = toggleSpeedDials.checked;
    localStorage.setItem('show-speed-dials', isVisible);
    if (isVisible) {
      speedDialsContainer.classList.remove('hide-card');
    } else {
      speedDialsContainer.classList.add('hide-card');
    }
  });

  toggleShieldStats.addEventListener('change', () => {
    const isVisible = toggleShieldStats.checked;
    localStorage.setItem('show-shield-stats', isVisible);
    if (isVisible) {
      statsCard.classList.remove('hide-card');
    } else {
      statsCard.classList.add('hide-card');
    }
    updateDashboardLayout(isVisible, toggleComparison.checked);
  });

  toggleComparison.addEventListener('change', () => {
    const isVisible = toggleComparison.checked;
    localStorage.setItem('show-comparison', isVisible);
    if (isVisible) {
      comparisonCard.classList.remove('hide-card');
    } else {
      comparisonCard.classList.add('hide-card');
    }
    updateDashboardLayout(toggleShieldStats.checked, isVisible);
  });
}

// Set Global Blocked count with premium counter animation
window.setGlobalBlockedCount = (count) => {
  const label = document.getElementById('stat-blocked-count');
  if (label) {
    let current = 0;
    const step = Math.ceil(count / 30) || 1;
    const interval = setInterval(() => {
      current += step;
      if (current >= count) {
        current = count;
        clearInterval(interval);
      }
      label.textContent = current.toLocaleString();
    }, 15);
  }
};

// Initial logo render (static default logo)
if (logoSection) {
  logoSection.innerHTML = `<div class="default-logo">Orbit</div>`;
}

// Initial triggers
updateTimeAndGreeting();
initFocusMode();
initCustomizer();

// Update time every second
setInterval(updateTimeAndGreeting, 1000);
