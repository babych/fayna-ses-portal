// Push notification listener for Fayna SES
self.addEventListener('push', (event) => {
  let title = '⚡ Файна Таун: Статус живлення';
  let body = 'Зміна стану електропостачання комплексу.';
  let tag = 'fayna-grid-status';
  let url = '/';
  let silent = false;

  if (event.data) {
    try {
      const data = event.data.json();
      if (data.title) title = data.title;
      if (data.body) body = data.body;
      if (data.tag) tag = data.tag;
      if (typeof data.silent === 'boolean') silent = data.silent;
      if (data.data?.url) url = data.data.url;
    } catch (_) {
      try {
        const text = event.data.text();
        if (text) body = text;
      } catch (__) {}
    }
  }

  // iOS Safari & PWA Notification Options:
  // 1. NEVER pass .svg in icon or badge (causes WebKit TypeError / rejection)
  // 2. silent: true for partial blackout transitions (no beep/vibrate)
  // 3. tag + renotify: false ensures in-place replacement without stacking banners
  const options = {
    body,
    icon: '/icon-192.png',
    tag,
    silent,
    renotify: false,
    data: { url },
  };

  event.waitUntil(
    self.registration.showNotification(title, options).catch((err) => {
      // Fallback: minimal possible notification call
      return self.registration.showNotification(title, { body });
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if ('setAppBadge' in self.navigator) {
    self.navigator.setAppBadge(0).catch(() => {});
  }
  if ('clearAppBadge' in self.navigator) {
    self.navigator.clearAppBadge().catch(() => {});
  }
  const targetUrl = event.notification.data?.url || '/';
  const fullTargetUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      // Look for any existing window client belonging to our origin
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client && client.url !== fullTargetUrl) {
            await client.navigate(fullTargetUrl).catch(() => {});
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(fullTargetUrl);
      }
    })
  );
});
