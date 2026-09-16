// POST /api/test/seed { scenario: "demo" } (TEST_MODE only): a SAMPLE fortnight around today, written after a reset.
// 12 SAMPLE customers at SAMPLE places (small fixed offsets, no house numbers); orders from 10 days ago to 7 days ahead
// in every status; one day planned at exactly 4.00 of 4.50 cords; some paid, some owing, one credit; two delivered orders
// with a placeholder photo that says SAMPLE. Stock, stock moves and check-ins are consistent with the deliveries.
import { randomToken } from './auth.js'
import { priceOrder } from './money.js'
import { samplePng } from './png.js'
import { optimizeRoute } from './route.js'
import { SAMPLE_PLACES } from './sample-places.js'
import { addDays, isoWeekday, nlDate } from './time.js'
import { loadProducts, loadSettings } from './views.js'

export const SEED_PEOPLE = [
  ['Wade R. (SAMPLE)', "King's Point"],
  ['Mary O. (SAMPLE)', 'South Brook'],
  ['Gord P. (SAMPLE)', "Robert's Arm"],
  ['Lorraine B. (SAMPLE)', "Pilley's Island"],
  ['Kevin H. (SAMPLE)', 'Little Bay'],
  ['Donna W. (SAMPLE)', 'Beachside'],
  ['Barry S. (SAMPLE)', "St. Patrick's"],
  ['Joan T. (SAMPLE)', "Harry's Harbour"],
  ['Clarence F. (SAMPLE)', 'Middle Arm'],
  ['Sheila M. (SAMPLE)', "Jackson's Cove"],
  ['Darrell K. (SAMPLE)', 'Sheppardville'],
  ['Patsy N. (SAMPLE)', 'Triton'],
]
const SPOTS = ['Up the lane past the church', 'Off the main road, by the big spruce', 'Near the wharf road']
const DUMPS = ['By the shed, not on the lawn', 'Back of the driveway, left side', 'Beside the old woodpile']
const LAT_OFF = [0.0021, -0.0017, 0.0009]
const LNG_OFF = [-0.0026, 0.0018, 0.0031]

const atMinutes = (date, minutes) => new Date(Date.parse(`${date}T00:00:00.000Z`) + minutes * 60e3).toISOString()

export async function seedDemo(c) {
  const s = await loadSettings(c.db)
  const products = await loadProducts(c.db)
  const wd = s.delivery_weekdays
  const onOrBefore = (d) => {
    while (!wd.includes(isoWeekday(d))) d = addDays(d, -1)
    return d
  }
  const onOrAfter = (d) => {
    while (!wd.includes(isoWeekday(d))) d = addDays(d, 1)
    return d
  }
  const today = c.today
  const todayDelivers = wd.includes(isoWeekday(today))
  const tomorrow = onOrAfter(addDays(today, 1))
  const busy = onOrAfter(addDays(tomorrow, 1)) // the day at 4.00 of 4.50 cords
  const later = onOrAfter(addDays(busy, 2))
  const ago = (n) => onOrBefore(addDays(today, -n))

  const customers = SEED_PEOPLE.map(([name, placeName], i) => {
    const pl = SAMPLE_PLACES.find((p) => p.name === placeName)
    return {
      id: `c_seed${String(i + 1).padStart(2, '0')}`,
      name,
      phone: `709-555-01${20 + i}`,
      lat: Math.round((pl.lat + LAT_OFF[i % 3]) * 1e6) / 1e6,
      lng: Math.round((pl.lng + LNG_OFF[i % 3]) * 1e6) / 1e6,
      address: `${SPOTS[i % 3]}, ${placeName}`,
      dump_notes: DUMPS[i % 3],
    }
  })

  const W = 'p_softwood_dry'
  const B = 'p_birch_dry'
  const G = 'p_softwood_green'
  const P = 'p_pellets'
  const plan = [
    { who: 0, p: W, unit: 'cord', qty: 1, status: 'delivered', date: ago(10), door: { method: 'cash' } },
    { who: 1, p: B, unit: 'face_cord', qty: 2, stacking: true, status: 'delivered', date: ago(9), door: { method: 'etransfer' } },
    { who: 2, p: P, unit: 'ton', qty: 1, status: 'delivered', date: ago(8), door: { method: 'owes' } },
    { who: 3, p: W, unit: 'load', qty: 1, status: 'delivered', date: ago(7), door: { method: 'cash', amount: 20000 } },
    { who: 4, p: B, unit: 'half_cord', qty: 1, status: 'delivered', date: ago(5), door: { method: 'etransfer' }, photo: true },
    {
      who: 5,
      p: G,
      unit: 'cord',
      qty: 1,
      status: 'delivered',
      date: ago(3),
      door: { method: 'owes' },
      photo: true,
      payments: [{ amount: 10000, method: 'etransfer', date: addDays(today, -1), note: 'Part of the balance' }],
    },
    { who: 6, p: P, unit: 'skid', qty: 1, status: 'delivered', date: ago(2), door: { method: 'cash' } },
    {
      who: 7,
      p: W,
      unit: 'cord',
      qty: 1,
      status: todayDelivers ? 'out_for_delivery' : 'scheduled',
      date: todayDelivers ? today : tomorrow,
    },
    {
      who: 8,
      p: W,
      unit: 'half_cord',
      qty: 1,
      status: 'cancelled',
      created: addDays(today, -6),
      payments: [{ amount: 5000, method: 'etransfer', date: addDays(today, -6), note: 'Deposit' }],
    },
    {
      who: 9,
      p: W,
      unit: 'cord',
      qty: 1,
      status: 'scheduled',
      date: busy,
      payments: [{ amount: 10000, method: 'etransfer', date: addDays(today, -1), note: 'Deposit' }],
    },
    { who: 10, p: B, unit: 'cord', qty: 1, status: 'scheduled', date: busy },
    { who: 11, p: W, unit: 'half_cord', qty: 2, status: 'scheduled', date: busy },
    { who: 0, p: W, unit: 'face_cord', qty: 3, status: 'scheduled', date: busy },
    { who: 1, p: P, unit: 'skid', qty: 2, status: 'scheduled', date: later },
    { who: 2, p: G, unit: 'cord', qty: 1, status: 'scheduled', date: later },
    { who: 4, p: B, unit: 'face_cord', qty: 1, stacking: true, status: 'scheduled', date: tomorrow },
    {
      who: 3,
      p: W,
      unit: 'cord',
      qty: 2,
      status: 'requested',
      created: addDays(today, -1),
      preferred: [later, onOrAfter(addDays(later, 1))],
    },
    { who: 5, p: P, unit: 'bag', qty: 20, status: 'requested', created: today },
    { who: 6, p: W, unit: 'load', qty: 1, status: 'requested', created: addDays(today, -2) },
    { who: 7, p: B, unit: 'half_cord', qty: 1, status: 'requested', created: today, preferred: [tomorrow] },
  ]

  const latestCreate = new Date(c.now.getTime() - 30 * 60e3).toISOString()
  const orders = plan.map((e, k) => {
    const cu = customers[e.who]
    const product = products.find((p) => p.id === e.p)
    const q = priceOrder({ product, unit: e.unit, qty: e.qty, stacking: !!e.stacking, lat: cu.lat, lng: cu.lng, zone_id: null }, s)
    const createdDate = e.created ?? (e.date < today ? addDays(e.date, -3) : addDays(today, -2))
    const created = atMinutes(createdDate, 11 * 60 + k)
    const onDay = ['scheduled', 'out_for_delivery', 'delivered'].includes(e.status)
    return {
      plan: e,
      k,
      id: `o_seed${String(k + 1).padStart(2, '0')}`,
      token: randomToken(),
      status: e.status,
      source: k % 3 === 2 ? 'phone' : 'online',
      customer: cu,
      product,
      q,
      lat: cu.lat,
      lng: cu.lng,
      delivery_date: onDay ? e.date : null,
      route_pos: null,
      delivered_at: e.status === 'delivered' ? atMinutes(e.date, 16 * 60 + k * 7) : null,
      created_at: created < latestCreate ? created : latestCreate,
      cancelled_at: e.status === 'cancelled' ? atMinutes(addDays(today, -4), 13 * 60) : null,
    }
  })

  // Route order per day: delivered stops first (in delivery order), then the rest by distance from the last of them.
  for (const date of new Set(orders.filter((o) => o.delivery_date).map((o) => o.delivery_date))) {
    const day = orders.filter((o) => o.delivery_date === date)
    const done = day.filter((o) => o.status === 'delivered').sort((a, b) => (a.delivered_at < b.delivered_at ? -1 : 1))
    const start = done.length ? done[done.length - 1] : s.yard
    const rest = optimizeRoute(
      start,
      day.filter((o) => o.status !== 'delivered'),
      s.yard,
    )
    ;[...done, ...rest].forEach((o, i) => {
      o.route_pos = i + 1
    })
  }

  const db = c.db
  const stmts = customers.map((cu) =>
    db
      .prepare('INSERT INTO customers (id, name, phone, phone_key, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(cu.id, cu.name, cu.phone, cu.phone.replace(/\D/g, '').slice(-10), atMinutes(addDays(today, -14), 12 * 60)),
  )
  const started = new Set(orders.filter((o) => o.status === 'delivered' || o.status === 'out_for_delivery').map((o) => o.delivery_date))
  for (const date of started) {
    stmts.push(db.prepare('INSERT INTO day_starts (date, started_at) VALUES (?, ?)').bind(date, atMinutes(date, 11 * 60)))
  }
  const photos = []
  for (const o of orders) {
    const e = o.plan
    const q = o.q
    const photoKey = e.photo ? `orders/${o.id}.png` : null
    if (photoKey) photos.push(photoKey)
    const opId = o.status === 'delivered' ? `seed-op-${String(o.k + 1).padStart(2, '0')}` : null
    const preferredAny = !e.preferred
    stmts.push(
      db
        .prepare(`INSERT INTO orders (id, token, status, source, customer_id, product_id, kind, product_label, unit, qty,
        explain, stacking, wood_cu_in, pellet_bags, lat, lng, distance_km, zone_id, address, dump_notes, note, preferred_any,
        preferred_dates, goods_cents, stacking_cents, delivery_cents, subtotal_cents, hst_cents, total_cents, delivery_date,
        route_pos, delivered_at, door_payment, checkin_op_id, photo_key, photo_type, created_at, updated_at, cancelled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          o.id,
          o.token,
          o.status,
          o.source,
          o.customer.id,
          o.product.id,
          o.product.kind,
          q.product_label,
          e.unit,
          e.qty,
          q.explain,
          e.stacking ? 1 : 0,
          q.wood_cu_in,
          q.pellet_bags,
          o.lat,
          o.lng,
          q.distance_km,
          o.customer.address,
          o.customer.dump_notes,
          preferredAny ? 1 : 0,
          JSON.stringify(e.preferred || []),
          q.goods_cents,
          q.stacking_cents,
          q.delivery_cents,
          q.subtotal_cents,
          q.hst_cents,
          q.total_cents,
          o.delivery_date,
          o.route_pos,
          o.delivered_at,
          e.door ? e.door.method : null,
          opId,
          photoKey,
          photoKey ? 'image/png' : null,
          o.created_at,
          o.delivered_at || o.cancelled_at || o.created_at,
          o.cancelled_at,
        ),
    )
    let paid = 0
    if (o.status === 'delivered') {
      const col = o.product.kind === 'wood' ? 'stock_cu_in' : 'stock_bags'
      const change = o.product.kind === 'wood' ? q.wood_cu_in : q.pellet_bags
      stmts.push(
        db
          .prepare(`INSERT INTO checkins (op_id, order_id, at, delivered_at, at_adjusted, received_at, method, amount_cents, note)
          VALUES (?, ?, ?, ?, 0, ?, ?, ?, '')`)
          .bind(opId, o.id, o.delivered_at, o.delivered_at, o.delivered_at, e.door.method, e.door.amount ?? null),
        db.prepare(`UPDATE products SET ${col} = ${col} - ? WHERE id = ?`).bind(change, o.product.id),
        db
          .prepare(`INSERT INTO stock_moves (product_id, change, reason, order_id, checkin_op_id, at) VALUES (?, ?, 'delivered', ?, ?, ?)`)
          .bind(o.product.id, -change, o.id, opId, o.delivered_at),
      )
      if (e.door.method !== 'owes') {
        paid = e.door.amount ?? q.total_cents
        stmts.push(
          db
            .prepare(`INSERT INTO payments (id, customer_id, order_id, amount_cents, method, date, note, source, voided,
            checkin_op_id, created_at) VALUES (?, ?, ?, ?, ?, ?, '', 'door', 0, ?, ?)`)
            .bind(`pay_seed${o.k + 1}_door`, o.customer.id, o.id, paid, e.door.method, nlDate(o.delivered_at), opId, o.delivered_at),
        )
      }
    }
    for (const [j, p] of (e.payments || []).entries()) {
      stmts.push(
        db
          .prepare(`INSERT INTO payments (id, customer_id, order_id, amount_cents, method, date, note, source, voided,
          created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'dealer', 0, ?)`)
          .bind(`pay_seed${o.k + 1}_${j + 1}`, o.customer.id, o.id, p.amount, p.method, p.date, p.note, atMinutes(p.date, 18 * 60)),
      )
    }
  }
  await db.batch(stmts)
  const png = samplePng()
  if (c.env.PHOTOS) for (const key of photos) await c.env.PHOTOS.put(key, png, { httpMetadata: { contentType: 'image/png' } })

  return { today, customers: customers.length, orders: orders.length, busy_day: busy, status_url: `/o/?t=${orders[9].token}` }
}
