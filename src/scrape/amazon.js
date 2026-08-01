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

  // Screen-reader affordances Amazon injects into link text.
  const NOISE_RE =
    /\s*(opens? in a new (tab|window)|opens an? .*? dialog|sponsored ad)\s*/gi;

  /**
   * Amazon's truncation widget renders a title twice — the full string in an
   * offscreen node and a shortened copy for display — so plain textContent
   * yields "TitleTitle". Prefer the full node; failing that, drop the visible
   * duplicate and any accessibility label.
   */
  function text(node) {
    if (!node) return '';

    const full = node.querySelector?.('.a-truncate-full');
    let raw = full ? full.textContent : null;

    if (raw == null) {
      const clone = node.cloneNode(true);
      for (const dupe of clone.querySelectorAll?.(
        '.a-truncate-cut, [aria-hidden="true"], .a-offscreen'
      ) || []) {
        dupe.remove();
      }
      raw = clone.textContent || node.textContent || '';
    }

    return collapse(raw.replace(NOISE_RE, ' ').replace(/\s+/g, ' ').trim());
  }

  /** Belt and braces: a string that is exactly itself twice over. */
  function collapse(s) {
    const half = s.length / 2;
    if (s.length > 6 && s.length % 2 === 0 && s.slice(0, half) === s.slice(half)) {
      return s.slice(0, half);
    }
    // The same with a separating space: "Title Title".
    const mid = Math.floor(s.length / 2);
    if (s[mid] === ' ' && s.slice(0, mid) === s.slice(mid + 1)) return s.slice(0, mid);
    return s;
  }

  // Deliberate duplicate of isValidIsbn10 in src/lib/isbn.js — a content script
  // is injected as a classic script and cannot import. Change both together;
  // src/lib/isbn.js is the canonical version and the one under test.
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
    if (attr) {
      return { value: collapse(attr.replace(NOISE_RE, ' ').replace(/\s+/g, ' ').trim()), via: 'title-attr' };
    }

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
  function classify({ asin, byline }) {
    // A valid ISBN-10 as the ASIN, or a stated print/audio format, is as close
    // to proof as this page gets. Everything else — including a plain "by
    // Author" byline, which furniture and kitchenware also carry — is a guess,
    // and a guess is shown to the user rather than acted on.
    if (isbn10Looking(asin)) return 'yes';
    if (FORMAT_RE.test(byline)) return 'yes';
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
      confidence: classify({ asin: asin.value, byline }),
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

  /**
   * Union of every item selector, not the first one that happens to match.
   * Amazon does not mark every row the same way — a cart can mix rows carrying
   * data-itemid with rows carrying only data-asin — and first-selector-wins
   * made the odd ones out invisible.
   */
  function itemsIn(container) {
    const found = [];
    for (const sel of ITEM_SELECTORS) {
      for (const el of container.querySelectorAll(sel)) {
        if (!found.includes(el)) found.push(el);
      }
    }
    // Nested matches would double-count; keep only outermost.
    return found.filter((n) => !found.some((other) => other !== n && other.contains(n)));
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

  /**
   * Every other page of a paginated cart. Wish lists load lazily and are
   * handled by scrolling, but the cart paginates for real — and reading only
   * page one silently loses everything after it.
   *
   * Only same-origin links qualify. An absolute href keeps its own host, and
   * the page we are reading is not a trusted source of URLs — a sponsored ad
   * carrying ?page=1 would otherwise become an outbound request the user never
   * asked for, from an extension that promises nothing leaves the browser.
   */
  function paginationUrls(doc, currentHref) {
    const origin =
      typeof location === 'undefined' ? 'https://www.amazon.com' : location.origin;
    const urls = [];

    for (const a of doc.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      const paged =
        /[?&]pageNumber=\d+/i.test(href) ||
        /[?&]page=\d+/i.test(href) ||
        (/\/gp\/cart\/view\.html/i.test(href) && /[?&]/.test(href));
      if (!paged) continue;

      let absolute;
      try {
        const url = new URL(href, origin);
        if (url.origin !== origin) continue;
        absolute = url.href;
      } catch {
        continue;
      }
      if (absolute !== currentHref && !urls.includes(absolute)) urls.push(absolute);
    }
    return urls;
  }

  async function fetchDoc(url) {
    try {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) return null;
      return new DOMParser().parseFromString(await res.text(), 'text/html');
    } catch {
      return null;
    }
  }

  /** Merge item lists, keeping one entry per ASIN per surface. */
  function mergeItems(lists) {
    const seen = new Set();
    const out = [];
    for (const list of lists) {
      for (const item of list || []) {
        const key = item.asin + '|' + item.surface;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
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

  const MAX_PAGES = 20;

  /**
   * Tri-state on purpose: true, false, or null for "cannot tell". A signed-out
   * cart looks like an empty one, and "no books found" sends someone hunting
   * for a scraping bug that isn't there. Only a positive signal either way is
   * acted on — an unrecognised page must never block a scan that would work.
   */
  function signedIn(doc = document) {
    const href = typeof location === 'undefined' ? '' : location.href;
    if (/\/ap\/signin/i.test(href)) return false;

    // Signed in: an account menu that offers a way out.
    if (doc.querySelector('#nav-item-signout, a[href*="/gp/flex/sign-out"]')) return true;

    const account = doc.querySelector('#nav-link-accountList, #nav-link-accountList-nav-line-1');
    const greeting = (account?.textContent || '').replace(/\s+/g, ' ').trim();
    if (greeting) {
      if (/sign\s?in/i.test(greeting)) return false;
      if (/hello|hi\b/i.test(greeting)) return true;
    }

    if (doc.querySelector('#nav-item-signin, form[action*="/ap/signin"], #ap_email')) {
      return false;
    }
    return null;
  }

  async function scan() {
    await loadAll();

    const here = typeof location === 'undefined' ? '' : location.href;
    const lists = [extractFrom(document)];

    // Follow cart pagination breadth-first. Later pages link to further pages,
    // so the frontier grows as we go; the cap is a runaway guard, not a limit
    // anyone should hit.
    const visited = new Set([here]);
    const queue = paginationUrls(document, here);

    while (queue.length && visited.size < MAX_PAGES) {
      const url = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);

      const doc = await fetchDoc(url);
      if (!doc) continue;

      lists.push(extractFrom(doc));
      for (const next of paginationUrls(doc, url)) {
        if (!visited.has(next) && !queue.includes(next)) queue.push(next);
      }
    }

    return mergeItems(lists);
  }

  /**
   * What the scraper actually saw, for when a book is in the cart but not in
   * the list. Reports which containers and item selectors matched, and how far
   * each candidate row got — so a miss can be diagnosed without guessing at
   * markup nobody can see.
   */
  function diagnose(doc = document) {
    const href = typeof location === 'undefined' ? '' : location.href;
    const report = {
      url: href.split('?')[0],
      otherPages: paginationUrls(doc, href).length,
      surfaces: [],
      rejected: [],
    };

    for (const surface of SURFACES) {
      const entry = { surface: surface.name, container: null, counts: {}, items: [] };
      for (const sel of surface.containers) {
        if (!doc.querySelector(sel)) continue;
        entry.container = sel;
        const container = doc.querySelector(sel);

        for (const itemSel of ITEM_SELECTORS) {
          entry.counts[itemSel] = container.querySelectorAll(itemSel).length;
        }

        for (const el of itemsIn(container)) {
          const asin = extractAsin(el);
          const title = extractTitle(el);
          if (!asin.value || !title.value) {
            report.rejected.push({
              surface: surface.name,
              asin: asin.value || null,
              asinVia: asin.via,
              title: title.value || null,
              titleVia: title.via,
              snippet: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90),
            });
            continue;
          }
          const item = extractItem(el, surface.name);
          entry.items.push({
            asin: item.asin,
            title: item.title,
            author: item.author,
            confidence: item.confidence,
            via: item.via,
          });
        }
        break;
      }
      report.surfaces.push(entry);
    }
    return report;
  }

  globalThis.CartToShelf = {
    extractFrom,
    extractItem,
    classify,
    scan,
    diagnose,
    paginationUrls,
    mergeItems,
    signedIn,
  };
})();

// executeScript resolves with this promise's value.
globalThis.CartToShelf.scan();
