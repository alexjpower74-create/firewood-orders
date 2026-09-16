// M2 API suite: every remaining route in docs/API.md, the rate guards, zones, season closed, totals, CSV and the demo seed.
// Same rules as api.test.mjs: a real local Worker in TEST_MODE, every test from a reset, "now" pinned with X-Test-Now.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SAMPLE_SETTINGS } from '../src/sample.js'
import {
  call,
  checkin,
  CORD,
  detail,
  order,
  orderBody,
  place,
  productMoves,
  put,
  reset,
  scheduled,
  signin,
  stock,
  stockMoves,
  SUN,
  T0,
  TUE,
  uuid,
  WED,
} from './api-helpers.mjs'

const D = SAMPLE_SETTINGS.delivery
const L = SAMPLE_SETTINGS.load
const TR = SAMPLE_SETTINGS.truck
const text = (bytes) => new TextDecoder().decode(bytes)
const minutesAfter = (iso, m) => new Date(Date.parse(iso) + m * 60e3).toISOString()
const customerOf = async (dealer, orderId) => (await detail(dealer, orderId)).body.customer.id
const pay = (dealer, body, now = T0) => call('POST', '/api/dealer/payments', { token: dealer, now, body })

// ---------------- order changes ----------------

test('customer cancel: only while requested; once scheduled the plain 409', async () => {
  await reset()
  const dealer = await signin('1357')
  const a = await order()
  const r = await call('POST', `/api/o/${a.token}/cancel`)
  assert.deepEqual([r.status, r.body], [200, { status: 'cancelled' }])
  assert.equal((await call('GET', `/api/o/${a.token}`)).body.order.status_label, 'Cancelled')
  const again = await call('POST', `/api/o/${a.token}/cancel`)
  assert.deepEqual([again.status, again.body.code], [409, 'bad_state'])
  const b = await scheduled(dealer, {}, TUE)
  const no = await call('POST', `/api/o/${b.token}/cancel`)
  assert.deepEqual(
    [no.status, no.body.code, no.body.error],
    [409, 'bad_state', 'This order is already on the schedule. Call us to change it.'],
  )
  assert.equal((await call('GET', `/api/o/${b.token}`)).body.order.status, 'scheduled')
  assert.equal((await call('POST', '/api/o/not-a-token/cancel')).status, 404)
  const board = await call('GET', '/api/dealer/board', { token: dealer })
  assert.deepEqual([board.body.counts.cancelled, board.body.counts.new], [1, 0])
})

test('dealer cancel: from requested and scheduled (frees the day), not once out for delivery; a paid deposit becomes a credit', async () => {
  await reset()
  const dealer = await signin('1357')
  const driver = await signin('2580')
  const a = await scheduled(dealer, {}, TUE)
  const b = await scheduled(dealer, {}, TUE)
  const cust = await customerOf(dealer, a.id)
  assert.equal((await pay(dealer, { customer_id: cust, order_id: a.id, amount_cents: 5000, method: 'cash' })).status, 201)
  const r = await call('POST', `/api/dealer/orders/${a.id}/cancel`, { token: dealer })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual(
    [r.body.order.status, r.body.order.delivery_date, r.body.order.route_pos, r.body.order.owing_cents],
    ['cancelled', null, null, -5000],
  )
  assert.equal((await call('GET', `/api/o/${a.token}`)).body.order.owing_label, 'Credit $50.00')
  const days = await call('GET', '/api/dealer/days', { token: dealer })
  assert.equal(days.body.days.find((d) => d.date === TUE).wood.used_cords, 1)
  assert.deepEqual(
    (await call('GET', `/api/dealer/days/${TUE}/route`, { token: dealer })).body.stops.map((s) => [s.id, s.route_pos]),
    [[b.id, 1]],
  )
  assert.equal((await call('GET', `/api/dealer/customers/${cust}/ledger`, { token: dealer })).body.balance_cents, -5000)
  const fresh = await order()
  assert.equal((await call('POST', `/api/dealer/orders/${fresh.id}/cancel`, { token: dealer })).body.order.status, 'cancelled')
  await call('POST', `/api/driver/day/${TUE}/start`, { token: driver })
  const out = await call('POST', `/api/dealer/orders/${b.id}/cancel`, { token: dealer })
  assert.deepEqual([out.status, out.body.code], [409, 'bad_state'])
})

test('edit: money recomputed; a delivered order refuses amount changes but takes a note; a new phone moves the order and its payments', async () => {
  await reset()
  const dealer = await signin('1357')
  const driver = await signin('2580')
  const o = await order({ place: "St. Patrick's" }) // 1 cord, free band: 300.00 + HST 45.00 = 345.00
  let r = await put(`/api/dealer/orders/${o.id}`, { qty: 2, stacking: true, address: 'Behind the school', note: 'Call first' }, dealer)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  // 2 cords 600.00 + stacking 2 × 60.00 = 720.00, free delivery, HST 108.00, total 828.00
  assert.deepEqual(
    [
      r.body.order.qty_label,
      r.body.order.wood_cu_in,
      r.body.order.goods_cents,
      r.body.order.stacking_cents,
      r.body.order.delivery_cents,
      r.body.order.hst_cents,
      r.body.order.total_cents,
    ],
    ['2 cords', 2 * CORD, 60000, 12000, 0, 10800, 82800],
  )
  assert.deepEqual([r.body.order.address, r.body.order.note, r.body.order.stacking], ['Behind the school', 'Call first', true])
  // moving the pin to King's Point recomputes the band ($25.00): subtotal 745.00, HST 111.75, total 856.75
  const kp = place("King's Point")
  r = await put(`/api/dealer/orders/${o.id}`, { lat: kp.lat, lng: kp.lng }, dealer)
  assert.deepEqual(
    [r.body.order.distance_km, r.body.order.delivery_cents, r.body.order.subtotal_cents, r.body.order.hst_cents, r.body.order.total_cents],
    [12.9, 2500, 74500, 11175, 85675],
  )
  // a dealer fee of 10.00: subtotal 730.00, HST 109.50, total 839.50
  r = await put(`/api/dealer/orders/${o.id}`, { delivery_cents: 1000 }, dealer)
  assert.deepEqual(
    [r.body.order.delivery_cents, r.body.order.subtotal_cents, r.body.order.hst_cents, r.body.order.total_cents],
    [1000, 73000, 10950, 83950],
  )
  assert.equal((await call('GET', `/api/o/${o.token}`)).body.order.owing_cents, 83950)
  for (const [field, change] of [
    ['qty', { qty: 0 }],
    ['phone', { phone: 'x' }],
    ['preferred', { preferred: { any: false, dates: [SUN] } }],
    ['unit', { unit: 'bag' }],
    ['delivery_cents', { delivery_cents: -1 }],
  ]) {
    const bad = await put(`/api/dealer/orders/${o.id}`, change, dealer)
    assert.deepEqual([bad.status, bad.body.field], [400, field], JSON.stringify(change))
  }
  assert.equal((await detail(dealer, o.id)).body.order.total_cents, 83950, 'refused edits change nothing')

  assert.equal((await call('POST', `/api/dealer/orders/${o.id}/schedule`, { token: dealer, body: { date: TUE } })).status, 200)
  assert.equal((await checkin(driver, o.id, { method: 'owes' })).status, 201)
  r = await put(`/api/dealer/orders/${o.id}`, { qty: 1 }, dealer)
  assert.deepEqual([r.status, r.body.code], [409, 'bad_state'])
  r = await put(`/api/dealer/orders/${o.id}`, { qty: 2, note: 'Stacked by the shed' }, dealer)
  assert.equal(r.status, 200, 'the same quantity again is not a change')
  assert.deepEqual([r.body.order.note, r.body.order.total_cents, r.body.order.status], ['Stacked by the shed', 83950, 'delivered'])

  const oldCustomer = await customerOf(dealer, o.id)
  assert.equal((await pay(dealer, { customer_id: oldCustomer, order_id: o.id, amount_cents: 1000, method: 'cash' })).status, 201)
  r = await put(`/api/dealer/orders/${o.id}`, { phone: '709-555-0199', name: 'Wade Rideout (SAMPLE)' }, dealer)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const d = await detail(dealer, o.id)
  assert.notEqual(d.body.customer.id, oldCustomer)
  assert.deepEqual(
    [d.body.customer.name, d.body.customer.phone, d.body.customer.balance_cents],
    ['Wade Rideout (SAMPLE)', '709-555-0199', 82950],
  )
  assert.equal(d.body.payments.length, 1)
  assert.equal((await call('GET', `/api/dealer/customers/${oldCustomer}/ledger`, { token: dealer })).body.balance_cents, 0)
  const cancelled = await order()
  await call('POST', `/api/o/${cancelled.token}/cancel`)
  assert.equal((await put(`/api/dealer/orders/${cancelled.id}`, { note: 'x' }, dealer)).status, 409)
  assert.equal((await put('/api/dealer/orders/o_nope', { note: 'x' }, dealer)).status, 404)
})

test('edit that grows a scheduled order re-checks capacity; shrinking is always allowed', async () => {
  await reset()
  const dealer = await signin('1357')
  const cords = []
  for (let i = 0; i < 4; i++) cords.push(await scheduled(dealer, {}, TUE))
  const half = await scheduled(dealer, { unit: 'half_cord' }, TUE)
  let r = await put(`/api/dealer/orders/${half.id}`, { unit: 'cord' }, dealer)
  assert.equal(r.status, 409, JSON.stringify(r.body))
  assert.equal(r.body.code, 'over_capacity')
  assert.equal(r.body.error, "That's more than the truck can carry that day: 4.00 of 4.50 cords already planned, this order needs 1.00.")
  assert.deepEqual(r.body.needs, { wood_cu_in: CORD, pellet_bags: 0 })
  assert.equal((await detail(dealer, half.id)).body.order.unit, 'half_cord', 'nothing saved')
  r = await put(`/api/dealer/orders/${half.id}`, { unit: 'face_cord' }, dealer)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const tue = async () => (await call('GET', '/api/dealer/days', { token: dealer })).body.days.find((d) => d.date === TUE)
  assert.equal((await tue()).wood.used_cu_in, 4 * CORD + 73728)
  // the dealer lowers the truck to 3 cords: the day is over; growing is refused, shrinking is not
  assert.equal((await put('/api/dealer/settings', { truck: { ...TR, wood_cords_per_day: 3 } }, dealer)).status, 200)
  assert.equal((await tue()).over, true)
  assert.equal((await put(`/api/dealer/orders/${half.id}`, { qty: 2 }, dealer)).status, 409)
  r = await put(`/api/dealer/orders/${cords[0].id}`, { unit: 'half_cord' }, dealer)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal((await tue()).wood.used_cu_in, 3 * CORD + CORD / 2 + 73728)
})

// ---------------- undo ----------------

test('undeliver and driver undo each put stock back and void the door payment (owing restored to the cent)', async () => {
  await reset()
  const dealer = await signin('1357')
  const driver = await signin('2580')
  const a = await scheduled(dealer, { unit: 'face_cord' }, TUE) // 120.00 + 25.00 delivery + HST 21.75 = 166.75
  await call('POST', `/api/driver/day/${TUE}/start`, { token: driver })
  const wood0 = (await stock('p_softwood_dry', dealer)).stock_cu_in

  const opA = uuid()
  let r = await checkin(driver, a.id, { method: 'cash' }, { op: opA })
  assert.deepEqual([r.status, r.body.order.total_cents, r.body.order.owing_cents], [201, 16675, 0])
  assert.equal((await stock('p_softwood_dry', dealer)).stock_cu_in, wood0 - 73728)
  const u = await call('DELETE', `/api/driver/checkins/${opA}`, { token: driver, now: minutesAfter(T0, 10) })
  assert.equal(u.status, 200, JSON.stringify(u.body))
  assert.deepEqual(
    [u.body.order.status, u.body.order.paid_cents, u.body.order.owing_cents, u.body.order.door_payment, u.body.order.delivered_at],
    ['out_for_delivery', 0, 16675, null, null],
  )
  assert.equal((await stock('p_softwood_dry', dealer)).stock_cu_in, wood0)
  assert.deepEqual(
    (await detail(dealer, a.id)).body.payments.map((p) => [p.amount_cents, p.source, p.voided]),
    [[16675, 'door', true]],
  )
  assert.equal((await call('GET', `/api/o/${a.token}`)).body.order.owing_label, 'Balance owing $166.75')
  const twice = await call('DELETE', `/api/driver/checkins/${opA}`, { token: driver, now: minutesAfter(T0, 11) })
  assert.deepEqual([twice.status, twice.body.code], [409, 'bad_state'])
  assert.equal((await stock('p_softwood_dry', dealer)).stock_cu_in, wood0, 'a second undo moves nothing')

  // delivered again with another op (e-Transfer of part), then the dealer marks it not delivered
  r = await checkin(driver, a.id, { method: 'etransfer', amount_cents: 6675 }, { at: minutesAfter(T0, 20), now: minutesAfter(T0, 20) })
  assert.deepEqual([r.status, r.body.order.owing_cents], [201, 10000])
  const un = await call('POST', `/api/dealer/orders/${a.id}/undeliver`, { token: dealer, now: minutesAfter(T0, 90) })
  assert.equal(un.status, 200, JSON.stringify(un.body))
  assert.deepEqual([un.body.order.status, un.body.order.paid_cents, un.body.order.owing_cents], ['out_for_delivery', 0, 16675])
  assert.equal((await stock('p_softwood_dry', dealer)).stock_cu_in, wood0)
  assert.deepEqual(
    stockMoves(a.id).map((m) => [m.change, m.reason]),
    [
      [-73728, 'delivered'],
      [73728, 'undo'],
      [-73728, 'delivered'],
      [73728, 'undo'],
    ],
  )
  assert.equal((await call('POST', `/api/dealer/orders/${a.id}/undeliver`, { token: dealer })).body.code, 'bad_state')

  // pellets on a day not started go back to scheduled
  const b = await scheduled(dealer, { product_id: 'p_pellets', unit: 'bag', qty: 14 }, WED) // 111.86 + 25.00 + HST 20.53 = 157.39
  const bags0 = (await stock('p_pellets', dealer)).stock_bags
  assert.equal((await checkin(driver, b.id, { method: 'owes' })).status, 201)
  assert.equal((await stock('p_pellets', dealer)).stock_bags, bags0 - 14)
  const unb = await call('POST', `/api/dealer/orders/${b.id}/undeliver`, { token: dealer })
  assert.deepEqual([unb.body.order.status, unb.body.order.owing_cents], ['scheduled', 15739])
  assert.equal((await stock('p_pellets', dealer)).stock_bags, bags0)
})

test('driver undo: 15 minutes after the server got it is still fine, 16 is too late', async () => {
  await reset()
  const dealer = await signin('1357')
  const driver = await signin('2580')
  const a = await scheduled(dealer, {}, TUE)
  const op = uuid()
  // the phone tapped an hour earlier; the 15 minutes count from when the server received it (T0)
  assert.equal((await checkin(driver, a.id, { method: 'cash' }, { op, at: minutesAfter(T0, -60) })).status, 201)
  const late = await call('DELETE', `/api/driver/checkins/${op}`, { token: driver, now: minutesAfter(T0, 16) })
  assert.deepEqual([late.status, late.body.code, late.body.error], [409, 'too_late', 'Too late to undo here. Ask the dealer to change it.'])
  assert.equal((await detail(dealer, a.id)).body.order.status, 'delivered')
  const b = await scheduled(dealer, {}, TUE)
  const op2 = uuid()
  assert.equal((await checkin(driver, b.id, { method: 'owes' }, { op: op2 })).status, 201)
  assert.equal((await call('DELETE', `/api/driver/checkins/${op2}`, { token: driver, now: minutesAfter(T0, 15) })).status, 200)
  assert.equal((await call('DELETE', `/api/driver/checkins/${uuid()}`, { token: driver })).status, 404)
})

// ---------------- payments ----------------

test('voided payments leave every sum', async () => {
  await reset()
  const dealer = await signin('1357')
  const driver = await signin('2580')
  const o = await scheduled(dealer, { place: "St. Patrick's" }, TUE) // 345.00
  const cust = await customerOf(dealer, o.id)
  const p1 = await pay(dealer, { customer_id: cust, order_id: o.id, amount_cents: 10000, method: 'etransfer' })
  const p2 = await pay(dealer, { customer_id: cust, amount_cents: 2000, method: 'cash', note: 'On account' })
  assert.deepEqual([p1.status, p2.status], [201, 201])
  // cash at the door with no amount pays what the order owes then: 345.00 − 100.00 = 245.00
  const door = await checkin(driver, o.id, { method: 'cash' }, { now: minutesAfter(T0, 1) })
  assert.equal(door.body.order.paid_cents, 34500)
  // the e-Transfer never landed and the on-account cash was a mistake: void both
  const v = await call('DELETE', `/api/dealer/payments/${p1.body.payment.id}`, { token: dealer })
  assert.deepEqual([v.status, v.body.payment.voided, v.body.payment.amount_cents], [200, true, 10000])
  assert.equal((await call('DELETE', `/api/dealer/payments/${p1.body.payment.id}`, { token: dealer })).body.payment.voided, true)
  assert.equal((await call('DELETE', `/api/dealer/payments/${p2.body.payment.id}`, { token: dealer })).status, 200)
  assert.equal((await call('DELETE', '/api/dealer/payments/pay_nope', { token: dealer })).status, 404)

  const d = await detail(dealer, o.id)
  assert.deepEqual([d.body.order.paid_cents, d.body.order.owing_cents, d.body.customer.balance_cents], [24500, 10000, 10000])
  assert.deepEqual(
    d.body.payments.map((p) => [p.amount_cents, p.voided]),
    [
      [10000, true],
      [24500, false],
    ],
  )
  assert.equal((await call('GET', `/api/o/${o.token}`)).body.order.owing_label, 'Balance owing $100.00')
  const ledger = await call('GET', `/api/dealer/customers/${cust}/ledger`, { token: dealer })
  assert.deepEqual(
    ledger.body.entries.map((e) => [e.kind, e.charge_cents, e.payment_cents, e.balance_cents]),
    [
      ['order', 34500, 0, 34500],
      ['payment', 0, 24500, 10000],
    ],
  )
  const list = await call('GET', '/api/dealer/customers', { token: dealer })
  assert.deepEqual([list.body.customers[0].paid_cents, list.body.customers[0].balance_cents], [24500, 10000])
  const board = await call('GET', '/api/dealer/board', { token: dealer })
  assert.deepEqual(
    board.body.owing.map((x) => [x.id, x.owing_cents]),
    [[o.id, 10000]],
  )
  const t = await call('GET', '/api/dealer/totals?season=2026', { token: dealer })
  assert.deepEqual([t.body.months[0].payments_cents, t.body.totals.payments_cents, t.body.totals.owing_cents], [24500, 24500, 10000])
  const csv = text((await call('GET', '/api/dealer/export/payments.csv?season=2026', { token: dealer })).body)
  assert.equal(csv.split('\r\n').length, 3, csv)
})

test('messages: the balance reminder is exact; paid in full and new orders have none', async () => {
  await reset()
  const dealer = await signin('1357')
  const driver = await signin('2580')
  const o = await scheduled(dealer, {}, TUE)
  await checkin(driver, o.id, { method: 'owes' })
  const d = await detail(dealer, o.id)
  assert.deepEqual(d.body.messages, [
    {
      kind: 'balance',
      label: 'Balance reminder',
      text: `Hi Wade, this is SAMPLE Wood & Pellets. Thanks again for your order. The balance of $373.75 is still owing. ${SAMPLE_SETTINGS.deposit_text}`,
    },
  ])
  await pay(dealer, { customer_id: d.body.customer.id, order_id: o.id, amount_cents: 37375, method: 'cash' })
  assert.deepEqual((await detail(dealer, o.id)).body.messages, [])
  assert.deepEqual((await detail(dealer, (await order()).id)).body.messages, [])
})

// ---------------- settings ----------------

test('settings: GET shape; PUT saves; info, status page and driver follow (sample off); truck caps recomputed', async () => {
  await reset()
  const dealer = await signin('1357')
  const driver = await signin('2580')
  const g = await call('GET', '/api/dealer/settings', { token: dealer })
  assert.equal(g.status, 200)
  assert.deepEqual(
    Object.keys(g.body.settings).sort(),
    [
      'name',
      'short_name',
      'sample',
      'phone',
      'deposit_text',
      'season_open',
      'season_message',
      'season_start',
      'min_order_cents',
      'hst_registered',
      'yard',
      'delivery',
      'load',
      'truck',
      'delivery_weekdays',
      'window_days',
    ].sort(),
  )
  assert.equal(g.body.settings.sample, true)
  assert.ok(!/pin_hash|pin_salt/.test(JSON.stringify(g.body)), 'no PIN hashes or salts')
  const soft = g.body.products.find((p) => p.id === 'p_softwood_dry')
  assert.deepEqual([soft.stock_cu_in, soft.stock_cords, soft.active, soft.sort], [40 * CORD, 40, true, 1])
  assert.equal(g.body.products.find((p) => p.id === 'p_pellets').stock_bags, 600)

  const o = await scheduled(dealer, {}, TUE)
  const r = await put(
    '/api/dealer/settings',
    {
      sample: false,
      name: 'SAMPLE Wood & Pellets — edited (demo)',
      min_order_cents: 5000,
      truck: { ...TR, wood_cords_per_day: 3.25, pellet_skids_per_day: 2 },
    },
    dealer,
  )
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual([r.body.settings.sample, r.body.settings.min_order_cents, r.body.settings.truck.wood_cords_per_day], [false, 5000, 3.25])
  assert.deepEqual(r.body.settings.delivery, D, 'groups not sent are kept')
  const info = (await call('GET', '/api/info')).body
  assert.deepEqual([info.sample, info.name, info.min_order_cents], [false, 'SAMPLE Wood & Pellets — edited (demo)', 5000])
  assert.equal((await call('GET', `/api/o/${o.token}`)).body.dealer.sample, false)
  assert.equal((await call('GET', '/api/driver/day', { token: driver })).body.dealer.sample, false)
  const tue = async () => (await call('GET', '/api/dealer/days', { token: dealer })).body.days.find((d) => d.date === TUE)
  let day = await tue()
  assert.deepEqual([day.wood.cap_cu_in, day.wood.cap_cords, day.pellets.cap_bags, day.pellets.cap_skids], [718848, 3.25, 140, 2])
  // bags per skid of the first active pellet product feeds cap_bags
  assert.equal((await put('/api/dealer/products/p_pellets', { bags_per_skid: 50 }, dealer)).status, 200)
  day = await tue()
  assert.equal(day.pellets.cap_bags, 100)
})

const SETTINGS_GROUPS = {
  names: [
    ['name', { name: '' }],
    ['short_name', { short_name: 'x'.repeat(41) }],
    ['sample', { sample: 'yes' }],
  ],
  contact: [
    ['phone', { phone: 'x'.repeat(33) }],
    ['deposit_text', { deposit_text: 'x'.repeat(401) }],
  ],
  season: [
    ['season_open', { season_open: 1 }],
    ['season_message', { season_message: 'x'.repeat(201) }],
    ['season_start', { season_start: '9-1' }],
    ['season_start', { season_start: '02-30' }],
  ],
  money: [
    ['min_order_cents', { min_order_cents: 100001 }],
    ['min_order_cents', { min_order_cents: 50.5 }],
    ['hst_registered', { hst_registered: 'true' }],
  ],
  yard: [
    ['yard', { yard: { lat: 44.65, lng: -63.57, label: 'Too far south' } }],
    ['yard', { yard: { ...SAMPLE_SETTINGS.yard, label: '' } }],
  ],
  delivery: [
    ['delivery.mode', { delivery: { ...D, mode: 'miles' } }],
    ['delivery.bands', { delivery: { ...D, bands: [] } }],
    [
      'delivery.bands',
      {
        delivery: {
          ...D,
          bands: [
            { up_to_km: 30, fee_cents: 0 },
            { up_to_km: 10, fee_cents: 2500 },
          ],
        },
      },
    ],
    ['delivery.bands', { delivery: { ...D, bands: [{ up_to_km: 10, fee_cents: 50001 }] } }],
    ['delivery.bands', { delivery: { ...D, bands: Array.from({ length: 7 }, (_, i) => ({ up_to_km: i + 1, fee_cents: 0 })) } }],
    ['delivery.zones', { delivery: { ...D, mode: 'zones', zones: [] } }],
    [
      'delivery.zones',
      {
        delivery: {
          ...D,
          zones: [
            { id: 'a', name: 'A', fee_cents: 0 },
            { id: 'a', name: 'B', fee_cents: 0 },
          ],
        },
      },
    ],
    ['delivery.beyond_message', { delivery: { ...D, beyond_message: 'x'.repeat(201) } }],
  ],
  load: [
    ['load.cords', { load: { ...L, cords: 0.2 } }],
    ['load.cords', { load: { ...L, cords: 1.234 } }],
    ['load.description', { load: { ...L, description: '' } }],
  ],
  truck: [
    ['truck.name', { truck: { ...TR, name: '' } }],
    ['truck.wood_cords_per_day', { truck: { ...TR, wood_cords_per_day: 40.5 } }],
    ['truck.wood_cords_per_day', { truck: { ...TR, wood_cords_per_day: 4.555 } }],
    ['truck.pellet_skids_per_day', { truck: { ...TR, pellet_skids_per_day: 21 } }],
  ],
  calendar: [
    ['delivery_weekdays', { delivery_weekdays: [] }],
    ['delivery_weekdays', { delivery_weekdays: [0, 1] }],
    ['delivery_weekdays', { delivery_weekdays: [1, 1] }],
    ['window_days', { window_days: 6 }],
    ['window_days', { window_days: 43 }],
  ],
}

for (const [group, cases] of Object.entries(SETTINGS_GROUPS)) {
  test(`settings validation: ${group}`, async () => {
    await reset()
    const dealer = await signin('1357')
    const before = (await call('GET', '/api/dealer/settings', { token: dealer })).body.settings
    for (const [field, change] of cases) {
      const r = await put('/api/dealer/settings', change, dealer)
      assert.equal(r.status, 400, `${field}: ${JSON.stringify(r.body)}`)
      assert.deepEqual([r.body.code, r.body.field], ['bad_request', field], JSON.stringify(change).slice(0, 90))
      assert.equal(typeof r.body.error, 'string')
    }
    assert.deepEqual((await call('GET', '/api/dealer/settings', { token: dealer })).body.settings, before, 'nothing saved')
  })
}

test('zones mode end to end: info lists the zones, quote and order need one, and the zone fee applies even far away', async () => {
  await reset()
  const dealer = await signin('1357')
  const zones = [
    { id: 'springdale', name: 'Springdale', fee_cents: 0 },
    { id: 'green-bay', name: 'Green Bay shore', fee_cents: 3500 },
  ]
  const r = await put('/api/dealer/settings', { delivery: { ...D, mode: 'zones', zones } }, dealer)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const info = (await call('GET', '/api/info')).body
  assert.deepEqual([info.delivery.mode, info.delivery.zones], ['zones', zones])
  const bu = place('Buchans')
  const q = (zoneId) =>
    call('POST', '/api/quote', { body: { product_id: 'p_softwood_dry', unit: 'cord', qty: 1, lat: bu.lat, lng: bu.lng, zone_id: zoneId } })
  const none = await q(undefined)
  assert.deepEqual([none.status, none.body.field], [400, 'zone_id'])
  assert.equal((await q('nowhere')).body.field, 'zone_id')
  const ok = await q('green-bay')
  // 300.00 + zone 35.00 = 335.00; HST 50.25; total 385.25 (Buchans is past every band, but zones ignore distance)
  assert.deepEqual([ok.status, ok.body.delivery_cents, ok.body.hst_cents, ok.body.total_cents], [200, 3500, 5025, 38525])
  const made = await call('POST', '/api/orders', { body: orderBody({ place: 'Buchans', zone_id: 'green-bay' }) })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  assert.equal((await detail(dealer, made.body.id)).body.order.delivery_cents, 3500)
  assert.equal((await call('POST', '/api/orders', { body: orderBody({ zone_id: null }) })).body.field, 'zone_id')
})

test('season closed: a public order is 403 with the dealer message; quotes still answer; a phone order is 201', async () => {
  await reset()
  const dealer = await signin('1357')
  assert.equal((await put('/api/dealer/settings', { season_open: false }, dealer)).status, 200)
  assert.equal((await call('GET', '/api/info')).body.season_open, false)
  const r = await call('POST', '/api/orders', { body: orderBody() })
  assert.deepEqual([r.status, r.body.code, r.body.error], [403, 'season_closed', SAMPLE_SETTINGS.season_message])
  const kp = place("King's Point")
  const quote = await call('POST', '/api/quote', { body: { product_id: 'p_softwood_dry', unit: 'cord', qty: 1, lat: kp.lat, lng: kp.lng } })
  assert.equal(quote.status, 200)
  // a phone order past the last band with the dealer's own fee
  const phone = await call('POST', '/api/dealer/orders', { token: dealer, body: orderBody({ place: 'Buchans', delivery_cents: 9000 }) })
  assert.equal(phone.status, 201, JSON.stringify(phone.body))
  const d = await detail(dealer, phone.body.id)
  assert.deepEqual([d.body.order.source, d.body.order.delivery_cents], ['phone', 9000])
})

// ---------------- products, stock, PINs ----------------

test('products: add firewood and pellets, edit (kind fixed), a not-sold unit and a deactivated product leave the order page', async () => {
  await reset()
  const dealer = await signin('1357')
  let r = await call('POST', '/api/dealer/products', {
    token: dealer,
    body: {
      kind: 'wood',
      name: 'Mixed hardwood, dry',
      species: 'Maple and birch',
      cut_in: 12,
      stacking_cents_per_cord: 5000,
      price_cents: { cord: 40000, face_cord: 11000 },
    },
  })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  const p = r.body.product
  assert.match(p.id, /^p_/)
  assert.deepEqual([p.kind, p.dryness, p.split, p.cut_in, p.active, p.sort, p.stock_cu_in], ['wood', 'dry', true, 12, true, 5, 0])
  assert.deepEqual(p.price_cents, { cord: 40000, half_cord: null, face_cord: 11000, load: null })
  const card = async () => (await call('GET', '/api/info')).body.products.find((x) => x.id === p.id)
  let c1 = await card()
  assert.deepEqual(
    c1.units.map((u) => [u.unit, u.price_cents, u.wood_cu_in]),
    [
      ['cord', 40000, CORD],
      ['face_cord', 11000, 12 * 4608],
    ],
  )
  assert.match(c1.units[1].explain, /\(12 inches\)\. That is 0\.25 of a full cord\.$/)

  for (const [field, change] of [
    ['kind', { kind: 'pellets' }],
    ['cut_in', { cut_in: 25 }],
    ['price_cents.cord', { price_cents: { cord: 0 } }],
    ['dryness', { dryness: 'wet' }],
    ['stacking_cents_per_cord', { stacking_cents_per_cord: 50001 }],
    ['name', { name: '' }],
  ]) {
    const bad = await put(`/api/dealer/products/${p.id}`, change, dealer)
    assert.deepEqual([bad.status, bad.body.field], [400, field], JSON.stringify(change))
  }
  r = await put(`/api/dealer/products/${p.id}`, { price_cents: { face_cord: null }, name: 'Hardwood, dry' }, dealer)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual(
    [r.body.product.name, r.body.product.price_cents.cord, r.body.product.price_cents.face_cord],
    ['Hardwood, dry', 40000, null],
  )
  c1 = await card()
  assert.deepEqual(
    c1.units.map((u) => u.unit),
    ['cord'],
  )
  assert.equal((await put(`/api/dealer/products/${p.id}`, { active: false }, dealer)).status, 200)
  assert.equal(await card(), undefined)
  assert.equal((await call('POST', '/api/orders', { body: orderBody({ product_id: p.id }) })).body.field, 'product_id')

  r = await call('POST', '/api/dealer/products', {
    token: dealer,
    body: { kind: 'pellets', name: 'SAMPLE Budget wood pellets', brand: 'SAMPLE Budget', bags_per_skid: 60, price_cents: { bag: 699 } },
  })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  assert.deepEqual(
    [r.body.product.bag_lb, r.body.product.bags_per_ton, r.body.product.bags_per_skid, r.body.product.price_cents],
    [40, 50, 60, { bag: 699, ton: null, skid: null }],
  )
  assert.equal((await call('POST', '/api/dealer/products', { token: dealer, body: { kind: 'coal', name: 'Coal' } })).body.field, 'kind')
  assert.equal((await call('POST', '/api/dealer/products', { token: dealer, body: { kind: 'wood' } })).body.field, 'name')
  assert.equal((await put('/api/dealer/products/p_nope', { name: 'x' }, dealer)).status, 404)
})

test('stock count: set and add, cords for firewood and bags for pellets, each written as an adjust move', async () => {
  await reset()
  const dealer = await signin('1357')
  const adj = (id, body) => call('POST', `/api/dealer/products/${id}/stock`, { token: dealer, body })
  let r = await adj('p_softwood_dry', { mode: 'set', cords: 12.5, note: 'Counted the yard' })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual([r.body.product.stock_cu_in, r.body.product.stock_cords], [2764800, 12.5])
  r = await adj('p_softwood_dry', { mode: 'add', cords: -0.5 })
  assert.deepEqual([r.body.product.stock_cu_in, r.body.product.stock_cords], [12 * CORD, 12])
  r = await adj('p_pellets', { mode: 'add', bags: 70 })
  assert.equal(r.body.product.stock_bags, 670)
  r = await adj('p_pellets', { mode: 'set', bags: 500 })
  assert.equal(r.body.product.stock_bags, 500)
  assert.deepEqual(productMoves('p_softwood_dry'), [
    [2764800 - 40 * CORD, 'adjust', 'Counted the yard'],
    [-CORD / 2, 'adjust', ''],
  ])
  assert.deepEqual(productMoves('p_pellets'), [
    [70, 'adjust', ''],
    [-170, 'adjust', ''],
  ])
  for (const [id, body, field] of [
    ['p_softwood_dry', { mode: 'set', bags: 5 }, 'cords'],
    ['p_pellets', { mode: 'set', cords: 1 }, 'bags'],
    ['p_softwood_dry', { mode: 'count', cords: 1 }, 'mode'],
    ['p_softwood_dry', { mode: 'add', cords: 1.234 }, 'cords'],
    ['p_pellets', { mode: 'set', bags: -1 }, 'bags'],
  ]) {
    const bad = await adj(id, body)
    assert.deepEqual([bad.status, bad.body.field], [400, field], JSON.stringify(body))
  }
  assert.equal((await adj('p_nope', { mode: 'set', cords: 1 })).status, 404)
})

test('PIN change: the current dealer PIN is checked; the new driver PIN works, the old one and its sessions do not', async () => {
  await reset()
  const dealer = await signin('1357')
  const driver = await signin('2580')
  const change = (body) => put('/api/dealer/pin', body, dealer)
  let r = await change({ which: 'driver', current_dealer_pin: '9999', new_pin: '4455' })
  assert.deepEqual([r.status, r.body.code, r.body.field], [401, 'unauthorized', 'current_dealer_pin'])
  assert.equal((await change({ which: 'driver', current_dealer_pin: '1357', new_pin: '12' })).body.field, 'new_pin')
  assert.equal((await change({ which: 'driver', current_dealer_pin: '1357', new_pin: '1357' })).body.field, 'new_pin')
  assert.equal((await change({ which: 'boss', current_dealer_pin: '1357', new_pin: '4455' })).body.field, 'which')
  r = await change({ which: 'driver', current_dealer_pin: '1357', new_pin: '4455' })
  assert.deepEqual([r.status, r.body], [200, { changed: 'driver' }])
  assert.equal((await call('GET', '/api/driver/day', { token: driver })).status, 401, 'the old driver session ended')
  assert.equal((await call('POST', '/api/signin', { body: { pin: '2580' } })).status, 401)
  assert.equal((await call('POST', '/api/signin', { body: { pin: '4455' } })).body.role, 'driver')
  r = await change({ which: 'dealer', current_dealer_pin: '1357', new_pin: '8642' })
  assert.equal(r.status, 200)
  assert.equal((await call('GET', '/api/dealer/board', { token: dealer })).status, 200, 'the dealer who changed it stays signed in')
  assert.equal((await call('POST', '/api/signin', { body: { pin: '1357' } })).status, 401)
  assert.equal((await call('POST', '/api/signin', { body: { pin: '8642' } })).body.role, 'dealer')
})

// ---------------- rate guards ----------------

test('sign-in guard: 5 wrong PINs from one place → 429, then even the right PIN; another place and 16 minutes later are fine', async () => {
  await reset()
  const from = (ip, pin, now = T0) => call('POST', '/api/signin', { body: { pin }, now, headers: { 'X-Test-IP': ip } })
  for (let i = 0; i < 5; i++) assert.equal((await from('phone-a', '0000')).status, 401, `wrong try ${i + 1}`)
  const locked = await from('phone-a', '1357')
  assert.deepEqual(
    [locked.status, locked.body.code, locked.body.error],
    [429, 'rate_limited', 'Too many tries. Wait 15 minutes and try again.'],
  )
  assert.equal((await from('phone-b', '1357')).status, 200)
  assert.equal((await from('phone-a', '1357', minutesAfter(T0, 14))).status, 429)
  assert.equal((await from('phone-a', '1357', minutesAfter(T0, 16))).status, 200)
  for (let i = 0; i < 6; i++) assert.equal((await from('phone-c', '2580')).status, 200, 'right PINs never lock anyone out')
})

test('order guard: 10 orders an hour from one place, the 11th is 429; refused requests, phone orders and other places do not count', async () => {
  await reset()
  const dealer = await signin('1357')
  const from = (ip, over = {}, now = T0) => call('POST', '/api/orders', { body: orderBody(over), now, headers: { 'X-Test-IP': ip } })
  assert.equal((await from('house-a', { qty: 0 })).status, 400)
  for (let i = 0; i < 10; i++) assert.equal((await from('house-a')).status, 201, `order ${i + 1}`)
  const r = await from('house-a')
  assert.deepEqual([r.status, r.body.code], [429, 'rate_limited'])
  assert.equal((await from('house-b')).status, 201)
  const phone = await call('POST', '/api/dealer/orders', { token: dealer, body: orderBody(), headers: { 'X-Test-IP': 'house-a' } })
  assert.equal(phone.status, 201)
  assert.equal((await from('house-a', {}, minutesAfter(T0, 61))).status, 201)
})

// ---------------- totals and CSV ----------------

test('totals: HST and totals equal row sums, zero months present, NL month boundary (Oct 1 02:00 UTC counts in September)', async () => {
  await reset()
  const dealer = await signin('1357')
  const driver = await signin('2580')
  // Sep 15: 1 cord to King's Point, 325.00 + HST 48.75 = 373.75, cash in full at the door
  const a = await scheduled(dealer, {}, TUE)
  const sep15 = '2026-09-15T17:00:00.000Z'
  assert.equal((await checkin(driver, a.id, { method: 'cash' }, { at: sep15, now: sep15 })).status, 201)
  // Sep 30 at 11:30 PM in St. John's = Oct 1 02:00 UTC: 14 bags to Little Bay, 136.86 + HST 20.529 → 20.53 = 157.39, owes
  const b = await scheduled(dealer, { product_id: 'p_pellets', unit: 'bag', qty: 14, place: 'Little Bay' }, '2026-09-30')
  // the morning driver token (14 days) ran out on Sep 28: the driver signed in again that week
  const driverLate = await signin('2580', '2026-09-30T12:00:00.000Z')
  const late = await checkin(driverLate, b.id, { method: 'owes' }, { at: '2026-10-01T02:00:00.000Z', now: '2026-10-01T02:05:00.000Z' })
  assert.equal(late.status, 201, JSON.stringify(late.body))
  assert.equal(late.body.order.delivered_label, 'Delivered Wednesday, September 30 at 11:30 PM')
  // October: no deliveries, one cheque on account (no order) for b's customer
  const oct = '2026-10-25T12:00:00.000Z'
  const dealerOct = await signin('1357', oct)
  const driverOct = await signin('2580', oct)
  const bCustomer = await customerOf(dealer, b.id)
  assert.equal(
    (await pay(dealerOct, { customer_id: bCustomer, amount_cents: 5000, method: 'cheque', date: '2026-10-10' }, oct)).status,
    201,
  )
  // Nov 3: half a cord of birch to St. Patrick's, 200.00 + HST 30.00 = 230.00, e-Transfer of 100.00 at the door
  const c = await call('POST', '/api/orders', {
    now: oct,
    body: orderBody({ product_id: 'p_birch_dry', unit: 'half_cord', place: "St. Patrick's" }),
  })
  assert.equal(c.status, 201, JSON.stringify(c.body))
  const sch = await call('POST', `/api/dealer/orders/${c.body.id}/schedule`, { token: dealerOct, now: oct, body: { date: '2026-11-03' } })
  assert.equal(sch.status, 200, JSON.stringify(sch.body))
  const nov3 = '2026-11-03T15:00:00.000Z'
  assert.equal((await checkin(driverOct, c.body.id, { method: 'etransfer', amount_cents: 10000 }, { at: nov3, now: nov3 })).status, 201)

  const nov = '2026-11-20T12:00:00.000Z'
  const dealerNov = await signin('1357', nov)
  const t = await call('GET', '/api/dealer/totals?season=2026', { token: dealerNov, now: nov })
  assert.equal(t.status, 200, JSON.stringify(t.body))
  assert.deepEqual(t.body.season, { year: 2026, from: '2026-09-01', to: '2027-08-31', label: '2026–27 season' })
  const row = (month, label, delivered, goods, stacking, delivery, subtotal, hst, total, payments) => ({
    month,
    label,
    delivered,
    goods_cents: goods,
    stacking_cents: stacking,
    delivery_cents: delivery,
    subtotal_cents: subtotal,
    hst_cents: hst,
    total_cents: total,
    payments_cents: payments,
  })
  assert.deepEqual(t.body.months, [
    row('2026-09', 'September 2026', 2, 30000 + 11186, 0, 2500 + 2500, 32500 + 13686, 4875 + 2053, 37375 + 15739, 37375),
    row('2026-10', 'October 2026', 0, 0, 0, 0, 0, 0, 0, 5000),
    row('2026-11', 'November 2026', 1, 20000, 0, 0, 20000, 3000, 23000, 10000),
  ])
  for (const k of [
    'delivered',
    'goods_cents',
    'stacking_cents',
    'delivery_cents',
    'subtotal_cents',
    'hst_cents',
    'total_cents',
    'payments_cents',
  ]) {
    assert.equal(
      t.body.totals[k],
      t.body.months.reduce((sum, m) => sum + m[k], 0),
      `totals.${k} is the sum of the rows`,
    )
  }
  for (const m of t.body.months) assert.equal(m.total_cents, m.subtotal_cents + m.hst_cents)
  assert.equal(t.body.totals.hst_cents, 4875 + 2053 + 3000)
  // owing now: b 157.39 (the cheque was on account, not on the order) + c 130.00
  assert.equal(t.body.totals.owing_cents, 15739 + 13000)

  assert.equal((await call('GET', '/api/dealer/totals', { token: dealerNov, now: nov })).body.season.year, 2026)
  const before = await call('GET', '/api/dealer/totals?season=2025', { token: dealer })
  assert.deepEqual([before.body.months.length, before.body.months[0].month, before.body.totals.delivered], [12, '2025-09', 0])
  assert.equal((await call('GET', '/api/dealer/totals?season=abc', { token: dealer })).body.field, 'season')
})

test('CSV exports: header exact, CRLF, quoting, formula guard, filename, money as 123.45', async () => {
  await reset()
  const dealer = await signin('1357')
  const driver = await signin('2580')
  const a = await scheduled(dealer, { name: 'Smith, "Junior" (SAMPLE)', phone: '709-555-0161' }, TUE)
  const b = await scheduled(
    dealer,
    { name: '=SUM(A1) (SAMPLE)', phone: '709-555-0162', place: "St. Patrick's", address: 'Up the hill\nleft at the pond' },
    TUE,
  )
  assert.equal((await checkin(driver, a.id, { method: 'cash' })).status, 201)
  const t1 = minutesAfter(T0, 1)
  assert.equal((await checkin(driver, b.id, { method: 'etransfer', amount_cents: 10000 }, { at: t1, now: t1 })).status, 201)
  const cust = await customerOf(dealer, b.id)
  const cheque = await pay(
    dealer,
    { customer_id: cust, order_id: b.id, amount_cents: 5000, method: 'cheque', note: '+ extra' },
    minutesAfter(T0, 2),
  )
  assert.equal(cheque.status, 201)

  const orders = await call('GET', '/api/dealer/export/orders.csv?season=2026', { token: dealer })
  assert.equal(orders.status, 200)
  assert.equal(orders.headers.get('content-type'), 'text/csv; charset=utf-8')
  assert.equal(orders.headers.get('content-disposition'), 'attachment; filename="firewood-orders-2026-orders.csv"')
  const ot = text(orders.body)
  assert.deepEqual(ot.split('\r\n'), [
    'Order,Delivered,Customer,Phone,Address,Product,Quantity,Goods,Stacking,Delivery,Subtotal,HST,Total,Paid,Owing,Door payment',
    `${a.id},2026-09-14,"Smith, ""Junior"" (SAMPLE)",709-555-0161,Up the lane past the church,"Mixed softwood, dry",1 cord,` +
      '300.00,0.00,25.00,325.00,48.75,373.75,373.75,0.00,Cash',
    `${b.id},2026-09-14,'=SUM(A1) (SAMPLE),709-555-0162,"Up the hill\nleft at the pond","Mixed softwood, dry",1 cord,` +
      '300.00,0.00,0.00,300.00,45.00,345.00,150.00,195.00,e-Transfer',
    '',
  ])
  const payments = await call('GET', '/api/dealer/export/payments.csv?season=2026', { token: dealer })
  assert.equal(payments.headers.get('content-disposition'), 'attachment; filename="firewood-orders-2026-payments.csv"')
  assert.deepEqual(text(payments.body).split('\r\n'), [
    'Date,Customer,Phone,Order,Method,Amount,Note',
    `2026-09-14,"Smith, ""Junior"" (SAMPLE)",709-555-0161,${a.id},Cash,373.75,`,
    `2026-09-14,'=SUM(A1) (SAMPLE),709-555-0162,${b.id},e-Transfer,100.00,`,
    `2026-09-14,'=SUM(A1) (SAMPLE),709-555-0162,${b.id},Cheque,50.00,'+ extra`,
    '',
  ])
  const empty = await call('GET', '/api/dealer/export/orders.csv?season=2025', { token: dealer })
  assert.equal(
    text(empty.body),
    'Order,Delivered,Customer,Phone,Address,Product,Quantity,Goods,Stacking,Delivery,Subtotal,HST,Total,Paid,Owing,Door payment\r\n',
  )
  assert.equal((await call('GET', '/api/dealer/export/orders.csv', { token: driver })).status, 403)
})

// ---------------- demo seed ----------------

test('demo seed: 12 SAMPLE customers, every status, a day at 4.00 of 4.50 cords, two photos, paid and owing, September totals', async () => {
  const r = await call('POST', '/api/test/seed', { body: { scenario: 'demo' } })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual([r.body.seeded, r.body.today, r.body.customers, r.body.busy_day], [true, '2026-09-14', 12, WED])
  assert.match(r.body.status_url, /^\/o\/\?t=[A-Za-z0-9_-]{32,}$/)
  const status = await call('GET', `/api/o/${r.body.status_url.slice('/o/?t='.length)}`)
  assert.equal(status.body.order.status_label, 'Scheduled for Wednesday, September 16')
  const dealer = await signin('1357')
  const customers = (await call('GET', '/api/dealer/customers', { token: dealer })).body.customers
  assert.equal(customers.length, 12)
  assert.ok(customers.every((c) => c.name.endsWith('(SAMPLE)')))
  assert.ok(
    customers.some((c) => c.balance_cents < 0),
    'a credit',
  )
  const board = (await call('GET', '/api/dealer/board', { token: dealer })).body
  assert.deepEqual(board.counts, { new: 4, scheduled: 8, delivered: 7, owing: 3, cancelled: 1 })
  const statuses = new Set([...board.new, ...board.scheduled, ...board.delivered].map((o) => o.status))
  assert.deepEqual([...statuses].sort(), ['delivered', 'out_for_delivery', 'requested', 'scheduled'])
  assert.ok(board.delivered.some((o) => o.owing_cents === 0) && board.delivered.some((o) => o.owing_cents > 0))
  const dates = [...board.delivered, ...board.scheduled].map((o) => o.delivery_date).sort()
  assert.ok(dates[0] >= '2026-09-04' && dates.at(-1) <= '2026-09-21', dates.join(' '))
  const days = (await call('GET', '/api/dealer/days', { token: dealer })).body.days
  const wed = days.find((d) => d.date === WED)
  assert.deepEqual([wed.wood.used_cords, wed.wood.cap_cords, wed.orders, wed.over], [4, 4.5, 4, false])
  const withPhoto = board.delivered.filter((o) => o.has_photo)
  assert.equal(withPhoto.length, 2)
  for (const o of withPhoto) {
    const img = await call('GET', `/api/photos/${o.token}`)
    assert.equal(img.headers.get('content-type'), 'image/png')
    assert.deepEqual([...img.body.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  }
  // stock went down only by what was delivered: softwood 1 cord + 1 load (1.5), birch 2 face cords + half a cord,
  // green 1 cord, pellets 1 ton (50) + 1 skid (70)
  assert.equal((await stock('p_softwood_dry', dealer)).stock_cu_in, 40 * CORD - CORD - CORD * 1.5)
  assert.equal((await stock('p_birch_dry', dealer)).stock_cu_in, 12 * CORD - 2 * 73728 - CORD / 2)
  assert.equal((await stock('p_softwood_green', dealer)).stock_cu_in, 25 * CORD - CORD)
  assert.equal((await stock('p_pellets', dealer)).stock_bags, 600 - 50 - 70)
  const t = (await call('GET', '/api/dealer/totals?season=2026', { token: dealer })).body
  assert.deepEqual([t.months[0].month, t.months[0].delivered], ['2026-09', 7])
  assert.ok(t.months[0].total_cents > 0 && t.totals.payments_cents > 0 && t.totals.owing_cents > 0)
  assert.equal((await call('POST', '/api/test/seed', { body: { scenario: 'party' } })).body.field, 'scenario')
})

// ---------------- fo2's cross-review of M1 ----------------

test('quote without a pin: goods and stacking, the money that needs a pin is null; below the minimum still refused', async () => {
  await reset()
  const q = (body) => call('POST', '/api/quote', { body })
  let r = await q({ product_id: 'p_birch_dry', unit: 'face_cord', qty: 3, stacking: true })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual(r.body, {
    product_label: 'Birch, dry',
    qty_label: '3 face cords',
    explain: 'A face cord: one row 4 feet high and 8 feet long, as deep as the pieces are long (16 inches). That is 0.33 of a full cord.',
    wood_cu_in: CORD,
    pellet_bags: 0,
    distance_km: null,
    goods_cents: 42000,
    stacking_cents: 6000,
    delivery_cents: null,
    subtotal_cents: null,
    hst_cents: null,
    total_cents: null,
  })
  r = await q({ product_id: 'p_birch_dry', unit: 'face_cord', qty: 3, lat: null, lng: null, delivery_cents: 1000 })
  assert.deepEqual([r.status, r.body.distance_km, r.body.delivery_cents, r.body.total_cents], [200, null, null, null])
  r = await q({ product_id: 'p_pellets', unit: 'bag', qty: 13 })
  assert.deepEqual([r.status, r.body.code, r.body.field], [400, 'below_minimum', 'qty'])
  r = await q({ product_id: 'p_softwood_dry', unit: 'cord', qty: 1, lat: 49.5 })
  assert.deepEqual([r.status, r.body.field], [400, 'pin'], 'half a pin is not no pin')
  const noPin = orderBody()
  delete noPin.lat
  delete noPin.lng
  r = await call('POST', '/api/orders', { body: noPin })
  assert.deepEqual([r.status, r.body.field], [400, 'pin'], 'an order still needs the pin')
})

test('quote with a delivery_cents override skips the band lookup, even past the last band; the override is 0 to 50 000', async () => {
  await reset()
  const dealer = await signin('1357')
  const bu = place('Buchans')
  const q = (extra) =>
    call('POST', '/api/quote', { body: { product_id: 'p_softwood_dry', unit: 'cord', qty: 1, lat: bu.lat, lng: bu.lng, ...extra } })
  assert.equal((await q({})).body.code, 'outside_area')
  let r = await q({ delivery_cents: 1000 })
  // 300.00 + 10.00 = 310.00; HST 46.50; total 356.50
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual([r.body.delivery_cents, r.body.subtotal_cents, r.body.hst_cents, r.body.total_cents], [1000, 31000, 4650, 35650])
  assert.ok(r.body.distance_km > 60)
  const kp = place("King's Point")
  r = await call('POST', '/api/quote', {
    body: { product_id: 'p_softwood_dry', unit: 'cord', qty: 1, lat: kp.lat, lng: kp.lng, delivery_cents: 0 },
  })
  assert.deepEqual([r.body.delivery_cents, r.body.total_cents], [0, 34500])
  assert.equal((await q({ delivery_cents: 50000 })).status, 200)
  r = await q({ delivery_cents: 50001 })
  assert.deepEqual([r.status, r.body.field, r.body.error], [400, 'delivery_cents', 'Enter a delivery fee from $0.00 to $500.00.'])
  r = await call('POST', '/api/dealer/orders', { token: dealer, body: orderBody({ place: 'Buchans', delivery_cents: 50001 }) })
  assert.deepEqual([r.status, r.body.field, r.body.error], [400, 'delivery_cents', 'Enter a delivery fee from $0.00 to $500.00.'])
  // the public order route ignores an override
  r = await call('POST', '/api/orders', { body: orderBody({ place: 'Buchans', delivery_cents: 1000 }) })
  assert.equal(r.body.code, 'outside_area')
})

test('over-capacity wording names the limit that is exceeded: bags when only pellets are short, cords when wood is (or both are)', async () => {
  await reset()
  const dealer = await signin('1357')
  const schedule = (id, date) => call('POST', `/api/dealer/orders/${id}/schedule`, { token: dealer, body: { date } })
  // Tuesday: 3 skids, then the truck drops to 2 skids (140 bags). A cord still fits the wood but the day is over on bags.
  for (let i = 0; i < 3; i++) await scheduled(dealer, { product_id: 'p_pellets', unit: 'skid', qty: 1 }, TUE)
  assert.equal((await put('/api/dealer/settings', { truck: { ...TR, pellet_skids_per_day: 2 } }, dealer)).status, 200)
  let r = await schedule((await order()).id, TUE)
  assert.deepEqual(
    [r.status, r.body.error],
    [409, "That's more than the truck can carry that day: 210 of 140 bags already planned, this order needs 0."],
  )
  // Wednesday: 4 cords, then the truck drops to 3 cords. Pellets fit the bags but the day is over on wood.
  for (let i = 0; i < 4; i++) await scheduled(dealer, {}, WED)
  assert.equal(
    (await put('/api/dealer/settings', { truck: { ...TR, wood_cords_per_day: 3, pellet_skids_per_day: 2 } }, dealer)).status,
    200,
  )
  const bags = await order({ product_id: 'p_pellets', unit: 'bag', qty: 14 })
  r = await schedule(bags.id, WED)
  assert.deepEqual(
    [r.status, r.body.error],
    [409, "That's more than the truck can carry that day: 4.00 of 3.00 cords already planned, this order needs 0.00."],
  )
  // both short (no skids at all): cords
  assert.equal(
    (await put('/api/dealer/settings', { truck: { ...TR, wood_cords_per_day: 3, pellet_skids_per_day: 0 } }, dealer)).status,
    200,
  )
  r = await schedule(bags.id, WED)
  assert.equal(r.body.error, "That's more than the truck can carry that day: 4.00 of 3.00 cords already planned, this order needs 0.00.")
})

test('schedule: an unknown order is 404, whatever the date', async () => {
  await reset()
  const dealer = await signin('1357')
  for (const date of [SUN, TUE, 'not-a-date']) {
    const r = await call('POST', '/api/dealer/orders/o_nope/schedule', { token: dealer, body: { date } })
    assert.deepEqual([r.status, r.body.code], [404, 'not_found'], date)
  }
})

// ---------------- fo2's M3 open items ----------------

test('ledger entries carry order_id and payment_id: null payment_id on orders, null order_id on a payment on account', async () => {
  await reset()
  const dealer = await signin('1357')
  const o = await order()
  const cust = await customerOf(dealer, o.id)
  const onOrder = await pay(dealer, { customer_id: cust, order_id: o.id, amount_cents: 10000, method: 'etransfer' }, minutesAfter(T0, 1))
  const onAccount = await pay(dealer, { customer_id: cust, amount_cents: 2500, method: 'cash', note: 'On account' }, minutesAfter(T0, 2))
  const l = await call('GET', `/api/dealer/customers/${cust}/ledger`, { token: dealer })
  assert.equal(l.status, 200)
  assert.deepEqual(
    l.body.entries.map((e) => [e.kind, e.order_id, e.payment_id, e.charge_cents, e.payment_cents, e.balance_cents]),
    [
      ['order', o.id, null, 37375, 0, 37375],
      ['payment', o.id, onOrder.body.payment.id, 0, 10000, 27375],
      ['payment', null, onAccount.body.payment.id, 0, 2500, 24875],
    ],
  )
  // the id is what the ledger needs to void a payment made on account
  assert.equal((await call('DELETE', `/api/dealer/payments/${l.body.entries[2].payment_id}`, { token: dealer })).status, 200)
  assert.equal((await call('GET', `/api/dealer/customers/${cust}/ledger`, { token: dealer })).body.balance_cents, 27375)
})

test('owing_label: a cancelled order with nothing paid says "Nothing owing"; with a deposit it is a credit; a paid order is "Paid in full"', async () => {
  await reset()
  const dealer = await signin('1357')
  const a = await order()
  assert.equal((await call('POST', `/api/o/${a.token}/cancel`)).status, 200)
  let s = (await call('GET', `/api/o/${a.token}`)).body.order
  assert.deepEqual([s.status, s.owing_cents, s.owing_label], ['cancelled', 0, 'Nothing owing'])

  const b = await scheduled(dealer, {}, TUE)
  await pay(dealer, { customer_id: await customerOf(dealer, b.id), order_id: b.id, amount_cents: 5000, method: 'cash' })
  assert.equal((await call('POST', `/api/dealer/orders/${b.id}/cancel`, { token: dealer })).status, 200)
  s = (await call('GET', `/api/o/${b.token}`)).body.order
  assert.deepEqual([s.owing_cents, s.owing_label], [-5000, 'Credit $50.00'])

  const c = await order()
  await pay(dealer, { customer_id: await customerOf(dealer, c.id), order_id: c.id, amount_cents: 37375, method: 'cash' })
  s = (await call('GET', `/api/o/${c.token}`)).body.order
  assert.deepEqual([s.status, s.owing_cents, s.owing_label], ['requested', 0, 'Paid in full'])
})
