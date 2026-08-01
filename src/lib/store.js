// Thin chrome.storage.local wrapper. Two things live here: the ISBN resolution
// cache (keyed by ASIN, so rescans are free) and the already-sent set (so a
// rerun does not re-add books you already shelved).

const CACHE_KEY = 'isbnCache';
const SENT_KEY = 'sentAsins';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 90;

async function get(key, fallback) {
  const out = await chrome.storage.local.get(key);
  return out[key] === undefined ? fallback : out[key];
}

export async function getCached(asin) {
  const cache = await get(CACHE_KEY, {});
  const hit = cache[asin];
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) return null;
  return hit.value;
}

export async function setCached(asin, value) {
  const cache = await get(CACHE_KEY, {});
  cache[asin] = { at: Date.now(), value };
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

// Goodreads book ids, keyed by ISBN. A hit removes the lookup request from a
// book's shelving entirely, which is the single biggest cost per book.
const BOOKID_KEY = 'goodreadsIds';

export async function getBookId(isbn) {
  if (!isbn) return null;
  const ids = await get(BOOKID_KEY, {});
  return ids[isbn] || null;
}

export async function setBookId(isbn, id) {
  if (!isbn || !id) return;
  const ids = await get(BOOKID_KEY, {});
  ids[isbn] = id;
  await chrome.storage.local.set({ [BOOKID_KEY]: ids });
}

export async function getSent() {
  return new Set(await get(SENT_KEY, []));
}

export async function markSent(asins) {
  const sent = await getSent();
  for (const a of asins) sent.add(a);
  await chrome.storage.local.set({ [SENT_KEY]: [...sent] });
}

export async function clearSent() {
  await chrome.storage.local.remove(SENT_KEY);
}
