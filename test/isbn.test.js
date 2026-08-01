import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidIsbn10,
  isValidIsbn13,
  isbn10To13,
  isbn13To10,
  asinAsIsbn,
  normalize,
} from '../src/lib/isbn.js';

test('isbn-10 check digits', () => {
  assert.ok(isValidIsbn10('0143039563'));
  assert.ok(isValidIsbn10('0-14-303956-3'), 'hyphens tolerated');
  assert.ok(isValidIsbn10('080442957X'), 'X check digit');
  assert.ok(!isValidIsbn10('0143039564'), 'transposed check digit rejected');
  assert.ok(!isValidIsbn10('B07C6DPLL5'), 'a Kindle ASIN is not an ISBN');
});

test('isbn-13 check digits', () => {
  assert.ok(isValidIsbn13('9780143039563'));
  assert.ok(!isValidIsbn13('9780143039564'));
});

test('round-trips between isbn-10 and isbn-13', () => {
  assert.equal(isbn10To13('0143039563'), '9780143039563');
  assert.equal(isbn13To10('9780143039563'), '0143039563');
  assert.equal(isbn13To10('9791234567896'), null, '979 has no isbn-10 form');
});

test('asinAsIsbn accepts print asins and rejects opaque ones', () => {
  assert.equal(asinAsIsbn('0374533555'), '0374533555');
  assert.equal(asinAsIsbn('B07C6DPLL5'), null);
});

test('normalize strips the excel armor goodreads exports use', () => {
  assert.equal(normalize('="0143039563"'), '0143039563');
});
