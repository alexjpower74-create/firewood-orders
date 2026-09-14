// Driver service worker (scope /driver/): keeps the driver page and its files on the phone so it reloads with no signal.
// Cache-first for exactly these files; it never answers /api/* (the queue and the day cache handle data).
const CACHE = 'firewood-orders-driver-v1'
const FILES = ['/driver/', '/driver/driver.css', '/driver/driver.js', '/driver/driver-api.js', '/driver/queue.js', '/theme.css']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return
  const path = url.pathname === '/driver/index.html' ? '/driver/' : url.pathname
  if (!FILES.includes(path)) return
  event.respondWith(caches.match(path).then((hit) => hit || fetch(event.request)))
})
