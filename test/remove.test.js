// This is the only destructive code in the extension, so its guard rails get
// tested harder than anything else here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRemover } from './helpers.js';

test('finds the delete control for a cart item', () => {
  const { api, document } = loadRemover('cart.html');
  const found = api.findRemovable(document, '0143039563');

  assert.ok(found);
  assert.equal(found.surface, 'cart');
  assert.equal(found.control.getAttribute('value'), 'Delete');
});

test('finds the delete control for a save-for-later item', () => {
  const { api, document } = loadRemover('cart.html');
  assert.equal(api.findRemovable(document, '0374533555').surface, 'saved');
});

test('refuses wish list items outright', () => {
  const { api, document } = loadRemover('wishlist.html');
  assert.equal(
    api.findRemovable(document, '0374602603'),
    null,
    'wish lists are curated and deletions there have no undo'
  );
});

test('an unknown asin removes nothing', () => {
  const { api, document } = loadRemover('cart.html');
  assert.equal(api.findRemovable(document, 'B0DOESNOT'), null);
  assert.equal(api.removeOne('B0DOESNOT').ok, false);
  assert.equal(api.removeOne('').ok, false, 'an empty asin must never match');
});

test('clicks only the control belonging to the matched item', () => {
  const { api, document } = loadRemover('cart.html');
  const clicked = [];
  for (const input of document.querySelectorAll('input[name^="submit.delete"]')) {
    input.click = () => clicked.push(input.closest('[data-asin]').getAttribute('data-asin'));
  }

  const result = api.removeOne('0374533555');
  assert.equal(result.ok, true);
  assert.deepEqual(clicked, ['0374533555'], 'exactly one delete, and the right one');
});
