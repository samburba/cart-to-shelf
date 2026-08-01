import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { loadAmazonScraper } from './helpers.js';

test('cart: extracts books from active cart and save-for-later', () => {
  const { api, document } = loadAmazonScraper('cart.html');
  const items = api.extractFrom(document);

  assert.equal(items.length, 5, 'every item is surfaced, books or not');

  const byAsin = Object.fromEntries(items.map((i) => [i.asin, i]));

  const crime = byAsin['0143039563'];
  assert.equal(crime.title, 'Crime and Punishment');
  assert.equal(crime.author, 'Fyodor Dostoevsky');
  assert.equal(crime.surface, 'cart');
  assert.equal(crime.confidence, 'yes');

  const kindle = byAsin['B07C6DPLL5'];
  assert.equal(kindle.confidence, 'yes', 'format string proves book-ness');
  assert.equal(kindle.format, 'Kindle Edition');

  const kahneman = byAsin['0374533555'];
  assert.equal(kahneman.surface, 'saved');
  assert.equal(kahneman.confidence, 'yes');
});

test("the truncation widget's doubled title is read once, not twice", () => {
  const { api, document } = loadAmazonScraper('cart.html');
  const doc = api.extractFrom(document).find((i) => i.asin === '1416594736');

  assert.equal(
    doc.title,
    'Doc Holliday: The Life and Legend',
    'not "Doc Holliday: The Life and LegendDoc Holliday: The Life and Legend"'
  );
  assert.ok(!/opens in a new tab/i.test(doc.title), 'no screen-reader label');
  assert.equal(doc.author, 'Gary L. Roberts');
});

test('a doubled string is collapsed even without the widget markup', () => {
  const { api, document } = loadAmazonScraper('cart.html');
  const el = document.querySelector('#sc-active-cart [data-asin="0143039563"]');
  el.querySelector('.sc-product-title').textContent = 'PiranesiPiranesi';

  const item = api.extractItem(el, 'cart');
  assert.equal(item.title, 'Piranesi');
});

test('cart: a non-book is flagged rather than dropped', () => {
  const { api, document } = loadAmazonScraper('cart.html');
  const cable = api.extractFrom(document).find((i) => i.asin === 'B08L5NP6NG');

  assert.ok(cable, 'never silently discarded — the user arbitrates');
  assert.equal(cable.confidence, 'maybe');
  assert.equal(cable.author, '');
});

test('wishlist: falls through the selector cascade for asin and title', () => {
  const { api, document } = loadAmazonScraper('wishlist.html');
  const items = api.extractFrom(document);

  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.surface === 'wishlist'));

  const graeber = items[0];
  assert.equal(graeber.asin, '0374602603');
  assert.equal(graeber.via.asin, 'reposition-params');
  assert.equal(graeber.via.title, 'title-attr');
  assert.equal(graeber.author, 'David Graeber and David Wengrow');

  const piranesi = items[1];
  assert.equal(piranesi.asin, '163557563X', 'recovered from the /dp/ href');
  assert.equal(piranesi.via.asin, 'href');
  assert.equal(piranesi.confidence, 'yes', 'a valid ISBN-10 ASIN is proof enough');
});

test('an unrelated amazon page yields nothing rather than garbage', () => {
  const { api, document } = loadAmazonScraper('product.html');
  assert.equal(
    api.extractFrom(document).length,
    0,
    'only cart, saved, and wish list containers are read'
  );
});

test('an item with no recoverable title is skipped', () => {
  const { api, document } = loadAmazonScraper('cart.html');
  const container = document.querySelector('#sc-active-cart');
  const orphan = document.createElement('div');
  orphan.setAttribute('data-asin', '0000000000');
  container.append(orphan);

  const asins = api.extractFrom(document).map((i) => i.asin);
  assert.ok(!asins.includes('0000000000'), 'a title-less row is not shelvable');
});

test('the same book in two surfaces is reported once per surface', () => {
  const { api, document } = loadAmazonScraper('cart.html');
  const saved = document.querySelector('#sc-saved-cart');
  saved.innerHTML += document.querySelector('#sc-active-cart').innerHTML;

  const crime = api.extractFrom(document).filter((i) => i.asin === '0143039563');
  assert.equal(crime.length, 2);
  assert.deepEqual(Array.from(crime, (i) => i.surface).sort(), ['cart', 'saved']);
});

test('a row marked differently from its neighbours is still found', () => {
  const { api, document } = loadAmazonScraper('cart.html');
  const container = document.querySelector('#sc-active-cart');
  // data-asin only, no data-itemid — the shape that first-selector-wins missed.
  const odd = document.createElement('div');
  odd.setAttribute('data-asin', '0374602603');
  odd.innerHTML =
    '<span class="sc-product-title">The Dawn of Everything</span>' +
    '<div class="sc-product-byline">by David Graeber | Hardcover</div>';
  container.append(odd);

  const asins = api.extractFrom(document).map((i) => i.asin);
  assert.ok(asins.includes('0374602603'), 'selectors union, not first-match-wins');
});

test('finds the other pages of a paginated cart', () => {
  const { api, document } = loadAmazonScraper('cart.html');
  const urls = Array.from(
    api.paginationUrls(document, 'https://www.amazon.com/gp/cart/view.html')
  );

  assert.deepEqual(urls, [
    'https://www.amazon.com/gp/cart/view.html?pageNumber=2',
    'https://www.amazon.com/gp/cart/view.html?pageNumber=3',
  ], 'deduped, absolute, and excluding the page we are on');
});

test('pagination never follows a link off amazon', () => {
  const hostile = `<html><body>
      <a href="https://tracker.example/collect?pageNumber=2">next</a>
      <a href="//tracker.example/collect?page=2">next</a>
      <a href="http://www.amazon.com/gp/cart/view.html?pageNumber=2">insecure</a>
      <a href="/gp/cart/view.html?pageNumber=2">real next page</a>
    </body></html>`;
  const { api } = loadAmazonScraper('cart.html');
  const { document: doc } = parseHTML(hostile);

  assert.deepEqual(
    Array.from(api.paginationUrls(doc, 'https://www.amazon.com/gp/cart/view.html')),
    ['https://www.amazon.com/gp/cart/view.html?pageNumber=2'],
    'a page we are reading is not a trusted source of URLs to fetch'
  );
});

test('scan follows pagination and merges every page', async () => {
  const page2 = `<html><body><div id="sc-active-cart">
      <div data-asin="0374602603" data-itemid="p2">
        <a href="/dp/0374602603">x</a>
        <span class="sc-product-title">The Dawn of Everything</span>
        <div class="sc-product-byline">by David Graeber | Hardcover</div>
      </div></div>
      <ul class="a-pagination"><li><a href="/gp/cart/view.html?pageNumber=3">3</a></li></ul>
    </body></html>`;

  const page3 = `<html><body><div id="sc-active-cart">
      <div data-asin="163557563X" data-itemid="p3">
        <a href="/dp/163557563X">x</a>
        <span class="sc-product-title">Piranesi</span>
        <div class="sc-product-byline">by Susanna Clarke | Hardcover</div>
      </div></div></body></html>`;

  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(String(url));
    const body = String(url).includes('pageNumber=2') ? page2 : page3;
    return { ok: true, text: async () => body };
  };

  const { api } = loadAmazonScraper('cart.html', { fetch: fetchImpl });
  // The content script self-invokes on load (that call is executeScript's
  // return value); let it settle before measuring this scan's requests.
  await new Promise((r) => setTimeout(r, 50));
  requested.length = 0;

  const items = await api.scan();
  const asins = Array.from(items, (i) => i.asin);

  assert.equal(requested.length, 2, 'page 3 is discovered from page 2, not re-fetched');
  assert.ok(asins.includes('0143039563'), 'page one still read from the live DOM');
  assert.ok(asins.includes('0374602603'), 'page two');
  assert.ok(asins.includes('163557563X'), 'page three');
  assert.equal(new Set(asins).size, asins.length, 'no duplicates across pages');
});

test('a failed page fetch loses that page, not the whole scan', async () => {
  const fetchImpl = async () => ({ ok: false, text: async () => '' });
  const { api } = loadAmazonScraper('cart.html', { fetch: fetchImpl });

  const items = await api.scan();
  assert.ok(Array.from(items, (i) => i.asin).includes('0143039563'));
});

test('diagnostics report what matched and what was rejected', () => {
  const { api, document } = loadAmazonScraper('cart.html');
  const container = document.querySelector('#sc-active-cart');
  const orphan = document.createElement('div');
  orphan.setAttribute('data-asin', '0000000000');
  orphan.textContent = 'A row with no recoverable title';
  container.append(orphan);

  const report = api.diagnose(document);
  const cart = report.surfaces.find((s) => s.surface === 'cart');

  assert.equal(cart.container, '#sc-active-cart');
  assert.ok(cart.counts['[data-itemid]'] > 0, 'per-selector counts localize a miss');
  assert.ok(cart.items.some((i) => i.asin === '0143039563'));

  const rejected = report.rejected.find((r) => r.asin === '0000000000');
  assert.ok(rejected, 'a dropped row is explained, not hidden');
  assert.equal(rejected.title, null);
  assert.match(rejected.snippet, /no recoverable title/);
});

test('items are not double-counted when nested nodes also match', () => {
  const { api, document } = loadAmazonScraper('cart.html');
  const asins = api.extractFrom(document).map((i) => i.asin);
  assert.equal(new Set(asins).size, asins.length);
});
