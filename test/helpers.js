// Runs the content script (a classic, non-module file) against a fixture DOM.
// Using vm rather than a bundler keeps the extension dependency-free.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { parseHTML, DOMParser } from 'linkedom';

const root = new URL('..', import.meta.url);
export const read = (rel) => readFileSync(fileURLToPath(new URL(rel, root)), 'utf8');

function load(fixtureName, scriptPath, globalName) {
  const { document, window } = parseHTML(read(`fixtures/${fixtureName}`));

  const context = vm.createContext({
    document,
    window: Object.assign(window, { scrollTo() {} }),
    setTimeout,
    clearTimeout,
    console,
    CSS: { escape: (s) => String(s).replace(/["\\]/g, '\\$&') },
  });
  context.globalThis = context;

  vm.runInContext(read(scriptPath), context);
  return { api: context[globalName], document };
}

export function loadAmazonScraper(fixtureName) {
  return load(fixtureName, 'src/scrape/amazon.js', 'CartToShelf');
}

export function loadRemover(fixtureName) {
  return load(fixtureName, 'src/scrape/amazon-remove.js', 'CartToShelfRemove');
}

/**
 * The Goodreads writer, with a page DOM and a stubbed fetch. `pageHtml` stands
 * in for whatever Goodreads page the script happens to be injected into — the
 * CSRF token is read from there.
 */
export function loadGoodreads({ pageHtml = '', fetchImpl } = {}) {
  const { document, window } = parseHTML(pageHtml || '<html><head></head><body></body></html>');

  const context = vm.createContext({
    document,
    window,
    location: { origin: 'https://www.goodreads.com' },
    fetch: fetchImpl,
    DOMParser,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console,
  });
  context.globalThis = context;

  vm.runInContext(read('src/scrape/goodreads.js'), context);
  return { api: context.CartToShelfGR, document };
}
