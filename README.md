# Vayu Browser

A privacy-focused desktop web browser built on Chromium and Electron.

---

## Overview

Vayu Browser is a lightweight desktop browser designed for speed, privacy, and simplicity. It provides an efficient browsing environment with built-in content blocking, customizable new tabs, privacy modes, and minimal resource usage.

## Features

- **Ad and Tracker Protection**: Integrated content blocking engine that filters intrusive ads and third-party trackers.
- **Private Browsing**: Incognito sessions that prevent history, cookies, and local data persistence.
- **Performance Optimized**: Low-overhead architecture powered by Electron and modern Chromium WebContents views.
- **Customizable Start Page**: Configurable new tab environment with shortcuts, search engine selection, and widgets.
- **Multi-Engine Search Support**: Quick switching between Google, DuckDuckGo, Bing, Yahoo, Yandex, Qmamu, and Sarvam AI.
- **Reader Mode**: Distraction-free article reader that strips clutter, sidebars, and ads.
- **Tab and Window Management**: Pinned tabs, tab groups, compact chrome toggles, and full-screen view.
- **Local Data Management**: Built-in bookmarking, history management, and download monitoring.

## System Requirements

- Windows 10 / 11 (x64)
- Node.js 18.0.0 or higher
- npm 9.0.0 or higher

## Getting Started

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/pourushsiddharth/browser.git
   cd browser
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the application in development mode:
   ```bash
   npm start
   ```

## Build and Distribution

### Unpacked Distribution
To create an unpacked Windows application build:
```bash
npm run build
```
Build artifacts are placed in the `dist/` directory.

### Windows Installer
To package the application into a standalone NSIS installer executable:
```bash
npm run dist
```
The installer output is generated in `dist/installer/`.

## Testing

Execute the automated unit and integration test suite:
```bash
npm test
```

## Documentation

- [System Architecture](docs/ARCHITECTURE.md): Multi-process design, IPC contracts, and privacy boundaries.
- [Development Guide](docs/DEVELOPMENT.md): Setup, coding standards, and build instructions.

## Repository Structure

```
.
├── main.js                  # Application lifecycle and main process logic
├── preload.js               # Context isolation and IPC bridge
├── renderer.js              # Browser interface controller and tab orchestration
├── adblocker.js             # Network request filtering and tracker protection
├── index.html               # Main window shell markup
├── style.css                # Interface stylesheets
├── newtab.html / .js / .css # Custom new tab page implementation
├── setup-wizard.*           # Initial onboarding setup wizard
├── build/                   # Packaging assets and NSIS build scripts
└── package.json             # Project dependencies and script definitions
```

## Security and Privacy

Vayu Browser executes web sessions with strict context isolation, disabled Node.js integration inside web views, and sandboxed content processes. Local browsing logs and cached credentials remain strictly local to the user's system.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Contact

- **Author**: Pourush Siddharth
- **Email**: pourushsiddharth@gmail.com
- **Repository**: [https://github.com/pourushsiddharth/browser](https://github.com/pourushsiddharth/browser)
