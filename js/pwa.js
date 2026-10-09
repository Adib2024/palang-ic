// Register the offline service worker (it lives at the site root, so one
// worker covers every tool page).
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {});
}
