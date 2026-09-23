# Vayu Browser

A desktop web browser built with Electron and Chromium.

## Overview

Vayu Browser is a lightweight web browser designed for speed and simplicity. It includes built-in ad blocking, tab management, private browsing, and customizable search engines.

## Features

- Built-in ad and tracker blocker
- Private browsing mode (Incognito)
- Tab management (new tabs, tab closing, multi-tab navigation)
- Bookmarks and history management
- Download manager
- Multiple search engine options (Google, DuckDuckGo, Bing, Yahoo)
- Dark and light theme support

## Requirements

- Windows 10 / 11
- Node.js 18 or higher
- npm

## How to Run

1. Clone the repository:
   ```bash
   git clone https://github.com/pourushsiddharth/browser.git
   cd browser
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the application:
   ```bash
   npm start
   ```

## Build

To create an unpacked build:
```bash
npm run build
```

To create a Windows installer (.exe):
```bash
npm run dist
```

## Tests

Run the test suite:
```bash
npm test
```

## Project Structure

```
├── main.js                  Entry point (Electron main process)
├── preload.js               Secure bridge between main and renderer
├── renderer.js              Main UI logic
├── index.html               Main browser interface
├── style.css                UI styles
├── src/                     Modular source files (database, adblock, permissions, tabs)
├── tests/                   Unit test suite
└── package.json             Dependencies and scripts
```

## License

MIT License.
