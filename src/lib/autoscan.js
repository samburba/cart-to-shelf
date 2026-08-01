// Deciding when a page load deserves an automatic scan. Extracted from the
// background worker so the rules are testable without a browser.

/**
 * Pages worth scanning. Amazon writes the cart URL several ways —
 * /gp/cart/view.html, /cart?ref_=nav_cart, /cart/smart-wagon — so the match
 * must not depend on a trailing slash.
 */
const SCANNABLE = new RegExp(
  [
    'amazon\\.[a-z.]+/',
    '(',
    'gp/cart',
    '|cart(?:[/?#]|$)',
    '|hz/wishlist',
    '|registry/wishlist',
    '|gp/registry',
    '|wishlist(?:[/?#]|$)',
    ')',
  ].join(''),
  'i'
);

export function isScannable(url = '') {
  return SCANNABLE.test(url);
}

/**
 * Amazon fires tabs.onUpdated with status 'complete' more than once per
 * navigation, so a naive listener scans repeatedly. A time-based debounce
 * suppressed those, but it also suppressed deliberate refreshes — the very
 * thing someone does when they want a rescan.
 *
 * Arm on 'loading' instead and fire once on the next 'complete'. A refresh
 * always passes through 'loading'; duplicate 'complete' events never do.
 */
export function createScanGate() {
  const armed = new Map(); // tabId -> url it was armed for

  return {
    /** @returns {boolean} whether this update should trigger a scan */
    shouldScan(tabId, status, url) {
      if (!isScannable(url)) {
        armed.delete(tabId);
        return false;
      }

      if (status === 'loading') {
        armed.set(tabId, url);
        return false;
      }

      if (status !== 'complete') return false;

      // Armed by a load of this page: fire once, then mark it settled. Settled
      // is not the same as absent — absent would let the next duplicate
      // 'complete' look like a fresh arrival and scan again.
      if (armed.get(tabId) === url) {
        armed.set(tabId, null);
        return true;
      }

      // A 'complete' with no preceding 'loading' — either a duplicate event or
      // the tab was already sitting on the page when we started listening.
      if (!armed.has(tabId)) {
        armed.set(tabId, null); // remember we've seen this tab settle
        return url ? true : false;
      }

      return false;
    },

    forget(tabId) {
      armed.delete(tabId);
    },
  };
}
