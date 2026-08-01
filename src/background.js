// Orchestration and the single source of truth for scan state. The popup is a
// view onto this; it can be closed and reopened at any point without losing
// work. Nothing here talks to a server we control, because there isn't one.

import { resolveAll } from './lib/resolve.js';
import { buildCsv, csvDataUrl } from './lib/csv.js';
import { markSent, getSent, clearSent, getBookId, setBookId } from './lib/store.js';
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

const isAmazon = (url = '') => /^https?:\/\/([^/]*\.)?amazon\./i.test(url);
const isGoodreads = (url = '') => /^https?:\/\/([^/]*\.)?goodreads\.com/i.test(url);

/** The pages worth auto-scanning: cart, Save for Later, and wish lists. */
const SCANNABLE = /amazon\.[^/]+\/(gp\/cart|cart\/|hz\/wishlist|registry\/wishlist|gp\/registry)/i;

function selectable(item) {
  return !item.alreadySent && item.confidence === 'yes' && item.source !== 'none';
}

async function decorate(items) {
  const sent = await getSent();
  return items.map((item) => ({ ...item, alreadySent: sent.has(item.asin) }));
}

function waitForComplete(tabId) {
  return new Promise((resolve) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
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

async function scanTab(tabId, { merge = false } = {}) {
  await patchSession({ status: 'scanning', note: 'Reading the page…', error: '' });

  const [injected] = await chrome.scripting.executeScript({
    target: { tabId },
    files: ['src/scrape/amazon.js'],
  });
  const found = injected?.result || [];

  if (!found.length) {
    const session = await getSession();
    const items = merge ? session.items : [];
    await patchSession({ status: 'done', items, note: 'No books found on that page.' });
    await setBadge(items.filter(selectable).length);
    return items;
  }

  await patchSession({ status: 'resolving', done: 0, total: found.length });
  const resolved = await resolveAll(found, (done, total) =>
    patchSession({ status: 'resolving', done, total })
  );

  // Merging lets a cart scan and a wish list scan accumulate instead of
  // clobbering each other — you can walk several lists and shelve once.
  const previous = merge ? (await getSession()).items : [];
  const byAsin = new Map(previous.map((i) => [i.asin, i]));
  for (const item of await decorate(resolved)) {
    const existing = byAsin.get(item.asin);
    byAsin.set(item.asin, {
      ...existing,
      ...item,
      // Preselect the confident, unsent books; leave doubtful ones visible but
      // unchecked. An existing manual choice always wins over the default.
      selected: existing ? existing.selected : selectable(item),
    });
  }
  const items = [...byAsin.values()];

  await patchSession({
    status: 'done',
    items,
    done: 0,
    total: 0,
    note: `Found ${items.length} item${items.length === 1 ? '' : 's'}.`,
  });
  await setBadge(items.filter(selectable).length);
  return items;
}

async function scan() {
  const tab = await tabFor(isAmazon, CART_URL);
  return { items: await scanTab(tab.id) };
}

// ------------------------------------------------------------- auto-scan

const recentlyScanned = new Map(); // tabId -> { url, at }

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !SCANNABLE.test(tab.url || '')) return;

  const { autoScan } = await getSettings();
  if (!autoScan) return;

  // Amazon fires 'complete' more than once per navigation; debounce per tab.
  const last = recentlyScanned.get(tabId);
  if (last && last.url === tab.url && Date.now() - last.at < 15000) return;
  recentlyScanned.set(tabId, { url: tab.url, at: Date.now() });

  const session = await getSession();
  if (session.status === 'shelving') return; // never interrupt a write

  try {
    await scanTab(tabId, { merge: true });
  } catch (err) {
    await patchSession({ status: 'error', error: String(err?.message || err) });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => recentlyScanned.delete(tabId));

// Where the browser sends people when they remove the extension. Deliberately
// bare: no id, no query string, nothing that could identify the uninstaller.
const UNINSTALL_URL = 'https://samburba.github.io/cart-to-shelf/uninstalled.html';

try {
  chrome.runtime.setUninstallURL?.(UNINSTALL_URL);
} catch {
  /* not supported everywhere; harmless if absent */
}

// A batch left mid-flight by a browser restart resumes on its own.
for (const event of [chrome.runtime.onStartup, chrome.runtime.onInstalled]) {
  event?.addListener(async () => {
    const session = await getSession();
    if (session.status === 'shelving' && session.queue?.length) runQueue();
  });
}

// -------------------------------------------------------------- shelving

// One request per book now, not two or three, so the gap can shrink without
// raising the request rate Goodreads actually sees.
const DELAY_MIN_MS = 700;
const DELAY_JITTER_MS = 500;

/** In-memory guard. Absent after a worker restart, which is what lets us resume. */
let shelvingRun = null;

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

  shelvingRun = (async () => {
    let tabId = null;
    try {
      for (;;) {
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

        // Persist after every book, before the next one is attempted.
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
    (url) => /amazon\.[^/]+\/(gp\/cart|cart\/)/i.test(url || ''),
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
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['src/scrape/amazon-remove.js'],
      });
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (asin) => globalThis.CartToShelfRemove.removeOne(asin),
        args: [book.asin],
      });
      if (res?.result?.ok) removed++;
      else skipped++;
    } catch {
      skipped++;
    }
    // Amazon re-renders (often a full navigation) after each delete, which
    // tears down the injected script — hence one item per injection.
    await new Promise((r) => setTimeout(r, 2500));
  }
  return { removed, skipped };
}

// Stop and natural completion can race; the Amazon deletions must not run twice.
let finishing = false;

async function finishShelving({ succeeded = [], failed = [] }) {
  if (finishing) return;
  finishing = true;
  try {
    await doFinishShelving({ succeeded, failed });
  } finally {
    finishing = false;
  }
}

async function doFinishShelving({ succeeded, failed }) {
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

  // Drop only books Goodreads actually confirmed. A failure stays put — the
  // whole point of waiting for confirmation is not to lose the ones that
  // didn't land.
  // Surface why a book failed, right on the book.
  const reasons = new Map(failed.map((b) => [b.asin, b.reason]));
  items = items.map((item) =>
    reasons.has(item.asin) ? { ...item, lastError: reasons.get(item.asin) } : item
  );

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
      const session = await getSession();
      await finishShelving({
        succeeded: session.succeeded || [],
        failed: [...(session.failed || []), ...(session.queue || [])],
      });
      return { ok: true };
    },
    scan: () => scan(),
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
