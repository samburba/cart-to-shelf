// Thin chrome.storage.local wrapper. Two things live here: the ISBN resolution
// cache (keyed by ASIN, so rescans are free) and the already-sent set (so a
// rerun does not re-add books you already shelved).

const CACHE_KEY = 'isbnCache';
const CACHE_VERSION_KEY = 'isbnCacheVersion';
const SENT_KEY = 'sentAsins';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 90;

// Bump when a scraping or lookup bug could have poisoned the cache. Misses are
// cached too, so a bad title that resolved to nothing would otherwise stay
// unresolved for 90 days — long after the bug was fixed.
const CACHE_VERSION = 2;

async function get(key, fallback) {
  const out = await chrome.storage.local.get(key);
  return out[key] === undefined ? fallback : out[key];
}

/**
 * Drops the whole cache when the version moves, then remembers the new one.
 *
 * Memoised: the stored version cannot change under a running worker, so the
 * check is worth exactly one storage read per worker lifetime rather than one
 * per ISBN lookup. The promise itself is cached, not its result, so concurrent
 * callers share a single check instead of racing to perform it.
 */
let versionChecked = null;

function ensureCacheVersion() {
  versionChecked ??= (async () => {
    const stored = await get(CACHE_VERSION_KEY, 0);
    if (stored === CACHE_VERSION) return;
    await chrome.storage.local.remove(CACHE_KEY);
    await chrome.storage.local.set({ [CACHE_VERSION_KEY]: CACHE_VERSION });
  })().catch((err) => {
    versionChecked = null; // a failed check must not be remembered as done
    throw err;
  });
  return versionChecked;
}

/** Forget the memoised check. Only meaningful when storage is swapped underneath
 *  us, which happens in tests and nowhere else. */
export function resetCacheVersionCheck() {
  versionChecked = null;
}

export async function getCached(asin) {
  await ensureCacheVersion();
  const cache = await get(CACHE_KEY, {});
  const hit = cache[asin];
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) return null;
  return hit.value;
}

export async function setCached(asin, value) {
  return setCachedMany([[asin, value]]);
}

/**
 * One read-modify-write for a whole batch of entries.
 *
 * Doing this per entry is both n storage round-trips and a lost-update hazard:
 * two overlapping writers each read the same cache object and the second one to
 * finish discards the first one's entry. Resolution now runs several lookups at
 * once, so that stopped being hypothetical.
 *
 * @param {Iterable<[string, unknown]>} entries
 */
export async function setCachedMany(entries) {
  const pairs = [...entries];
  if (!pairs.length) return;
  await ensureCacheVersion();
  const cache = await get(CACHE_KEY, {});
  const at = Date.now();
  for (const [asin, value] of pairs) cache[asin] = { at, value };
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

/**
 * Cap on the already-sent history. Nothing prunes it otherwise, and it is a
 * list that only ever grows. Far more than anyone's lifetime of book buying,
 * small enough that the stored array stays trivial; oldest entries fall off the
 * front, so the worst case is re-offering a book shelved thousands of books ago.
 */
const SENT_LIMIT = 5000;

export async function markSent(asins) {
  const sent = await getSent();
  // A Set keeps insertion order, so the array is oldest-first and trimming the
  // front drops the least recent.
  for (const a of asins) sent.add(a);
  const list = [...sent];
  await chrome.storage.local.set({
    [SENT_KEY]: list.length > SENT_LIMIT ? list.slice(-SENT_LIMIT) : list,
  });
}

export async function clearSent() {
  await chrome.storage.local.remove(SENT_KEY);
}
