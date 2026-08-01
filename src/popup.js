// A view onto the background worker's session. It holds no durable state of its
// own, because Chrome and Firefox both destroy this document the moment focus
// leaves it — switching to a Goodreads tab mid-run must not lose anything.

const $ = (id) => document.getElementById(id);
const els = {
  scan: $('scan'),
  status: $('status'),
  autoScan: $('auto-scan'),
  removeAdded: $('remove-added'),
  removeAmazon: $('remove-amazon'),
  toolbar: $('toolbar'),
  selectAll: $('select-all'),
  count: $('count'),
  clear: $('clear'),
  diagnose: $('diagnose'),
  forget: $('forget'),
  list: $('list'),
  actions: $('actions'),
  shelve: $('shelve'),
  stop: $('stop'),
  csv: $('csv'),
};

let session = { status: 'idle', items: [] };

const SOURCE_LABEL = {
  asin: 'ISBN from Amazon',
  openlibrary: 'matched via Open Library',
  googlebooks: 'matched via Google Books',
  none: 'title only — Goodreads will guess',
};

const SURFACE_LABEL = { cart: 'Cart', saved: 'Save for Later', wishlist: 'Wish list' };

// Cover art is an attribute read off a page we do not control, rendered inside
// a privileged extension document. Anything but an Amazon image host would be a
// request the user never asked for, so anything else is simply not loaded.
const IMAGE_HOST_RE = /(^|\.)(media-amazon\.com|ssl-images-amazon\.com|images-amazon\.com)$/i;

function safeImage(raw) {
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && IMAGE_HOST_RE.test(url.hostname) ? url.href : '';
  } catch {
    return '';
  }
}

async function send(message) {
  const reply = await chrome.runtime.sendMessage(message);
  if (!reply?.ok) throw new Error(reply?.error || 'Something went wrong');
  return reply.data;
}

function statusText(s) {
  // An error and a note are not alternatives when a run ends early: the error
  // says why it stopped, the note says how far it got. Losing the count is
  // losing the thing the user most needs to know.
  if (s.error) return s.note ? `${s.error} ${s.note}` : s.error;
  switch (s.status) {
    case 'scanning':
      return 'Reading the page…';
    case 'resolving':
      return `Looking up ISBNs… ${s.done}/${s.total}`;
    case 'shelving':
      return `${s.note || 'Adding to Goodreads…'} (${s.done}/${s.total})`;
    default:
      return s.note || 'Open your Amazon cart or a wish list, then scan.';
  }
}

const selected = () => session.items.filter((i) => i.selected);
const busy = () => ['scanning', 'resolving', 'shelving'].includes(session.status);

function render() {
  els.status.textContent = statusText(session);
  els.status.classList.toggle('error', Boolean(session.error));

  els.list.replaceChildren();
  for (const item of session.items) {
    const li = document.createElement('li');
    li.classList.toggle('sent', item.alreadySent);

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = Boolean(item.selected);
    box.addEventListener('change', async () => {
      item.selected = box.checked;
      refreshCount();
      await send({ type: 'select', asin: item.asin, selected: box.checked });
    });

    const img = document.createElement('img');
    img.src = safeImage(item.image);
    img.alt = '';

    const body = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = item.title;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = [item.author, SURFACE_LABEL[item.surface] || item.surface]
      .filter(Boolean)
      .join(' · ');

    const badge = document.createElement('span');
    badge.className = 'badge';
    if (item.lastError) {
      badge.className = 'badge warn';
      badge.textContent = `failed: ${item.lastError}`;
    } else if (item.alreadySent) {
      badge.textContent = 'already sent';
    } else if (item.confidence === 'maybe' && item.source === 'none') {
      badge.className = 'badge warn';
      badge.textContent = 'might not be a book';
    } else {
      badge.textContent = SOURCE_LABEL[item.source] || item.source;
      if (item.source === 'none') badge.className = 'badge warn';
    }

    body.append(title, meta, badge);
    li.append(box, img, body);
    els.list.append(li);
  }

  const any = session.items.length > 0 || session.status === 'shelving';
  els.toolbar.hidden = !any;
  els.actions.hidden = !any;
  els.stop.hidden = session.status !== 'shelving';
  els.scan.disabled = busy();
  els.scan.textContent = busy() ? 'Working…' : 'Scan Amazon';
  refreshCount();
}

function refreshCount() {
  const n = selected().length;
  els.count.textContent = `${n} of ${session.items.length} selected`;
  els.selectAll.checked = n > 0 && n === session.items.length;
  els.shelve.disabled = n === 0 || busy();
  els.csv.disabled = n === 0 || busy();
  els.shelve.textContent = n > 0 ? `Add ${n} to Goodreads` : 'Add to Goodreads';
}

// The background broadcasts every session change; a popup that happens to be
// open follows along live, and one that was closed rehydrates on next open.
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'session') {
    session = message.session;
    render();
  }
});

(async function init() {
  const state = await send({ type: 'state' });
  session = state.session;
  els.autoScan.checked = state.settings.autoScan;
  els.removeAdded.checked = state.settings.removeAdded;
  els.removeAmazon.checked = state.settings.removeFromAmazon;
  render();
})();

els.scan.addEventListener('click', async () => {
  els.scan.disabled = true;
  try {
    await send({ type: 'scan' });
  } catch (err) {
    els.status.textContent = err.message;
    els.status.classList.add('error');
  }
});

els.autoScan.addEventListener('change', () =>
  send({ type: 'settings', patch: { autoScan: els.autoScan.checked } })
);

els.removeAdded.addEventListener('change', () =>
  send({ type: 'settings', patch: { removeAdded: els.removeAdded.checked } })
);

els.removeAmazon.addEventListener('change', async () => {
  // Deleting from Amazon is the only irreversible thing here, so turning it on
  // asks once. Turning it off never does.
  if (
    els.removeAmazon.checked &&
    !confirm(
      'Delete books from your Amazon cart and Save for Later once Goodreads confirms them?\n\n' +
        'Only books Goodreads accepted are removed. Wish lists are never touched.'
    )
  ) {
    els.removeAmazon.checked = false;
    return;
  }
  await send({ type: 'settings', patch: { removeFromAmazon: els.removeAmazon.checked } });
});

els.selectAll.addEventListener('change', async () => {
  for (const item of session.items) item.selected = els.selectAll.checked;
  render();
  await send({ type: 'select', asin: null, selected: els.selectAll.checked });
});

els.diagnose.addEventListener('click', async () => {
  try {
    const report = await send({ type: 'diagnose' });
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    const found = report.surfaces.reduce((n, s) => n + s.items.length, 0);
    els.status.textContent = `Copied: ${found} row${found === 1 ? '' : 's'} read, ${report.rejected.length} rejected. Paste it into a bug report.`;
    els.status.classList.remove('error');
  } catch (err) {
    els.status.textContent = `Diagnostics failed: ${err.message}`;
    els.status.classList.add('error');
  }
});

els.stop.addEventListener('click', () => send({ type: 'stop' }));
els.clear.addEventListener('click', () => send({ type: 'clear' }));
els.forget.addEventListener('click', () => send({ type: 'forget' }));

els.shelve.addEventListener('click', async () => {
  const books = selected();
  els.shelve.disabled = true;
  try {
    await send({ type: 'shelve', books });
  } catch (err) {
    els.status.textContent = `${err.message}. Try "CSV instead".`;
    els.status.classList.add('error');
  }
});

els.csv.addEventListener('click', async () => {
  try {
    await send({ type: 'csv', books: selected() });
  } catch (err) {
    els.status.textContent = err.message;
    els.status.classList.add('error');
  }
});
