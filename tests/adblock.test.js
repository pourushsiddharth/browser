const test = require('node:test');
const assert = require('node:assert/strict');

const adblock = require('../src/browser/adblock');

test('Adblocker Filtering Engine Suite', async (t) => {
  await t.test('blocks known advertising domains', () => {
    assert.equal(adblock.isBlocked('https://doubleclick.net/ad.js'), true);
    assert.equal(adblock.isBlocked('https://pagead2.googlesyndication.com/pagead/show_ads.js'), true);
    assert.equal(adblock.isBlocked('https://adnxs.com/banner'), true);
    assert.equal(adblock.isBlocked('https://criteo.com/delivery'), true);
  });

  await t.test('blocks tracking subdomains properly', () => {
    assert.equal(adblock.isBlocked('https://sub.doubleclick.net/tracker'), true);
    assert.equal(adblock.isBlocked('https://deep.sub.google-analytics.com/collect'), true);
  });

  await t.test('blocks known ad path and telemetry patterns', () => {
    assert.equal(adblock.isBlocked('https://example.com/ads/banner.gif'), true);
    assert.equal(adblock.isBlocked('https://news.org/track?id=123'), true);
    assert.equal(adblock.isBlocked('https://blog.net/scripts/telemetry.js'), true);
  });

  await t.test('allows benign web domains and first-party Google services', () => {
    assert.equal(adblock.isBlocked('https://google.com'), false);
    assert.equal(adblock.isBlocked('https://www.google.com/search?q=test'), false);
    assert.equal(adblock.isBlocked('https://fonts.gstatic.com/s/roboto/v30.woff2'), false);
    assert.equal(adblock.isBlocked('https://github.com/torvalds/linux'), false);
    assert.equal(adblock.isBlocked('https://en.wikipedia.org/wiki/Web_browser'), false);
  });

  await t.test('allows internal schemes and local protocols', () => {
    assert.equal(adblock.isBlocked('orbit://newtab'), false);
    assert.equal(adblock.isBlocked('file:///C:/Users/test/doc.pdf'), false);
  });
});
