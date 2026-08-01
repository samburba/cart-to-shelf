// Turn a scraped Amazon item into something Goodreads can match on.
//
// Ladder: ASIN-as-ISBN (free, correct for most print books) -> Open Library ->
// Google Books -> title+author only. Every rung records how it got there so the
// review UI can show the user its confidence.

import { asinAsIsbn, normalize, isValidIsbn10, isValidIsbn13 } from './isbn.js';
import { getCached, setCachedMany } from './store.js';

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
 * Resolve one item, reporting whether the answer is new enough to be worth
 * writing back. The caller batches those writes; doing it here would mean one
 * storage read-modify-write per book, and lost updates once lookups overlap.
 *
 * @param {{asin:string,title:string,author?:string}} item
 * @returns {Promise<{result:{isbn:string|null, source:string}, cache:boolean}>}
 */
async function resolveOne(item) {
  const direct = asinAsIsbn(item.asin);
  if (direct) return { result: { isbn: direct, source: 'asin' }, cache: false };

  const cached = await getCached(item.asin);
  if (cached) return { result: cached, cache: false };

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
  return { result, cache: true };
}

/**
 * @param {{asin:string,title:string,author?:string}} item
 * @returns {Promise<{isbn:string|null, source:'asin'|'openlibrary'|'googlebooks'|'none'}>}
 */
export async function resolveIsbn(item) {
  const { result, cache } = await resolveOne(item);
  if (cache) await setCachedMany([[item.asin, result]]);
  return result;
}

/**
 * How many lookups may be in flight at once.
 *
 * Serially, a cart of forty unknown titles is up to eighty requests end to end,
 * each able to burn the full timeout — minutes of staring at a progress bar. A
 * small pool collapses that without turning a book scan into something Open
 * Library or Google Books would reasonably call abuse.
 */
const CONCURRENCY = 4;

export async function resolveAll(items, onProgress) {
  const out = new Array(items.length);
  const writes = [];
  let done = 0;
  let next = 0;

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;

      const { result, cache } = await resolveOne(items[i]);
      out[i] = { ...items[i], ...result };
      if (cache) writes.push([items[i].asin, result]);

      // Progress is a count of what has finished, not of position in the list —
      // out-of-order completion is the whole point of the pool.
      onProgress?.(++done, items.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker)
  );

  // One write for the whole scan.
  await setCachedMany(writes);
  return out;
}
