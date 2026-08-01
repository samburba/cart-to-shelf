// Goodreads-import CSV. This is Goodreads' own export schema, which is what its
// importer at /review/import is built to round-trip.

import { normalize, isbn10To13, isValidIsbn13, isbn13To10 } from './isbn.js';

const HEADERS = [
  'Title',
  'Author',
  'ISBN',
  'ISBN13',
  'My Rating',
  'Bookshelves',
  'Exclusive Shelf',
];

function escapeField(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Goodreads exports ISBNs as ="0143039563" so spreadsheet software cannot eat
 * the leading zero. The importer expects that armor, and the whole cell must
 * then be quoted because it contains a quote character.
 */
function isbnCell(isbn) {
  const s = normalize(isbn);
  return s ? escapeField(`="${s}"`) : '';
}

function splitIsbns(book) {
  const raw = normalize(book.isbn);
  if (!raw) return { isbn10: '', isbn13: '' };
  if (isValidIsbn13(raw)) return { isbn10: isbn13To10(raw) || '', isbn13: raw };
  return { isbn10: raw, isbn13: isbn10To13(raw) || '' };
}

/** @param {Array<{title:string,author?:string,isbn?:string}>} books */
export function buildCsv(books) {
  const rows = [HEADERS.join(',')];
  for (const book of books) {
    const { isbn10, isbn13 } = splitIsbns(book);
    rows.push([
      escapeField(book.title),
      escapeField(book.author || ''),
      isbnCell(isbn10),
      isbnCell(isbn13),
      '',
      escapeField('to-read'),
      escapeField('to-read'),
    ].join(','));
  }
  // Trailing newline; Goodreads' parser is happier with one.
  return rows.join('\n') + '\n';
}

export function csvDataUrl(csv) {
  // A BOM keeps Excel from mangling accented titles if the user opens the file
  // before importing it.
  const bytes = new TextEncoder().encode('﻿' + csv);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return 'data:text/csv;base64,' + btoa(binary);
}
