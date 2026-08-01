// Turn a scraped Amazon item into something Goodreads can match on.
//
// Ladder: ASIN-as-ISBN (free, correct for most print books) -> Open Library ->
// Google Books -> title+author only. Every rung records how it got there so the
// review UI can show the user its confidence.

import { asinAsIsbn, normalize, isValidIsbn10, isValidIsbn13 } from './isbn.js';
import { getCached, setCached } from './store.js';

const TIMEOUT_MS = 8000;

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function firstValidIsbn(candidates) {
  for (const c of candidates || []) {
    const s = normalize(c);
    if (isValidIsbn13(s) || isValidIsbn10(s)) return s;
  }
  return null;
}

async function openLibrary(title, author) {
  const params = new URLSearchParams({ title, limit: '5' });
  if (author) params.set('author', author);
  const data = await fetchJson(`https://openlibrary.org/search.json?${params}`);
  for (const doc of data?.docs || []) {
    const isbn = firstValidIsbn(doc.isbn);
    if (isbn) return isbn;
  }
  return null;
}

async function googleBooks(title, author) {
  const q = [`intitle:${title}`, author ? `inauthor:${author}` : '']
    .filter(Boolean)
    .join('+');
  const url =
    'https://www.googleapis.com/books/v1/volumes?maxResults=5&q=' +
    encodeURIComponent(q);
  const data = await fetchJson(url);
  for (const item of data?.items || []) {
    const ids = (item.volumeInfo?.industryIdentifiers || []).map((i) => i.identifier);
    const isbn = firstValidIsbn(ids);
    if (isbn) return isbn;
  }
  return null;
}

/**
 * @param {{asin:string,title:string,author?:string}} item
 * @returns {Promise<{isbn:string|null, source:'asin'|'openlibrary'|'googlebooks'|'none'}>}
 */
export async function resolveIsbn(item) {
  const direct = asinAsIsbn(item.asin);
  if (direct) return { isbn: direct, source: 'asin' };

  const cached = await getCached(item.asin);
  if (cached) return cached;

  const title = (item.title || '').slice(0, 120);
  let result = { isbn: null, source: 'none' };

  if (title) {
    const ol = await openLibrary(title, item.author);
    if (ol) result = { isbn: ol, source: 'openlibrary' };
    else {
      const gb = await googleBooks(title, item.author);
      if (gb) result = { isbn: gb, source: 'googlebooks' };
    }
  }

  // Cache misses too — a title with no match will not suddenly acquire one, and
  // caching it keeps repeat scans from hammering both APIs.
  await setCached(item.asin, result);
  return result;
}

export async function resolveAll(items, onProgress) {
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const resolved = await resolveIsbn(items[i]);
    out.push({ ...items[i], ...resolved });
    onProgress?.(i + 1, items.length);
  }
  return out;
}
