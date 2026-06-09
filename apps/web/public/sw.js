self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'FITGO';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/client/card')) {
    event.respondWith(
      caches.open('fitgo-offline').then(async (cache) => {
        const cached = await cache.match('access-card');
        if (cached) return cached;
        return fetch(event.request);
      }),
    );
  }
});
