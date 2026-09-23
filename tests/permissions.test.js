const test = require('node:test');
const assert = require('node:assert/strict');

const permissions = require('../src/main/permissions');

test('Permissions Subsystem Suite', async (t) => {
  await t.test('normalizes permission strings consistently', () => {
    assert.equal(permissions.normalizePermission('geolocation'), 'location');
    assert.equal(permissions.normalizePermission('audio'), 'microphone');
    assert.equal(permissions.normalizePermission('video'), 'camera');
    assert.equal(permissions.normalizePermission('clipboard-read'), 'clipboard-read');
  });

  await t.test('extracts hostname and origin cleanly', () => {
    assert.equal(permissions.getOrigin('https://meet.google.com/abc-xyz'), 'meet.google.com');
    assert.equal(permissions.getOrigin('http://localhost:3000/dashboard'), 'localhost');
  });
});
