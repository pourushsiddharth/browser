const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Simulate an isolated user data directory for testing
const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'vayu-test-db-'));
process.env.VAYU_USER_DATA = tempUserData;

const db = require('../src/main/db');

test('Database Subsystem Suite', async (t) => {
  await t.test('initializes default schema with version 2', () => {
    const loaded = db.loadDb();
    assert.equal(loaded.schemaVersion, 2);
    assert.ok(Array.isArray(loaded.history));
    assert.ok(Array.isArray(loaded.bookmarks));
    assert.ok(Array.isArray(loaded.downloads));
    assert.ok(Array.isArray(loaded.passwords));
    assert.ok(typeof loaded.settings === 'object');
    assert.ok(typeof loaded.session === 'object');
  });

  await t.test('encrypts and decrypts passwords consistently', () => {
    const plaintext = 'SuperSecret123!';
    const encrypted = db.encryptPassword(plaintext);
    assert.notEqual(encrypted, plaintext);
    assert.ok(encrypted.startsWith('enc:') || encrypted.startsWith('gcm:'));

    const decrypted = db.decryptPassword(encrypted);
    assert.equal(decrypted, plaintext);
  });

  await t.test('performs atomic writes creating valid database and backup files', () => {
    const current = db.getDb();
    current.history.push({ url: 'https://vayu.in', title: 'Vayu Browser', timestamp: Date.now() });
    db.setDbDirty(true);
    db.saveDb();

    const dbFile = path.join(tempUserData, 'orbit-data.json');
    assert.ok(fs.existsSync(dbFile), 'orbit-data.json must exist');

    const content = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    assert.equal(content.history.length, 1);
    assert.equal(content.history[0].url, 'https://vayu.in');
  });

  await t.test('recovers from backup when primary file is corrupted', () => {
    const dbFile = path.join(tempUserData, 'orbit-data.json');
    const bakFile = path.join(tempUserData, 'orbit-data.json.bak');

    // Create a known good state in backup
    const goodData = {
      schemaVersion: 2,
      history: [{ url: 'https://recovery-test.org', title: 'Recovery' }],
      bookmarks: [],
      downloads: [],
      passwords: [],
      settings: {},
      session: { tabs: [], activeTabIndex: 0 }
    };
    fs.writeFileSync(bakFile, JSON.stringify(goodData, null, 2), 'utf8');

    // Corrupt primary file with broken JSON
    fs.writeFileSync(dbFile, '{ broken json corrupted !!!', 'utf8');

    // loadDb should gracefully recover from .bak
    const recovered = db.loadDb();
    assert.equal(recovered.history[0].url, 'https://recovery-test.org');
  });
});
