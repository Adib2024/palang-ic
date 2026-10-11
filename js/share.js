// "Pilih alat": files shared to DokuJaga from another app (Web Share Target)
// or passed on from a tool wait in the on-device inbox; pick a tool for them.
import { initPage } from './page.js';
import { formatSize } from './pdf-kit.js';
import { peekInbox, takeInbox } from './handoff.js';
import { toolsFor, isPdfFile } from './tool-catalog.js';

const $ = (sel) => document.querySelector(sel);
let files = [];
const page = initPage(() => render());

function render() {
  const list = $('#shareList');
  list.textContent = '';
  files.forEach((f) => {
    const li = document.createElement('li');
    const kind = document.createElement('span');
    kind.className = `wf-kind ${isPdfFile(f) ? 'pdf' : 'img'}`;
    kind.textContent = isPdfFile(f) ? 'PDF' : 'IMG';
    const name = document.createElement('span');
    name.className = 'wf-fname';
    name.textContent = f.name;
    const size = document.createElement('small');
    size.textContent = formatSize(f.size);
    li.append(kind, name, size, document.createElement('span'));
    list.appendChild(li);
  });
  $('#fileCount').textContent = String(files.length);
  $('#shareEmpty').hidden = files.length > 0;
  $('#shareClear').hidden = !files.length;
  const ok = new Set(toolsFor(files).map((t) => t.href));
  document.querySelectorAll('[data-href]').forEach((a) => {
    a.hidden = !ok.has(a.dataset.href);
    a.href = `../${a.dataset.href}?from=inbox`;
  });
  $('#sharePick').hidden = !ok.size;
}

async function boot() {
  const box = await peekInbox();
  files = box ? box.files : [];
  render();
}

$('#shareClear').addEventListener('click', async () => {
  await takeInbox();
  files = [];
  render();
});
boot();

window.__share = { get files() { return files; }, reload: boot };
