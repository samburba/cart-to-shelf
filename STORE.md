# Store submission

Everything needed for the Chrome Web Store and Firefox AMO listings, so the
copy is written once and stays consistent.

Build the upload artifact with `npm run build` → `cart-to-shelf.zip`.

## Before you submit

- [ ] Replace the placeholder icons in `src/icons/` with real artwork
      (128×128 required by Chrome; AMO uses 64 and 128).
- [ ] Take screenshots: Chrome wants 1280×800 or 640×400, at least one, up to
      five. Useful set: the popup mid-review with confidence badges, the popup
      mid-shelve, the Goodreads shelf after a run.
- [ ] Bump `version` in `manifest.json`. Store versions can never be reused,
      even after a rejection.

## Listing copy

**Name:** Cart to Shelf

**Summary (132 char max):**
Move books from your Amazon cart, wish lists, and Save for Later onto your
Goodreads Want to Read shelf.

**Description:**

Books you mean to read pile up in your Amazon cart, because that's where you
eventually buy them. It's a bad reading list: unsorted, unshareable, and
invisible from Goodreads.

Cart to Shelf reads your Amazon cart, Save for Later, and wish lists, then adds
those books to your Goodreads Want to Read shelf.

- Scans automatically when you open a cart or wish list, or on demand
- Books it's confident about are pre-checked; anything ambiguous is shown
  unchecked rather than quietly dropped, so you decide
- Resolves ISBNs from the ASIN where possible, else Open Library or Google Books
- Remembers what it already sent, so re-running never duplicates
- Optionally clears confirmed books from your Amazon cart (off by default;
  wish lists are never touched)
- Falls back to a Goodreads CSV import file if anything goes wrong

There is no account, no server, and no password. The extension works inside the
sessions you're already signed in to. Nothing is collected and nothing is sent
anywhere except anonymous title lookups for editions without an ISBN.

Open source: https://github.com/samburba/cart-to-shelf

**Category:** Productivity
**Privacy policy URL:** https://cart-to-shelf.burba.dev/privacy.html
**Homepage:** https://cart-to-shelf.burba.dev/
**Support:** https://github.com/samburba/cart-to-shelf/issues

## Chrome Web Store

Console: https://chrome.google.com/webstore/devconsole — $5 one-time
registration fee, paid once per developer account.

**Single purpose** (required field):

> Transfer books from a user's Amazon cart, Save for Later, and wish lists to
> their Goodreads Want to Read shelf.

**Permission justifications** (each is a required field; reviewers reject vague
answers):

| Permission | Justification |
| --- | --- |
| `https://*.amazon.com/*` | Reads book titles, authors, and ASINs from the user's own cart, Save for Later, and wish list pages. This is the source of the books being transferred. |
| `https://*.goodreads.com/*` | Adds the selected books to the user's Goodreads Want to Read shelf, using the session they are already signed in to. |
| `https://openlibrary.org/*` | Looks up an ISBN by title and author for Kindle and Audible editions, whose ASIN is not an ISBN. Anonymous; no user data is sent. |
| `https://www.googleapis.com/*` | Same lookup via Google Books when Open Library has no match. Anonymous. |
| `storage` | Caches ISBN lookups locally and records which books were already sent, so re-running does not create duplicates. Local to the device. |
| `downloads` | Saves the Goodreads-format CSV file when the user chooses the CSV import path. |
| `scripting` | Injects the reader into the Amazon page and the writer into the Goodreads page, on user action. |
| `tabs` | Finds the user's existing Amazon and Goodreads tabs, or opens one, to run the above. |

**Data usage disclosures:** tick nothing. Declare that the extension does not
collect or transmit user data, and certify it is not sold to third parties, not
used for creditworthiness, and not used for purposes unrelated to the single
purpose above.

Expect days to weeks for first review. Broad host permissions attract scrutiny;
the justifications above and the public source are what answer it.

## Firefox AMO

Console: https://addons.mozilla.org/developers/ — free, no fee.

`manifest.json` already carries the `browser_specific_settings.gecko.id` AMO
requires. The source is unminified with no build step, so no source-code upload
is needed. Choose **listed** distribution.

AMO review is usually much faster than Chrome's. Submit here second anyway —
Chrome sets the harder bar, and anything its reviewers make you change is worth
having in the AMO listing too.

## A caveat worth knowing

The extension automates goodreads.com using undocumented endpoints, which their
terms discourage. Neither store forbids this, and the traffic is user-initiated,
throttled, and confined to the user's own account — but it is a real basis on
which a reviewer could push back, and Goodreads could break the automatic path
at any time. The CSV import path does not depend on any of it, which is worth
saying plainly in the listing rather than discovering in a rejection.

## Releases

`npm run release 1.1.0` bumps `manifest.json` and `package.json`, runs the
tests, commits, tags `v1.1.0`, and pushes. The tag triggers
`.github/workflows/release.yml`, which re-runs the tests, checks the tag agrees
with the manifest, builds the zip, attaches it to a GitHub release, and — if the
secrets below are set — submits to both stores.

Without those secrets it still tests, builds, and publishes the GitHub release.
You just upload the zip by hand. Nothing breaks; a step is skipped.

### Chrome secrets

Repo → Settings → Secrets and variables → Actions:

| Secret | Where it comes from |
| --- | --- |
| `CHROME_EXTENSION_ID` | The item's ID, visible in the developer dashboard URL after the first manual upload |
| `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET` | Google Cloud console → enable the **Chrome Web Store API** → create an OAuth client of type *Desktop app* |
| `CHROME_REFRESH_TOKEN` | Exchange an auth code for a refresh token once, using that client, with scope `https://www.googleapis.com/auth/chromewebstore` |

The **first** submission has to be manual — the API can update an existing item
but cannot create one, and the listing copy, screenshots, and privacy
disclosures are dashboard-only fields anyway.

### Firefox secrets

AMO → Manage API Keys: `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`.

### Version discipline

Store versions are write-once. A rejected 1.1.0 can never be re-uploaded as
1.1.0 — you go to 1.1.1. The release script refuses to move the version
backwards, and the workflow refuses to build when the tag and the manifest
disagree, which is how the wrong version otherwise reaches a store.

## Screenshots

Chrome requires at least one, up to five, at **1280×800** or 640×400. The first
is the one shown on the store card and in search results, so it carries the
most weight. AMO accepts the same images.

| # | Shot | Must show |
| --- | --- | --- |
| 1 | Popup open over your Amazon cart | Both halves of the idea in one frame: the cart behind, the extension's list of books in front, "Add to Goodreads" visible |
| 2 | Mid-run | The status line counting through — `Adding "…" (3/8)` — so it's clear this is doing work, not just making a list |
| 3 | The Goodreads shelf afterwards | Want to Read with the books that just arrived. The payoff |
| 4 | An ambiguous item | A row unchecked with "might not be a book" — you stay in control, nothing is added behind your back |
| 5 | Settings | The three checkboxes, including the off-by-default Amazon deletion. Reviewers look for exactly this |

Practical notes:

- The popup is 420px wide; captured alone it's tiny in a 1280×800 frame. Shoot
  the whole browser window with the popup open (`Cmd+Shift+4`, then Space, then
  hold Option while clicking to drop the window shadow), then scale to exactly
  1280×800.
- Zoom the page to 125–150% first so text survives the store's downscaling.
- Use light mode. Both themes work, but light reads better on a store card.
- Check the frame for your own data: the account name in Amazon's nav, other
  tabs, bookmarks bar, notifications.
- No added marketing text or claims baked into the images — Chrome treats
  overlaid promotional copy as a listing-quality problem.

`store/promo-tile-440x280.png` is the optional small promo tile, ready to upload.
