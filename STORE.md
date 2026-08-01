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
