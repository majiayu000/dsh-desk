const CACHE = 'dsh-companion-v2'
const SHELL = ['/companion.html', '/companion.webmanifest', '/companion-icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
  )))
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  const shellRequest = SHELL.includes(url.pathname)
  const assetRequest = url.pathname.startsWith('/assets/')
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || (!shellRequest && !assetRequest)) return
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone()
    caches.open(CACHE).then((cache) => cache.put(event.request, copy))
    return response
  }).catch(() => caches.match(event.request).then((response) => {
    if (response) return response
    if (event.request.mode === 'navigate' && url.pathname === '/companion.html') {
      return caches.match('/companion.html')
    }
    return Response.error()
  })))
})
