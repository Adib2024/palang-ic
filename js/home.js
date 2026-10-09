import { initPage } from './page.js';

initPage();

// Category chips filter the tool grid (like iLovePDF's tool filters).
const chips = [...document.querySelectorAll('.chip[data-cat]')];
const tools = [...document.querySelectorAll('.tool[data-cat]')];
for (const chip of chips) {
  chip.addEventListener('click', () => {
    const cat = chip.dataset.cat;
    chips.forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    tools.forEach((t) => { t.hidden = cat !== 'all' && t.dataset.cat !== cat; });
  });
}
