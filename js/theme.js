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

  apply();

  document.addEventListener('DOMContentLoaded', function () {
    apply();
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
