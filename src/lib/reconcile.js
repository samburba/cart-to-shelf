// Merging scan results across pages, without stale entries.
//
// Scans accumulate so you can walk the cart and two wish lists and shelve the
// union. But plain accumulation has no way to express a removal: take a book
// out of your cart, rescan, and it is still listed because "merge" only ever
// adds. Reconciling per list fixes that — a rescan of a list replaces
// everything previously seen on that list, and leaves every other list alone.

/**
 * Identity of a list, stable across the query strings Amazon decorates its
 * URLs with (`?ref_=nav_cart`) and across pagination (`?pageNumber=2`), since
 * every page of one cart is still that one cart.
 */
export function listKey(url = '') {
  try {
    const { origin, pathname } = new URL(url);
    const path = pathname
      .replace(/\/view\.html$/i, '')
      .replace(/\/+$/, '')
      .toLowerCase();
    return origin.toLowerCase() + path;
  } catch {
    return '';
  }
}

/**
 * @param {Array} previous items already held
 * @param {Array} fresh items just scraped from `key`
 * @param {string} key the list they came from
 */
export function reconcileItems(previous, fresh, key) {
  // Choices are remembered from everything previously held, including the rows
  // this rescan is about to replace. Reading them off the survivors only would
  // silently re-tick a book the user had just unticked.
  const chosen = new Map(previous.map((i) => [i.asin, i]));

  // Everything from a different list survives untouched.
  const kept = key ? previous.filter((i) => i.sourceUrl !== key) : previous.slice();

  const byAsin = new Map(kept.map((i) => [i.asin, i]));
  for (const item of fresh) {
    const before = chosen.get(item.asin);
    byAsin.set(item.asin, {
      ...before,
      ...item,
      sourceUrl: key,
      // A manual tick or untick always wins over the default.
      selected: before ? before.selected : item.selected,
    });
  }
  return [...byAsin.values()];
}
