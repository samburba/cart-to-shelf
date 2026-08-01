# Privacy Policy

**Cart to Shelf collects nothing.**

There is no server operated by this extension, no account, and no analytics. The
developer never receives your data, because there is nowhere for it to go.

## What the extension reads

When you click *Scan Amazon*, it reads the book titles, authors, ASINs, and
cover image URLs visible on the Amazon page you have open. It does not read your
payment details, addresses, order history, or any other page.

## What leaves your browser

Two things, and only for books whose ASIN is not already an ISBN:

- An anonymous title/author query to **openlibrary.org**
- If that fails, an anonymous title/author query to **googleapis.com** (Google
  Books)

Neither request includes any identifier for you or your accounts.

Adding books to Goodreads happens as requests to goodreads.com from within a
goodreads.com page, using the session you are already signed in to. The
extension never sees, stores, or transmits your credentials for either site.

## What is stored, and where

In your browser's local extension storage, on your device only:

- A cache of ISBN lookups (expires after 90 days)
- The list of ASINs you have already sent, so reruns don't create duplicates

Uninstalling the extension deletes both. *Reset history* in the popup clears the
second one.

## Deleting from Amazon

The optional "Also delete them from my Amazon cart and Save for Later" setting is
off by default. When you turn it on, the extension clicks the Delete control for
books Goodreads has confirmed. It never touches wish lists, and never touches
anything Goodreads did not accept.

## Permissions

| Permission | Why |
| --- | --- |
| `https://*.amazon.com/*` | Read books from your cart, wish lists, and Save for Later |
| `https://*.goodreads.com/*` | Add books to your Want to Read shelf |
| `openlibrary.org`, `googleapis.com` | Look up ISBNs for Kindle and Audible editions |
| `storage` | The cache and already-sent list described above |
| `downloads` | Save the CSV file when you choose that path |
| `scripting`, `tabs` | Run the reader on the page, only when you click Scan |
