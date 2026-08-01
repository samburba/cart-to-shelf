import test from 'node:test';
import assert from 'node:assert/strict';
import { installChrome } from './mocks.js';

installChrome();
const session = await import('../src/lib/session.js');
const store = await import('../src/lib/store.js');

test('an untouched session reads back as the empty default', async () => {
  installChrome();
  assert.deepEqual(await session.getSession(), session.EMPTY_SESSION);
});

test('patching merges rather than replaces, and survives a reload', async () => {
  installChrome();
  await session.patchSession({ status: 'resolving', total: 5 });
  await session.patchSession({ done: 2 });

  const s = await session.getSession();
  assert.equal(s.status, 'resolving');
  assert.equal(s.total, 5, 'the earlier field is not clobbered');
  assert.equal(s.done, 2);
  assert.deepEqual(s.items, [], 'defaults fill the gaps');
});

test('every patch broadcasts, so an open popup follows along', async () => {
  const chrome = installChrome();
  await session.patchSession({ status: 'shelving' });

  const last = chrome._sent.at(-1);
  assert.equal(last.type, 'session');
  assert.equal(last.session.status, 'shelving');
});

test('a queue outlives the run that created it', async () => {
  installChrome();
  await session.patchSession({ status: 'shelving', queue: [{ asin: 'A' }, { asin: 'B' }] });
  // Simulating a worker restart: nothing in memory, everything in storage.
  const revived = await session.getSession();
  assert.equal(revived.queue.length, 2, 'this is what makes an interrupted batch resumable');
});

test('settings default sanely, and the destructive one defaults off', async () => {
  installChrome();
  const s = await session.getSettings();
  assert.equal(s.autoScan, true);
  assert.equal(s.removeAdded, true);
  assert.equal(s.removeFromAmazon, false, 'deleting from Amazon is never a default');
});

test('settings patch merges', async () => {
  installChrome();
  await session.setSettings({ autoScan: false });
  const s = await session.getSettings();
  assert.equal(s.autoScan, false);
  assert.equal(s.removeAdded, true);
});

test('setBadge is a no-op where the action api is absent', async () => {
  installChrome();
  await session.setBadge(3); // must not throw in a browser without chrome.action
});

test('sent asins accumulate and can be cleared', async () => {
  installChrome();
  assert.equal((await store.getSent()).size, 0);

  await store.markSent(['A', 'B']);
  await store.markSent(['B', 'C']);
  const sent = await store.getSent();
  assert.deepEqual([...sent].sort(), ['A', 'B', 'C'], 'deduped');

  await store.clearSent();
  assert.equal((await store.getSent()).size, 0);
});

test('a cache written by an older version is discarded wholesale', async () => {
  const chrome = installChrome();
  // A miss cached back when titles were being scraped wrong.
  await chrome.storage.local.set({
    isbnCache: { B0OLDBUG000: { at: Date.now(), value: { isbn: null, source: 'none' } } },
    isbnCacheVersion: 1,
  });

  assert.equal(
    await store.getCached('B0OLDBUG000'),
    null,
    'a poisoned miss must not outlive the bug that caused it'
  );
  assert.equal(chrome._store.isbnCacheVersion, 2);
});

test('a stale cache entry is ignored', async () => {
  const chrome = installChrome();
  await store.setCached('B0STALE000', { isbn: '0143039563', source: 'openlibrary' });
  assert.ok(await store.getCached('B0STALE000'));

  // Backdate it past the 90-day ttl.
  const cache = chrome._store.isbnCache;
  cache['B0STALE000'].at = Date.now() - 1000 * 60 * 60 * 24 * 91;
  await chrome.storage.local.set({ isbnCache: cache });

  assert.equal(await store.getCached('B0STALE000'), null);
  assert.equal(await store.getCached('B0NEVERSET'), null);
});
