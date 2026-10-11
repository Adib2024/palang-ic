// Batch mode for single-file tools: when several files are picked, the same
// settings are applied to each one and the results are saved as one ZIP.
// The first file still drives the tool's preview and options.
import { makeZip } from './zip.js';

/**
 * @param {HTMLElement} host where the "N files" note goes
 * @param {{tr: (key: string, vars?: object) => string}} opts
 */
export function createBatch(host, { tr }) {
  let files = [];
  const note = document.createElement('div');
  note.className = 'batch-note';
  note.hidden = true;
  host.appendChild(note);

  function render() {
    note.hidden = files.length < 2;
    if (note.hidden) return;
    note.textContent = '';
    const head = document.createElement('strong');
    head.textContent = tr('batchNote', { n: files.length });
    const list = document.createElement('ul');
    files.forEach((f) => {
      const li = document.createElement('li');
      li.textContent = f.name;
      list.appendChild(li);
    });
    note.append(head, list);
  }

  return {
    /** Remember the picked files (only the ones this tool can take). */
    set(list) { files = [...list]; render(); },
    get files() { return files; },
    /** True when more than one file is waiting: save as a ZIP. */
    get active() { return files.length > 1; },
    render,
    /**
     * Process every file with `fn(file) => Promise<File>` (in order, one at a
     * time to keep memory low). Failed files are skipped and reported.
     * @returns {Promise<{zip: File, done: number, failed: {file: File, err: any}[]}>}
     */
    async run(fn, zipName, onProgress = () => {}) {
      const out = [];
      const failed = [];
      for (let i = 0; i < files.length; i++) {
        onProgress(i + 1, files.length, files[i]);
        try {
          out.push(await fn(files[i]));
        } catch (err) {
          failed.push({ file: files[i], err });
        }
      }
      if (!out.length) throw (failed[0] && failed[0].err) || new Error('empty');
      const seen = new Map();
      const entries = [];
      for (const f of out) {
        // Keep names unique inside the ZIP.
        let name = f.name;
        const n = seen.get(name) || 0;
        seen.set(name, n + 1);
        if (n) name = name.replace(/(\.[^.]+)?$/, ` (${n + 1})$1`);
        entries.push({ name, data: new Uint8Array(await f.arrayBuffer()) });
      }
      return { zip: new File([makeZip(entries)], zipName, { type: 'application/zip' }), done: out.length, failed };
    },
  };
}

/** One line summarising a batch run for the status area. */
export function batchSummary(tr, res, size) {
  let s = tr('batchDone', { n: res.done, size });
  if (res.failed.length) s += ` ${tr('batchFailed', { n: res.failed.length, names: res.failed.map((f) => f.file.name).join(', ') })}`;
  return s;
}
