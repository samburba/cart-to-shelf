// Goodreads writer. Runs as a content script on goodreads.com, so every fetch
// below is same-origin and carries the session cookies the user already has.
// The extension never sees, stores, or transmits a credential.
//
// This handles exactly ONE book per invocation and returns its outcome. The
// batch loop lives in the background worker instead, because a content script
// is a fragile place to keep a multi-minute loop: any navigation, bfcache
// eviction, or re-injection kills it silently and takes the unreported results
// with it.
//
// NOTE: neither the search markup nor the shelf-add endpoint is documented.
// Both can change without warning, which is why failures route to CSV.

(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function csrfToken() {
    const meta =
      document.querySelector('meta[name="csrf-token"]') ||
      document.querySelector('meta[name="csrf_token"]');
    return meta?.getAttribute('content') || '';
  }

  /**
   * Tri-state, like the Amazon side: null means the page is unfamiliar, and an
   * unfamiliar page must not block a shelving run that would have worked.
   */
  function signedIn(doc = document) {
    if (doc.querySelector('a[href*="/user/sign_out"], .siteHeader__personal')) return true;
    if (doc.querySelector('a[href^="/user/show/"]')) return true;

    if (
      doc.querySelector(
        'form[action*="/user/sign_in"], a[href*="/user/sign_in"], #userSignInFormField'
      )
    ) {
      return false;
    }
    return null;
  }

  function parse(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function bookIdFrom(doc) {
    const anchor =
      doc.querySelector('a.bookTitle[href*="/book/show/"]') ||
      doc.querySelector('[itemtype*="schema.org/Book"] a[href*="/book/show/"]') ||
      doc.querySelector('a[href*="/book/show/"]');
    const m = (anchor?.getAttribute('href') || '').match(/\/book\/show\/(\d+)/);
    if (m) return m[1];

    const resource = doc.querySelector('[data-resource-id]');
    return resource?.getAttribute('data-resource-id') || null;
  }

  /**
   * Fast path: /book/isbn/<isbn> redirects straight to the book page. One
   * request, no HTML parsing, and it does not depend on search-result markup —
   * so it is both quicker and sturdier than scraping /search.
   */
  async function byIsbn(isbn) {
    const res = await fetch(`/book/isbn/${encodeURIComponent(isbn)}`, {
      credentials: 'same-origin',
      redirect: 'follow',
    });
    if (!res.ok) return null;

    const landed = new URL(res.url, location.origin).pathname.match(/\/book\/show\/(\d+)/);
    if (landed) return landed[1];

    // Some editions render the page without a redirect; read the id off it.
    return bookIdFrom(parse(await res.text()));
  }

  /**
   * Progressively looser queries. Amazon titles carry edition furniture that
   * Goodreads' index does not — series notes, "A Novel", format suffixes — and
   * an over-specified query returns nothing at all rather than a near match.
   */
  function queriesFor(book) {
    const out = [];
    const push = (q) => {
      const trimmed = (q || '').trim();
      if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    };

    if (book.isbn) push(book.isbn);

    const title = (book.title || '')
      .replace(/\s*[([].*?[)\]]\s*/g, ' ') // (Penguin Classics), [Hardcover]
      .replace(/\s*[:–—-]\s*(a|an|the)\s+(novel|memoir|biography|story)\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    push([title, book.author].filter(Boolean).join(' '));
    push(title);

    // Last resort: the main title, before the subtitle.
    const main = title.split(/\s*[:–—]\s*/)[0];
    if (main && main.length > 3) push([main, book.author].filter(Boolean).join(' '));

    return out;
  }

  /** A /search?q= that matches exactly one book redirects straight to it. */
  async function search(book) {
    const queries = queriesFor(book);

    for (let i = 0; i < queries.length; i++) {
      const url = `/search?utf8=%E2%9C%93&search_type=books&q=${encodeURIComponent(queries[i])}`;
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) continue;

      const direct = new URL(res.url, location.origin).pathname.match(/\/book\/show\/(\d+)/);
      if (direct) return direct[1];

      const id = bookIdFrom(parse(await res.text()));
      if (id) return id;
      if (i < queries.length - 1) await sleep(400);
    }
    return null;
  }

  async function findBookId(book) {
    if (book.isbn) {
      const direct = await byIsbn(book.isbn);
      if (direct) return direct;
    }
    return search(book);
  }

  async function addToShelf(bookId, token) {
    const res = await fetch('/shelf/add_to_shelf.json', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': token,
      },
      body: new URLSearchParams({
        name: 'to-read',
        book_id: bookId,
        wtr_new: 'true',
        authenticity_token: token,
      }).toString(),
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };

    const text = await res.text();
    // A successful add returns JSON; an expired session returns the sign-in
    // page as HTML.
    if (/^\s*</.test(text)) return { ok: false, reason: 'not-signed-in' };
    return { ok: true };
  }

  /** @returns {Promise<{ok:boolean, goodreadsId?:string, reason?:string}>} */
  async function shelveOne(book) {
    try {
      const token = csrfToken();
      if (!token) return { ok: false, reason: 'no-csrf-token' };

      // A known id from a previous run skips lookup entirely.
      const id = book.goodreadsId || (await findBookId(book));
      if (!id) return { ok: false, reason: 'not-found-on-goodreads' };

      const result = await addToShelf(id, token);
      return result.ok ? { ok: true, goodreadsId: id } : result;
    } catch (err) {
      return { ok: false, reason: String(err?.message || err) };
    }
  }

  globalThis.CartToShelfGR = {
    shelveOne,
    findBookId,
    byIsbn,
    search,
    queriesFor,
    bookIdFrom,
    csrfToken,
    signedIn,
  };
})();
