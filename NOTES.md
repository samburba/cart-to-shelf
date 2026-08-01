# Where things stand

Working notes, as of 1 August 2026. Everything below is committed and pushed.

## Live

- Repo: https://github.com/samburba/cart-to-shelf (public, CI green)
- Site: https://cart-to-shelf.burba.dev (Pages from `docs/`, HTTPS enforced)
- Uninstall page: `/uninstalled.html`, wired via `runtime.setUninstallURL`
- 95 tests, `npm test`

The `burba.dev` apex is served from S3/CloudFront, **not** Pages — which is why
this site lives on a `cart-to-shelf.` subdomain (Route 53 CNAME →
`samburba.github.io`). A project site under the apex gets handed to the wrong
origin and 404s.

## What's left before the stores

1. **Screenshots.** The only real blocker. Shot list and capture technique are
   in `STORE.md`. The popup closes on focus loss, so use `screencapture -T 10`
   from a terminal, or right-click → Inspect popup to pin it open.
2. **First Chrome submission is manual.** Their API can update an item but not
   create one, and the listing fields are dashboard-only regardless. After that,
   `npm run release <version>` does everything.
3. Store secrets, if you want automated submission — see `STORE.md`.

## Never exercised against a real cart

Worth doing before strangers install it, because these are the expensive places
for a bug:

- **Amazon deletion** (`src/scrape/amazon-remove.js`). Guarded hard — confirmed
  adds only, cart and Save for Later only, wish lists refused twice over, each
  deletion verified by polling `isPresent` rather than counting clicks. Still
  never run for real.
- **Pagination crawl** (`scan()` in `src/scrape/amazon.js`). Follows cart pages
  breadth-first, capped at 20.

## Things that bit us, so they don't again

- Amazon's truncation widget renders every title **twice** (offscreen full copy
  plus a visible shortened one) and appends "Opens in a new tab". Plain
  `textContent` gives `TitleTitleOpens in a new tab`, which then fails every
  Goodreads search. Handled in `text()`.
- Negative ISBN lookups are cached 90 days, so a scraping bug poisons the cache
  long after it's fixed. `CACHE_VERSION` in `src/lib/store.js` — bump it whenever
  a scraping or lookup fix could have written bad entries.
- The popup renders **persisted** session state, so after an update it can still
  show items produced by the bug the update fixed. Cleared on `reason=update`.
  When testing a scraping fix: reload, **Clear**, then scan.
- A Goodreads sign-in page still carries a `csrf-token`. Token presence proves
  nothing about the session; check for sign-in/sign-out links instead.
- Store versions are write-once. A rejected 1.1.0 can never be re-uploaded as
  1.1.0. `scripts/release.js` refuses to go backwards; the workflow refuses to
  build when tag and manifest disagree.

## Debugging

The popup has a **Diagnostics** button: copies what the scraper actually saw —
matched containers, per-selector counts, every extracted row with the path it
took, and every rejected row with a text snippet. Use it when a book is in the
cart but not in the list; it distinguishes "never scanned" from "scanned and
failed to match", which need opposite fixes.
