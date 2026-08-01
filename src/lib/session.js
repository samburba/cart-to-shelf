// Scan/shelve state lives here rather than in the popup, because the popup is
// torn down the instant focus moves to another tab. Anything the popup needs to
// redraw itself must survive that, so it goes to storage and is rehydrated on
// every open.

const SESSION_KEY = 'session';
const SETTINGS_KEY = 'settings';

export const DEFAULT_SETTINGS = {
  autoScan: true,
  removeAdded: true,
  // The one destructive setting in the extension. Off unless asked for.
  removeFromAmazon: false,
};

export const EMPTY_SESSION = {
  status: 'idle', // idle | scanning | resolving | shelving | done | error
  items: [],
  done: 0,
  total: 0,
  note: '',
  error: '',
  result: null, // { succeeded, failed } from the last shelve
  // The shelving queue is persisted after every single book, so a batch that
  // is interrupted — worker suspended, browser closed, tab navigated — resumes
  // exactly where it stopped instead of losing the run.
  queue: [],
  succeeded: [],
  failed: [],
};

export async function getSession() {
  const out = await chrome.storage.local.get(SESSION_KEY);
  return { ...EMPTY_SESSION, ...(out[SESSION_KEY] || {}) };
}

/** Merge a patch into the session, persist it, and nudge the popup if open. */
export async function patchSession(patch) {
  const next = { ...(await getSession()), ...patch };
  await chrome.storage.local.set({ [SESSION_KEY]: next });
  chrome.runtime.sendMessage({ type: 'session', session: next }).catch(() => {
    /* no popup listening; storage still holds the truth */
  });
  return next;
}

export async function getSettings() {
  const out = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(out[SETTINGS_KEY] || {}) };
}

export async function setSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/** Badge shows how many unsent books are waiting. */
export async function setBadge(count) {
  const action = chrome.action || chrome.browserAction;
  if (!action?.setBadgeText) return;
  await action.setBadgeText({ text: count > 0 ? String(count) : '' });
  await action.setBadgeBackgroundColor?.({ color: '#6b4f2a' });
}
