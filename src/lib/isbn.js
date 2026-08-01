// ISBN validation and conversion. No dependencies so this file can be loaded
// by the extension, the tests, and (via vm) the content script harness alike.

/** Strip hyphens, spaces, and Excel armor. Uppercase the X check digit. */
export function normalize(raw) {
  if (!raw) return '';
  return String(raw).replace(/^="|"$/g, '').replace(/[\s-]/g, '').toUpperCase();
}

export function isValidIsbn10(raw) {
  const s = normalize(raw);
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = s[i];
    sum += (c === 'X' ? 10 : Number(c)) * (10 - i);
  }
  return sum % 11 === 0;
}

export function isValidIsbn13(raw) {
  const s = normalize(raw);
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  return sum % 10 === 0;
}

export function isbn10To13(raw) {
  const s = normalize(raw);
  if (!isValidIsbn10(s)) return null;
  const core = '978' + s.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  return core + String((10 - (sum % 10)) % 10);
}

export function isbn13To10(raw) {
  const s = normalize(raw);
  if (!isValidIsbn13(s) || !s.startsWith('978')) return null;
  const core = s.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? 'X' : String(check));
}

/**
 * Most print books on Amazon carry their ISBN-10 as the ASIN. Kindle and
 * Audible ASINs are opaque (B0...), so the check digit is what separates them.
 */
export function asinAsIsbn(asin) {
  const s = normalize(asin);
  return isValidIsbn10(s) ? s : null;
}
