self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const data = payload.data || {};
  const tourId = data.tourId;
  const targetPath = tourId
    ? data.eventName === 'tour.completed'
      ? `/tours/${tourId}/review`
      : `/tours/${tourId}`
    : '/';

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Zig-Zag', {
      body: payload.body || 'Hay una actualización disponible.',
      icon: '/favicon.png',
      badge: '/favicon.png',
      data: { ...data, targetPath },
      tag: tourId ? `tour-${tourId}` : 'zigzag-update',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetPath = event.notification.data?.targetPath || '/';
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients[0];
      if (existing) {
        return existing.focus().then(() => existing.navigate(targetUrl));
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
