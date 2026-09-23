# System Architecture

Vayu Browser is a desktop browser engineered using Electron and Chromium, focusing on performance, privacy isolation, and minimalist user experience.

---

## 1. Process Separation Model

The browser architecture adheres to Chromium's multi-process separation model:

```text
                           +----------------------+
                           |     Main Process     |
                           |       (Node.js)      |
                           +----------+-----------+
                                      |
         +----------------------------+----------------------------+
         |                                                         |
         v                                                         v
+------------------------+                             +------------------------+
|   Main Browser Window  |                             |   WebContentsView Tabs |
|  (Chromium UI Renderer)|                             |  (Sandboxed Web Pages) |
|  nodeIntegration: false|                             |  nodeIntegration: false|
|  contextIsolation: true|                             |  contextIsolation: true|
|  preload: preload.js   |                             |  sandbox: true         |
+------------------------+                             +------------------------+
```

### Main Process
- Orchestrates window lifecycles, database operations, session management, and system integration.
- Hosts native OS-level encryption (`safeStorage`) for saved passwords.
- Enforces navigation guards and download validation.

### UI Renderer Process
- Powers the browser chrome (tabs bar, address bar, navigation controls, bookmarks bar, and sidebar).
- Zero Node.js runtime access. Interacts with the main process exclusively via typed IPC channels defined in `preload.js`.

### WebContentsView Tab Instances
- Render external web content in isolated Chromium sandbox views.
- Out-of-memory or tab crashes are isolated; a crashed tab never terminates the main browser frame.

---

## 2. Directory Structure

```text
browser/
├── main.js                  # Main process entry point
├── preload.js               # Context bridge for browser UI
├── preload-tab.js           # Context bridge for web views
├── renderer.js              # Browser UI interaction controller
├── index.html               # Main frame markup
├── style.css                # Visual design system
├── newtab.html              # Custom start page
│
├── src/
│   ├── main/
│   │   ├── db.js            # Atomic JSON database with safeStorage & backups
│   │   ├── permissions.js   # Origin-based granular permission system
│   │   ├── downloads.js     # Sandboxed download manager & security checks
│   │   ├── session-manager.js # Crash recovery & session restore
│   │   ├── tabs.js          # WebContentsView lifecycle management
│   │   ├── windows.js       # Auxiliary window references
│   │   ├── navigation.js    # URL validation and normalization
│   │   └── updater.js       # Auto-update integration
│   │
│   ├── browser/
│   │   ├── adblock.js       # Network-level content blocking engine
│   │   └── security.js      # IPC sender validation and schema sanitizer
│   │
│   └── renderer/
│       ├── address-bar.js   # Address bar auto-completion and URL formatting
│       └── controls.js      # Window framing and keyboard controls
│
├── tests/                   # Automated unit and integration test suites
├── docs/                    # Technical documentation
└── .github/workflows/       # CI/CD and automated release pipelines
```

---

## 3. Storage and Data Flow

All persistent user data is centralized in the user data directory:
- `orbit-data.json`: Primary JSON database.
- `orbit-data.json.bak`: Automatic backup fallback.
- `orbit-data.json.tmp`: Temporary file for atomic disk writes.

Atomic writes prevent corruption during abrupt power failures or unexpected shutdowns:
1. Write serialize payload to `.tmp`.
2. Copy current `.json` to `.bak`.
3. Atomic file rename `.tmp` to `.json`.

---

## 4. Privacy & Incognito Isolation

Incognito tabs are strictly partitioned using in-memory sessions:
- Session partition: `session.fromPartition('incognito')`.
- Zero disk caching or persistent cookies.
- No entries written to `db.history`, `db.downloads`, or `db.session`.
- Automatic cache and storage purge when all incognito tabs are closed.
