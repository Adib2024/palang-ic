// The "inbox": files handed from one place to a tool without leaving the
// device — shared to DokuJaga from another app (via the service worker) or
// passed on with "Teruskan ke…". Kept in IndexedDB on this device only and
// removed as soon as a tool takes them.
const DB = 'dokujaga-handoff';
const STORE = 'inbox';
const MAX_AGE = 24 * 60 * 60 * 1000;

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req && req.result); };
    t.onerror = () => { db.close(); reject(t.error); };
  }));
}

/** Put files in the inbox (replaces anything already there). */
export function putInbox(files, from = '') {
  return tx('readwrite', (s) => s.put({ at: Date.now(), from, files: [...files] }, 'current'));
}

/** Look at the inbox without emptying it. Resolves to {files, from, at} or null. */
export async function peekInbox() {
  try {
    const v = await tx('readonly', (s) => s.get('current'));
    return v && Date.now() - v.at < MAX_AGE && v.files && v.files.length ? v : null;
  } catch {
    return null;
  }
}

/** Take the files and empty the inbox. */
export async function takeInbox() {
  const v = await peekInbox();
  try { await tx('readwrite', (s) => s.delete('current')); } catch { /* ignore */ }
  return v ? v.files : [];
}

/** Put files into a file <input> as if the user had picked them. */
function feed(input, files) {
  const dt = new DataTransfer();
  (input.multiple ? files : files.slice(0, 1)).forEach((f) => dt.items.add(f));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * If this page was opened with ?from=inbox, give the waiting files to the
 * tool's file input(s). Call after the tool has set up its listeners.
 */
export async function deliverInbox() {
  const params = new URLSearchParams(location.search);
  if (params.get('from') !== 'inbox') return false;
  params.delete('from');
  history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash);
  // Tools with one input per file (Compare: A/B, Palang IC: front/back), else #pickFiles.
  const pairs = [['#fileA', '#fileB'], ['input[data-input="front"]', 'input[data-input="back"]']];
  const pair = pairs.map((sels) => sels.map((q) => document.querySelector(q))).find((inputs) => inputs[0]);
  const single = document.querySelector('#pickFiles');
  // No file input here (e.g. the tool picker): leave the files in the inbox.
  if (!pair && !single) return false;
  const files = await takeInbox();
  if (!files.length) return false;
  if (pair) files.slice(0, pair.length).forEach((f, i) => feed(pair[i], [f]));
  else feed(single, files);
  return true;
}
