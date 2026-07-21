// GuardFlow service worker — exists solely to receive Web Push events while
// the app isn't open in a foreground tab. No offline caching on purpose:
// this app always needs fresh roster data, so a cache-first strategy would
// just serve stale shifts.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = { title: 'GuardFlow', body: '' }
  try {
    if (event.data) data = event.data.json()
  } catch {
    if (event.data) data.body = event.data.text()
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'GuardFlow', {
      body: data.body || '',
      tag: data.tag,
      icon: '/favicon.svg',
      dir: 'rtl',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow('/shift-live')
    }),
  )
})
