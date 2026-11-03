// Register the offline service worker (it lives at the site root, so one
// worker covers every tool page).
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  // The first install caches the whole app; wait until this page has loaded
  // (and the phone is idle) so it doesn't slow down the first visit.
  const go = () => navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {});
  const idle = () => (window.requestIdleCallback ? requestIdleCallback(go, { timeout: 3000 }) : setTimeout(go, 500));
  if (document.readyState === 'complete') idle(); else window.addEventListener('load', idle, { once: true });
}
