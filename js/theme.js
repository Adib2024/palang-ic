// Light/dark toggle. Loaded as a classic script in <head> so the saved theme
// applies before first paint (no flash). Light is the default; dark when the
// user picks it, or 'auto' (the "Aa" panel) to follow the device setting.
(function () {
  var KEY = 'palangic:theme';
  var root = document.documentElement;

  function saved() {
    try {
      var v = JSON.parse(window.localStorage.getItem(KEY));
      return v === 'light' || v === 'dark' || v === 'auto' ? v : null;
    } catch (e) {
      return null;
    }
  }

  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function effective() {
    var v = saved();
    if (v === 'auto') return media && media.matches ? 'dark' : 'light';
    return v || 'light';
  }
  function store(v) {
    try { window.localStorage.setItem(KEY, JSON.stringify(v)); return true; } catch (e) { return false; }
  }

  function apply() {
    if (saved()) root.setAttribute('data-theme', effective());
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
  // English strings are a separate module: start fetching them now.
  try {
    if (read('palangic:lang') === 'en' && document.currentScript) {
      var pre = document.createElement('link');
      pre.rel = 'modulepreload';
      pre.href = new URL('i18n-en.js', document.currentScript.src).href;
      document.head.appendChild(pre);
    }
  } catch (e) { /* only a speed-up */ }
  var display = { text: read(TEXT_KEY) || 'md', contrast: read(CONTRAST_KEY) === 'high' };
  function applyDisplay() {
    if (display.text === 'lg' || display.text === 'xl') root.setAttribute('data-text', display.text);
    else root.removeAttribute('data-text');
    if (display.contrast) root.setAttribute('data-contrast', 'high');
    else root.removeAttribute('data-contrast');
  }
  applyDisplay();

  var LABELS = {
    ms: { title: 'Paparan', btn: 'Tetapan paparan', size: 'Saiz teks', contrast: 'Kontras tinggi', dark: 'Tema gelap', auto: 'Ikut tetapan peranti', on: 'Hidup', off: 'Mati' },
    en: { title: 'Display', btn: 'Display settings', size: 'Text size', contrast: 'High contrast', dark: 'Dark theme', auto: 'Follow device setting', on: 'On', off: 'Off' },
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
      toggle();
      relabel();
    });
    // Follow the phone/computer's light or dark setting (and its changes).
    var auto = el('button', { type: 'button', class: 'a11y-sw', id: 'a11yAuto' });
    auto.addEventListener('click', function () {
      // Turning it off keeps whatever theme is showing now.
      if (!store(saved() === 'auto' ? effective() : 'auto')) return;
      apply();
      relabel();
    });
    pop.append(h, sizeRow, contrast, dark, auto);
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
      var isDark = root.getAttribute('data-theme') === 'dark';
      dark.textContent = L.dark;
      dark.setAttribute('aria-pressed', String(isDark));
      dark.setAttribute('data-state', isDark ? L.on : L.off);
      var isAuto = saved() === 'auto';
      auto.textContent = L.auto;
      auto.setAttribute('aria-pressed', String(isAuto));
      auto.setAttribute('data-state', isAuto ? L.on : L.off);
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

  // Light ⇄ dark by hand. A manual switch stops following the device.
  function toggle() {
    var dark = (root.getAttribute('data-theme') || effective()) === 'dark';
    if (!store(dark ? 'light' : 'dark')) {
      // Storage blocked: still switch for this visit.
      root.setAttribute('data-theme', dark ? 'light' : 'dark');
      var b = document.getElementById('themeToggle');
      if (b) b.textContent = dark ? '☾' : '☀️';
      return;
    }
    apply();
  }

  apply();
  // In 'auto', switch as soon as the device does (e.g. at sunset).
  if (media) {
    var follow = function () { if (saved() === 'auto') apply(); };
    if (media.addEventListener) media.addEventListener('change', follow); else if (media.addListener) media.addListener(follow);
  }

  document.addEventListener('DOMContentLoaded', function () {
    apply();
    mountDisplayMenu();
    var btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.addEventListener('click', toggle);
  });
})();
