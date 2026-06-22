// Unregister any existing service worker and clear all caches
if ('serviceWorker' in navigator) {
  caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(r => r.unregister());
  });
}
