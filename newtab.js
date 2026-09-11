// Orbit Browser - New Tab Dashboard script

const WEATHER_CODES = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Light freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Rain showers',
  81: 'Heavy showers',
  82: 'Violent showers',
  85: 'Light snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Severe thunderstorm'
};

function formatTemperature(tempC) {
  if (tempC === null || Number.isNaN(Number(tempC))) return '--°C';
  return `${Math.round(Number(tempC))}°C`;
}

function weatherLabelFromCode(code) {
  return WEATHER_CODES[code] || 'Clear';
}

function getAqiStatus(aqi) {
  if (aqi === null || aqi === undefined || Number.isNaN(Number(aqi))) return 'N/A';
  const value = Number(aqi);
  if (value <= 50) return 'Good';
  if (value <= 100) return 'Moderate';
  if (value <= 150) return 'Unhealthy for sensitive groups';
  if (value <= 200) return 'Unhealthy';
  if (value <= 300) return 'Very unhealthy';
  return 'Hazardous';
}

function setWeatherLoading() {
  const weatherTemp = document.querySelector('.weather-temp');
  const weatherLoc = document.querySelector('.weather-loc');
  const weatherAqiLabel = document.querySelector('.weather-aqi-label');
  const weatherAqiStatus = document.querySelector('.weather-aqi-status');

  if (weatherTemp) weatherTemp.textContent = '--°C';
  if (weatherLoc) weatherLoc.textContent = 'Locating...';
  if (weatherAqiLabel) weatherAqiLabel.textContent = 'AQI --';
  if (weatherAqiStatus) weatherAqiStatus.innerHTML = 'Checking <span class="aqi-dot"></span>';
}

function updateWeatherWidget({ tempC, locationName, aqi, summary }) {
  const weatherTemp = document.querySelector('.weather-temp');
  const weatherLoc = document.querySelector('.weather-loc');
  const weatherAqiLabel = document.querySelector('.weather-aqi-label');
  const weatherAqiStatus = document.querySelector('.weather-aqi-status');

  if (weatherTemp) weatherTemp.textContent = formatTemperature(tempC);
  if (weatherLoc) weatherLoc.textContent = locationName || 'Your city';
  if (weatherAqiLabel) {
    weatherAqiLabel.textContent = aqi === null || aqi === undefined ? 'AQI --' : `AQI ${Math.round(Number(aqi))}`;
  }
  if (weatherAqiStatus) {
    const status = getAqiStatus(aqi);
    const statusText = status === 'N/A' ? 'Unavailable' : status;
    weatherAqiStatus.innerHTML = `${statusText} <span class="aqi-dot"></span>`;
  }

  if (summary && weatherLoc) {
    const summaryText = weatherLoc.textContent;
    weatherLoc.title = summaryText + (summary ? ` • ${summary}` : '');
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function readCachedLocation() {
  try {
    const raw = localStorage.getItem('orbit-weather-location-cache');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Number.isFinite(parsed.latitude) && Number.isFinite(parsed.longitude)) {
      return { latitude: parsed.latitude, longitude: parsed.longitude };
    }
  } catch (err) {
    console.warn('Cached location is invalid:', err);
  }
  return null;
}

function writeCachedLocation(coords) {
  try {
    localStorage.setItem('orbit-weather-location-cache', JSON.stringify({
      latitude: Number(coords.latitude),
      longitude: Number(coords.longitude),
      updatedAt: Date.now()
    }));
  } catch (err) {
    console.warn('Could not cache location:', err);
  }
}

async function getIpBasedFallback() {
  const providers = [
    {
      name: 'ipapi.co',
      url: 'https://ipapi.co/json/',
      parse: (data) => {
        if (data && Number.isFinite(data.latitude) && Number.isFinite(data.longitude)) {
          return { latitude: data.latitude, longitude: data.longitude };
        }
        return null;
      }
    },
    {
      name: 'ipinfo.io',
      url: 'https://ipinfo.io/json',
      parse: (data) => {
        if (!data || !data.loc) return null;
        const [latitude, longitude] = String(data.loc).split(',').map(Number);
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          return { latitude, longitude };
        }
        return null;
      }
    }
  ];

  let lastError = null;

  for (const provider of providers) {
    try {
      const data = await fetchJson(provider.url, { cache: 'no-store' });
      const coords = provider.parse(data);
      if (coords) {
        return coords;
      }
    } catch (err) {
      lastError = err;
      console.warn(`${provider.name} location fallback failed:`, err);
    }
  }

  if (lastError) {
    console.warn('All IP-based location fallbacks failed:', lastError);
  }

  return readCachedLocation();
}

async function getCurrentCoords() {
  const cachedLocation = readCachedLocation();
  if (!navigator.geolocation) {
    return cachedLocation || getIpBasedFallback();
  }

  try {
    const coords = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const nextCoords = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          };
          writeCachedLocation(nextCoords);
          resolve(nextCoords);
        },
        async () => {
          const ipCoords = await getIpBasedFallback();
          if (ipCoords) {
            resolve(ipCoords);
            return;
          }
          reject(new Error('Location permission denied'));
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 600000 }
      );
    });

    return coords;
  } catch (err) {
    const ipCoords = await getIpBasedFallback();
    if (ipCoords) {
      return ipCoords;
    }
    if (cachedLocation) {
      return cachedLocation;
    }
    throw err;
  }
}

function normalizeLocationLabel(value) {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.replace(/\s+/g, ' ');
}

function extractBestLocationName(payload) {
  const result = payload?.results?.[0] || payload;
  const address = result?.address || {};
  const candidates = [
    result?.name,
    result?.locality,
    result?.city,
    result?.town,
    result?.village,
    result?.municipality,
    result?.county,
    result?.admin2,
    result?.admin1,
    result?.state,
    result?.region,
    address?.city,
    address?.town,
    address?.village,
    address?.municipality,
    address?.county,
    address?.state,
    address?.region,
    result?.country,
    address?.country
  ];

  for (const candidate of candidates) {
    const label = normalizeLocationLabel(candidate);
    if (label && !/^undefined$/i.test(label)) {
      return label;
    }
  }

  return '';
}

async function getLocationName(latitude, longitude) {
  const providers = [
    {
      name: 'Open-Meteo',
      fetcher: async () => {
        const data = await fetchJson(`https://geocoding-api.open-meteo.com/v1/reverse?latitude=${latitude}&longitude=${longitude}&language=en&format=json`);
        return extractBestLocationName(data) || '';
      }
    },
    {
      name: 'Nominatim',
      fetcher: async () => {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=10&accept-language=en`;
        const response = await fetch(url, {
          headers: {
            'Accept-Language': 'en',
            'User-Agent': 'VayuBrowser/1.0'
          }
        });
        if (!response.ok) {
          throw new Error(`Request failed: ${response.status}`);
        }

        const data = await response.json();
        const address = data?.address || {};
        const city = address.city || address.town || address.village || address.municipality || address.county || address.state || address.country || data?.display_name;
        const label = normalizeLocationLabel(city);
        if (label && !/^undefined$/i.test(label)) {
          return label.split(',')[0].trim();
        }
        return '';
      }
    }
  ];

  for (const provider of providers) {
    try {
      const label = await provider.fetcher();
      if (label) {
        return label;
      }
    } catch (err) {
      console.warn(`${provider.name} reverse geocoding failed:`, err);
    }
  }

  return 'Your city';
}

async function fetchWeatherForCoordinates(latitude, longitude) {
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timezone=auto`;
  const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude}&longitude=${longitude}&current=us_aqi&timezone=auto`;

  const [weatherResponse, aqiResponse] = await Promise.allSettled([
    fetchJson(weatherUrl),
    fetchJson(aqiUrl)
  ]);

  let tempC = null;
  let summary = 'Weather';
  let aqi = null;

  if (weatherResponse.status === 'fulfilled' && weatherResponse.value?.current) {
    const current = weatherResponse.value.current;
    tempC = current.temperature_2m;
    summary = weatherLabelFromCode(current.weather_code);
  }

  if (aqiResponse.status === 'fulfilled' && aqiResponse.value?.current) {
    aqi = aqiResponse.value.current.us_aqi;
  }

  const locationName = await getLocationName(latitude, longitude);

  return { tempC, aqi, locationName, summary };
}

async function loadWeather() {
  setWeatherLoading();

  try {
    let coords = null;

    try {
      coords = await getCurrentCoords();
    } catch (locationErr) {
      console.warn('Geolocation unavailable, falling back to IP-based location:', locationErr);
      coords = await getIpBasedFallback();
    }

    if (!coords) {
      throw new Error('Unable to determine user location');
    }

    const weatherData = await fetchWeatherForCoordinates(coords.latitude, coords.longitude);
    updateWeatherWidget(weatherData);
  } catch (err) {
    console.error('Weather load failed:', err);
    const weatherLoc = document.querySelector('.weather-loc');
    const weatherTemp = document.querySelector('.weather-temp');
    const weatherAqiLabel = document.querySelector('.weather-aqi-label');
    const weatherAqiStatus = document.querySelector('.weather-aqi-status');

    if (weatherTemp) weatherTemp.textContent = '—';
    if (weatherLoc) weatherLoc.textContent = 'Location unavailable';
    if (weatherAqiLabel) weatherAqiLabel.textContent = 'AQI --';
    if (weatherAqiStatus) weatherAqiStatus.innerHTML = 'Unavailable <span class="aqi-dot"></span>';
  }
}

if (typeof document !== 'undefined') {
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

    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    if (clock) clock.textContent = timeStr;

    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const hour = now.getHours();
    let greetText = 'Hello';
    if (hour >= 5 && hour < 12) {
      greetText = 'Good Morning ☀️';
    } else if (hour >= 12 && hour < 17) {
      greetText = 'Good Afternoon 🌤️';
    } else if (hour >= 17 && hour < 22) {
      greetText = 'Good Evening 🌅';
    } else {
      greetText = 'Good Night 🌙';
    }

    if (greeting) {
      greeting.textContent = `${greetText} | ${dateStr}`;
    }
  }

  // Handle search form submission
  if (searchForm && searchInput) {
    searchForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const query = searchInput.value.trim();
      if (query) {
        if (query.includes('.') && !query.includes(' ') && !query.startsWith('http')) {
          window.location.href = 'https://' + query;
        } else if (query.startsWith('http://') || query.startsWith('https://')) {
          window.location.href = query;
        } else {
          let searchEngineUrl = 'https://www.google.com/search?q=';
          if (window.orbitNewTab && typeof window.orbitNewTab.getSearchEngine === 'function') {
            try {
              searchEngineUrl = await window.orbitNewTab.getSearchEngine();
            } catch (err) {
              console.error(err);
            }
          }
          window.location.href = searchEngineUrl + encodeURIComponent(query);
        }
      }
    });
  }

  if (focusToggle && customizerPanel) {
    focusToggle.addEventListener('click', () => {
      document.body.classList.toggle('focus-mode');
      const isFocusMode = document.body.classList.contains('focus-mode');
      localStorage.setItem('focus-mode', isFocusMode);
      if (isFocusMode) {
        customizerPanel.classList.remove('active');
      }
    });
  }

  function initFocusMode() {
    const isFocusMode = localStorage.getItem('focus-mode') === 'true';
    if (isFocusMode) {
      document.body.classList.add('focus-mode');
    }
  }

  if (settingsToggle && customizerPanel) {
    settingsToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      customizerPanel.classList.toggle('active');
    });
  }

  if (customizerClose) {
    customizerClose.addEventListener('click', () => {
      customizerPanel.classList.remove('active');
    });
  }

  if (customizerPanel && settingsToggle) {
    document.addEventListener('click', (e) => {
      if (customizerPanel.classList.contains('active') &&
          !customizerPanel.contains(e.target) &&
          !settingsToggle.contains(e.target)) {
        customizerPanel.classList.remove('active');
      }
    });

    customizerPanel.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  function updateDashboardLayout(showShield, showComp) {
    if (!dashboardContainer) return;

    const isVisible = showShield || showComp;
    if (!isVisible) {
      dashboardContainer.classList.add('all-hidden');
      dashboardContainer.classList.remove('single-widget');
    } else if (showShield !== showComp) {
      dashboardContainer.classList.remove('all-hidden');
      dashboardContainer.classList.add('single-widget');
    } else {
      dashboardContainer.classList.remove('all-hidden');
      dashboardContainer.classList.remove('single-widget');
    }
  }

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

  function initCustomizer() {
    const centerpiece = localStorage.getItem('centerpiece-mode') || 'logo';
    const showSpeedDials = localStorage.getItem('show-speed-dials') !== 'false';
    const showShieldStats = localStorage.getItem('show-shield-stats') !== 'false';
    const showComparison = localStorage.getItem('show-comparison') !== 'false';

    if (centerpieceSelect) centerpieceSelect.value = centerpiece;
    if (toggleSpeedDials) toggleSpeedDials.checked = showSpeedDials;
    if (toggleShieldStats) toggleShieldStats.checked = showShieldStats;
    if (toggleComparison) toggleComparison.checked = showComparison;

    applyCenterpiece(centerpiece);
    if (speedDialsContainer && !showSpeedDials) speedDialsContainer.classList.add('hide-card');
    if (statsCard && !showShieldStats) statsCard.classList.add('hide-card');
    if (comparisonCard && !showComparison) comparisonCard.classList.add('hide-card');

    updateDashboardLayout(showShieldStats, showComparison);

    if (centerpieceSelect) {
      centerpieceSelect.addEventListener('change', () => {
        const mode = centerpieceSelect.value;
        localStorage.setItem('centerpiece-mode', mode);
        applyCenterpiece(mode);
      });
    }

    if (toggleSpeedDials) {
      toggleSpeedDials.addEventListener('change', () => {
        const isVisible = toggleSpeedDials.checked;
        localStorage.setItem('show-speed-dials', isVisible);
        if (isVisible) {
          speedDialsContainer.classList.remove('hide-card');
        } else if (speedDialsContainer) {
          speedDialsContainer.classList.add('hide-card');
        }
      });
    }

    if (toggleShieldStats && statsCard) {
      toggleShieldStats.addEventListener('change', () => {
        const isVisible = toggleShieldStats.checked;
        localStorage.setItem('show-shield-stats', isVisible);
        if (isVisible) {
          statsCard.classList.remove('hide-card');
        } else {
          statsCard.classList.add('hide-card');
        }
        updateDashboardLayout(isVisible, toggleComparison ? toggleComparison.checked : false);
      });
    }

    if (toggleComparison && comparisonCard) {
      toggleComparison.addEventListener('change', () => {
        const isVisible = toggleComparison.checked;
        localStorage.setItem('show-comparison', isVisible);
        if (isVisible) {
          comparisonCard.classList.remove('hide-card');
        } else {
          comparisonCard.classList.add('hide-card');
        }
        updateDashboardLayout(toggleShieldStats ? toggleShieldStats.checked : false, isVisible);
      });
    }
  }

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

  if (logoSection) {
    logoSection.innerHTML = `
      <div class="vayu-logo-container">
        <img class="vayu-logo-img" src="vayu_logo.png" alt="Vayu Logo">
      </div>
    `;
  }

  updateTimeAndGreeting();
  initFocusMode();
  initCustomizer();
  setWeatherLoading();
  loadWeather();

  setInterval(updateTimeAndGreeting, 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      loadWeather();
    }
  });

  if (window.orbitNewTab && searchInput) {
    let isDeletingSearch = false;

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        isDeletingSearch = true;
      } else {
        isDeletingSearch = false;
      }

      if (e.key === 'Tab' && searchInput.selectionStart !== searchInput.selectionEnd) {
        e.preventDefault();
        searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
      }
    });

    searchInput.addEventListener('input', async () => {
      const query = searchInput.value;
      if (isDeletingSearch || !query.trim() || query.endsWith(' ')) return;

      const normalizedQuery = query.trim().toLowerCase();

      try {
        const suggestions = await window.orbitNewTab.getAutocomplete(query.trim());
        if (suggestions && suggestions.length > 0) {
          const match = suggestions.find(s => s.friendly.toLowerCase().startsWith(normalizedQuery));
          if (match) {
            const typedLength = query.length;
            const completion = match.friendly.substring(typedLength);

            if (completion.length > 0) {
              searchInput.value = query + completion;
              searchInput.setSelectionRange(typedLength, searchInput.value.length);
            }
          }
        }
      } catch (err) {
        console.error('Autocomplete suggestions query failed:', err);
      }
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatTemperature,
    weatherLabelFromCode,
    getAqiStatus,
    setWeatherLoading,
    updateWeatherWidget,
    fetchWeatherForCoordinates,
    loadWeather
  };
}
