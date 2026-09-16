// Money: goods, stacking, delivery bands and zones, HST, minimum order, and balances to the cent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  customerBalance,
  deliveryCents,
  formatMoney,
  goodsCents,
  hstCents,
  owingCents,
  owingLabel,
  paidCents,
  priceOrder,
  stackingCents,
} from '../src/money.js'
import { SAMPLE_PLACES } from '../src/sample-places.js'
import { SAMPLE_SETTINGS } from '../src/sample.js'

const BANDS = SAMPLE_SETTINGS.delivery
const birch = {
  kind: 'wood',
  name: 'Birch, dry',
  cut_in: 16,
  stacking_cents_per_cord: 6000,
  price_cents: { cord: 37500, half_cord: 20000, face_cord: 14000, load: null },
}
const settings = { ...SAMPLE_SETTINGS, load_cu_in: 331776 }
const place = (name) => SAMPLE_PLACES.find((p) => p.name === name)

test('goods = price × qty; a null price is not offered', () => {
  assert.equal(goodsCents(birch, 'face_cord', 3), 42000)
  assert.equal(goodsCents(birch, 'cord', 20), 750000)
  assert.throws(() => goodsCents(birch, 'load', 1), { code: 'not_offered', extra: { field: 'unit' } })
})

test('stacking is half-up per cubic inch', () => {
  // 6 500 × 73 728 / 221 184 = 2 166.67 → 2 167
  assert.equal(stackingCents(6500, 73728), 2167)
  // 6 000 on a 16-inch face cord = exactly 2 000
  assert.equal(stackingCents(6000, 73728), 2000)
  // 1 000 on a face cord = 333.33 → 333; on two = 666.67 → 667
  assert.equal(stackingCents(1000, 73728), 333)
  assert.equal(stackingCents(1000, 147456), 667)
  // exactly half a cent rounds up: 1 ¢/cord on half a cord = 0.5 → 1
  assert.equal(stackingCents(1, 110592), 1)
})

test('delivery bands: the edge belongs to the lower band; past the last band is outside the area', () => {
  assert.equal(deliveryCents(BANDS, 0, null), 0)
  assert.equal(deliveryCents(BANDS, 10.0, null), 0)
  assert.equal(deliveryCents(BANDS, 10.01, null), 2500)
  assert.equal(deliveryCents(BANDS, 30, null), 2500)
  assert.equal(deliveryCents(BANDS, 60, null), 5000)
  assert.throws(() => deliveryCents(BANDS, 60.01, null), {
    code: 'outside_area',
    status: 400,
    extra: { field: 'pin' },
    message: "That's farther than we deliver. Call us at 709-555-0100 and we'll see what we can do.",
  })
  // bands out of order are sorted by up_to_km first
  const shuffled = { ...BANDS, bands: [BANDS.bands[2], BANDS.bands[0], BANDS.bands[1]] }
  assert.equal(deliveryCents(shuffled, 12, null), 2500)
})

test('zones: the chosen zone fee; no zone is a field error', () => {
  const zones = {
    mode: 'zones',
    bands: [],
    beyond_message: '',
    zones: [
      { id: 'z_town', name: 'Springdale', fee_cents: 0 },
      { id: 'z_bay', name: 'Halls Bay', fee_cents: 3500 },
    ],
  }
  assert.equal(deliveryCents(zones, 999, 'z_bay'), 3500)
  assert.equal(deliveryCents(zones, 0, 'z_town'), 0)
  assert.throws(() => deliveryCents(zones, 0, 'z_nowhere'), { code: 'bad_request', extra: { field: 'zone_id' } })
})

test('HST 15 % half-up per order', () => {
  assert.equal(hstCents(33310, true), 4997) // 4 996.5 → 4 997
  assert.equal(hstCents(10, true), 2) // 1.5 → 2
  assert.equal(hstCents(9, true), 1) // 1.35 → 1
  assert.equal(hstCents(13686, true), 2053) // 2 052.9 → 2 053
  assert.equal(hstCents(32500, true), 4875)
  assert.equal(hstCents(33310, false), 0)
})

test('minimum order: at the line passes, a cent below refuses', () => {
  const p = {
    kind: 'pellets',
    name: 'Test pellets',
    bag_lb: 40,
    bags_per_ton: 50,
    bags_per_skid: 70,
    price_cents: { bag: 5500, ton: null, skid: null },
  }
  const at = { product: p, unit: 'bag', qty: 2, stacking: false, lat: place('Springdale').lat, lng: place('Springdale').lng }
  assert.equal(priceOrder(at, settings).goods_cents, 11000)
  const below = { ...at, product: { ...p, price_cents: { bag: 10999, ton: null, skid: null } }, qty: 1 }
  assert.equal(priceOrder({ ...below, product: { ...p, price_cents: { bag: 11000, ton: null, skid: null } } }, settings).goods_cents, 11000)
  assert.throws(() => priceOrder(below, settings), {
    code: 'below_minimum',
    extra: { field: 'qty' },
    message: 'The smallest order we deliver is $110.00 before delivery.',
  })
  // stacking counts toward the minimum
  const small = {
    kind: 'wood',
    name: 'Kindling',
    cut_in: 16,
    stacking_cents_per_cord: 6000,
    price_cents: { cord: null, half_cord: null, face_cord: 9000, load: null },
  }
  const face = { product: small, unit: 'face_cord', qty: 1, lat: at.lat, lng: at.lng }
  assert.throws(() => priceOrder({ ...face, stacking: false }, settings), { code: 'below_minimum' })
  assert.equal(priceOrder({ ...face, stacking: true }, settings).subtotal_cents, 9000 + 2000) // 11 000: at the line
})

test("a whole quote: 1 cord of dry softwood to King's Point", () => {
  const soft = {
    kind: 'wood',
    name: 'Mixed softwood, dry',
    cut_in: 16,
    stacking_cents_per_cord: 6000,
    price_cents: { cord: 30000, half_cord: 17000, face_cord: 12000, load: 42000 },
  }
  const kp = place("King's Point")
  const q = priceOrder({ product: soft, unit: 'cord', qty: 1, stacking: false, lat: kp.lat, lng: kp.lng }, settings)
  assert.deepEqual(q, {
    product_label: 'Mixed softwood, dry',
    qty_label: '1 cord',
    explain: 'A full cord: a stack 4 feet high, 4 feet wide and 8 feet long (128 cubic feet).',
    wood_cu_in: 221184,
    pellet_bags: 0,
    distance_km: 12.9,
    goods_cents: 30000,
    stacking_cents: 0,
    delivery_cents: 2500,
    subtotal_cents: 32500,
    hst_cents: 4875,
    total_cents: 37375,
  })
})

test('money text', () => {
  assert.equal(formatMoney(123456), '$1,234.56')
  assert.equal(formatMoney(5), '$0.05')
  assert.equal(formatMoney(100000000), '$1,000,000.00')
  assert.equal(formatMoney(-2000), '-$20.00')
  assert.equal(owingLabel(12000), 'Balance owing $120.00')
  assert.equal(owingLabel(0), 'Paid in full')
  assert.equal(owingLabel(-2000), 'Credit $20.00')
})

// A small seeded generator so every run checks the same 300 ledgers.
function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('owing to the cent on 300 seeded random ledgers', () => {
  const rand = mulberry32(20260914)
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))
  const STATUSES = ['requested', 'scheduled', 'out_for_delivery', 'delivered', 'cancelled']
  for (let ledger = 0; ledger < 300; ledger++) {
    const orders = []
    for (let i = 0, n = int(0, 6); i < n; i++) {
      orders.push({ id: `o_${ledger}_${i}`, status: STATUSES[int(0, 4)], total_cents: int(1, 400000) })
    }
    const payments = []
    for (let i = 0, n = int(0, 8); i < n; i++) {
      const onOrder = orders.length && rand() < 0.75
      payments.push({
        order_id: onOrder ? orders[int(0, orders.length - 1)].id : null,
        amount_cents: int(1, 300000),
        voided: rand() < 0.2 ? 1 : 0,
      })
    }

    // Written out independently: walk the rows by hand.
    let expectedBalance = 0
    for (const o of orders) {
      let paidOnThis = 0
      for (const p of payments) {
        if (p.order_id === o.id && p.voided === 0) paidOnThis = paidOnThis + p.amount_cents
      }
      let charge = o.total_cents
      if (o.status === 'cancelled') charge = 0
      assert.equal(paidCents(o.id, payments), paidOnThis, `ledger ${ledger} order ${o.id} paid`)
      assert.equal(owingCents(o, payments), charge - paidOnThis, `ledger ${ledger} order ${o.id} owing`)
      expectedBalance = expectedBalance + charge
    }
    for (const p of payments) {
      if (p.voided === 0) expectedBalance = expectedBalance - p.amount_cents
    }
    assert.equal(customerBalance(orders, payments), expectedBalance, `ledger ${ledger} balance`)
    assert.ok(Number.isInteger(customerBalance(orders, payments)))
  }
})

test('without a pin: goods and stacking only, never a guessed delivery or total; the minimum still applies', () => {
  const soft = {
    kind: 'wood',
    name: 'Mixed softwood, dry',
    cut_in: 16,
    stacking_cents_per_cord: 6000,
    price_cents: { cord: 30000, half_cord: 17000, face_cord: 12000, load: 42000 },
  }
  const q = priceOrder({ product: soft, unit: 'cord', qty: 1, stacking: true, lat: null, lng: null }, settings)
  assert.deepEqual(
    [q.wood_cu_in, q.distance_km, q.goods_cents, q.stacking_cents, q.delivery_cents, q.subtotal_cents, q.hst_cents, q.total_cents],
    [221184, null, 30000, 6000, null, null, null, null],
  )
  // a fee override does not make a pin up either
  const o = priceOrder({ product: soft, unit: 'cord', qty: 1, lat: null, lng: null, delivery_override: 1000 }, settings)
  assert.deepEqual([o.delivery_cents, o.total_cents], [null, null])
  assert.throws(
    () => priceOrder({ product: soft, unit: 'face_cord', qty: 1, lat: null, lng: null }, { ...settings, min_order_cents: 12001 }),
    { code: 'below_minimum' },
  )
})

test('owing labels: a cancelled order with nothing paid is "Nothing owing", never "Paid in full"', () => {
  assert.equal(owingLabel(0, { cancelled: true }), 'Nothing owing')
  assert.equal(owingLabel(0), 'Paid in full')
  assert.equal(owingLabel(0, { cancelled: false }), 'Paid in full')
  assert.equal(owingLabel(-5000, { cancelled: true }), 'Credit $50.00')
  assert.equal(owingLabel(100, { cancelled: true }), 'Balance owing $1.00')
})
