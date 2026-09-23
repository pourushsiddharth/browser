# Development Guide

This guide details setup instructions, coding conventions, testing procedures, and contribution workflows for Vayu Browser.

---

## Prerequisites

- **Node.js**: Version 18.0.0 or higher
- **npm**: Version 9.0.0 or higher
- **Operating System**: Windows 10 / 11 (x64)

---

## Setup and Running

1. Install project dependencies:
   ```bash
   npm install
   ```

2. Start the application in development mode:
   ```bash
   npm start
   ```

---

## Testing and Verification

Before submitting pull requests or packaging releases, execute the automated test suite:

```bash
npm test
```

To run individual test files:
```bash
node --test tests/db.test.js
node --test tests/adblock.test.js
node --test tests/downloads.test.js
node --test tests/permissions.test.js
```

Syntax verification for JavaScript files:
```bash
node -c main.js
node -c preload.js
node -c src/main/*.js
node -c src/browser/*.js
```

---

## Packaging and Builds

### Unpacked Build
Generates unpacked application binaries in `dist/`:
```bash
npm run build
```

### Standalone NSIS Installer
Builds a production Windows installer executable:
```bash
npm run dist
```

---

## Security Guidelines

1. **Context Isolation**: Never set `nodeIntegration: true` or `contextIsolation: false` in any browser window.
2. **IPC Sender Validation**: Always verify event senders using `isTrustedSender(event)` in `ipcMain` handlers.
3. **Secrets Management**: Never commit API keys or private certificates to source control. Use environment variables (`.env`).
4. **Incognito Integrity**: Never persist data originating from incognito tabs to disk storage or logs.
