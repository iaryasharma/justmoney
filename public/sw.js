// Minimal service worker: makes JustMoney installable, caches the app shell
// for offline use, and lets notifications open the app.
const CACHE = 'justmoney-v1'
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/']))) })
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone()
      caches.open(CACHE).then((c) => c.put(e.request, copy))
      return res
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('/')))
  )
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const route = e.notification.data && e.notification.data.route
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => {
    if (cs[0]) { cs[0].postMessage({ type: 'route', route }); return cs[0].focus() }
    return self.clients.openWindow(route ? '/?route=' + encodeURIComponent(route) : '/')
  }))
})
