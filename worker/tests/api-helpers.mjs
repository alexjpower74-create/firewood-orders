// Shared helpers for the API suites (api.test.mjs = M1 routes, api-m2.test.mjs = M2 routes) against a real local Worker in
// TEST_MODE. "Now" is pinned with X-Test-Now: Mon Sep 14 2026, 9:30 AM NDT.
//
// Stock is read through GET /api/dealer/settings. `stock_moves` has no route, so stockMoves() and productMoves() read the
// local D1 SQLite file the Worker persists to (STATE_DIR/v3/d1/miniflare-D1DatabaseObject/*.sqlite), read-only, through
// node:sqlite. Test-only: nothing in the Worker knows about it.
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SAMPLE_PLACES } from '../src/sample-places.js'
import { SAMPLE_SETTINGS } from '../src/sample.js'

export const BASE = process.env.API_BASE || 'http://127.0.0.1:7702'
const STATE_DIR = process.env.STATE_DIR
export const T0 = '2026-09-14T12:00:00.000Z' // Monday, 9:30 AM in St. John's
export const TUE = '2026-09-15'
export const WED = '2026-09-16'
export const SUN = '2026-09-20'
export const CORD = 221184
export const place = (name) => SAMPLE_PLACES.find((p) => p.name === name)
export const YARD = SAMPLE_SETTINGS.yard
export const uuid = () => crypto.randomUUID()

let ipSeq = 0

// Each request comes from its own X-Test-IP unless the test sets one, so the rate guards only bite where a test means it.
export async function call(method, url, { body, token, now = T0, headers = {}, raw } = {}) {
  const h = { 'X-Test-Now': now, 'X-Test-IP': `test-${++ipSeq}`, ...headers }
  if (token) h.Authorization = `Bearer ${token}`
  let payload
  if (raw !== undefined) payload = raw
  else if (body !== undefined) {
    h['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const r = await fetch(BASE + url, { method, headers: h, body: payload })
  const type = r.headers.get('content-type') || ''
  const data = type.includes('application/json') ? await r.json() : new Uint8Array(await r.arrayBuffer())
  return { status: r.status, body: data, headers: r.headers }
}

export async function reset() {
  const r = await call('POST', '/api/test/reset')
  assert.equal(r.status, 200, 'reset needs a Worker started with TEST_MODE=1')
}

export async function signin(pin, now = T0) {
  const r = await call('POST', '/api/signin', { body: { pin }, now })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body.token
}

let seq = 0
export function orderBody(over = {}) {
  seq++
  const at = place(over.place || "King's Point")
  const { place: _p, ...rest } = over
  return { product_id: 'p_softwood_dry', unit: 'cord', qty: 1, stacking: false, lat: at.lat, lng: at.lng,
    address: 'Up the lane past the church', dump_notes: 'By the shed, not on the lawn', zone_id: null,
    preferred: { any: true }, name: `Wade R. (SAMPLE)`, phone: `709-555-${String(1000 + seq).slice(-4)}`, note: '', ...rest }
}

export async function order(over = {}) {
  const r = await call('POST', '/api/orders', { body: orderBody(over) })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  return r.body
}

export async function scheduled(dealer, over, date) {
  const o = await order(over)
  const r = await call('POST', `/api/dealer/orders/${o.id}/schedule`, { token: dealer, body: { date } })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return o
}

// Stock of one product through the dealer settings route: { stock_cu_in, stock_bags }.
export async function stock(id, token) {
  const r = await call('GET', '/api/dealer/settings', { token })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const p = r.body.products.find((x) => x.id === id)
  return { stock_cu_in: p.stock_cu_in ?? 0, stock_bags: p.stock_bags ?? 0 }
}

function withDb(fn) {
  assert.ok(STATE_DIR, 'STATE_DIR must point at the Worker persist dir (tests/run.mjs sets it)')
  const dir = path.join(STATE_DIR, 'v3', 'd1', 'miniflare-D1DatabaseObject')
  const file = readdirSync(dir).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite')
  const db = new DatabaseSync(path.join(dir, file), { readOnly: true })
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

export function stockMoves(orderId) {
  return withDb((db) => db.prepare('SELECT product_id, change, reason FROM stock_moves WHERE order_id = ? ORDER BY id')
    .all(orderId).map((r) => ({ ...r })))
}

// [change, reason, note] for every stock move of a product, oldest first.
export function productMoves(productId) {
  return withDb((db) => db.prepare('SELECT change, reason, note FROM stock_moves WHERE product_id = ? ORDER BY id')
    .all(productId).map((r) => [r.change, r.reason, r.note]))
}

export const put = (url, body, token, now = T0) => call('PUT', url, { body, token, now })

export const checkin = (driver, orderId, payment, { at = T0, now = T0, op = uuid() } = {}) =>
  call('POST', '/api/driver/checkins', { token: driver, now, body: { op_id: op, order_id: orderId, at, payment } })

export const detail = (dealer, id, now = T0) => call('GET', `/api/dealer/orders/${id}`, { token: dealer, now })
