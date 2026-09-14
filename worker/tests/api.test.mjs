// M1 API suite against a real local Worker (wrangler dev --local, TEST_MODE=1). Run through `npm test` (tests/run.mjs).
// Every test starts from POST /api/test/reset. "Now" is pinned with X-Test-Now: Mon Sep 14 2026, 9:30 AM NDT.
// Helpers, and how stock is read (GET /api/dealer/settings since M2), are in api-helpers.mjs. M2 routes: api-m2.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { optimizeRoute, pathKm } from '../src/route.js'
import { SAMPLE_SETTINGS } from '../src/sample.js'
import {
  BASE, call, CORD, order, orderBody, place, reset, scheduled, signin, stock, stockMoves, SUN, T0, TUE, uuid, WED, YARD,
} from './api-helpers.mjs'

// ---------------- public ----------------

test('info: shape per API.md, 4 products, delivery dates start tomorrow and skip Sundays', async () => {
  await reset()
  const { status, body } = await call('GET', '/api/info')
  assert.equal(status, 200)
  for (const k of ['name', 'short_name', 'sample', 'timezone', 'today', 'now', 'phone', 'season_open', 'season_message',
    'deposit_text', 'min_order_cents', 'hst_registered', 'yard', 'delivery', 'load', 'products', 'delivery_dates', 'map']) {
    assert.ok(k in body, `info has ${k}`)
  }
  assert.equal(body.name, 'SAMPLE Wood & Pellets — Springdale (demo)')
  assert.equal(body.sample, true)
  assert.equal(body.timezone, 'America/St_Johns')
  assert.equal(body.today, '2026-09-14')
  assert.equal(body.now, T0)
  assert.deepEqual(body.yard, { lat: place('Springdale').lat, lng: place('Springdale').lng, label: 'Our yard, Springdale (SAMPLE)' })
  assert.deepEqual(body.delivery.bands.map((b) => b.label), ['Up to 10 km: free', 'Up to 30 km: $25.00', 'Up to 60 km: $50.00'])
  assert.deepEqual(body.load, { cords: 1.5, description: SAMPLE_SETTINGS.load.description })
  assert.deepEqual(body.products.map((p) => p.id), ['p_softwood_dry', 'p_birch_dry', 'p_softwood_green', 'p_pellets'])
  const soft = body.products[0]
  assert.deepEqual(Object.keys(soft).sort(), ['cut_in', 'dryness', 'id', 'kind', 'name', 'species', 'split',
    'stacking_cents_per_cord', 'units'].sort())
  assert.deepEqual(soft.units.map((u) => [u.unit, u.price_cents, u.wood_cu_in]),
    [['cord', 30000, 221184], ['half_cord', 17000, 110592], ['face_cord', 12000, 73728], ['load', 42000, 331776]])
  assert.equal(soft.units[3].explain,
    'A load is what our dump truck carries in one trip, dumped in a pile, not stacked. We count a load as 1.5 cords.')
  assert.deepEqual(body.products[1].units.map((u) => u.unit), ['cord', 'half_cord', 'face_cord']) // birch: no load
  assert.deepEqual(body.products[2].units.map((u) => u.unit), ['cord', 'load'])
  const pel = body.products[3]
  assert.deepEqual(pel.units.map((u) => [u.unit, u.price_cents, u.pellet_bags]), [['bag', 799, 1], ['ton', 36500, 50], ['skid', 49900, 70]])
  assert.equal(pel.units[0].explain, 'One 40 lb bag.')
  assert.ok(!JSON.stringify(body).includes('stock'), 'stock is never public')
  assert.equal(body.delivery_dates.length, 14)
  assert.deepEqual(body.delivery_dates[0], { date: '2026-09-15', label: 'Tue Sep 15', long_label: 'Tuesday, September 15' })
  assert.ok(!body.delivery_dates.some((d) => d.date === SUN || d.date === '2026-09-27'))
  assert.equal(body.delivery_dates[5].date, '2026-09-21') // Tue..Sat, then Mon 21
  assert.equal(body.delivery_dates[13].date, '2026-09-30')
  assert.equal(body.map.style, 'https://tiles.openfreemap.org/styles/liberty')
  assert.equal(body.map.attribution, '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>')
  assert.equal(body.map.tiles, undefined, 'no raster tile URL any more')
})

test('quote: three orders written out by hand', async () => {
  await reset()
  const q = async (over) => {
    const { product_id = 'p_softwood_dry', unit = 'cord', qty = 1, stacking = false, place: at } = over
    const p = place(at)
    const r = await call('POST', '/api/quote', { body: { product_id, unit, qty, stacking, lat: p.lat, lng: p.lng } })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    return r.body
  }
  // 1 cord dry softwood to King's Point (12.9 km, band 10–30 = $25): 300.00 + 25.00 = 325.00; HST 48.75; 373.75
  const a = await q({ place: "King's Point" })
  assert.deepEqual([a.distance_km, a.goods_cents, a.stacking_cents, a.delivery_cents, a.subtotal_cents, a.hst_cents, a.total_cents],
    [12.9, 30000, 0, 2500, 32500, 4875, 37375])
  assert.equal(a.qty_label, '1 cord')
  // 3 face cords of birch, stacked, to St. Patrick's (8.5 km, free): 3 × 140.00 = 420.00; 3 × 73 728 = 221 184 cu in = 1 cord,
  // stacking 60.00; subtotal 480.00; HST 72.00; total 552.00
  const b = await q({ product_id: 'p_birch_dry', unit: 'face_cord', qty: 3, stacking: true, place: "St. Patrick's" })
  assert.deepEqual([b.wood_cu_in, b.goods_cents, b.stacking_cents, b.delivery_cents, b.subtotal_cents, b.hst_cents, b.total_cents],
    [221184, 42000, 6000, 0, 48000, 7200, 55200])
  // 14 bags of pellets to Little Bay (12.7 km, $25): 14 × 7.99 = 111.86; subtotal 136.86; HST 20.529 → 20.53; total 157.39
  const c = await q({ product_id: 'p_pellets', unit: 'bag', qty: 14, place: 'Little Bay' })
  assert.deepEqual([c.pellet_bags, c.goods_cents, c.stacking_cents, c.delivery_cents, c.subtotal_cents, c.hst_cents, c.total_cents],
    [14, 11186, 0, 2500, 13686, 2053, 15739])
  assert.equal(c.qty_label, '14 bags')
})

test('quote refusals: below minimum, outside the area, not offered', async () => {
  await reset()
  const sp = place("St. Patrick's")
  let r = await call('POST', '/api/quote', { body: { product_id: 'p_pellets', unit: 'bag', qty: 13, lat: sp.lat, lng: sp.lng } })
  assert.deepEqual([r.status, r.body.code, r.body.field, r.body.error],
    [400, 'below_minimum', 'qty', 'The smallest order we deliver is $110.00 before delivery.'])
  const bu = place('Buchans')
  r = await call('POST', '/api/quote', { body: { product_id: 'p_softwood_dry', unit: 'cord', qty: 1, lat: bu.lat, lng: bu.lng } })
  assert.deepEqual([r.status, r.body.code, r.body.field, r.body.error],
    [400, 'outside_area', 'pin', SAMPLE_SETTINGS.delivery.beyond_message])
  r = await call('POST', '/api/quote', { body: { product_id: 'p_birch_dry', unit: 'load', qty: 1, lat: sp.lat, lng: sp.lng } })
  assert.deepEqual([r.status, r.body.code, r.body.field], [400, 'not_offered', 'unit'])
})

const FIELD_CASES = [
  ['product_id', { product_id: 'p_nope' }],
  ['unit', { unit: 'truckload' }],
  ['qty', { qty: 0 }],
  ['qty', { qty: 21 }],
  ['qty', { qty: 1.5 }],
  ['stacking', { product_id: 'p_softwood_green', stacking: true }],
  ['pin', { lat: 45.0 }],
  ['pin', { lng: -70 }],
  ['address', { address: '' }],
  ['address', { address: 'x'.repeat(121) }],
  ['dump_notes', { dump_notes: 'x'.repeat(201) }],
  ['preferred', { preferred: { any: false, dates: [] } }],
  ['preferred', { preferred: { any: false, dates: [SUN] } }],
  ['preferred', { preferred: { any: false, dates: ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-21', '2026-09-22', '2026-09-23'] } }],
  ['name', { name: '' }],
  ['name', { name: 'x'.repeat(81) }],
  ['phone', { phone: 'call me' }],
  ['phone', { phone: '555-012' }],
  ['note', { note: 'x'.repeat(281) }],
]

for (const [field, over] of FIELD_CASES) {
  test(`order validation: ${field} ${JSON.stringify(over).slice(0, 60)}`, async () => {
    if (field === 'product_id') await reset()
    const r = await call('POST', '/api/orders', { body: orderBody(over) })
    assert.equal(r.status, 400, JSON.stringify(r.body))
    assert.equal(r.body.code, 'bad_request')
    assert.equal(r.body.field, field)
    assert.equal(typeof r.body.error, 'string')
    if (field === 'pin') assert.equal(r.body.error, 'Tap the map where the truck should dump it.')
  })
}

test('a new order: 201, the status page says Requested, owing = total; the customer is found again by phone', async () => {
  await reset()
  const r = await call('POST', '/api/orders', { body: orderBody({ phone: '(709) 555-0142', name: 'Wade R. (SAMPLE)',
    preferred: { any: false, dates: [WED, '2026-09-17'] } }) })
  assert.equal(r.status, 201)
  assert.match(r.body.id, /^o_/)
  assert.match(r.body.token, /^[A-Za-z0-9_-]{32,}$/)
  assert.equal(r.body.status, 'requested')
  assert.equal(r.body.status_url, `/o/?t=${r.body.token}`)
  assert.equal(r.body.quote.total_cents, 37375)
  const s = await call('GET', `/api/o/${r.body.token}`)
  assert.equal(s.status, 200)
  assert.equal(s.body.order.status_label, 'Requested')
  assert.equal(s.body.order.owing_cents, 37375)
  assert.equal(s.body.order.owing_label, 'Balance owing $373.75')
  assert.equal(s.body.order.preferred_label, 'Wed Sep 16, Thu Sep 17')
  assert.equal(s.body.order.created_label, 'Mon Sep 14, 9:30 AM')
  assert.equal(s.body.dealer.sample, true)
  for (const secret of ['token', 'phone', 'customer_id', 'id', 'lat', 'name']) assert.ok(!(secret in s.body.order), secret)

  // same phone digits written differently → the same customer, name updated to the newest
  const again = await call('POST', '/api/orders', { body: orderBody({ phone: '709.555.0142', name: 'Wade Rideout (SAMPLE)' }) })
  assert.equal(again.status, 201)
  const dealer = await signin('1357')
  const list = await call('GET', '/api/dealer/customers', { token: dealer })
  assert.equal(list.body.customers.length, 1)
  assert.equal(list.body.customers[0].name, 'Wade Rideout (SAMPLE)')
  assert.equal(list.body.customers[0].orders, 2)
  assert.equal(list.body.customers[0].balance_cents, 37375 * 2)
  assert.equal((await call('GET', '/api/o/not-a-real-token')).status, 404)
})

// ---------------- sign-in ----------------

test('sign-in: wrong PIN 401 field pin; dealer and driver roles; driver on a dealer route 403; no token 401', async () => {
  await reset()
  const wrong = await call('POST', '/api/signin', { body: { pin: '0000' } })
  assert.deepEqual([wrong.status, wrong.body.code, wrong.body.field, wrong.body.error], [401, 'unauthorized', 'pin', 'That PIN is not right.'])
  const d = await call('POST', '/api/signin', { body: { pin: '1357' } })
  assert.equal(d.body.role, 'dealer')
  assert.equal(d.body.expires_at, '2026-09-15T00:00:00.000Z') // 12 h
  const v = await call('POST', '/api/signin', { body: { pin: '2580' } })
  assert.equal(v.body.role, 'driver')
  assert.equal(v.body.expires_at, '2026-09-28T12:00:00.000Z') // 14 days
  const forbidden = await call('GET', '/api/dealer/board', { token: v.body.token })
  assert.deepEqual([forbidden.status, forbidden.body.code], [403, 'forbidden'])
  assert.equal((await call('GET', '/api/driver/day', { token: v.body.token })).status, 200)
  assert.equal((await call('GET', '/api/driver/day', { token: d.body.token })).status, 200, 'the dealer can drive too')
  const none = await call('GET', '/api/dealer/board')
  assert.deepEqual([none.status, none.body.code], [401, 'unauthorized'])
  assert.equal((await call('GET', '/api/driver/day')).status, 401)
  assert.equal((await call('GET', '/api/dealer/board', { token: 'forged' })).status, 401)
  // expired: the dealer token 13 hours later
  assert.equal((await call('GET', '/api/dealer/board', { token: d.body.token, now: '2026-09-15T01:00:00.000Z' })).status, 401)
  // sign out ends the session
  assert.equal((await call('POST', '/api/signout', { token: d.body.token })).status, 200)
  assert.equal((await call('GET', '/api/dealer/board', { token: d.body.token })).status, 401)
})

// ---------------- dealer: board and scheduling ----------------

test('board buckets and counts', async () => {
  await reset()
  const dealer = await signin('1357')
  const driver = await signin('2580')
  const a = await order({ name: 'Alma (SAMPLE)' })
  const b = await order({ name: 'Bert (SAMPLE)', now: undefined })
  const c = await scheduled(dealer, { name: 'Cora (SAMPLE)' }, TUE)
  const d = await scheduled(dealer, { name: 'Dan (SAMPLE)' }, TUE)
  await call('POST', `/api/driver/day/${TUE}/start`, { token: driver, now: '2026-09-15T11:00:00.000Z' })
  const ck = await call('POST', '/api/driver/checkins', { token: driver, now: '2026-09-15T13:00:00.000Z',
    body: { op_id: uuid(), order_id: d.id, at: '2026-09-15T13:00:00.000Z', payment: { method: 'owes' } } })
  assert.equal(ck.status, 201, JSON.stringify(ck.body))
  const later = '2026-09-15T14:00:00.000Z' // the morning dealer token (12 h) has run out by now: sign in again
  const r = await call('GET', '/api/dealer/board', { token: await signin('1357', later), now: later })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.counts, { new: 2, scheduled: 1, delivered: 1, owing: 1, cancelled: 0 })
  assert.deepEqual(r.body.new.map((o) => o.id), [a.id, b.id])
  assert.deepEqual(r.body.scheduled.map((o) => [o.id, o.status]), [[c.id, 'out_for_delivery']])
  assert.deepEqual(r.body.delivered.map((o) => o.id), [d.id])
  assert.deepEqual(r.body.owing.map((o) => o.id), [d.id])
  const s = r.body.owing[0]
  for (const k of ['id', 'token', 'status', 'status_label', 'source', 'customer_id', 'name', 'phone', 'address', 'dump_notes',
    'lat', 'lng', 'product_id', 'kind', 'product_label', 'unit', 'qty', 'qty_label', 'stacking', 'wood_cu_in', 'pellet_bags',
    'cords', 'preferred_label', 'preferred_dates', 'preferred_any', 'delivery_date', 'delivery_label', 'route_pos',
    'distance_km', 'goods_cents', 'stacking_cents', 'delivery_cents', 'subtotal_cents', 'hst_cents', 'total_cents',
    'paid_cents', 'owing_cents', 'delivered_at', 'delivered_label', 'door_payment', 'has_photo', 'note', 'created_at',
    'created_label']) assert.ok(k in s, `summary has ${k}`)
  assert.equal(s.cords, 1)
  assert.equal(s.delivery_label, 'Tue Sep 15')
  assert.equal(s.door_payment, 'owes')
})

test('schedule to a Sunday → 400 field date; past and beyond the window refused', async () => {
  await reset()
  const dealer = await signin('1357')
  const o = await order()
  const sun = await call('POST', `/api/dealer/orders/${o.id}/schedule`, { token: dealer, body: { date: SUN } })
  assert.deepEqual([sun.status, sun.body.code, sun.body.field, sun.body.error], [400, 'bad_request', 'date', "We don't deliver on Sundays."])
  const past = await call('POST', `/api/dealer/orders/${o.id}/schedule`, { token: dealer, body: { date: '2026-09-12' } })
  assert.deepEqual([past.status, past.body.field], [400, 'date'])
  const far = await call('POST', `/api/dealer/orders/${o.id}/schedule`, { token: dealer, body: { date: '2026-10-05' } })
  assert.deepEqual([far.status, far.body.field], [400, 'date']) // window 21 days: Sep 14 … Oct 4
  const today = await call('POST', `/api/dealer/orders/${o.id}/schedule`, { token: dealer, body: { date: '2026-09-14' } })
  assert.equal(today.status, 200)
  assert.equal(today.body.order.status_label, 'Scheduled for Monday, September 14')
})

test('capacity: 4 cords on Tue, a fifth refused with exact numbers; a half cord fits to 4.50; then even a face cord is refused', async () => {
  await reset()
  const dealer = await signin('1357')
  for (let i = 0; i < 4; i++) await scheduled(dealer, {}, TUE)
  const fifth = await order()
  const r = await call('POST', `/api/dealer/orders/${fifth.id}/schedule`, { token: dealer, body: { date: TUE } })
  assert.equal(r.status, 409)
  assert.deepEqual(r.body, {
    error: "That's more than the truck can carry that day: 4.00 of 4.50 cords already planned, this order needs 1.00.",
    code: 'over_capacity',
    day: { date: TUE, wood: { used_cu_in: 884736, cap_cu_in: 995328, used_cords: 4, cap_cords: 4.5 },
      pellets: { used_bags: 0, cap_bags: 210 } },
    needs: { wood_cu_in: 221184, pellet_bags: 0 },
  })
  assert.equal((await call('GET', `/api/o/${fifth.token}`)).body.order.status, 'requested')
  const half = await order({ unit: 'half_cord' })
  const ok = await call('POST', `/api/dealer/orders/${half.id}/schedule`, { token: dealer, body: { date: TUE } })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  const days = await call('GET', '/api/dealer/days', { token: dealer })
  const tue = days.body.days.find((d) => d.date === TUE)
  assert.deepEqual(tue.wood, { used_cu_in: 995328, cap_cu_in: 995328, used_cords: 4.5, cap_cords: 4.5 })
  assert.equal(tue.over, false)
  const face = await order({ unit: 'face_cord', qty: 1, place: "King's Point" })
  const no = await call('POST', `/api/dealer/orders/${face.id}/schedule`, { token: dealer, body: { date: TUE } })
  assert.equal(no.status, 409)
  assert.equal(no.body.error, "That's more than the truck can carry that day: 4.50 of 4.50 cords already planned, this order needs 0.33.")
})

test('capacity for pellets: 3 skids planned, then 1 bag is refused', async () => {
  await reset()
  const dealer = await signin('1357')
  for (let i = 0; i < 3; i++) await scheduled(dealer, { product_id: 'p_pellets', unit: 'skid', qty: 1 }, TUE)
  const bag = await order({ product_id: 'p_pellets', unit: 'bag', qty: 14 })
  const r = await call('POST', `/api/dealer/orders/${bag.id}/schedule`, { token: dealer, body: { date: TUE } })
  assert.equal(r.status, 409)
  assert.equal(r.body.error, "That's more than the truck can carry that day: 210 of 210 bags already planned, this order needs 14.")
  assert.deepEqual(r.body.day.pellets, { used_bags: 210, cap_bags: 210 })
  assert.deepEqual(r.body.needs, { wood_cu_in: 0, pellet_bags: 14 })
  // wood still fits on that day
  await scheduled(dealer, {}, TUE)
  const days = await call('GET', '/api/dealer/days', { token: dealer })
  const tue = days.body.days.find((d) => d.date === TUE)
  assert.deepEqual(tue.pellets, { used_bags: 210, cap_bags: 210, used_skids: 3, cap_skids: 3 })
  assert.equal(tue.orders, 4)
  const sun = days.body.days.find((d) => d.date === SUN)
  assert.deepEqual([sun.delivers, sun.reason], [false, 'No deliveries on Sundays'])
  assert.equal(days.body.days.length, 21)
})

test('moving an order between days frees the first day; unschedule frees it too', async () => {
  await reset()
  const dealer = await signin('1357')
  const moving = []
  for (let i = 0; i < 4; i++) moving.push(await scheduled(dealer, {}, TUE))
  const blocked = await order()
  assert.equal((await call('POST', `/api/dealer/orders/${blocked.id}/schedule`, { token: dealer, body: { date: TUE } })).status, 409)
  const move = await call('POST', `/api/dealer/orders/${moving[1].id}/schedule`, { token: dealer, body: { date: WED } })
  assert.equal(move.status, 200)
  assert.equal(move.body.order.route_pos, 1)
  const route = await call('GET', `/api/dealer/days/${TUE}/route`, { token: dealer })
  assert.deepEqual(route.body.stops.map((s) => s.route_pos), [1, 2, 3], 'Tuesday compacts')
  assert.equal((await call('POST', `/api/dealer/orders/${blocked.id}/schedule`, { token: dealer, body: { date: TUE } })).status, 200)
  const un = await call('POST', `/api/dealer/orders/${moving[0].id}/unschedule`, { token: dealer })
  assert.equal(un.status, 200)
  assert.deepEqual([un.body.order.status, un.body.order.delivery_date, un.body.order.route_pos], ['requested', null, null])
  assert.equal((await call('POST', `/api/dealer/orders/${moving[0].id}/unschedule`, { token: dealer })).body.code, 'bad_state')
  const days = await call('GET', '/api/dealer/days', { token: dealer })
  assert.equal(days.body.days.find((d) => d.date === TUE).wood.used_cords, 3)
  assert.equal(days.body.days.find((d) => d.date === WED).wood.used_cords, 1)
})

test('the race: 8 concurrent schedule calls into an empty day → exactly 4 × 200 and 4 × 409', async () => {
  await reset()
  const dealer = await signin('1357')
  const orders = []
  for (let i = 0; i < 8; i++) orders.push(await order())
  const results = await Promise.all(orders.map((o) =>
    call('POST', `/api/dealer/orders/${o.id}/schedule`, { token: dealer, body: { date: TUE } })))
  const codes = results.map((r) => r.status).sort()
  assert.deepEqual(codes, [200, 200, 200, 200, 409, 409, 409, 409], JSON.stringify(codes))
  const days = await call('GET', '/api/dealer/days', { token: dealer })
  const tue = days.body.days.find((d) => d.date === TUE)
  assert.equal(tue.wood.used_cords, 4)
  assert.equal(tue.wood.used_cu_in, 4 * CORD)
  const route = await call('GET', `/api/dealer/days/${TUE}/route`, { token: dealer })
  assert.deepEqual(route.body.stops.map((s) => s.route_pos), [1, 2, 3, 4])
})

// ---------------- stock and check-ins ----------------

test('stock: unchanged by order, schedule and start; a delivered 16-inch face cord takes exactly 73 728 cu in', async () => {
  await reset()
  const dealer = await signin('1357')
  const driver = await signin('2580')
  const before = (await stock('p_softwood_dry', dealer))
  assert.equal(before.stock_cu_in, 40 * CORD)
  const o = await order({ unit: 'face_cord', qty: 1, place: "King's Point" })
  assert.deepEqual((await stock('p_softwood_dry', dealer)), before, 'order')
  await call('POST', `/api/dealer/orders/${o.id}/schedule`, { token: dealer, body: { date: TUE } })
  assert.deepEqual((await stock('p_softwood_dry', dealer)), before, 'schedule')
  await call('POST', `/api/driver/day/${TUE}/start`, { token: driver })
  assert.deepEqual((await stock('p_softwood_dry', dealer)), before, 'start')
  const ck = await call('POST', '/api/driver/checkins', { token: driver,
    body: { op_id: uuid(), order_id: o.id, at: T0, payment: { method: 'cash' } } })
  assert.equal(ck.status, 201, JSON.stringify(ck.body))
  assert.equal((await stock('p_softwood_dry', dealer)).stock_cu_in, before.stock_cu_in - 73728)
  assert.deepEqual(stockMoves(o.id), [{ product_id: 'p_softwood_dry', change: -73728, reason: 'delivered' }])
  assert.equal((await stock('p_birch_dry', dealer)).stock_cu_in, 12 * CORD, 'other products untouched')
})

test('idempotent check-in: same op_id twice → 201 then 200 duplicate; stock and door payment once; another op → 409', async () => {
  await reset()
  const dealer = await signin('1357')
  const driver = await signin('2580')
  const o = await scheduled(dealer, { product_id: 'p_pellets', unit: 'skid', qty: 1 }, TUE)
  const bags = (await stock('p_pellets', dealer)).stock_bags
  const op = uuid()
  const body = { op_id: op, order_id: o.id, at: T0, payment: { method: 'cash' } }
  const first = await call('POST', '/api/driver/checkins', { token: driver, body })
  assert.equal(first.status, 201, JSON.stringify(first.body))
  assert.equal(first.body.duplicate, false)
  const second = await call('POST', '/api/driver/checkins', { token: driver, body })
  assert.equal(second.status, 200, JSON.stringify(second.body))
  assert.equal(second.body.duplicate, true)
  assert.equal((await stock('p_pellets', dealer)).stock_bags, bags - 70, 'stock moved once')
  assert.equal(stockMoves(o.id).length, 1)
  const detail = await call('GET', `/api/dealer/orders/${o.id}`, { token: dealer })
  assert.equal(detail.body.payments.length, 1, 'one door payment')
  assert.equal(detail.body.payments[0].source, 'door')
  const other = await call('POST', '/api/driver/checkins', { token: driver, body: { ...body, op_id: uuid() } })
  assert.deepEqual([other.status, other.body.code], [409, 'already_delivered'])
  assert.equal((await stock('p_pellets', dealer)).stock_bags, bags - 70)

  // replays at once: still one
  const o2 = await scheduled(dealer, { product_id: 'p_pellets', unit: 'skid', qty: 1 }, WED)
  const body2 = { op_id: uuid(), order_id: o2.id, at: T0, payment: { method: 'owes' } }
  const burst = await Promise.all([1, 2, 3].map(() => call('POST', '/api/driver/checkins', { token: driver, body: body2 })))
  assert.deepEqual(burst.map((r) => r.status).sort(), [200, 200, 201])
  assert.equal((await stock('p_pellets', dealer)).stock_bags, bags - 140)

  const req = await order()
  const bad = await call('POST', '/api/driver/checkins', { token: driver,
    body: { op_id: uuid(), order_id: req.id, at: T0, payment: { method: 'cash' } } })
  assert.deepEqual([bad.status, bad.body.code, bad.body.error], [409, 'bad_state', "This order isn't on a delivery day."])
  const none = await call('POST', '/api/driver/checkins', { token: driver,
    body: { op_id: uuid(), order_id: 'o_nope', at: T0, payment: { method: 'cash' } } })
  assert.equal(none.status, 404)
  const noPay = await call('POST', '/api/driver/checkins', { token: driver, body: { op_id: uuid(), order_id: req.id, at: T0 } })
  assert.deepEqual([noPay.status, noPay.body.field], [400, 'payment'])
})

test('original time: at = T with server now T + 45 min keeps T; 2 h in the future is adjusted', async () => {
  await reset()
  const dealer = await signin('1357')
  const driver = await signin('2580')
  const o = await scheduled(dealer, {}, TUE)
  const T = '2026-09-15T17:05:00.000Z' // 2:35 PM NDT
  const later = '2026-09-15T17:50:00.000Z'
  const r = await call('POST', '/api/driver/checkins', { token: driver, now: later,
    body: { op_id: uuid(), order_id: o.id, at: T, payment: { method: 'owes' } } })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  assert.equal(r.body.at, T)
  assert.equal(r.body.at_adjusted, false)
  assert.equal(r.body.order.delivered_at, T)
  const s = await call('GET', `/api/o/${o.token}`)
  assert.equal(s.body.order.delivered_label, 'Delivered Tuesday, September 15 at 2:35 PM')

  const o2 = await scheduled(dealer, {}, TUE)
  const future = '2026-09-15T19:50:00.000Z'
  const r2 = await call('POST', '/api/driver/checkins', { token: driver, now: later,
    body: { op_id: uuid(), order_id: o2.id, at: future, payment: { method: 'owes' } } })
  assert.equal(r2.status, 201)
  assert.equal(r2.body.at_adjusted, true)
  assert.equal(r2.body.at, later)

  const o3 = await scheduled(dealer, {}, TUE)
  const r3 = await call('POST', '/api/driver/checkins', { token: driver, now: later,
    body: { op_id: uuid(), order_id: o3.id, at: '2026-09-08T17:00:00.000Z', payment: { method: 'owes' } } })
  assert.equal(r3.body.at_adjusted, true, 'more than 7 days old')
})

test('door payment: Cash with no amount pays the owing; e-Transfer of part; Owes records nothing', async () => {
  await reset()
  const dealer = await signin('1357')
  const driver = await signin('2580')
  const cash = await scheduled(dealer, {}, TUE) // 373.75
  const et = await scheduled(dealer, { place: "St. Patrick's" }, TUE) // 300.00 + HST 45.00 = 345.00
  const owes = await scheduled(dealer, { unit: 'half_cord', place: "St. Patrick's" }, TUE) // 170.00 + 25.50 = 195.50
  // a deposit before delivery: cash at the door then pays only the rest
  const pre = await call('POST', '/api/dealer/payments', { token: dealer,
    body: { customer_id: (await call('GET', `/api/dealer/orders/${cash.id}`, { token: dealer })).body.customer.id,
      order_id: cash.id, amount_cents: 10000, method: 'etransfer' } })
  assert.equal(pre.status, 201, JSON.stringify(pre.body))
  const ck = (o, payment) => call('POST', '/api/driver/checkins', { token: driver,
    body: { op_id: uuid(), order_id: o.id, at: T0, payment } })

  const a = await ck(cash, { method: 'cash' })
  assert.equal(a.status, 201)
  assert.deepEqual([a.body.order.paid_cents, a.body.order.owing_cents, a.body.order.door_payment], [37375, 0, 'cash'])
  assert.equal((await call('GET', `/api/o/${cash.token}`)).body.order.owing_label, 'Paid in full')
  const pays = (await call('GET', `/api/dealer/orders/${cash.id}`, { token: dealer })).body.payments
  assert.deepEqual(pays.map((p) => [p.amount_cents, p.method, p.source, p.date]),
    [[10000, 'etransfer', 'dealer', '2026-09-14'], [27375, 'cash', 'door', '2026-09-14']])

  const b = await ck(et, { method: 'etransfer', amount_cents: 20000 })
  assert.equal(b.body.order.total_cents, 34500)
  assert.equal(b.body.order.owing_cents, 34500 - 20000)
  assert.equal((await call('GET', `/api/o/${et.token}`)).body.order.owing_label, 'Balance owing $145.00')

  const c = await ck(owes, { method: 'owes', amount_cents: 5000 })
  assert.equal(c.body.order.paid_cents, 0)
  assert.equal(c.body.order.door_payment, 'owes')
  assert.equal((await call('GET', `/api/dealer/orders/${owes.id}`, { token: dealer })).body.payments.length, 0)
  assert.equal((await call('GET', `/api/o/${owes.token}`)).body.order.owing_label, 'Balance owing $195.50')
})

test('start: the board shows out for delivery and the status page says Out for delivery; idempotent', async () => {
  await reset()
  const dealer = await signin('1357')
  const driver = await signin('2580')
  const a = await scheduled(dealer, {}, TUE)
  await scheduled(dealer, {}, TUE)
  await scheduled(dealer, {}, WED)
  const r = await call('POST', `/api/driver/day/${TUE}/start`, { token: driver })
  assert.deepEqual(r.body, { started: true, changed: 2 })
  assert.deepEqual((await call('POST', `/api/driver/day/${TUE}/start`, { token: driver })).body, { started: true, changed: 0 })
  const board = await call('GET', '/api/dealer/board', { token: dealer })
  assert.deepEqual(board.body.scheduled.map((o) => o.status), ['out_for_delivery', 'out_for_delivery', 'scheduled'])
  assert.equal((await call('GET', `/api/o/${a.token}`)).body.order.status_label, 'Out for delivery')
  const day = await call('GET', `/api/driver/day?date=${TUE}`, { token: driver })
  assert.equal(day.body.started, true)
  assert.equal(day.body.long_label, 'Tuesday, September 15')
  assert.deepEqual(day.body.counts, { done: 0, total: 2 })
  const stop = day.body.stops[0]
  assert.equal(stop.pos, 1)
  assert.equal(stop.maps_url, `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}`)
  const detail = await call('GET', `/api/dealer/orders/${a.id}`, { token: dealer })
  assert.deepEqual(detail.body.messages.map((m) => m.kind), ['on_the_way'])
  assert.equal(detail.body.messages[0].text,
    "Hi Wade, this is SAMPLE Wood & Pellets. We're on the way with your 1 cord of Mixed softwood, dry. See you soon.")
})

test('messages: scheduled text exact with the status link and owing', async () => {
  await reset()
  const dealer = await signin('1357')
  const o = await scheduled(dealer, { name: 'Wade R. (SAMPLE)' }, TUE)
  const d = await call('GET', `/api/dealer/orders/${o.id}`, { token: dealer })
  assert.deepEqual(d.body.messages, [{ kind: 'scheduled', label: "We're coming",
    text: `Hi Wade, this is SAMPLE Wood & Pellets. Your order (1 cord of Mixed softwood, dry) is booked for delivery on ` +
      `Tuesday, September 15. Amount owing: $373.75. Check your order: ${BASE}/o/?t=${o.token}` }])
  assert.deepEqual(Object.keys(d.body.customer).sort(), ['balance_cents', 'id', 'name', 'phone'])
})

test('ledger: running balance on 3 orders and 4 payments (one on account)', async () => {
  await reset()
  const dealer = await signin('1357')
  const phone = '709-555-0177'
  const o1 = await order({ phone, now: undefined }) // 373.75
  const o2 = await call('POST', '/api/orders', { now: '2026-09-15T12:00:00.000Z', body: orderBody({ phone, place: "St. Patrick's" }) }) // 345.00
  const o3 = await call('POST', '/api/orders', { now: '2026-09-16T12:00:00.000Z',
    body: orderBody({ phone, product_id: 'p_pellets', unit: 'bag', qty: 14, place: 'Little Bay' }) }) // 157.39
  const late = '2026-09-17T12:00:00.000Z'
  const cust = (await call('GET', `/api/dealer/orders/${o1.id}`, { token: dealer })).body.customer.id
  const lateDealer = await signin('1357', late)
  const pay = (body, now) => call('POST', '/api/dealer/payments', { token: lateDealer, now, body: { customer_id: cust, ...body } })
  assert.equal((await pay({ order_id: o1.id, amount_cents: 10000, method: 'etransfer', date: '2026-09-14' }, late)).status, 201)
  assert.equal((await pay({ order_id: o2.body.id, amount_cents: 34500, method: 'cash', date: '2026-09-15' }, late)).status, 201)
  assert.equal((await pay({ amount_cents: 5000, method: 'cheque', date: '2026-09-16', note: 'on account' }, late)).status, 201)
  assert.equal((await pay({ order_id: o3.body.id, amount_cents: 739, method: 'card', date: '2026-09-17' }, late)).status, 201)
  const future = await pay({ amount_cents: 100, method: 'cash', date: '2026-09-18' }, late)
  assert.deepEqual([future.status, future.body.field], [400, 'date'])
  assert.equal((await pay({ amount_cents: 0, method: 'cash' }, late)).body.field, 'amount_cents')

  const l = await call('GET', `/api/dealer/customers/${cust}/ledger`, { token: lateDealer, now: late })
  assert.equal(l.status, 200)
  assert.deepEqual(l.body.entries.map((e) => [e.date, e.kind, e.charge_cents, e.payment_cents, e.balance_cents]), [
    ['2026-09-14', 'order', 37375, 0, 37375],
    ['2026-09-14', 'payment', 0, 10000, 27375],
    ['2026-09-15', 'order', 34500, 0, 61875],
    ['2026-09-15', 'payment', 0, 34500, 27375],
    ['2026-09-16', 'order', 15739, 0, 43114],
    ['2026-09-16', 'payment', 0, 5000, 38114],
    ['2026-09-17', 'payment', 0, 739, 37375],
  ])
  assert.equal(l.body.balance_cents, 37375 + 34500 + 15739 - 10000 - 34500 - 5000 - 739)
  assert.equal(l.body.entries[0].label, 'Mon Sep 14')
  assert.equal(l.body.entries[0].text, 'Order: 1 cord of Mixed softwood, dry')
  const list = await call('GET', '/api/dealer/customers', { token: lateDealer, now: late })
  assert.deepEqual([list.body.customers[0].balance_cents, list.body.customers[0].paid_cents, list.body.customers[0].orders],
    [37375, 50239, 3])
})

// ---------------- route ----------------

const SIX = ["King's Point", 'South Brook', "Robert's Arm", "Pilley's Island", 'Little Bay', 'Beachside']

test('route optimize on 6 SAMPLE stops matches the pure module order and total_km', async () => {
  await reset()
  const dealer = await signin('1357')
  const byId = {}
  for (const name of SIX) {
    const o = await scheduled(dealer, { place: name, unit: 'half_cord', phone: `709-555-${1100 + SIX.indexOf(name)}` }, TUE)
    byId[o.id] = place(name)
  }
  const r = await call('POST', `/api/dealer/days/${TUE}/route/optimize`, { token: dealer })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const expected = optimizeRoute(YARD, Object.entries(byId).map(([id, p]) => ({ id, lat: p.lat, lng: p.lng })), YARD)
  assert.deepEqual(r.body.stops.map((s) => s.id), expected.map((s) => s.id))
  assert.deepEqual(r.body.stops.map((s) => s.route_pos), [1, 2, 3, 4, 5, 6])
  assert.equal(r.body.total_km, Math.round(pathKm(YARD, expected, YARD) * 10) / 10)
  assert.equal(r.body.note, 'Order is by distance, not road time.')
  const again = await call('GET', `/api/dealer/days/${TUE}/route`, { token: dealer })
  assert.deepEqual(again.body.stops.map((s) => s.id), expected.map((s) => s.id), 'saved')
})

test('route optimize after a delivery keeps the delivered stop first and starts from it', async () => {
  await reset()
  const dealer = await signin('1357')
  const driver = await signin('2580')
  const ids = []
  for (const name of SIX.slice(0, 4)) ids.push((await scheduled(dealer, { place: name, unit: 'half_cord' }, TUE)).id)
  const delivered = ids[2]
  await call('POST', '/api/driver/checkins', { token: driver, body: { op_id: uuid(), order_id: delivered, at: T0, payment: { method: 'owes' } } })
  const r = await call('POST', `/api/dealer/days/${TUE}/route/optimize`, { token: dealer })
  assert.equal(r.body.stops[0].id, delivered)
  const from = place(SIX[2])
  const rest = ids.filter((id) => id !== delivered).map((id) => ({ id, ...place(SIX[ids.indexOf(id)]) }))
  assert.deepEqual(r.body.stops.slice(1).map((s) => s.id), optimizeRoute(from, rest, YARD).map((s) => s.id))
})

test('route PUT saves an order and refuses missing, duplicate and foreign ids', async () => {
  await reset()
  const dealer = await signin('1357')
  const ids = []
  for (let i = 0; i < 3; i++) ids.push((await scheduled(dealer, { unit: 'half_cord' }, TUE)).id)
  const foreign = (await scheduled(dealer, {}, WED)).id
  const put = (order_ids) => call('PUT', `/api/dealer/days/${TUE}/route`, { token: dealer, body: { order_ids } })
  const ok = await put([ids[2], ids[0], ids[1]])
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.body.stops.map((s) => s.id), [ids[2], ids[0], ids[1]])
  for (const bad of [[ids[0], ids[1]], [ids[0], ids[1], ids[1]], [ids[0], ids[1], foreign], [ids[0], ids[1], ids[2], foreign], 'nope']) {
    const r = await put(bad)
    assert.deepEqual([r.status, r.body.code, r.body.field], [400, 'bad_request', 'order_ids'], JSON.stringify(bad))
  }
  assert.deepEqual((await call('GET', `/api/dealer/days/${TUE}/route`, { token: dealer })).body.stops.map((s) => s.id),
    [ids[2], ids[0], ids[1]], 'refusals change nothing')
})

// ---------------- photos ----------------

// A real 1×1 PNG.
const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64'))

test('photo: PUT png → GET returns the same bytes and type; 415 text/plain; 413 over 5 000 000 bytes; 404 unknown op', async () => {
  await reset()
  const dealer = await signin('1357')
  const driver = await signin('2580')
  const o = await scheduled(dealer, {}, TUE)
  const op = uuid()
  await call('POST', '/api/driver/checkins', { token: driver, body: { op_id: op, order_id: o.id, at: T0, payment: { method: 'owes' } } })
  assert.equal((await call('GET', `/api/photos/${o.token}`)).status, 404)
  const put = (raw, type, id = op) => call('PUT', `/api/driver/checkins/${id}/photo`, { token: driver, raw, headers: { 'Content-Type': type } })
  const r = await put(PNG, 'image/png')
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual(r.body, { stored: true, photo_url: `/api/photos/${o.token}` })
  const g = await call('GET', `/api/photos/${o.token}`)
  assert.equal(g.status, 200)
  assert.equal(g.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(g.body), Buffer.from(PNG))
  assert.equal((await call('GET', `/api/o/${o.token}`)).body.order.photo_url, `/api/photos/${o.token}`)
  const t = await put(new TextEncoder().encode('hello'), 'text/plain')
  assert.deepEqual([t.status, t.body.code], [415, 'unsupported_media'])
  const big = await put(new Uint8Array(5000001), 'image/jpeg')
  assert.deepEqual([big.status, big.body.code], [413, 'payload_too_large'])
  const edge = await put(new Uint8Array(5000000).fill(7), 'image/jpeg')
  assert.equal(edge.status, 200, 'exactly 5 000 000 bytes is allowed')
  const g2 = await call('GET', `/api/photos/${o.token}`)
  assert.equal(g2.headers.get('content-type'), 'image/jpeg', 'a second photo replaces the first')
  assert.equal(g2.body.length, 5000000)
  assert.equal((await put(PNG, 'image/png', uuid())).status, 404)
})

test('test routes and unknown API paths', async () => {
  assert.equal((await call('GET', '/api/nothing-here')).status, 404)
  assert.equal((await call('GET', '/api/dealer/orders/o_nope', { token: await signin('1357') })).status, 404)
})
