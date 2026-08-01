// Removes a single item from the Amazon cart or Save for Later, after Goodreads
// has confirmed the book. Deliberately destructive, so it is deliberately
// narrow:
//
//   * Wish lists are refused outright — those are curated and deletions there
//     have no undo. Only the cart and Save for Later, both cheap to rebuild.
//   * It matches on ASIN inside a known container. No ASIN match, no click.
//   * One item per invocation. Amazon re-renders (often a full navigation)
//     after a delete, which invalidates this context; the caller re-injects.

(function () {
  // The only two regions this script will ever touch.
  const REGIONS = [
    { surface: 'cart', selectors: ['#sc-active-cart', '[data-name="Active Cart"]'] },
    { surface: 'saved', selectors: ['#sc-saved-cart', '[data-name="Saved Items"]'] },
  ];

  const DELETE_SELECTORS = [
    'input[name^="submit.delete"]',
    '[data-action="delete"] input[type="submit"]',
    '[data-action="delete-active-item"] input',
    '[data-action="delete-saved-item"] input',
    'span[data-action*="delete"] input',
    'button[name^="submit.delete"]',
  ];

  const DP_RE = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i;

  function matchesAsin(el, asin) {
    if (el.getAttribute?.('data-asin') === asin) return true;
    if (el.querySelector(`[data-asin="${CSS.escape(asin)}"]`)) return true;
    for (const a of el.querySelectorAll('a[href]')) {
      const m = (a.getAttribute('href') || '').match(DP_RE);
      if (m && m[1].toUpperCase() === asin.toUpperCase()) return true;
    }
    return false;
  }

  function findDeleteControl(el) {
    for (const sel of DELETE_SELECTORS) {
      const node = el.querySelector(sel);
      if (node) return node;
    }
    // Last resort: a control whose visible label is exactly "Delete".
    for (const node of el.querySelectorAll('input,button,a')) {
      const label = (node.value || node.textContent || '').trim().toLowerCase();
      if (label === 'delete') return node;
    }
    return null;
  }

  /** @returns {{el:Element, control:Element, surface:string}|null} */
  function findRemovable(doc, asin) {
    if (!asin) return null;
    for (const region of REGIONS) {
      for (const sel of region.selectors) {
        const container = doc.querySelector(sel);
        if (!container) continue;
        for (const el of container.querySelectorAll('[data-itemid], .sc-list-item, [data-asin]')) {
          if (!matchesAsin(el, asin)) continue;
          const control = findDeleteControl(el);
          if (control) return { el, control, surface: region.surface };
        }
        break;
      }
    }
    return null;
  }

  function removeOne(asin) {
    const found = findRemovable(document, asin);
    if (!found) return { ok: false, reason: 'not-found-in-cart' };
    found.control.click();
    // Clicking is not removing. Amazon re-renders asynchronously, and a click on
    // a node detached by an earlier re-render does nothing at all — which is how
    // a run can report more removals than it performed. The caller confirms with
    // isPresent() before counting this.
    return { ok: true, surface: found.surface, clicked: true };
  }

  /** Is this ASIN still sitting in the cart or Save for Later? */
  function isPresent(asin) {
    return findRemovable(document, asin) !== null;
  }

  globalThis.CartToShelfRemove = {
    removeOne,
    isPresent,
    findRemovable,
    findDeleteControl,
  };
})();
