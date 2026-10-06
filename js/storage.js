// localStorage can be missing or throw (private mode, blocked site data),
// so every access is guarded and the app works fine without it.
const PREFIX = 'palangic:';

export function load(key, fallback) {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* ignore: preference just won't persist */
  }
}
