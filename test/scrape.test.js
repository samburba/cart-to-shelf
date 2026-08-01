import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAmazonScraper } from './helpers.js';

test('cart: extracts books from active cart and save-for-later', () => {
  const { api, document } = loadAmazonScraper('cart.html');
  const items = api.extractFrom(document);

  assert.equal(items.length, 4, 'every item is surfaced, books or not');

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

test('items are not double-counted when nested nodes also match', () => {
  const { api, document } = loadAmazonScraper('cart.html');
  const asins = api.extractFrom(document).map((i) => i.asin);
  assert.equal(new Set(asins).size, asins.length);
});
