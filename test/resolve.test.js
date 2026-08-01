import test from 'node:test';
import assert from 'node:assert/strict';
import { installChrome, installFetch } from './mocks.js';

// chrome must exist before the module under test first touches storage.
installChrome();
const { resolveIsbn, resolveAll } = await import('../src/lib/resolve.js');

const OL = 'openlibrary.org';
const GB = 'googleapis.com';

const KINDLE = { asin: 'B07C6DPLL5', title: 'The Overstory', author: 'Richard Powers' };

test('a print asin is the isbn — no network at all', async () => {
  installChrome();
  const calls = installFetch({});

  const result = await resolveIsbn({ asin: '0143039563', title: 'Crime and Punishment' });
  assert.deepEqual(result, { isbn: '0143039563', source: 'asin' });
  assert.equal(calls.length, 0, 'the cheap path must stay free');
});

test('an opaque asin resolves through open library', async () => {
  installChrome();
  installFetch({ [OL]: { docs: [{ isbn: ['9780393635225'] }] } });

  assert.deepEqual(await resolveIsbn(KINDLE), {
    isbn: '9780393635225',
    source: 'openlibrary',
  });
});

test('open library results failing validation are skipped', async () => {
  installChrome();
  installFetch({
    [OL]: { docs: [{ isbn: ['not-an-isbn', '1234567890'] }, { isbn: ['9780393635225'] }] },
  });

  const result = await resolveIsbn(KINDLE);
  assert.equal(result.isbn, '9780393635225', 'bad check digits are not accepted');
});

test('google books is the fallback when open library has nothing', async () => {
  installChrome();
  const calls = installFetch({
    [OL]: { docs: [] },
    [GB]: { items: [{ volumeInfo: { industryIdentifiers: [{ identifier: '0374533555' }] } }] },
  });

  assert.deepEqual(await resolveIsbn(KINDLE), {
    isbn: '0374533555',
    source: 'googlebooks',
  });
  assert.equal(calls.length, 2, 'open library is tried first, once');
});

test('both lookups failing yields a title-only result, not a throw', async () => {
  installChrome();
  installFetch({ [OL]: { docs: [] }, [GB]: { items: [] } });

  assert.deepEqual(await resolveIsbn(KINDLE), { isbn: null, source: 'none' });
});

test('a network error is swallowed into a null result', async () => {
  installChrome();
  installFetch({ [OL]: new Error('offline'), [GB]: new Error('offline') });

  assert.deepEqual(await resolveIsbn(KINDLE), { isbn: null, source: 'none' });
});

test('results are cached by asin, including misses', async () => {
  installChrome();

  let calls = installFetch({ [OL]: { docs: [{ isbn: ['9780393635225'] }] } });
  await resolveIsbn(KINDLE);
  assert.equal(calls.length, 1);

  calls = installFetch({ [OL]: { docs: [{ isbn: ['9999999999999'] }] } });
  const second = await resolveIsbn(KINDLE);
  assert.equal(calls.length, 0, 'a cache hit makes no requests');
  assert.equal(second.isbn, '9780393635225');

  // A miss is cached too — an unmatched title will not suddenly acquire one.
  installFetch({ [OL]: { docs: [] }, [GB]: { items: [] } });
  await resolveIsbn({ asin: 'B00MISSMISS', title: 'Nonexistent' });
  const calls3 = installFetch({});
  await resolveIsbn({ asin: 'B00MISSMISS', title: 'Nonexistent' });
  assert.equal(calls3.length, 0);
});

test('an item with no title never queries anything', async () => {
  installChrome();
  const calls = installFetch({});

  assert.deepEqual(await resolveIsbn({ asin: 'B0NOTITLE0', title: '' }), {
    isbn: null,
    source: 'none',
  });
  assert.equal(calls.length, 0);
});

test('resolveAll preserves order and reports progress for every item', async () => {
  installChrome();
  installFetch({ [OL]: { docs: [] }, [GB]: { items: [] } });

  const items = [
    { asin: '0143039563', title: 'A' },
    { asin: '0374533555', title: 'B' },
    { asin: 'B07C6DPLL5', title: 'C' },
  ];
  const progress = [];
  const out = await resolveAll(items, (done, total) => progress.push([done, total]));

  assert.deepEqual(
    out.map((i) => i.title),
    ['A', 'B', 'C']
  );
  assert.deepEqual(progress, [
    [1, 3],
    [2, 3],
    [3, 3],
  ]);
  assert.equal(out[0].source, 'asin');
  assert.equal(out[2].source, 'none');
  assert.equal(out[2].asin, 'B07C6DPLL5', 'the original fields survive the merge');
});
