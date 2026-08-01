// Minimal stand-ins for the extension APIs. The lib modules touch `chrome` only
// at call time, so installing this before a dynamic import is enough.

import { resetCacheVersionCheck } from '../src/lib/store.js';

export function installChrome() {
  // Fresh storage means the cache-version check must run again; the real worker
  // never swaps storage out from under itself, so only tests need this.
  resetCacheVersionCheck();

  const store = {};
  const sent = [];

  const chrome = {
    _store: store,
    _sent: sent,
    storage: {
      local: {
        async get(key) {
          if (key == null) return { ...store };
          const keys = Array.isArray(key) ? key : [key];
          return Object.fromEntries(
            keys.filter((k) => k in store).map((k) => [k, store[k]])
          );
        },
        async set(obj) {
          Object.assign(store, obj);
        },
        async remove(key) {
          for (const k of Array.isArray(key) ? key : [key]) delete store[k];
        },
      },
    },
    runtime: {
      async sendMessage(message) {
        sent.push(message);
      },
      async getPlatformInfo() {
        return { os: 'mac' };
      },
    },
  };

  globalThis.chrome = chrome;
  return chrome;
}

/**
 * Route fetches by substring match. Each route may be an object (returned as
 * JSON) or a function receiving the url. Records every call for assertions.
 */
export function installFetch(routes) {
  const calls = [];

  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    for (const [pattern, response] of Object.entries(routes)) {
      if (!String(url).includes(pattern)) continue;
      const value = typeof response === 'function' ? response(String(url)) : response;
      if (value instanceof Error) throw value;
      return {
        ok: value.ok !== false,
        status: value.status || 200,
        url: value.url || String(url),
        async json() {
          return value.json ?? value;
        },
        async text() {
          return value.text ?? JSON.stringify(value.json ?? value);
        },
      };
    }
    return { ok: false, status: 404, url: String(url), async json() {}, async text() { return ''; } };
  };

  return calls;
}
