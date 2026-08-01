// Watches an Amazon list for changes and tells the background worker.
//
// Polling every few seconds would re-scrape a page that mostly has not changed,
// and would still lag a removal by up to that interval. Amazon updates the cart
// in place over AJAX, so the DOM mutation *is* the event — observing it is both
// instant and free when nothing is happening.

(function () {
  if (globalThis.__cartToShelfWatching) return; // one observer per tab
  globalThis.__cartToShelfWatching = true;

  const CONTAINERS = ['#sc-active-cart', '#sc-saved-cart', '#g-items'];
  const SETTLE_MS = 1200;

  let timer = null;

  function changed() {
    // Amazon fires a burst of mutations per edit; wait for it to stop.
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        chrome.runtime.sendMessage({ type: 'list-changed' });
      } catch {
        /* worker asleep or extension reloading; the next edit will retry */
      }
    }, SETTLE_MS);
  }

  const observer = new MutationObserver(changed);

  function observe() {
    let found = 0;
    for (const sel of CONTAINERS) {
      const node = document.querySelector(sel);
      if (!node) continue;
      observer.observe(node, { childList: true, subtree: true });
      found++;
    }
    return found;
  }

  if (!observe()) {
    // The cart can render after this script lands; wait for the container to
    // appear, then switch to watching it directly.
    const bootstrap = new MutationObserver(() => {
      if (observe()) bootstrap.disconnect();
    });
    bootstrap.observe(document.body, { childList: true, subtree: true });
  }
})();
