// Light/dark toggle. Loaded as a classic script in <head> so the saved theme
// applies before first paint (no flash). Light is the default; dark only
// when the user picks it.
(function () {
  var KEY = 'palangic:theme';
  var root = document.documentElement;

  function saved() {
    try {
      var v = JSON.parse(window.localStorage.getItem(KEY));
      return v === 'light' || v === 'dark' ? v : null;
    } catch (e) {
      return null;
    }
  }

  function effective() {
    return saved() || 'light';
  }

  function apply() {
    var theme = saved();
    if (theme) root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');
    var dark = effective() === 'dark';
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) {
      m.setAttribute('content', dark ? '#0b0d17' : '#ffffff');
      m.removeAttribute('media');
    });
    var btn = document.getElementById('themeToggle');
    if (btn) {
      btn.textContent = dark ? '☀️' : '☾';
      btn.setAttribute('aria-pressed', String(dark));
    }
  }

  // Display settings: text size and high contrast (also applied before paint).
  var TEXT_KEY = 'palangic:textSize';
  var CONTRAST_KEY = 'palangic:contrast';
  function read(key) {
    try { return JSON.parse(window.localStorage.getItem(key)); } catch (e) { return null; }
  }
  function write(key, v) {
    try { window.localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* not saved */ }
  }
  var display = { text: read(TEXT_KEY) || 'md', contrast: read(CONTRAST_KEY) === 'high' };
  function applyDisplay() {
    if (display.text === 'lg' || display.text === 'xl') root.setAttribute('data-text', display.text);
    else root.removeAttribute('data-text');
    if (display.contrast) root.setAttribute('data-contrast', 'high');
    else root.removeAttribute('data-contrast');
  }
  applyDisplay();

  var LABELS = {
    ms: { title: 'Paparan', btn: 'Tetapan paparan', size: 'Saiz teks', contrast: 'Kontras tinggi', dark: 'Tema gelap', on: 'Hidup', off: 'Mati' },
    en: { title: 'Display', btn: 'Display settings', size: 'Text size', contrast: 'High contrast', dark: 'Dark theme', on: 'On', off: 'Off' },
  };
  function lang() { return read('palangic:lang') === 'en' ? 'en' : 'ms'; }

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text) e.textContent = text;
    return e;
  }

  // The "Aa" button and its panel are added to every page's header here, so
  // the pages themselves don't need to change.
  function mountDisplayMenu() {
    var actions = document.querySelector('.site-header .top-actions');
    if (!actions || document.getElementById('a11yBtn')) return;
    var wrap = el('div', { class: 'a11y-wrap' });
    var btn = el('button', { type: 'button', id: 'a11yBtn', class: 'theme-toggle a11y-btn', 'aria-expanded': 'false', 'aria-controls': 'a11yPop' }, 'Aa');
    var pop = el('div', { id: 'a11yPop', class: 'a11y-pop', role: 'group', hidden: '' });
    var h = el('h2', { id: 'a11yTitle' });
    pop.setAttribute('aria-labelledby', 'a11yTitle');
    var sizeRow = el('div', { class: 'a11y-row' });
    var sizeLabel = el('span', { id: 'a11ySizeLabel' });
    var seg = el('div', { class: 'a11y-seg', role: 'group', 'aria-labelledby': 'a11ySizeLabel' });
    var sizes = [['md', 'A'], ['lg', 'A+'], ['xl', 'A++']].map(function (s) {
      var b = el('button', { type: 'button', 'data-size': s[0] }, s[1]);
      b.addEventListener('click', function () {
        display.text = s[0];
        write(TEXT_KEY, s[0]);
        applyDisplay();
        relabel();
      });
      seg.appendChild(b);
      return b;
    });
    sizeRow.append(sizeLabel, seg);
    var contrast = el('button', { type: 'button', class: 'a11y-sw', id: 'a11yContrast' });
    contrast.addEventListener('click', function () {
      display.contrast = !display.contrast;
      write(CONTRAST_KEY, display.contrast ? 'high' : 'normal');
      applyDisplay();
      relabel();
    });
    var dark = el('button', { type: 'button', class: 'a11y-sw', id: 'a11yDark' });
    dark.addEventListener('click', function () {
      var themeBtn = document.getElementById('themeToggle');
      if (themeBtn) themeBtn.click();
      relabel();
    });
    pop.append(h, sizeRow, contrast, dark);
    wrap.append(btn, pop);
    var langEl = actions.querySelector('.lang');
    actions.insertBefore(wrap, langEl || null);

    function relabel() {
      var L = LABELS[window.document.documentElement.lang === 'en' ? 'en' : lang()];
      btn.setAttribute('aria-label', L.btn);
      btn.title = L.btn;
      h.textContent = L.title;
      sizeLabel.textContent = L.size;
      sizes.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-size') === display.text)); });
      contrast.textContent = L.contrast;
      contrast.setAttribute('aria-pressed', String(display.contrast));
      contrast.setAttribute('data-state', display.contrast ? L.on : L.off);
      var isDark = effective() === 'dark' || root.getAttribute('data-theme') === 'dark';
      dark.textContent = L.dark;
      dark.setAttribute('aria-pressed', String(isDark));
      dark.setAttribute('data-state', isDark ? L.on : L.off);
    }
    function close() {
      pop.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
    btn.addEventListener('click', function () {
      var open = pop.hidden;
      relabel();
      pop.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) { var first = pop.querySelector('[aria-pressed="true"]') || pop.querySelector('button'); if (first) first.focus(); }
    });
    document.addEventListener('click', function (e) {
      if (!pop.hidden && !wrap.contains(e.target)) close();
      // Language buttons: relabel after the page has switched language.
      if (e.target.closest && e.target.closest('[data-lang]')) setTimeout(relabel, 0);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !pop.hidden) { close(); btn.focus(); }
    });
    relabel();
  }

  apply();

  document.addEventListener('DOMContentLoaded', function () {
    apply();
    mountDisplayMenu();
    var btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      try {
        window.localStorage.setItem(KEY, JSON.stringify(effective() === 'dark' ? 'light' : 'dark'));
      } catch (e) {
        // Storage blocked: still switch for this visit.
        root.setAttribute('data-theme', effective() === 'dark' ? 'light' : 'dark');
        btn.textContent = root.getAttribute('data-theme') === 'dark' ? '☀️' : '☾';
        return;
      }
      apply();
    });
  });
})();
