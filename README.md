<div align="center">
  <img src="vayu_app_logo.png" alt="Vayu Browser Logo" width="120" />

  # 🌬️ Vayu Browser

  **A sleek, ultra-fast, and privacy-focused desktop web browser built with Electron and Chromium.**

  [![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](package.json)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
  [![Electron](https://img.shields.io/badge/Electron-31.0.0-47848F.svg)](https://www.electronjs.org/)
  [![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)]()

</div>

---

## 🌟 Overview

**Vayu Browser** is engineered for speed, simplicity, and privacy. Designed with a minimal cognitive footprint, Vayu eliminates web clutter while providing modern browsing features such as built-in ad blocking, incognito mode, customizable new tabs, reader view, and multi-engine web search.

---

## ✨ Features

- 🛡️ **Built-in Shield (Ad & Tracker Blocker):** Automatically blocks intrusive advertisements, tracking scripts, and popups for faster page loads and enhanced privacy.
- 🔒 **Incognito & Private Tabs:** Browse without leaving local trace—history, cookies, and cache are cleared automatically.
- ⚡ **Ultra-Fast & Responsive:** Powered by Chromium and Electron with optimized WebContents view rendering.
- 🎨 **Sleek New Tab Page:** Custom start page with clock, smart greetings, wallpaper backgrounds, quick access shortcuts, and search widgets.
- 🔍 **Multi-Search Engine Integration:** Seamlessly search using Google, DuckDuckGo, Bing, Yahoo, Yandex, Qmamu, or Sarvam AI.
- 📖 **Distraction-Free Reader Mode:** Converts articles into clean, readable text layouts free of advertisements and sidebars.
- 📑 **Advanced Tab & Header Management:**
  - Tab grouping, pinned tabs, and smooth switching.
  - Immersive full-screen mode and compact header toggles for maximum screen area.
- 🔖 **Bookmarks & History:** Complete bookmark management bar alongside searchable browsing history.
- ⬇️ **Download Manager:** Integrated downloads tray to monitor and manage file downloads easily.

---

## 🚀 Quick Start

### Prerequisites

Ensure you have [Node.js](https://nodejs.org/) (v18 or higher recommended) and `npm` installed on your machine.

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/pourushsiddharth/browser.git
   cd browser
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Launch Vayu Browser:**
   ```bash
   npm start
   ```

> 💡 **Windows Shortcut:** You can also double-click `Start Orbit.bat` to quickly run the browser without opening a command prompt.

---

## 📦 Building & Packaging

### Standard Windows Build (Unpacked)
To create an unpacked executable version for Windows:
```bash
npm run build
```
The compiled application output will be saved in the `dist/` directory.

### Windows NSIS Installer Setup
To generate a standalone setup wizard installer (`.exe`):
```bash
npm run dist
```
The generated installer will be located under `dist/installer/`.

---

## 🛠️ Project Structure

```
├── main.js                   # Electron main process & window lifecycle
├── adblocker.js               # Ad & tracker blocking engine logic
├── preload.js                # Preload bridge for secure IPC communication
├── renderer.js               # Browser UI renderer & tab control
├── index.html                # Main browser container layout
├── style.css                 # Main application styling
├── newtab.html / .js / .css  # Customizable New Tab page
├── setup-wizard.*            # Initial browser setup & onboarding wizard
├── build/                    # Installer configuration & custom NSIS scripts
├── vayu_app_logo.png         # Official Vayu app branding assets
└── package.json              # Project dependencies & build configurations
```

---

## 📬 Feedback & Support

If you encounter any issues, have suggestions, or want to contribute to Vayu Browser:
- **Author:** Pourush Siddharth
- **Email:** [pourushsiddharth@gmail.com](mailto:pourushsiddharth@gmail.com)
- **GitHub Repository:** [pourushsiddharth/browser](https://github.com/pourushsiddharth/browser)

---

<div align="center">
  <sub>Built with ❤️ using Electron & Chromium | © 2026 Vayu Browser</sub>
</div>
