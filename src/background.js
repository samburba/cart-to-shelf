// Orchestration and the single source of truth for scan state. The popup is a
// view onto this; it can be closed and reopened at any point without losing
// work. Nothing here talks to a server we control, because there isn't one.

import { resolveAll } from './lib/resolve.js';
import { buildCsv, csvDataUrl } from './lib/csv.js';
import { markSent, getSent, clearSent, getBookId, setBookId } from './lib/store.js';
import { createScanGate } from './lib/autoscan.js';
import { listKey, reconcileItems } from './lib/reconcile.js';
import {
  getSession,
  patchSession,
  getSettings,
  setSettings,
  setBadge,
  EMPTY_SESSION,
} from './lib/session.js';

const CART_URL = 'https://www.amazon.com/gp/cart/view.html';
const IMPORT_URL = 'https://www.goodreads.com/review/import';
const GOODREADS_HOME = 'https://www.goodreads.com/';

// Kept deliberately in step with host_permissions. A matcher that is broader
// than the granted scope does not open a door — it just produces a page we then
// fail to inject into, surfacing as an opaque permission error rather than an
// honest "not supported here".
const isAmazon = (url = '') => /^https:\/\/([^/]*\.)?amazon\.com(?:[/?#]|$)/i.test(url);
const isGoodreads = (url = '') =>
  /^https:\/\/([^/]*\.)?goodreads\.com(?:[/?#]|$)/i.test(url);

const scanGate = createScanGate();

function selectable(item) {
  return !item.alreadySent && item.confidence === 'yes' && item.source !== 'none';
}

async function decorate(items) {
  const sent = await getSent();
  return items.map((item) => ({ ...item, alreadySent: sent.has(item.asin) }));
}

// A page that stalls should not strand the caller. Resolving on timeout rather
// than rejecting is deliberate: a half-loaded cart is still worth scraping, and
// the scrape reports emptiness honestly if it isn't.
const LOAD_TIMEOUT_MS = 15000;

function waitForComplete(tabId) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };

    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') finish();
    };
    const timer = setTimeout(finish, LOAD_TIMEOUT_MS);

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === 'complete') finish();
      },
      finish // the tab vanished; nothing to wait for
    );
  });
}

async function tabFor(predicate, fallbackUrl) {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && predicate(active.url)) return active;

  const existing = (await chrome.tabs.query({})).find((t) => predicate(t.url));
  if (existing) return existing;

  const tab = await chrome.tabs.create({ url: fallbackUrl, active: false });
  await waitForComplete(tab.id);
  return tab;
}

// ---------------------------------------------------------------- scanning

/** Failure reasons that mean the Goodreads session is gone, not that the book is. */
const SESSION_LOST = new Set(['not-signed-in', 'no-csrf-token']);

/**
 * A signed-out Amazon page looks exactly like an empty cart, and a signed-out
 * Goodreads returns the sign-in page for every write. Both read as "the
 * extension is broken" unless we say otherwise.
 */
const SIGNED_OUT = {
  amazon: 'You are not signed in to Amazon. Sign in, then scan again.',
  goodreads:
    'You are not signed in to Goodreads. Sign in, then try again — or use “CSV instead”, which works either way.',
};

async function scanTab(tabId, { merge = false, quiet = false } = {}) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const key = listKey(tab?.url || '');

  if (!quiet) {
    await patchSession({ status: 'scanning', note: 'Reading the page…', error: '' });
  }

  const [injected] = await chrome.scripting.executeScript({
    target: { tabId },
    files: ['src/scrape/amazon.js'],
  });
  const found = injected?.result || [];

  if (!found.length) {
    // Nothing found is ambiguous: an empty cart and a signed-out one look the
    // same. Ask before blaming the page — and if the question cannot be asked,
    // fall back to the ordinary empty-page result rather than inventing a
    // diagnosis.
    let signedOut = false;
    try {
      const [auth] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => globalThis.CartToShelf.signedIn(),
      });
      signedOut = auth?.result === false;
    } catch {
      /* the page went away mid-scan; "no books" is still the honest answer */
    }

    const session = await getSession();
    const items = merge ? session.items : [];

    await patchSession({
      status: signedOut ? 'error' : 'done',
      items,
      error: signedOut ? SIGNED_OUT.amazon : '',
      note: signedOut ? '' : 'No books found on that page.',
    });
    await setBadge(items.filter(selectable).length);
    return items;
  }

  await patchSession({ status: 'resolving', done: 0, total: found.length });
  const resolved = await resolveAll(found, (done, total) =>
    patchSession({ status: 'resolving', done, total })
  );

  // Accumulate across different lists, replace within one — so walking the
  // cart and two wish lists unions them, but removing a book from the cart
  // removes it here too.
  const previous = merge ? (await getSession()).items : [];
  const fresh = (await decorate(resolved)).map((item) => ({
    ...item,
    selected: selectable(item),
  }));
  const items = reconcileItems(previous, fresh, key);

  await patchSession({
    status: 'done',
    items,
    done: 0,
    total: 0,
    note: `Found ${items.length} item${items.length === 1 ? '' : 's'}.`,
  });
  await setBadge(items.filter(selectable).length);
  await watchTab(tabId);
  return items;
}

/** Keep an eye on a list we have scanned, so edits to it show up on their own. */
async function watchTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/scrape/watch.js'],
    });
  } catch {
    /* the tab navigated away mid-scan; nothing to watch */
  }
}

// Edits arrive in bursts even after the page-side settle, and a rescan is not
// free, so coalesce again here.
const RESCAN_DEBOUNCE_MS = 800;
const rescanTimers = new Map();

async function onListChanged(tabId) {
  if (tabId == null) return;

  const { autoScan } = await getSettings();
  if (!autoScan) return;

  const session = await getSession();
  if (session.status === 'shelving') return; // never interrupt a write

  clearTimeout(rescanTimers.get(tabId));
  rescanTimers.set(
    tabId,
    setTimeout(async () => {
      rescanTimers.delete(tabId);
      try {
        // Quiet: this is a background refresh nobody asked for, so it must not
        // stomp the status line with "Reading the page…".
        await scanTab(tabId, { merge: true, quiet: true });
      } catch {
        /* the tab went away; the next scan will sort it out */
      }
    }, RESCAN_DEBOUNCE_MS)
  );
}

async function scan() {
  const tab = await tabFor(isAmazon, CART_URL);
  return { items: await scanTab(tab.id) };
}

// ------------------------------------------------------------- auto-scan

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  const url = tab?.url || info.url || '';
  if (!scanGate.shouldScan(tabId, info.status, url)) return;

  const { autoScan } = await getSettings();
  if (!autoScan) return;

  const session = await getSession();
  if (session.status === 'shelving') return; // never interrupt a write

  try {
    await scanTab(tabId, { merge: true });
  } catch (err) {
    await patchSession({ status: 'error', error: String(err?.message || err) });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  scanGate.forget(tabId);
  clearTimeout(rescanTimers.get(tabId));
  rescanTimers.delete(tabId);
});

// Where the browser sends people when they remove the extension. Deliberately
// bare: no id, no query string, nothing that could identify the uninstaller.
const UNINSTALL_URL = 'https://cart-to-shelf.burba.dev/uninstalled.html';

try {
  chrome.runtime.setUninstallURL?.(UNINSTALL_URL);
} catch {
  /* not supported everywhere; harmless if absent */
}

// A batch left mid-flight by a browser restart resumes on its own.
chrome.runtime.onStartup?.addListener(async () => {
  const session = await getSession();
  if (session.status === 'shelving' && session.queue?.length) runQueue();
});

chrome.runtime.onInstalled?.addListener(async (details) => {
  // Scanned items are a cache of what a page looked like at scan time. After an
  // update they may have been produced by a scraping bug the update just fixed,
  // and a stale list is indistinguishable from a fresh one in the popup. Drop
  // it so the next scan is authoritative.
  if (details?.reason === 'update') {
    await patchSession({ ...EMPTY_SESSION, note: 'Updated — scan again for a fresh list.' });
    await setBadge(0);
    return;
  }

  const session = await getSession();
  if (session.status === 'shelving' && session.queue?.length) runQueue();
});

// -------------------------------------------------------------- shelving

// One request per book now, not two or three, so the gap can shrink without
// raising the request rate Goodreads actually sees.
const DELAY_MIN_MS = 700;
const DELAY_JITTER_MS = 500;

/** In-memory guard. Absent after a worker restart, which is what lets us resume. */
let shelvingRun = null;

/**
 * Bumped whenever a run is abandoned or superseded — Stop, or a fresh batch.
 *
 * Stop finalises the session while a book may still be in flight. Without this,
 * that book's write lands *after* the finalisation and undoes it: the queue
 * reappears, and the book is recorded as failed a second time on top of the
 * entry Stop already made for it. A run whose generation has moved on drops its
 * result on the floor instead, which is the correct thing to do with the
 * outcome of work nobody is waiting for any more.
 */
let shelveGeneration = 0;

/**
 * Sleep in short hops, touching an extension API between them. An idle MV3
 * worker is suspended after ~30s, and that is what silently killed earlier
 * batches partway through.
 */
async function sleepAlive(ms) {
  let left = ms;
  while (left > 0) {
    const step = Math.min(5000, left);
    await new Promise((r) => setTimeout(r, step));
    left -= step;
    try {
      await chrome.runtime.getPlatformInfo();
    } catch {
      /* keepalive is best effort */
    }
  }
}

async function goodreadsTab(cachedId) {
  if (cachedId != null) {
    try {
      const tab = await chrome.tabs.get(cachedId);
      if (tab && isGoodreads(tab.url)) return tab;
    } catch {
      /* tab was closed; fall through and find another */
    }
  }
  return tabFor(isGoodreads, GOODREADS_HOME);
}

/**
 * Drains the persisted queue one book at a time. Each book is its own script
 * injection and its own storage write, so nothing beyond the single book in
 * flight can ever be lost.
 */
async function runQueue() {
  if (shelvingRun) return shelvingRun;

  const generation = shelveGeneration;

  shelvingRun = (async () => {
    let tabId = null;
    try {
      for (;;) {
        if (shelveGeneration !== generation) return;

        const session = await getSession();
        if (session.status !== 'shelving') return;

        const queue = session.queue || [];
        if (!queue.length) {
          await finishShelving({
            succeeded: session.succeeded || [],
            failed: session.failed || [],
          });
          return;
        }

        const book = queue[0];
        const total = session.total || queue.length;
        await patchSession({ note: `Adding “${book.title}”…`, done: total - queue.length });

        let outcome;
        try {
          const tab = await goodreadsTab(tabId);
          tabId = tab.id;
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['src/scrape/goodreads.js'],
          });
          const known = await getBookId(book.isbn);
          const [res] = await chrome.scripting.executeScript({
            target: { tabId },
            func: (payload) => globalThis.CartToShelfGR.shelveOne(payload),
            args: [known ? { ...book, goodreadsId: known } : book],
          });
          outcome = res?.result || { ok: false, reason: 'no-response' };
          if (outcome.ok && outcome.goodreadsId) {
            await setBookId(book.isbn, outcome.goodreadsId);
          }
        } catch (err) {
          outcome = { ok: false, reason: String(err?.message || err) };
        }

        // Persist after every book, before the next one is attempted — unless
        // Stop finalised the session while this book was in flight, in which
        // case Stop has already accounted for it.
        if (shelveGeneration !== generation) return;

        const current = await getSession();
        await patchSession({
          queue: (current.queue || []).slice(1),
          succeeded: outcome.ok
            ? [...(current.succeeded || []), { ...book, goodreadsId: outcome.goodreadsId }]
            : current.succeeded || [],
          failed: outcome.ok
            ? current.failed || []
            : [...(current.failed || []), { ...book, reason: outcome.reason }],
          done: total - (current.queue || []).length + 1,
        });

        // A session that lapsed mid-run fails every remaining book identically.
        // Stop and say so once, rather than grinding through forty of them and
        // burying the reason in a list.
        if (!outcome.ok && SESSION_LOST.has(outcome.reason)) {
          const s = await getSession();
          await finishShelving({
            succeeded: s.succeeded || [],
            failed: [...(s.failed || []), ...(s.queue || [])],
            error: SIGNED_OUT.goodreads,
          });
          return;
        }

        if ((current.queue || []).length > 1) {
          await sleepAlive(DELAY_MIN_MS + Math.random() * DELAY_JITTER_MS);
        }
      }
    } finally {
      shelvingRun = null;
    }
  })();

  return shelvingRun;
}

async function shelve(books) {
  shelveGeneration++; // any older run is now stale

  // Check once up front rather than discovering it forty failures in. Only a
  // definite "signed out" stops the run: the check is an optimisation, and a
  // check that cannot complete must not be the reason a working batch is
  // refused. The per-book path catches a lapsed session anyway.
  let signedOut = false;
  try {
    const tab = await goodreadsTab(null);
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/scrape/goodreads.js'],
    });
    const [auth] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => globalThis.CartToShelfGR.signedIn(),
    });
    signedOut = auth?.result === false;
  } catch {
    /* could not look; proceed and let the books themselves report it */
  }

  if (signedOut) {
    await patchSession({ status: 'done', error: SIGNED_OUT.goodreads, queue: [] });
    return { started: false, signedOut: true };
  }

  await patchSession({
    status: 'shelving',
    done: 0,
    total: books.length,
    note: 'Adding to Goodreads…',
    error: '',
    result: null,
    queue: books,
    succeeded: [],
    failed: [],
  });
  runQueue();
  return { started: true };
}

/**
 * Delete confirmed books from the Amazon cart / Save for Later. Only ever
 * called for books Goodreads returned success for, and only for those two
 * surfaces — wish lists are never touched.
 */
async function removeFromAmazon(books) {
  const targets = books.filter((b) => b.surface === 'cart' || b.surface === 'saved');
  if (!targets.length) return { removed: 0, skipped: 0 };

  const tab = await tabFor(
    (url) => isAmazon(url) && /\/(gp\/cart|cart[/?#]|cart$)/i.test(url || ''),
    CART_URL
  );

  let removed = 0;
  let skipped = 0;
  for (const book of targets) {
    await patchSession({
      status: 'shelving',
      note: `Removing “${book.title}” from your cart…`,
    });
    try {
      const inject = () =>
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['src/scrape/amazon-remove.js'],
        });

      await inject();
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (asin) => globalThis.CartToShelfRemove.removeOne(asin),
        args: [book.asin],
      });

      if (!res?.result?.ok) {
        skipped++;
      } else {
        // Confirm it actually went. Amazon re-renders asynchronously, and a
        // click on a node detached by an earlier re-render silently does
        // nothing — counting clicks overstated what was removed.
        let gone = false;
        for (let attempt = 0; attempt < 6 && !gone; attempt++) {
          await new Promise((r) => setTimeout(r, 700));
          try {
            await inject();
            const [check] = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: (asin) => globalThis.CartToShelfRemove.isPresent(asin),
              args: [book.asin],
            });
            gone = check?.result === false;
          } catch {
            // A navigation mid-check; re-inject on the next pass.
          }
        }
        if (gone) removed++;
        else skipped++;
      }
    } catch {
      skipped++;
    }
  }
  return { removed, skipped };
}

// Stop and natural completion can race; the Amazon deletions must not run twice.
let finishing = false;

async function finishShelving({ succeeded = [], failed = [], error = '' }) {
  if (finishing) return;
  finishing = true;
  try {
    await doFinishShelving({ succeeded, failed, error });
  } finally {
    finishing = false;
  }
}

async function doFinishShelving({ succeeded, failed, error = '' }) {
  if (succeeded.length) await markSent(succeeded.map((b) => b.asin));

  const sentAsins = new Set(succeeded.map((b) => b.asin));
  const failedAsins = new Set(failed.map((b) => b.asin));
  const session = await getSession();
  // Leave only the failures selected, so the CSV fallback next picks up exactly
  // what did not go through.
  let items = session.items.map((item) => ({
    ...item,
    alreadySent: item.alreadySent || sentAsins.has(item.asin),
    selected: failedAsins.has(item.asin),
  }));

  // Surface why a book failed, right on the book.
  const reasons = new Map(failed.map((b) => [b.asin, b.reason]));
  items = items.map((item) =>
    reasons.has(item.asin) ? { ...item, lastError: reasons.get(item.asin) } : item
  );

  // Drop only books Goodreads actually confirmed. A failure stays put — the
  // whole point of waiting for confirmation is not to lose the ones that
  // didn't land.
  const settings = await getSettings();
  if (settings.removeAdded) items = items.filter((item) => !sentAsins.has(item.asin));

  let cartNote = '';
  if (settings.removeFromAmazon && succeeded.length) {
    const { removed, skipped } = await removeFromAmazon(succeeded);
    if (removed) cartNote = ` Removed ${removed} from your Amazon cart.`;
    if (skipped) cartNote += ` ${skipped} could not be removed — check the cart.`;
  }

  await patchSession({
    status: 'done',
    items,
    done: 0,
    total: 0,
    queue: [],
    result: { succeeded, failed },
    error,
    note:
      (failed.length
        ? `Added ${succeeded.length}. ${failed.length} did not go through (${failed[0].reason}) — still listed and selected, so “CSV instead” will import them.`
        : `Added all ${succeeded.length} to Want to Read.`) + cartNote,
  });
  await setBadge(items.filter((i) => selectable(i) || failedAsins.has(i.asin)).length);
}

// ------------------------------------------------------------------- csv

async function exportCsv(books) {
  const csv = buildCsv(books);
  await chrome.downloads.download({
    url: csvDataUrl(csv),
    filename: 'cart-to-shelf-goodreads-import.csv',
    saveAs: true,
  });
  await chrome.tabs.create({ url: IMPORT_URL, active: true });
  await markSent(books.map((b) => b.asin));

  const session = await getSession();
  const asins = new Set(books.map((b) => b.asin));
  const items = session.items.map((i) =>
    asins.has(i.asin) ? { ...i, alreadySent: true } : i
  );
  await patchSession({
    status: 'done',
    items,
    note: 'CSV saved. Upload it on the Goodreads import page.',
  });
  await setBadge(items.filter(selectable).length);
  return { count: books.length };
}

// -------------------------------------------------------------- messaging

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'list-changed') {
    onListChanged(sender?.tab?.id);
    return false;
  }

  const handlers = {
    state: async () => {
      const session = await getSession();
      // If a batch was interrupted (worker suspended, browser restarted), the
      // queue outlived it. Opening the popup picks the run back up.
      if (session.status === 'shelving' && session.queue?.length && !shelvingRun) {
        runQueue();
      }
      return { session, settings: await getSettings() };
    },
    resume: async () => {
      runQueue();
      return { ok: true };
    },
    stop: async () => {
      // Retire the run first, so a book still in flight cannot write over the
      // finalisation we are about to perform.
      shelveGeneration++;
      const session = await getSession();
      await finishShelving({
        succeeded: session.succeeded || [],
        failed: [...(session.failed || []), ...(session.queue || [])],
      });
      return { ok: true };
    },
    scan: () => scan(),
    diagnose: async () => {
      const tab = await tabFor(isAmazon, CART_URL);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['src/scrape/amazon.js'],
      });
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => globalThis.CartToShelf.diagnose(),
      });
      return res?.result || null;
    },
    shelve: () => shelve(message.books),
    csv: () => exportCsv(message.books),
    settings: () => setSettings(message.patch),
    select: async () => {
      // Selection lives in the session too, so switching tabs mid-review does
      // not throw away the choices you just made.
      const session = await getSession();
      const items = session.items.map((i) =>
        message.asin == null || i.asin === message.asin
          ? { ...i, selected: message.selected }
          : i
      );
      await patchSession({ items });
      return { ok: true };
    },
    forget: async () => {
      await clearSent();
      const session = await getSession();
      const items = session.items.map((i) => ({ ...i, alreadySent: false }));
      await patchSession({ items, note: 'Cleared the already-sent history.' });
      await setBadge(items.filter(selectable).length);
      return { ok: true };
    },
    clear: async () => {
      await patchSession({ ...EMPTY_SESSION });
      await setBadge(0);
      return { ok: true };
    },
  };

  const handler = handlers[message.type];
  if (!handler) return false;

  handler()
    .then((data) => sendResponse({ ok: true, data }))
    .catch(async (err) => {
      await patchSession({ status: 'error', error: String(err?.message || err) });
      sendResponse({ ok: false, error: String(err?.message || err) });
    });
  return true; // keep the channel open for the async response
});
