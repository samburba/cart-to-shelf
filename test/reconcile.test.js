import test from 'node:test';
import assert from 'node:assert/strict';
import { listKey, reconcileItems } from '../src/lib/reconcile.js';

const CART = 'https://www.amazon.com/gp/cart/view.html';
const WISH = 'https://www.amazon.com/hz/wishlist/ls/ABC123';

test('a list keeps one identity across ref params and pagination', () => {
  const key = listKey(CART);
  assert.equal(listKey('https://www.amazon.com/gp/cart/view.html?ref_=nav_cart'), key);
  assert.equal(listKey('https://www.amazon.com/gp/cart/view.html?pageNumber=3'), key);
  assert.equal(listKey('https://www.amazon.com/gp/cart/'), key, 'trailing slash');
  assert.notEqual(listKey(WISH), key, 'a wish list is a different list');
  assert.equal(listKey('not a url'), '');
});

const item = (asin, extra = {}) => ({ asin, title: asin, selected: true, ...extra });

test('a rescan removes what is no longer on that list', () => {
  const previous = [
    item('A', { sourceUrl: listKey(CART) }),
    item('B', { sourceUrl: listKey(CART) }),
  ];
  // B was removed from the cart.
  const after = reconcileItems(previous, [item('A')], listKey(CART));

  assert.deepEqual(Array.from(after, (i) => i.asin), ['A'], 'this is the removal case');
});

test('other lists are untouched by a rescan', () => {
  const previous = [
    item('A', { sourceUrl: listKey(CART) }),
    item('W', { sourceUrl: listKey(WISH) }),
  ];
  const after = reconcileItems(previous, [], listKey(CART));

  assert.deepEqual(
    Array.from(after, (i) => i.asin),
    ['W'],
    'emptying the cart must not empty a wish list scanned earlier'
  );
});

test('scans of different lists still accumulate', () => {
  let items = reconcileItems([], [item('A'), item('B')], listKey(CART));
  items = reconcileItems(items, [item('W')], listKey(WISH));

  assert.deepEqual(Array.from(items, (i) => i.asin).sort(), ['A', 'B', 'W']);
});

test('a manual tick survives a rescan', () => {
  const previous = [item('A', { sourceUrl: listKey(CART), selected: false })];
  const after = reconcileItems(previous, [item('A', { selected: true })], listKey(CART));

  assert.equal(after[0].selected, false, 'the user unticked it; a refresh must not undo that');
});

test('fresh fields overwrite stale ones', () => {
  const previous = [item('A', { sourceUrl: listKey(CART), title: 'AA', lastError: 'boom' })];
  const after = reconcileItems(previous, [{ asin: 'A', title: 'Correct Title' }], listKey(CART));

  assert.equal(after[0].title, 'Correct Title');
});

test('an unknown key accumulates rather than clearing everything', () => {
  const previous = [item('A', { sourceUrl: listKey(CART) })];
  const after = reconcileItems(previous, [item('B')], '');

  assert.deepEqual(Array.from(after, (i) => i.asin).sort(), ['A', 'B']);
});
