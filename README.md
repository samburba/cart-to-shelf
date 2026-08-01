# Cart to Shelf

Move books out of your Amazon cart, wish lists, and Save for Later, and onto
your Goodreads **Want to Read** shelf.

The cart is where books you mean to read pile up, because it's where you
eventually buy them. It's a bad reading list. This moves them somewhere useful.

## Why an extension

Goodreads retired its public API in December 2020 and issues no new keys, and
Amazon has never exposed a personal cart or wish list to third parties. So there
is no server-side path — a hosted version would have to hold your Amazon and
Goodreads passwords.

An extension sidesteps that entirely. It runs inside the sessions you are
already signed in to, so requests carry your existing cookies. There is no
backend, no account, no OAuth, no API key. Nothing leaves your browser except
title/author lookups to Open Library and Google Books, and those are anonymous.

## Install

**From source (any browser)**

1. `git clone` this repo.
2. Chrome: visit `chrome://extensions`, enable Developer mode, click *Load
   unpacked*, select the repo folder.
   Firefox: visit `about:debugging#/runtime/this-firefox`, click *Load Temporary
   Add-on*, select `manifest.json`.

Store listings are pending.

## Use

1. Open your Amazon cart or a wish list.
2. Click the extension, then **Scan Amazon**.
3. Review the list. Confident books are pre-checked; anything ambiguous is shown
   unchecked rather than dropped, so you decide.
4. **Add to Goodreads** shelves them. If that ever fails, **CSV instead**
   produces a file for Goodreads' bulk importer.

Books you've already sent are remembered and won't be re-added on a later scan.
*Reset history* clears that.

Scan state lives in the extension's background worker, not the popup, so you can
close the popup or switch tabs mid-run without losing anything.

Shelving is a persisted queue, written to storage after every single book. Each
book is an independent request, so an interrupted batch — suspended worker,
closed browser, navigated tab — resumes from exactly where it stopped when you
next open the popup, rather than losing the run. **Stop** ends a batch early;
whatever hasn't been added yet stays selected for the CSV fallback. Books that
fail show the reason on the book itself.

## Options

| Option | Default | What |
| --- | --- | --- |
| Scan automatically when I open a cart or list | on | Scans cart, Save for Later, and wish list pages as they load. Results accumulate across pages, so you can walk several lists and shelve once. The toolbar badge counts what's waiting. |
| Clear books from this list once Goodreads confirms them | on | Removes shelved books from the review list. Only on a confirmed add — failures stay put and stay selected. |
| Also delete them from my Amazon cart and Save for Later | **off** | Deletes confirmed books from Amazon too. Wish lists are never touched. |

That last one is the only irreversible action in the extension. It runs only for
books Goodreads accepted, matches strictly on ASIN inside the cart and
Save-for-Later regions, and asks for confirmation when you switch it on.

## The two write paths

**Add to Goodreads** searches Goodreads for each book and shelves it, throttled
to about one book every two seconds. Fast and hands-off, but it depends on
undocumented Goodreads internals, so it can break when they change their site.
Anything that fails stays selected and falls through to CSV.

**CSV instead** writes Goodreads' own export schema and opens
`/review/import`, where you upload it. One manual step, effectively unbreakable,
and comfortable with hundreds of books at once. Prefer it for big batches.

Goodreads discourages automated access in its terms. Traffic here is
user-initiated, throttled, and confined to your own account, but they could
rate-limit or break the automatic path at any time. The CSV path does not depend
on any of that, which is why it exists.

## ISBNs

Most print books carry their ISBN-10 as the Amazon ASIN, so matching is exact
and free. Kindle and Audible ASINs are opaque; those fall back to Open Library,
then Google Books, matching on title and author. Anything unresolved is still
sent with title and author, which Goodreads' importer can usually match, just
less reliably. Every book in the review list shows which rung it landed on.

Results are cached for 90 days, so rescans are quick.

## Development

```
npm install
npm test     # node:test over saved Amazon fixtures
npm run build  # zips manifest.json + src for store upload
```

The Amazon markup changes periodically. Each field is read through an ordered
selector cascade and records which rung matched (`via` in the scan output), so
breakage is usually a one-line fix in `src/scrape/amazon.js` plus a fresh
fixture in `fixtures/`.

## Layout

| Path | What |
| --- | --- |
| `src/scrape/amazon.js` | Reads cart, Save for Later, and wish lists |
| `src/scrape/goodreads.js` | Same-origin shelf writes |
| `src/lib/isbn.js` | Check digits, ISBN-10/13 conversion |
| `src/lib/resolve.js` | Open Library / Google Books lookup + cache |
| `src/lib/csv.js` | Goodreads import CSV |
| `src/background.js` | Tab handling and orchestration |
| `src/popup.*` | The review UI |

## Site

`docs/` is the GitHub Pages site — enable Pages from that folder.
`uninstalled.html` is the page the browser opens when someone removes the
extension, wired up with `runtime.setUninstallURL`. It carries no query string
and no tracking: nothing about who uninstalled, only what to do if it broke.

## Privacy

No data collection of any kind, and no telemetry — not even anonymous counters.
See [PRIVACY.md](PRIVACY.md).
