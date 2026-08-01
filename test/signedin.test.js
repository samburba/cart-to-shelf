// Signed-out pages are the failure mode most likely to be mistaken for a bug:
// a signed-out cart looks exactly like an empty one, and a signed-out Goodreads
// fails every single write for the same reason.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { loadAmazonScraper, loadGoodreads, read } from './helpers.js';

const doc = (name) => parseHTML(read(`fixtures/${name}`)).document;

test('amazon: a signed-out cart is recognised, not read as empty', () => {
  const { api } = loadAmazonScraper('cart.html');
  assert.equal(api.signedIn(doc('cart-signed-out.html')), false);
});

test('amazon: a signed-in page reports signed in', () => {
  const { api } = loadAmazonScraper('cart.html');
  const signedIn = parseHTML(
    '<html><body><a id="nav-link-accountList"><span id="nav-link-accountList-nav-line-1">Hello, Sam</span></a></body></html>'
  ).document;
  assert.equal(api.signedIn(signedIn), true);
});

// "Hello, sign in" is Amazon's signed-out greeting. Matching /hello/ first would
// read it as signed in, which is the wrong way round to be wrong.
test('amazon: the signed-out greeting is not mistaken for a name', () => {
  const { api } = loadAmazonScraper('cart.html');
  const greeting = parseHTML(
    '<html><body><a id="nav-link-accountList">Hello, sign in</a></body></html>'
  ).document;
  assert.equal(api.signedIn(greeting), false);
});

test('amazon: an unrecognised page returns null and blocks nothing', () => {
  const { api, document } = loadAmazonScraper('cart.html');
  assert.equal(
    api.signedIn(document),
    null,
    'unknown must never be treated as signed out — that would block a working scan'
  );
});

test('goodreads: sign-in links mean signed out', () => {
  const { api } = loadGoodreads({ pageHtml: '<html></html>' });
  assert.equal(api.signedIn(doc('goodreads-signed-out.html')), false);
});

test('goodreads: a csrf token proves nothing about the session', () => {
  const { api } = loadGoodreads({ pageHtml: '<html></html>' });
  const signedOut = doc('goodreads-signed-out.html');
  assert.ok(
    signedOut.querySelector('meta[name="csrf-token"]'),
    'the signed-out page has a token too'
  );
  assert.equal(api.signedIn(signedOut), false);
});

test('goodreads: a sign-out link means signed in', () => {
  const { api } = loadGoodreads({ pageHtml: '<html></html>' });
  assert.equal(api.signedIn(doc('goodreads-signed-in.html')), true);
});

test('goodreads: an unfamiliar page returns null', () => {
  const { api } = loadGoodreads({ pageHtml: '<html></html>' });
  assert.equal(api.signedIn(doc('goodreads-search.html')), null);
});
