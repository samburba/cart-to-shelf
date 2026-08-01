// Amazon scraper. Classic (non-module) script so chrome.scripting can inject it
// directly. It exposes globalThis.CartToShelf for the Node tests, which run this
// same file against saved fixtures via vm, and ends with a scan() call whose
// promise becomes executeScript's return value.

(function () {
  const FORMAT_RE =
    /\b(paperback|hardcover|hardback|kindle edition|mass market|audible|audio ?cd|board book|library binding|spiral-?bound|leather bound|comic|graphic novel)\b/i;
  const AUTHOR_RE = /\bby\s+(.+?)(?:\s*[|(]|$)/i;
  const DP_RE = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i;

  /** Walk an ordered list of selectors, return the first node that exists. */
  function pick(root, selectors) {
    for (const sel of selectors) {
      const node = root.querySelector(sel);
      if (node) return node;
    }
    return null;
  }

  function text(node) {
    return (node?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isbn10Looking(s) {
    if (!/^\d{9}[\dX]$/i.test(s || '')) return false;
    let sum = 0;
    const u = s.toUpperCase();
    for (let i = 0; i < 10; i++) sum += (u[i] === 'X' ? 10 : Number(u[i])) * (10 - i);
    return sum % 11 === 0;
  }

  function extractAsin(el) {
    const direct = el.getAttribute?.('data-asin');
    if (direct) return { value: direct.trim(), via: 'data-asin' };

    const params = el.getAttribute?.('data-reposition-action-params');
    if (params) {
      try {
        const parsed = JSON.parse(params);
        if (parsed.asin) return { value: String(parsed.asin), via: 'reposition-params' };
      } catch {
        const m = params.match(/"asin"\s*:\s*"([A-Z0-9]{10})"/i);
        if (m) return { value: m[1], via: 'reposition-params' };
      }
    }

    const nested = el.querySelector('[data-asin]');
    if (nested?.getAttribute('data-asin')) {
      return { value: nested.getAttribute('data-asin').trim(), via: 'nested-data-asin' };
    }

    for (const a of el.querySelectorAll('a[href]')) {
      const m = (a.getAttribute('href') || '').match(DP_RE);
      if (m) return { value: m[1].toUpperCase(), via: 'href' };
    }
    return { value: '', via: 'none' };
  }

  function extractTitle(el) {
    const byAttr = pick(el, ['[id^="itemName_"][title]', 'a[title][href*="/dp/"]']);
    const attr = byAttr?.getAttribute('title');
    if (attr) return { value: attr.trim(), via: 'title-attr' };

    const node = pick(el, [
      '.sc-product-title',
      '.sc-grid-item-product-title',
      '[data-testid="item-title"]',
      '[id^="itemName_"]',
      'h2 a',
      'a[href*="/dp/"]',
    ]);
    return { value: text(node), via: node ? 'text' : 'none' };
  }

  function extractByline(el) {
    const node = pick(el, [
      '.sc-product-byline',
      '[id^="item-byline-"]',
      '.a-row .a-size-small.a-color-secondary',
      '.sc-product-binding',
    ]);
    return text(node);
  }

  function extractImage(el) {
    const img = pick(el, ['img.sc-product-image', '[id^="itemImage_"] img', 'img']);
    return img?.getAttribute('src') || '';
  }

  /**
   * Book-ness is a heuristic, and a wrong "no" is worse than a wrong "maybe" —
   * anything uncertain is surfaced to the user rather than dropped.
   * @returns {'yes'|'maybe'}
   */
  function classify({ asin, byline, title }) {
    if (isbn10Looking(asin)) return 'yes';
    if (FORMAT_RE.test(byline)) return 'yes';
    if (/^B0/i.test(asin) && AUTHOR_RE.test(byline)) return 'maybe';
    if (AUTHOR_RE.test(byline) || AUTHOR_RE.test(title)) return 'maybe';
    return 'maybe';
  }

  function extractItem(el, surface) {
    const asin = extractAsin(el);
    const title = extractTitle(el);
    if (!asin.value || !title.value) return null;

    const byline = extractByline(el);
    const authorMatch = byline.match(AUTHOR_RE) || title.value.match(AUTHOR_RE);
    const formatMatch = byline.match(FORMAT_RE);

    return {
      asin: asin.value,
      title: title.value.replace(/\s*\([^)]*\)\s*$/, '').trim() || title.value,
      author: authorMatch ? authorMatch[1].trim() : '',
      format: formatMatch ? formatMatch[0] : '',
      image: extractImage(el),
      surface,
      confidence: classify({ asin: asin.value, byline, title: title.value }),
      via: { asin: asin.via, title: title.via },
    };
  }

  const SURFACES = [
    { name: 'cart', containers: ['#sc-active-cart', '[data-name="Active Cart"]'] },
    { name: 'saved', containers: ['#sc-saved-cart', '[data-name="Saved Items"]'] },
    { name: 'wishlist', containers: ['#g-items', '#wl-item-view'] },
  ];

  const ITEM_SELECTORS = [
    '[data-itemid]',
    'li[data-id]',
    '.sc-list-item',
    '.sc-item',
    '[data-asin]',
  ];

  function itemsIn(container) {
    for (const sel of ITEM_SELECTORS) {
      const found = [...container.querySelectorAll(sel)];
      // Nested matches would double-count; keep only outermost.
      const outermost = found.filter(
        (n) => !found.some((other) => other !== n && other.contains(n))
      );
      if (outermost.length) return outermost;
    }
    return [];
  }

  function extractFrom(doc) {
    const seen = new Set();
    const out = [];
    for (const surface of SURFACES) {
      for (const sel of surface.containers) {
        const container = doc.querySelector(sel);
        if (!container) continue;
        for (const el of itemsIn(container)) {
          const item = extractItem(el, surface.name);
          if (!item) continue;
          const key = item.asin + '|' + surface.name;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(item);
        }
        break; // first matching container per surface wins
      }
    }
    return out;
  }

  /** Wish lists load lazily; scroll until the item count stops growing. */
  async function loadAll() {
    const list = document.querySelector('#g-items');
    if (!list) return;
    let previous = -1;
    for (let i = 0; i < 40 && list.children.length !== previous; i++) {
      previous = list.children.length;
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 700));
    }
    window.scrollTo(0, 0);
  }

  async function scan() {
    await loadAll();
    return extractFrom(document);
  }

  globalThis.CartToShelf = { extractFrom, extractItem, classify, scan };
})();

// executeScript resolves with this promise's value.
globalThis.CartToShelf.scan();
