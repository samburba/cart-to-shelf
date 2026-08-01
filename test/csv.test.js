import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCsv } from '../src/lib/csv.js';

const lines = (csv) => csv.trim().split('\n');

test('emits the goodreads export header', () => {
  const csv = buildCsv([]);
  assert.equal(
    lines(csv)[0],
    'Title,Author,ISBN,ISBN13,My Rating,Bookshelves,Exclusive Shelf'
  );
});

test('armors isbns and fills in the other form', () => {
  const csv = buildCsv([
    { title: 'Crime and Punishment', author: 'Fyodor Dostoevsky', isbn: '0143039563' },
  ]);
  const row = lines(csv)[1];
  assert.ok(row.includes('"=""0143039563"""'), 'excel armor, quote-escaped');
  assert.ok(row.includes('"=""9780143039563"""'), 'isbn-13 derived');
  assert.ok(row.endsWith('to-read,to-read'));
});

test('accepts an isbn-13 and back-fills the isbn-10', () => {
  const row = lines(buildCsv([{ title: 'X', isbn: '9780143039563' }]))[1];
  assert.ok(row.includes('"=""0143039563"""'));
  assert.ok(row.includes('"=""9780143039563"""'));
});

test('escapes commas, quotes, and survives a missing isbn', () => {
  const row = lines(
    buildCsv([{ title: 'Eat, Pray, "Love"', author: 'Elizabeth Gilbert' }])
  )[1];
  assert.ok(row.startsWith('"Eat, Pray, ""Love""",Elizabeth Gilbert,,,'));
});

test('keeps diacritics intact', () => {
  const row = lines(buildCsv([{ title: 'Le Père Goriot', author: 'Honoré de Balzac' }]))[1];
  assert.ok(row.includes('Le Père Goriot'));
  assert.ok(row.includes('Honoré de Balzac'));
});
