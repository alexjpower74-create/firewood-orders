// Driver service worker (scope /driver/): keeps the driver page and its files on the phone so it reloads with no signal.
// Network-first with a 3 s timeout: a good answer is served and refreshes the cache, so a changed page reaches phones on
// their next load without a cache bump; no answer (or a slow one, or an error status) falls back to the cached copy.
// It never answers /api/* (the queue and the day cache handle data).
const CACHE = 'firewood-orders-driver'
const FILES = ['/driver/', '/driver/driver.css', '/driver/driver.js', '/driver/driver-api.js', '/driver/queue.js', '/theme.css']
const TIMEOUT_MS = 3000

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

async function networkFirst(path) {
  const cache = await caches.open(CACHE)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(path, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
    if (response.ok && !response.redirected) {
      await cache.put(path, response.clone())
      return response
    }
    return (await cache.match(path)) || response
  } catch {
    return (await cache.match(path)) || Response.error()
  } finally {
    clearTimeout(timer)
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return
  const path = url.pathname === '/driver/index.html' ? '/driver/' : url.pathname
  if (!FILES.includes(path)) return
  event.respondWith(networkFirst(path))
})
