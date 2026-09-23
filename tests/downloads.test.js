const test = require('node:test');
const assert = require('node:assert/strict');

const downloads = require('../src/main/downloads');

test('Download Security and Validation Suite', async (t) => {
  await t.test('sanitizes unsafe filenames and prevents path traversal', () => {
    assert.equal(downloads.sanitizeFilename('../../etc/passwd'), 'passwd');
    assert.equal(downloads.sanitizeFilename('..\\..\\Windows\\System32\\cmd.exe'), 'cmd.exe');
    assert.equal(downloads.sanitizeFilename('report:final?.pdf'), 'report_final_.pdf');
    assert.equal(downloads.sanitizeFilename('   clean_file.png   '), 'clean_file.png');
  });

  await t.test('detects dangerous executable file extensions', () => {
    assert.equal(downloads.isDangerousFile('setup.exe'), true);
    assert.equal(downloads.isDangerousFile('script.bat'), true);
    assert.equal(downloads.isDangerousFile('payload.vbs'), true);
    assert.equal(downloads.isDangerousFile('installer.msi'), true);
    assert.equal(downloads.isDangerousFile('automation.ps1'), true);
  });

  await t.test('identifies safe document and media extensions', () => {
    assert.equal(downloads.isDangerousFile('paper.pdf'), false);
    assert.equal(downloads.isDangerousFile('image.png'), false);
    assert.equal(downloads.isDangerousFile('song.mp3'), false);
    assert.equal(downloads.isDangerousFile('archive.zip'), false);
  });
});
