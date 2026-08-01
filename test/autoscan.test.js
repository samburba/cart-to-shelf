import test from 'node:test';
import assert from 'node:assert/strict';
import { isScannable, createScanGate } from '../src/lib/autoscan.js';

test('recognises the several ways amazon writes a cart url', () => {
  for (const url of [
    'https://www.amazon.com/gp/cart/view.html',
    'https://www.amazon.com/gp/cart/view.html?ref_=nav_cart',
    'https://www.amazon.com/cart?ref_=nav_cart',
    'https://www.amazon.com/cart',
    'https://www.amazon.com/cart/smart-wagon',
    'https://www.amazon.co.uk/gp/cart/view.html',
  ]) {
    assert.ok(isScannable(url), url);
  }
});

test('recognises wish list urls', () => {
  for (const url of [
    'https://www.amazon.com/hz/wishlist/ls/ABC123',
    'https://www.amazon.com/registry/wishlist/ABC123',
    'https://www.amazon.com/gp/registry/wishlist/ABC',
  ]) {
    assert.ok(isScannable(url), url);
  }
});

test('ignores everything else on amazon', () => {
  for (const url of [
    'https://www.amazon.com/Crime-Punishment/dp/0143039563',
    'https://www.amazon.com/gp/css/order-history',
    'https://www.amazon.com/',
    'https://www.goodreads.com/review/import',
    '',
  ]) {
    assert.equal(isScannable(url), false, url);
  }
});

const CART = 'https://www.amazon.com/gp/cart/view.html';

test('a refresh scans again — this is the whole point', () => {
  const gate = createScanGate();

  // First arrival.
  assert.equal(gate.shouldScan(1, 'loading', CART), false);
  assert.equal(gate.shouldScan(1, 'complete', CART), true);

  // The user hits refresh.
  assert.equal(gate.shouldScan(1, 'loading', CART), false);
  assert.equal(gate.shouldScan(1, 'complete', CART), true, 'a refresh is a deliberate rescan');
});

test('duplicate complete events do not scan twice', () => {
  const gate = createScanGate();

  gate.shouldScan(1, 'loading', CART);
  assert.equal(gate.shouldScan(1, 'complete', CART), true);
  assert.equal(gate.shouldScan(1, 'complete', CART), false, 'amazon fires complete repeatedly');
  assert.equal(gate.shouldScan(1, 'complete', CART), false);
});

test('a tab already sitting on the cart scans once', () => {
  const gate = createScanGate();
  assert.equal(gate.shouldScan(2, 'complete', CART), true, 'no preceding loading event');
  assert.equal(gate.shouldScan(2, 'complete', CART), false);
});

test('tabs are tracked independently', () => {
  const gate = createScanGate();

  gate.shouldScan(1, 'loading', CART);
  gate.shouldScan(2, 'loading', CART);
  assert.equal(gate.shouldScan(1, 'complete', CART), true);
  assert.equal(gate.shouldScan(2, 'complete', CART), true);
});

test('navigating away disarms the tab', () => {
  const gate = createScanGate();

  gate.shouldScan(1, 'loading', CART);
  assert.equal(gate.shouldScan(1, 'complete', 'https://www.amazon.com/dp/0143039563'), false);
  // Coming back is a fresh arrival, not a duplicate.
  gate.shouldScan(1, 'loading', CART);
  assert.equal(gate.shouldScan(1, 'complete', CART), true);
});

test('forget clears a closed tab', () => {
  const gate = createScanGate();
  gate.shouldScan(1, 'loading', CART);
  gate.forget(1);
  // A new tab reusing the id behaves like a first arrival.
  assert.equal(gate.shouldScan(1, 'complete', CART), true);
});
