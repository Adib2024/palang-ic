// Undo / redo for the page editors (Redact, Sign, workflows). Each change is
// recorded as {undo, redo}; several changes can be grouped into one step.
// Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y work except while typing in a field.
import { t } from './i18n.js';

/** @param {{onChange?: () => void}} [opts] */
export function createUndo({ onChange = () => {} } = {}) {
  const done = [];
  const undone = [];
  let group = null;
  let replaying = false;
  const api = {
    /** Record a change that has just happened. */
    push(step) {
      if (replaying) return;
      if (group) { group.push(step); return; }
      done.push(step);
      undone.length = 0;
      onChange();
    },
    /** Group every change made inside `fn` into one undo step. */
    async group(fn) {
      group = [];
      try { await fn(); } finally {
        const g = group;
        group = null;
        if (g.length) api.push({ undo: () => [...g].reverse().forEach((s) => s.undo()), redo: () => g.forEach((s) => s.redo()) });
      }
    },
    undo() {
      const s = done.pop();
      if (!s) return;
      replaying = true;
      try { s.undo(); } finally { replaying = false; }
      undone.push(s);
      onChange();
    },
    redo() {
      const s = undone.pop();
      if (!s) return;
      replaying = true;
      try { s.redo(); } finally { replaying = false; }
      done.push(s);
      onChange();
    },
    clear() { done.length = 0; undone.length = 0; onChange(); },
    get canUndo() { return done.length > 0; },
    get canRedo() { return undone.length > 0; },
  };
  return api;
}

/**
 * Undo / redo buttons placed after `anchor`, plus the keyboard shortcuts.
 * @returns {() => void} call after a language change or any state change
 */
export function mountUndoButtons(anchor, history, lang) {
  const bar = document.createElement('div');
  bar.className = 'undo-bar';
  const make = (id, icon, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small';
    b.id = id;
    const i = document.createElement('span');
    i.setAttribute('aria-hidden', 'true');
    i.textContent = icon;
    const label = document.createElement('span');
    b.append(i, label);
    b.addEventListener('click', onClick);
    bar.appendChild(b);
    return { b, label };
  };
  const u = make('undoStep', '↶', () => history.undo());
  const r = make('redoStep', '↷', () => history.redo());
  anchor.after(bar);
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); history.undo(); } else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); history.redo(); }
  });
  const refresh = () => {
    u.label.textContent = t(lang(), 'undoStep');
    r.label.textContent = t(lang(), 'redoStep');
    u.b.disabled = !history.canUndo;
    r.b.disabled = !history.canRedo;
  };
  refresh();
  return refresh;
}
