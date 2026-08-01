// The Goodreads writer leans on undocumented markup and an undocumented
// endpoint. These tests pin the shapes it currently expects, so when Goodreads
// changes something the failure is a red test rather than a silent no-op.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { loadGoodreads, read } from './helpers.js';

const parseDoc = (html) => parseHTML(html).document;

const SEARCH_HTML = read('fixtures/goodreads-search.html');
const PAGE = '<html><head><meta name="csrf-token" content="TOK"></head><body></body></html>';

function fetcher(handlers) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    for (const [pattern, make] of Object.entries(handlers)) {
      if (String(url).includes(pattern)) return make(String(url), options);
    }
    return { ok: false, status: 404, url: String(url), text: async () => '' };
  };
  return { fetchImpl, calls };
}

const ok = (body, url = 'https://www.goodreads.com/search') => () => ({
  ok: true,
  status: 200,
  url,
  text: async () => body,
});

const BOOK = { asin: '0143039563', title: 'Crime and Punishment', isbn: '0143039563' };

test('reads the csrf token out of the page', () => {
  const { api } = loadGoodreads({ pageHtml: PAGE });
  assert.equal(api.csrfToken(), 'TOK');
});

test('pulls the first book id out of a search results page', () => {
  const { api } = loadGoodreads({ pageHtml: PAGE });
  assert.equal(api.bookIdFrom(parseDoc(SEARCH_HTML)), '7144', 'first result wins');
});

test('bookIdFrom returns null rather than guessing on an unfamiliar page', () => {
  const { api } = loadGoodreads({ pageHtml: PAGE });
  assert.equal(api.bookIdFrom(parseDoc('<html><body><p>hello</p></body></html>')), null);
});

const ISBN_REDIRECT = ok('', 'https://www.goodreads.com/book/show/7144.Crime_and_Punishment');

test('shelves a book in two requests: isbn lookup, then the shelf post', async () => {
  const { fetchImpl, calls } = fetcher({
    '/book/isbn/': ISBN_REDIRECT,
    '/shelf/add_to_shelf.json': ok('{"shelf":{"name":"to-read"}}'),
  });
  const { api } = loadGoodreads({ pageHtml: PAGE, fetchImpl });

  assert.deepEqual({ ...(await api.shelveOne(BOOK)) }, { ok: true, goodreadsId: '7144' });

  assert.equal(calls.length, 2, 'the isbn path skips search entirely');
  assert.match(calls[0].url, /\/book\/isbn\/0143039563/);

  const post = calls[1];
  assert.equal(post.options.method, 'POST');
  assert.equal(post.options.headers['X-CSRF-Token'], 'TOK');
  assert.match(post.options.body, /name=to-read/);
  assert.match(post.options.body, /book_id=7144/);
});

test('a known book id skips lookup altogether — one request', async () => {
  const { fetchImpl, calls } = fetcher({ '/shelf/add_to_shelf.json': ok('{}') });
  const { api } = loadGoodreads({ pageHtml: PAGE, fetchImpl });

  const result = await api.shelveOne({ ...BOOK, goodreadsId: '7144' });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1, 'a cached id is the whole point');
  assert.match(calls[0].url, /add_to_shelf/);
});

test('falls back to search when the isbn lookup misses', async () => {
  const { fetchImpl, calls } = fetcher({
    '/book/isbn/': () => ({ ok: false, status: 404, url: '', text: async () => '' }),
    '/search': ok(SEARCH_HTML),
    '/shelf/add_to_shelf.json': ok('{}'),
  });
  const { api } = loadGoodreads({ pageHtml: PAGE, fetchImpl });

  assert.equal((await api.shelveOne(BOOK)).goodreadsId, '7144');
  assert.match(calls[0].url, /\/book\/isbn\//);
  assert.match(calls[1].url, /\/search/, 'search is the safety net, not the default');
});

test('a book with no isbn goes straight to search', async () => {
  const { fetchImpl, calls } = fetcher({
    '/search': ok(SEARCH_HTML),
    '/shelf/add_to_shelf.json': ok('{}'),
  });
  const { api } = loadGoodreads({ pageHtml: PAGE, fetchImpl });

  await api.shelveOne({ asin: 'B07C6DPLL5', title: 'Crime and Punishment' });
  assert.match(calls[0].url, /\/search/);
});

test('a search that redirects straight to the book is honoured', async () => {
  const { fetchImpl } = fetcher({
    '/search': ok('<html><body>redirected</body></html>', 'https://www.goodreads.com/book/show/4321.Piranesi'),
    '/shelf/add_to_shelf.json': ok('{}'),
  });
  const { api } = loadGoodreads({ pageHtml: PAGE, fetchImpl });

  assert.equal((await api.shelveOne(BOOK)).goodreadsId, '4321');
});

test('falls back to a title+author search when the isbn finds nothing', async () => {
  let first = true;
  const { fetchImpl, calls } = fetcher({
    '/search': () => {
      if (first) {
        first = false;
        return { ok: true, status: 200, url: 'https://www.goodreads.com/search', text: async () => '<html><body>no results</body></html>' };
      }
      return { ok: true, status: 200, url: 'https://www.goodreads.com/search', text: async () => SEARCH_HTML };
    },
    '/shelf/add_to_shelf.json': ok('{}'),
  });
  const { api } = loadGoodreads({
    pageHtml: PAGE,
    fetchImpl,
  });

  const result = await api.shelveOne({ ...BOOK, author: 'Fyodor Dostoevsky' });
  assert.equal(result.ok, true);
  const titleSearch = calls.map((c) => decodeURIComponent(c.url)).find((u) => u.includes('Fyodor'));
  assert.match(titleSearch, /Crime and Punishment Fyodor Dostoevsky/);
});

test('queries loosen: isbn, title+author, title, then main title only', () => {
  const { api } = loadGoodreads({ pageHtml: PAGE });
  const queries = api.queriesFor({
    isbn: '1416594736',
    title: 'Doc Holliday: The Life and Legend (Penguin Classics)',
    author: 'Gary L. Roberts',
  });

  assert.deepEqual(Array.from(queries), [
    '1416594736',
    'Doc Holliday: The Life and Legend Gary L. Roberts',
    'Doc Holliday: The Life and Legend',
    'Doc Holliday Gary L. Roberts',
  ]);
});

test('edition furniture is stripped from queries', () => {
  const { api } = loadGoodreads({ pageHtml: PAGE });
  const queries = Array.from(
    api.queriesFor({ title: 'The Overstory: A Novel [Paperback]', author: 'Richard Powers' })
  );
  assert.equal(queries[0], 'The Overstory Richard Powers');
});

test('a book with no isbn and no author still produces a query', () => {
  const { api } = loadGoodreads({ pageHtml: PAGE });
  assert.deepEqual(Array.from(api.queriesFor({ title: 'Piranesi' })), ['Piranesi']);
});

test('an html response to the shelf post means the session expired', async () => {
  const { fetchImpl } = fetcher({
    '/search': ok(SEARCH_HTML),
    '/shelf/add_to_shelf.json': ok('<html><body>Sign in</body></html>'),
  });
  const { api } = loadGoodreads({ pageHtml: PAGE, fetchImpl });

  assert.deepEqual({ ...await api.shelveOne(BOOK) }, { ok: false, reason: 'not-signed-in' });
});

test('reports the status code when the shelf post is rejected', async () => {
  const { fetchImpl } = fetcher({
    '/search': ok(SEARCH_HTML),
    '/shelf/add_to_shelf.json': () => ({ ok: false, status: 429, url: '', text: async () => '' }),
  });
  const { api } = loadGoodreads({ pageHtml: PAGE, fetchImpl });

  assert.deepEqual({ ...await api.shelveOne(BOOK) }, { ok: false, reason: 'HTTP 429' });
});

test('a book with no search hit is reported, not silently skipped', async () => {
  const { fetchImpl } = fetcher({ '/search': ok('<html><body>nothing</body></html>') });
  const { api } = loadGoodreads({ pageHtml: PAGE, fetchImpl });

  assert.deepEqual({ ...await api.shelveOne(BOOK) }, {
    ok: false,
    reason: 'not-found-on-goodreads',
  });
});

test('a missing csrf token fails fast without touching the network', async () => {
  const { fetchImpl, calls } = fetcher({});
  const { api } = loadGoodreads({ pageHtml: '<html><head></head><body></body></html>', fetchImpl });

  assert.deepEqual({ ...await api.shelveOne(BOOK) }, { ok: false, reason: 'no-csrf-token' });
  assert.equal(calls.length, 0);
});

test('a thrown fetch becomes a failure result, never an escaped exception', async () => {
  const fetchImpl = async () => {
    throw new Error('NetworkError');
  };
  const { api } = loadGoodreads({ pageHtml: PAGE, fetchImpl });

  const result = await api.shelveOne(BOOK);
  assert.equal(result.ok, false);
  assert.match(result.reason, /NetworkError/);
});
