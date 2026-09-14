// The offline queue. Every Start and Delivered is written to IndexedDB first; a sender posts oldest first and removes an item
// only after the server has answered 200/201 (and, for a photo, 200 to the photo). 400/403/404/409/413/415 move the item to
// "Not accepted" with the server's message; no signal, 429 and 5xx leave it queued and try again with backoff.
// Photos are stored as { type, data: ArrayBuffer } (WebKit cannot keep Blobs in IndexedDB in every mode).
import { api, NetworkError } from './driver-api.js'

const DB_NAME = 'firewood-orders-driver'
const STORE = 'queue'

let opening = null
function openDb() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return opening
}

function withStore(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    let result
    if (req) req.onsuccess = () => { result = req.result }
    t.oncomplete = () => resolve(result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  }))
}

export const addItem = (item) => withStore('readwrite', (s) => s.add(item))
export const updateItem = (item) => withStore('readwrite', (s) => s.put(item))
export const removeItem = (seq) => withStore('readwrite', (s) => s.delete(seq))
export const allItems = () => withStore('readonly', (s) => s.getAll()).then((items) => items.sort((a, b) => a.seq - b.seq))

const BACKOFF_FIRST_MS = 5000
const BACKOFF_MAX_MS = 60000

// hooks: onAccepted(item, body) after a check-in is accepted, onStarted(item, body), onChange(), onAuthNeeded()
export function createSender(hooks = {}) {
  let running = null
  let again = false
  let failures = 0
  let nextTryAt = 0
  let offline = false

  async function answered(item, r) {
    offline = false
    if (r.status === 401) return 'auth'
    if (r.status === 429 || r.status >= 500) return 'retry'
    item.state = 'rejected'
    item.message = r.body?.error || `The office did not accept this (${r.status}).`
    await updateItem(item)
    return 'ok'
  }

  async function sendOne(item) {
    try {
      if (item.kind === 'start') {
        const r = await api.start(item.date)
        if (r.status !== 200) return answered(item, r)
        await hooks.onStarted?.(item, r.body)
        await removeItem(item.seq)
        return 'ok'
      }
      if (item.state === 'queued') {
        const r = await api.checkin({
          op_id: item.op_id,
          order_id: item.order_id,
          at: item.at,
          payment: item.payment,
          note: item.note || '',
        })
        if (r.status !== 200 && r.status !== 201) return answered(item, r)
        // Accepted: only now may the item leave the queue (or move on to its photo).
        await hooks.onAccepted?.(item, r.body)
        if (!item.photo) {
          await removeItem(item.seq)
          return 'ok'
        }
        item.state = 'photo'
        await updateItem(item)
      }
      const p = await api.photo(item.op_id, item.photo)
      if (p.status !== 200) return answered(item, p)
      await removeItem(item.seq)
      return 'ok'
    } catch (e) {
      if (e instanceof NetworkError) {
        offline = true
        return 'retry'
      }
      throw e
    }
  }

  async function loop() {
    for (;;) {
      const items = (await allItems()).filter((i) => i.state !== 'rejected')
      if (!items.length) {
        failures = 0
        return
      }
      const result = await sendOne(items[0])
      if (result === 'ok') {
        failures = 0
        await hooks.onChange?.()
        continue
      }
      if (result === 'auth') {
        hooks.onAuthNeeded?.()
        return
      }
      failures += 1
      nextTryAt = Date.now() + Math.min(BACKOFF_MAX_MS, BACKOFF_FIRST_MS * 2 ** (failures - 1))
      return
    }
  }

  // force: a new item, signal back, or the page shown again; those skip the backoff wait.
  function kick(force = false) {
    if (force) nextTryAt = 0
    if (running) {
      again = again || force
      return running
    }
    if (Date.now() < nextTryAt) return Promise.resolve()
    running = loop()
      .catch((e) => console.error('[driver queue]', e))
      .finally(async () => {
        running = null
        await hooks.onChange?.()
        if (again) {
          again = false
          kick(true)
        }
      })
    return running
  }

  return {
    kick,
    idle: () => running || Promise.resolve(),
    status: () => ({ offline, failures, nextTryAt }),
  }
}
