self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'FITGO';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/' },
    renotify: Boolean(data.tag),
  };

  const badgeCount =
    typeof data.badge === 'number' && Number.isFinite(data.badge)
      ? Math.max(0, Math.floor(data.badge))
      : null;

  event.waitUntil(
    (async () => {
      if (badgeCount !== null && 'setAppBadge' in self.navigator) {
        try {
          if (badgeCount > 0) {
            await self.navigator.setAppBadge(badgeCount);
          } else {
            await self.navigator.clearAppBadge();
          }
        } catch {
          // Badging is optional (unsupported browsers / permissions).
        }
      }
      await self.registration.showNotification(title, options);
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  const absolute = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of clientsList) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            await client.navigate(absolute);
          } else {
            client.postMessage({ type: 'fitgo-navigate', url: absolute });
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(absolute);
      }
    })(),
  );
});

// Access-card JSON must not intercept document navigations to /client/card
// (that broke the page). Last barcode is cached in localStorage by the app.
