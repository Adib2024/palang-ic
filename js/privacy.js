// Privacy page: lists what DokuJaga keeps in this browser and deletes it on
// request (settings, saved signatures, recent tools, shared-file inbox).
import { initPage } from './page.js';
import { t } from './i18n.js';

const $ = (sel) => document.querySelector(sel);
const PREFIX = 'palangic:';
let ready = false;
let inbox = false;

const page = initPage(() => { if (ready) render(); });
const tr = (key, vars) => t(page.lang(), key, vars);

function keys() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
  } catch { /* storage blocked: nothing stored */ }
  return out;
}

function count(key) {
  try { const v = JSON.parse(localStorage.getItem(PREFIX + key)); return Array.isArray(v) ? v.length : 0; } catch { return 0; }
}

async function hasInbox() {
  if (!('indexedDB' in window) || !indexedDB.databases) return false;
  try { return (await indexedDB.databases()).some((d) => d.name === 'dokujaga-handoff'); } catch { return false; }
}

function render() {
  const list = $('#pvStored');
  list.textContent = '';
  const all = keys();
  const rows = [];
  const prefs = all.filter((k) => k !== 'savedSigs' && k !== 'recent');
  if (prefs.length) rows.push(tr('pvItemPrefs', { n: prefs.length }));
  if (count('savedSigs')) rows.push(tr('pvItemSigs', { n: count('savedSigs') }));
  if (count('recent')) rows.push(tr('pvItemRecent', { n: count('recent') }));
  if (inbox) rows.push(tr('pvItemInbox'));
  if (!rows.length) rows.push(tr('pvNothing'));
  for (const r of rows) {
    const li = document.createElement('li');
    li.textContent = r;
    list.appendChild(li);
  }
  $('#pvClear').disabled = !all.length && !inbox;
}

/** Delete everything DokuJaga stored in this browser (the offline app copy stays). */
export async function clearAll() {
  try { for (const k of keys()) localStorage.removeItem(PREFIX + k); } catch { /* blocked */ }
  try { localStorage.removeItem('palangic:theme'); } catch { /* blocked */ }
  if ('indexedDB' in window) {
    await new Promise((r) => { const req = indexedDB.deleteDatabase('dokujaga-handoff'); req.onsuccess = req.onerror = req.onblocked = () => r(); });
  }
  inbox = false;
  document.documentElement.removeAttribute('data-text');
  document.documentElement.removeAttribute('data-contrast');
  document.documentElement.removeAttribute('data-theme');
  render();
  $('#status').textContent = tr('pvCleared');
}

$('#pvClear').addEventListener('click', clearAll);
ready = true;
render();
hasInbox().then((v) => { inbox = v; render(); });

// Exposed for the automated test only.
window.__privacy = { clearAll, keys };
