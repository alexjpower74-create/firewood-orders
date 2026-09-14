// Firewood Orders Worker: the API in docs/API.md under /api/*, and the static app from ../app/public.
import { ApiError, bad, badState, notFound } from './errors.js'
import { DEALER_HOURS, DRIVER_DAYS, hashPin, randomId, randomToken, sameHex, sha256Hex } from './auth.js'
import { now as clockNow, testMode } from './clock.js'
import { customerBalance, owingCents, paidCents, priceOrder } from './money.js'
import { optimizeRoute, pathKm } from './route.js'
import { sampleStatements } from './sample.js'
import { addDays, isValidDate, isoWeekday, longLabel, nlDate, shortLabel, TZ, weekdayName } from './time.js'
import { cordsOf, cordsText } from './units.js'
import { MAX_PAYMENT_CENTS, parseOrderInput, phoneDigits } from './validate.js'
import {
  customerOrderView, DAY_STATUSES, dateView, deliveredLabel, deliveryView, loadProducts, loadSettings, MAP, METHOD_LABELS,
  nextDeliveryDates, NOTE, ORDER_SELECT, orderMessages, orderSummary, paymentView, publicProduct, qtyLabelOf,
} from './views.js'

const MAX_PHOTO_BYTES = 5000000
const PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  })

// [method, path pattern, handler, access] — access: undefined (public), 'dealer', 'driver' (either role), 'test'.
const ROUTES = [
  ['GET', '/api/info', info],
  ['POST', '/api/quote', quote],
  ['POST', '/api/orders', (c) => createOrder(c, 'online')],
  ['GET', '/api/o/:token', customerOrder],
  ['GET', '/api/photos/:token', getPhoto],
  ['POST', '/api/signin', signin],
  ['POST', '/api/signout', signout],
  ['GET', '/api/dealer/board', board, 'dealer'],
  ['GET', '/api/dealer/orders/:id', orderDetail, 'dealer'],
  ['POST', '/api/dealer/orders', (c) => createOrder(c, 'phone'), 'dealer'],
  ['POST', '/api/dealer/orders/:id/schedule', schedule, 'dealer'],
  ['POST', '/api/dealer/orders/:id/unschedule', unschedule, 'dealer'],
  ['GET', '/api/dealer/days', days, 'dealer'],
  ['GET', '/api/dealer/days/:date/route', (c) => routeView(c, dateParam(c.params.date)), 'dealer'],
  ['POST', '/api/dealer/days/:date/route/optimize', optimizeDay, 'dealer'],
  ['PUT', '/api/dealer/days/:date/route', putRoute, 'dealer'],
  ['GET', '/api/dealer/customers', customers, 'dealer'],
  ['GET', '/api/dealer/customers/:id/ledger', ledger, 'dealer'],
  ['POST', '/api/dealer/payments', createPayment, 'dealer'],
  ['GET', '/api/driver/day', driverDay, 'driver'],
  ['POST', '/api/driver/day/:date/start', startDay, 'driver'],
  ['POST', '/api/driver/checkins', checkin, 'driver'],
  ['PUT', '/api/driver/checkins/:op_id/photo', putPhoto, 'driver'],
  ['POST', '/api/test/reset', testReset, 'test'],
].map(([method, pattern, handler, access]) => {
  const names = []
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+)')) + '$')
  return { method, re, names, handler, access }
})

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
    try {
      return await dispatch(request, env, url)
    } catch (e) {
      if (e instanceof ApiError) return json({ error: e.message, code: e.code, ...e.extra }, e.status)
      console.error(e)
      return json({ error: 'Something went wrong on our side. Try again.', code: 'server_error' }, 500)
    }
  },
}

async function dispatch(request, env, url) {
  for (const r of ROUTES) {
    const m = url.pathname.match(r.re)
    if (!m || r.method !== request.method) continue
    if (r.access === 'test' && !testMode(env)) break
    const now = clockNow(request, env)
    const c = {
      request, env, url, db: env.DB, now, nowIso: now.toISOString(), today: nlDate(now),
      params: Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])])),
      body: () => readJson(request),
    }
    if (r.access === 'dealer' || r.access === 'driver') c.role = await requireRole(c, r.access)
    return await r.handler(c)
  }
  throw notFound('There is nothing here.')
}

async function readJson(request) {
  try {
    return await request.json()
  } catch {
    throw bad('body', 'Send the details as JSON.')
  }
}

function dateParam(date, field = 'date') {
  if (!isValidDate(date)) throw bad(field, 'Pick a delivery day.')
  return date
}

// ---------- sign-in ----------

async function requireRole(c, access) {
  const h = c.request.headers.get('Authorization') || ''
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : ''
  if (!token) throw new ApiError(401, 'unauthorized', 'Sign in first.')
  const row = await c.db.prepare('SELECT role FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(await sha256Hex(token), c.nowIso).first()
  if (!row) throw new ApiError(401, 'unauthorized', 'Your sign-in has run out. Sign in again.')
  if (access === 'dealer' && row.role !== 'dealer') throw new ApiError(403, 'forbidden', 'Only the dealer can open this.')
  c.token = token
  return row.role
}

async function signin(c) {
  const body = await c.body()
  const pin = typeof body?.pin === 'string' ? body.pin : ''
  const row = await c.db.prepare('SELECT dealer_pin_hash, dealer_pin_salt, driver_pin_hash, driver_pin_salt FROM settings WHERE id = 1').first()
  let role = null
  if (/^\d{4,8}$/.test(pin)) {
    if (sameHex(await hashPin(pin, row.dealer_pin_salt), row.dealer_pin_hash)) role = 'dealer'
    else if (sameHex(await hashPin(pin, row.driver_pin_salt), row.driver_pin_hash)) role = 'driver'
  }
  if (!role) throw new ApiError(401, 'unauthorized', 'That PIN is not right.', { field: 'pin' })
  const token = randomToken()
  const ms = role === 'dealer' ? DEALER_HOURS * 3600e3 : DRIVER_DAYS * 86400e3
  const expires = new Date(c.now.getTime() + ms).toISOString()
  await c.db.prepare('INSERT INTO sessions (token_hash, role, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), role, c.nowIso, expires).run()
  return json({ token, role, expires_at: expires })
}

async function signout(c) {
  await requireRole(c, 'driver')
  await c.db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(c.token)).run()
  return json({ signed_out: true })
}

// ---------- public ----------

async function info(c) {
  const s = await loadSettings(c.db)
  const products = (await loadProducts(c.db)).filter((p) => p.active).map((p) => publicProduct(p, s))
    .filter((p) => p.units.length)
  return json({
    name: s.name, short_name: s.short_name, sample: true, timezone: TZ, today: c.today, now: c.nowIso, phone: s.phone,
    season_open: s.season_open, season_message: s.season_message, deposit_text: s.deposit_text,
    min_order_cents: s.min_order_cents, hst_registered: s.hst_registered, yard: s.yard, delivery: deliveryView(s.delivery),
    load: { cords: s.load.cords, description: s.load.description }, products,
    delivery_dates: nextDeliveryDates(s, c.today, 14), map: MAP,
  })
}

async function orderContext(c) {
  const s = await loadSettings(c.db)
  const products = await loadProducts(c.db)
  return { s, products, deliveryDates: nextDeliveryDates(s, c.today, 14) }
}

async function quote(c) {
  const body = await c.body()
  const { s, products, deliveryDates } = await orderContext(c)
  const input = parseOrderInput(body, { products, settings: s, deliveryDates, full: false, dealer: false })
  return json(priceOrder(input, s))
}

async function createOrder(c, source) {
  const body = await c.body()
  const { s, products, deliveryDates } = await orderContext(c)
  if (source === 'online' && !s.season_open) throw new ApiError(403, 'season_closed', s.season_message)
  const input = parseOrderInput(body, { products, settings: s, deliveryDates, full: true, dealer: source === 'phone' })
  const q = priceOrder(input, s)
  const id = randomId('o')
  const token = randomToken()
  const phoneKey = phoneDigits(input.phone).slice(-10)
  await c.db.batch([
    c.db.prepare('INSERT INTO customers (id, name, phone, phone_key, created_at) VALUES (?, ?, ?, ?, ?) ' +
      'ON CONFLICT (phone_key) DO UPDATE SET name = excluded.name, phone = excluded.phone')
      .bind(randomId('c'), input.name, input.phone, phoneKey, c.nowIso),
    c.db.prepare(`INSERT INTO orders (id, token, status, source, customer_id, product_id, kind, product_label, unit, qty,
        explain, stacking, wood_cu_in, pellet_bags, lat, lng, distance_km, zone_id, address, dump_notes, note, preferred_any,
        preferred_dates, goods_cents, stacking_cents, delivery_cents, subtotal_cents, hst_cents, total_cents, created_at,
        updated_at)
      VALUES (?, ?, 'requested', ?, (SELECT id FROM customers WHERE phone_key = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, token, source, phoneKey, input.product.id, input.product.kind, q.product_label, input.unit, input.qty,
        q.explain, input.stacking ? 1 : 0, q.wood_cu_in, q.pellet_bags, input.lat, input.lng, q.distance_km, input.zone_id,
        input.address, input.dump_notes, input.note, input.preferred_any ? 1 : 0, JSON.stringify(input.preferred_dates),
        q.goods_cents, q.stacking_cents, q.delivery_cents, q.subtotal_cents, q.hst_cents, q.total_cents, c.nowIso, c.nowIso),
  ])
  return json({ id, token, status: 'requested', status_url: `/o/?t=${token}`, quote: q }, 201)
}

async function orderByToken(c, token) {
  const o = await c.db.prepare(`${ORDER_SELECT} WHERE o.token = ?`).bind(token).first()
  if (!o) throw notFound("We couldn't find that order. Check the link or call us.")
  return o
}

async function paymentsOfOrder(c, orderId) {
  const { results } = await c.db.prepare('SELECT * FROM payments WHERE order_id = ? ORDER BY date, created_at').bind(orderId).all()
  return results
}

async function customerOrder(c) {
  const o = await orderByToken(c, c.params.token)
  return json(customerOrderView(o, await paymentsOfOrder(c, o.id), await loadSettings(c.db)))
}

async function getPhoto(c) {
  const o = await orderByToken(c, c.params.token)
  const obj = o.photo_key ? await c.env.PHOTOS.get(o.photo_key) : null
  if (!obj) throw notFound('There is no photo for this order.')
  return new Response(obj.body, {
    headers: { 'Content-Type': obj.httpMetadata?.contentType || o.photo_type || 'application/octet-stream',
      'Cache-Control': 'no-store' },
  })
}

// ---------- dealer: orders ----------

async function allOrders(c, where = '', binds = []) {
  const { results } = await c.db.prepare(`${ORDER_SELECT} ${where}`).bind(...binds).all()
  return results
}

async function allPayments(c) {
  const { results } = await c.db.prepare('SELECT * FROM payments ORDER BY date, created_at').all()
  return results
}

async function orderById(c, id) {
  const o = await c.db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).bind(id).first()
  if (!o) throw notFound("We couldn't find that order.")
  return o
}

async function summaryOf(c, id) {
  const o = await orderById(c, id)
  return orderSummary(o, await paymentsOfOrder(c, o.id))
}

async function board(c) {
  const [orders, payments] = await Promise.all([allOrders(c), allPayments(c)])
  const all = orders.map((o) => orderSummary(o, payments))
  const since = new Date(c.now.getTime() - 30 * 86400e3).toISOString()
  const byStr = (k) => (a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0)
  const fresh = all.filter((o) => o.status === 'requested').sort(byStr('created_at'))
  const scheduled = all.filter((o) => o.status === 'scheduled' || o.status === 'out_for_delivery')
    .sort((a, b) => byStr('delivery_date')(a, b) || a.route_pos - b.route_pos)
  const delivered = all.filter((o) => o.status === 'delivered' && o.delivered_at >= since)
    .sort((a, b) => byStr('delivered_at')(b, a))
  const owing = all.filter((o) => o.status === 'delivered' && o.owing_cents > 0).sort(byStr('delivered_at'))
  return json({
    counts: { new: fresh.length, scheduled: scheduled.length, delivered: delivered.length, owing: owing.length,
      cancelled: all.filter((o) => o.status === 'cancelled').length },
    new: fresh, scheduled, delivered, owing,
  })
}

async function orderDetail(c) {
  const o = await orderById(c, c.params.id)
  const s = await loadSettings(c.db)
  const { results: payments } = await c.db.prepare('SELECT * FROM payments WHERE customer_id = ? ORDER BY date, created_at')
    .bind(o.customer_id).all()
  const { results: custOrders } = await c.db.prepare('SELECT id, status, total_cents FROM orders WHERE customer_id = ?')
    .bind(o.customer_id).all()
  return json({
    order: orderSummary(o, payments),
    customer: { id: o.customer_id, name: o.name, phone: o.phone, balance_cents: customerBalance(custOrders, payments) },
    payments: payments.filter((p) => p.order_id === o.id).map(paymentView),
    messages: orderMessages(o, payments, s, c.url.origin),
  })
}

// ---------- dealer: the truck and the route ----------

async function dayUse(c, date) {
  return c.db.prepare(`SELECT COALESCE(SUM(wood_cu_in), 0) AS wood, COALESCE(SUM(pellet_bags), 0) AS bags, COUNT(*) AS n
    FROM orders WHERE delivery_date = ? AND status IN ${DAY_STATUSES}`).bind(date).first()
}

function checkScheduleDate(s, today, date) {
  dateParam(date)
  const last = addDays(today, s.window_days - 1)
  if (date < today || date > last) throw bad('date', `Pick a day from today to ${longLabel(last)}.`)
  const wd = isoWeekday(date)
  if (!s.delivery_weekdays.includes(wd)) throw bad('date', `We don't deliver on ${weekdayName(wd)}s.`)
}

function overCapacity(s, date, use, o) {
  const woodShort = use.wood + o.wood_cu_in > s.cap_cu_in
  const error = woodShort || o.kind === 'wood'
    ? `That's more than the truck can carry that day: ${cordsText(use.wood)} of ${cordsText(s.cap_cu_in)} cords already ` +
      `planned, this order needs ${cordsText(o.wood_cu_in)}.`
    : `That's more than the truck can carry that day: ${use.bags} of ${s.cap_bags} bags already planned, this order ` +
      `needs ${o.pellet_bags}.`
  return new ApiError(409, 'over_capacity', error, {
    day: { date,
      wood: { used_cu_in: use.wood, cap_cu_in: s.cap_cu_in, used_cords: cordsOf(use.wood), cap_cords: cordsOf(s.cap_cu_in) },
      pellets: { used_bags: use.bags, cap_bags: s.cap_bags } },
    needs: { wood_cu_in: o.wood_cu_in, pellet_bags: o.pellet_bags },
  })
}

async function schedule(c) {
  const body = await c.body()
  const date = body?.date
  const s = await loadSettings(c.db)
  checkScheduleDate(s, c.today, date)
  const o = await orderById(c, c.params.id)
  const db = c.db
  const nowIso = c.nowIso
  if (o.status !== 'requested' && o.status !== 'scheduled') throw badState("This order can't be put on the schedule now.")
  if (o.status === 'scheduled' && o.delivery_date === date) return json({ order: await summaryOf(c, o.id) })
  // CAPACITY-GUARD:BEGIN — the capacity check and the write are one statement, so two taps can't both take the last space.
  const r = await db.prepare(`UPDATE orders SET status = 'scheduled', delivery_date = ?1, updated_at = ?3,
      route_pos = (SELECT COALESCE(MAX(route_pos), 0) + 1 FROM orders WHERE delivery_date = ?1 AND id <> ?2 AND status IN ${DAY_STATUSES})
    WHERE id = ?2 AND status IN ('requested', 'scheduled')
      AND (SELECT COALESCE(SUM(wood_cu_in), 0) FROM orders WHERE delivery_date = ?1 AND id <> ?2 AND status IN ${DAY_STATUSES})
        + wood_cu_in <= (SELECT cap_cu_in FROM settings WHERE id = 1)
      AND (SELECT COALESCE(SUM(pellet_bags), 0) FROM orders WHERE delivery_date = ?1 AND id <> ?2 AND status IN ${DAY_STATUSES})
        + pellet_bags <= (SELECT cap_bags FROM settings WHERE id = 1)`)
    .bind(date, o.id, nowIso).run()
  // CAPACITY-GUARD:END
  if (r.meta.changes === 0) {
    const now = await orderById(c, o.id)
    if (now.status !== 'requested' && now.status !== 'scheduled') throw badState("This order can't be put on the schedule now.")
    throw overCapacity(s, date, await dayUse(c, date), now)
  }
  if (o.status === 'scheduled' && o.delivery_date !== date) await compactDay(c, o.delivery_date)
  return json({ order: await summaryOf(c, o.id) })
}

async function unschedule(c) {
  const o = await orderById(c, c.params.id)
  const r = await c.db.prepare(`UPDATE orders SET status = 'requested', delivery_date = NULL, route_pos = NULL, updated_at = ?
    WHERE id = ? AND status = 'scheduled'`).bind(c.nowIso, o.id).run()
  if (r.meta.changes === 0) throw badState('Only a scheduled order can come off the schedule.')
  await compactDay(c, o.delivery_date)
  return json({ order: await summaryOf(c, o.id) })
}

async function compactDay(c, date) {
  const { results } = await c.db.prepare(`SELECT id FROM orders WHERE delivery_date = ? AND status IN ${DAY_STATUSES}
    ORDER BY route_pos, id`).bind(date).all()
  if (!results.length) return
  await c.db.batch(results.map((r, i) => c.db.prepare('UPDATE orders SET route_pos = ? WHERE id = ?').bind(i + 1, r.id)))
}

function bagsPerSkid(products) {
  return products.find((p) => p.kind === 'pellets' && p.active)?.bags_per_skid || null
}

async function days(c) {
  const s = await loadSettings(c.db)
  const products = await loadProducts(c.db)
  const perSkid = bagsPerSkid(products)
  const from = c.today
  const to = addDays(from, s.window_days - 1)
  const { results: uses } = await c.db.prepare(`SELECT delivery_date AS date, COALESCE(SUM(wood_cu_in), 0) AS wood,
      COALESCE(SUM(pellet_bags), 0) AS bags, COUNT(*) AS n
    FROM orders WHERE delivery_date BETWEEN ? AND ? AND status IN ${DAY_STATUSES} GROUP BY delivery_date`).bind(from, to).all()
  const { results: starts } = await c.db.prepare('SELECT date FROM day_starts WHERE date BETWEEN ? AND ?').bind(from, to).all()
  const useBy = Object.fromEntries(uses.map((u) => [u.date, u]))
  const started = new Set(starts.map((r) => r.date))
  const out = []
  for (let i = 0; i < s.window_days; i++) {
    const date = addDays(from, i)
    const u = useBy[date] || { wood: 0, bags: 0, n: 0 }
    const delivers = s.delivery_weekdays.includes(isoWeekday(date))
    out.push({
      ...dateView(date), delivers, reason: delivers ? null : `No deliveries on ${weekdayName(isoWeekday(date))}s`,
      orders: u.n, started: started.has(date), over: u.wood > s.cap_cu_in || u.bags > s.cap_bags,
      wood: { used_cu_in: u.wood, cap_cu_in: s.cap_cu_in, used_cords: cordsOf(u.wood), cap_cords: cordsOf(s.cap_cu_in) },
      pellets: { used_bags: u.bags, cap_bags: s.cap_bags,
        used_skids: perSkid ? Math.round((u.bags * 100) / perSkid) / 100 : 0, cap_skids: s.truck.pellet_skids_per_day },
    })
  }
  return json({ days: out })
}

async function dayOrders(c, date) {
  return allOrders(c, `WHERE o.delivery_date = ? AND o.status IN ${DAY_STATUSES} ORDER BY o.route_pos, o.id`, [date])
}

// Delivered stops, in the order they were delivered: they stay at the front of the route.
function deliveredFirst(rows) {
  return rows.filter((o) => o.status === 'delivered')
    .sort((a, b) => (a.delivered_at < b.delivered_at ? -1 : a.delivered_at > b.delivered_at ? 1 : a.route_pos - b.route_pos))
}

async function isStarted(c, date) {
  return !!(await c.db.prepare('SELECT 1 FROM day_starts WHERE date = ?').bind(date).first())
}

async function routeView(c, date) {
  const s = await loadSettings(c.db)
  const rows = await dayOrders(c, date)
  const payments = rows.length ? await allPayments(c) : []
  return json({
    date, label: shortLabel(date), long_label: longLabel(date), yard: s.yard, started: await isStarted(c, date),
    stops: rows.map((o) => orderSummary(o, payments)), total_km: Math.round(pathKm(s.yard, rows, s.yard) * 10) / 10,
    note: NOTE,
  })
}

async function saveRoute(c, ids) {
  await c.db.batch(ids.map((id, i) => c.db.prepare('UPDATE orders SET route_pos = ? WHERE id = ?').bind(i + 1, id)))
}

async function optimizeDay(c) {
  const date = dateParam(c.params.date)
  const s = await loadSettings(c.db)
  const rows = await dayOrders(c, date)
  const done = deliveredFirst(rows)
  const start = done.length ? done[done.length - 1] : s.yard
  const rest = optimizeRoute(start, rows.filter((o) => o.status !== 'delivered'), s.yard)
  if (rows.length) await saveRoute(c, [...done, ...rest].map((o) => o.id))
  return routeView(c, date)
}

async function putRoute(c) {
  const date = dateParam(c.params.date)
  const body = await c.body()
  const ids = body?.order_ids
  const refuse = () => bad('order_ids', "That list doesn't match the orders on this day. Reload and try again.")
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) throw refuse()
  const rows = await dayOrders(c, date)
  const have = new Set(rows.map((o) => o.id))
  if (ids.length !== rows.length || new Set(ids).size !== ids.length || !ids.every((id) => have.has(id))) throw refuse()
  const done = deliveredFirst(rows).map((o) => o.id)
  if (done.some((id, i) => ids[i] !== id)) {
    throw bad('order_ids', 'Delivered stops stay first, in the order they were delivered.')
  }
  await saveRoute(c, ids)
  return routeView(c, date)
}

// ---------- dealer: customers and payments ----------

async function customers(c) {
  const { results: custs } = await c.db.prepare('SELECT * FROM customers').all()
  const { results: orders } = await c.db.prepare('SELECT id, customer_id, status, total_cents, created_at FROM orders').all()
  const payments = await allPayments(c)
  const out = custs.map((cu) => {
    const os = orders.filter((o) => o.customer_id === cu.id)
    const ps = payments.filter((p) => p.customer_id === cu.id)
    const live = os.filter((o) => o.status !== 'cancelled')
    const last = os.map((o) => o.created_at).sort().pop()
    const balance = customerBalance(os, ps)
    return { id: cu.id, name: cu.name, phone: cu.phone, orders: live.length,
      total_cents: live.reduce((a, o) => a + o.total_cents, 0), paid_cents: ps.filter((p) => !p.voided)
        .reduce((a, p) => a + p.amount_cents, 0), balance_cents: balance,
      last_order_label: last ? shortLabel(nlDate(last)) : null }
  })
  out.sort((a, b) => b.balance_cents - a.balance_cents || a.name.localeCompare(b.name))
  return json({ customers: out })
}

async function ledger(c) {
  const cu = await c.db.prepare('SELECT * FROM customers WHERE id = ?').bind(c.params.id).first()
  if (!cu) throw notFound("We couldn't find that customer.")
  const orders = await allOrders(c, 'WHERE o.customer_id = ?', [cu.id])
  const { results: payments } = await c.db.prepare('SELECT * FROM payments WHERE customer_id = ?').bind(cu.id).all()
  const rows = [
    ...orders.filter((o) => o.status !== 'cancelled').map((o) => ({ date: nlDate(o.created_at), at: o.created_at,
      kind: 'order', text: `Order: ${qtyLabelOf(o)} of ${o.product_label}`, charge_cents: o.total_cents, payment_cents: 0 })),
    ...payments.filter((p) => !p.voided).map((p) => ({ date: p.date, at: p.created_at, kind: 'payment',
      text: `${p.source === 'door' ? 'Paid at the door' : 'Payment'}: ${METHOD_LABELS[p.method]}${p.note ? ` (${p.note})` : ''}`,
      charge_cents: 0, payment_cents: p.amount_cents })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  let running = 0
  const entries = rows.map(({ at, ...e }) => {
    running += e.charge_cents - e.payment_cents
    return { date: e.date, label: shortLabel(e.date), kind: e.kind, text: e.text, charge_cents: e.charge_cents,
      payment_cents: e.payment_cents, balance_cents: running }
  })
  const balance = customerBalance(orders, payments)
  return json({ customer: { id: cu.id, name: cu.name, phone: cu.phone, balance_cents: balance }, entries,
    balance_cents: balance })
}

async function createPayment(c) {
  const b = (await c.body()) || {}
  const cu = typeof b.customer_id === 'string'
    ? await c.db.prepare('SELECT id FROM customers WHERE id = ?').bind(b.customer_id).first() : null
  if (!cu) throw bad('customer_id', 'Pick the customer who paid.')
  let orderId = null
  if (b.order_id !== undefined && b.order_id !== null) {
    const o = typeof b.order_id === 'string'
      ? await c.db.prepare('SELECT id FROM orders WHERE id = ? AND customer_id = ?').bind(b.order_id, cu.id).first() : null
    if (!o) throw bad('order_id', "That order isn't this customer's.")
    orderId = o.id
  }
  if (!Number.isInteger(b.amount_cents) || b.amount_cents < 1 || b.amount_cents > MAX_PAYMENT_CENTS) {
    throw bad('amount_cents', 'Enter an amount from $0.01 to $100,000.00.')
  }
  if (!['cash', 'etransfer', 'cheque', 'card', 'other'].includes(b.method)) throw bad('method', 'Pick how they paid.')
  const date = b.date === undefined || b.date === null ? c.today : b.date
  if (!isValidDate(date) || date > c.today) throw bad('date', 'Pick the day it was paid, today or earlier.')
  const note = b.note === undefined || b.note === null ? '' : typeof b.note === 'string' ? b.note.trim() : null
  if (note === null || note.length > 200) throw bad('note', 'Keep the note to 200 characters.')
  const p = { id: randomId('pay'), customer_id: cu.id, order_id: orderId, amount_cents: b.amount_cents, method: b.method,
    date, note, source: 'dealer', voided: 0 }
  await c.db.prepare(`INSERT INTO payments (id, customer_id, order_id, amount_cents, method, date, note, source, voided, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'dealer', 0, ?)`)
    .bind(p.id, p.customer_id, p.order_id, p.amount_cents, p.method, p.date, p.note, c.nowIso).run()
  return json({ payment: paymentView(p) }, 201)
}

// ---------- driver ----------

async function driverDay(c) {
  const date = c.url.searchParams.get('date') ? dateParam(c.url.searchParams.get('date')) : c.today
  const s = await loadSettings(c.db)
  const rows = await dayOrders(c, date)
  const payments = rows.length ? await allPayments(c) : []
  return json({
    dealer: { name: s.name, short_name: s.short_name, sample: true }, date, long_label: longLabel(date), yard: s.yard,
    started: await isStarted(c, date), note: NOTE,
    counts: { done: rows.filter((o) => o.status === 'delivered').length, total: rows.length },
    stops: rows.map((o, i) => ({
      order_id: o.id, pos: i + 1, status: o.status, name: o.name, phone: o.phone, address: o.address,
      dump_notes: o.dump_notes, lat: o.lat, lng: o.lng, product_label: o.product_label, qty_label: qtyLabelOf(o),
      stacking: !!o.stacking, total_cents: o.total_cents, paid_cents: paidCents(o.id, payments),
      owing_cents: owingCents(o, payments), delivered_label: deliveredLabel(o), door_payment: o.door_payment,
      maps_url: `https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}`,
    })),
  })
}

async function startDay(c) {
  const date = dateParam(c.params.date)
  const [, r] = await c.db.batch([
    c.db.prepare('INSERT OR IGNORE INTO day_starts (date, started_at) VALUES (?, ?)').bind(date, c.nowIso),
    c.db.prepare(`UPDATE orders SET status = 'out_for_delivery', updated_at = ? WHERE delivery_date = ? AND status = 'scheduled'`)
      .bind(c.nowIso, date),
  ])
  return json({ started: true, changed: r.meta.changes })
}

const OP_ID_RE = /^[A-Za-z0-9_-]{8,100}$/

async function checkinReply(c, ck, duplicate, status) {
  return json({ duplicate, order: await summaryOf(c, ck.order_id), at: ck.delivered_at, at_adjusted: !!ck.at_adjusted },
    status)
}

async function checkin(c) {
  const b = (await c.body()) || {}
  if (typeof b.op_id !== 'string' || !OP_ID_RE.test(b.op_id)) throw bad('op_id', 'This delivery has no id. Update the app.')
  const opId = b.op_id
  const existing = await c.db.prepare('SELECT * FROM checkins WHERE op_id = ?').bind(opId).first()
  if (existing) return checkinReply(c, existing, true, 200)

  if (typeof b.order_id !== 'string') throw bad('order_id', 'Pick the stop you delivered.')
  const atMs = typeof b.at === 'string' ? Date.parse(b.at) : NaN
  if (Number.isNaN(atMs)) throw bad('at', 'This delivery has no time. Update the app.')
  const pay = b.payment
  if (!pay || typeof pay !== 'object' || !['cash', 'etransfer', 'owes'].includes(pay.method)) {
    throw bad('payment', 'Pick how they paid.')
  }
  let amount = null
  if (pay.method !== 'owes' && pay.amount_cents !== undefined && pay.amount_cents !== null) {
    if (!Number.isInteger(pay.amount_cents) || pay.amount_cents < 1 || pay.amount_cents > MAX_PAYMENT_CENTS) {
      throw bad('payment', 'Enter an amount from $0.01 to $100,000.00.')
    }
    amount = pay.amount_cents
  }
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 280) : ''

  const o = await c.db.prepare('SELECT * FROM orders WHERE id = ?').bind(b.order_id).first()
  if (!o) throw notFound("We couldn't find that order.")
  if (o.status === 'delivered') {
    throw new ApiError(409, 'already_delivered', 'This stop was already marked delivered.')
  }
  if (o.status !== 'scheduled' && o.status !== 'out_for_delivery') {
    throw badState(o.status === 'cancelled' ? 'This order was cancelled.' : "This order isn't on a delivery day.")
  }

  // Keep the moment the driver tapped, unless the phone clock is clearly wrong.
  const nowIso = c.nowIso
  const atIso = new Date(atMs).toISOString()
  const adjusted = atMs < c.now.getTime() - 7 * 86400e3 || atMs > c.now.getTime() + 5 * 60e3
  const deliveredAt = adjusted ? nowIso : atIso

  const stockCol = o.kind === 'wood' ? 'stock_cu_in' : 'stock_bags'
  const change = o.kind === 'wood' ? o.wood_cu_in : o.pellet_bags
  const applied = 'EXISTS (SELECT 1 FROM orders WHERE id = ? AND checkin_op_id = ?)'
  const db = c.db
  const stmts = [
    db.prepare(`INSERT INTO checkins (op_id, order_id, at, delivered_at, at_adjusted, received_at, method, amount_cents, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(opId, o.id, atIso, deliveredAt, adjusted ? 1 : 0, nowIso, pay.method, amount, note),
    db.prepare(`UPDATE orders SET status = 'delivered', delivered_at = ?, door_payment = ?, checkin_op_id = ?, updated_at = ?
      WHERE id = ? AND status IN ('scheduled', 'out_for_delivery')`).bind(deliveredAt, pay.method, opId, nowIso, o.id),
    db.prepare(`UPDATE products SET ${stockCol} = ${stockCol} - ? WHERE id = ? AND ${applied}`)
      .bind(change, o.product_id, o.id, opId),
    db.prepare(`INSERT INTO stock_moves (product_id, change, reason, order_id, checkin_op_id, at)
      SELECT ?, ?, 'delivered', ?, ?, ? WHERE ${applied}`).bind(o.product_id, -change, o.id, opId, nowIso, o.id, opId),
  ]
  if (pay.method !== 'owes') {
    const owingNow = `o.total_cents - (SELECT COALESCE(SUM(p.amount_cents), 0) FROM payments p WHERE p.order_id = o.id AND p.voided = 0)`
    stmts.push(db.prepare(`INSERT INTO payments (id, customer_id, order_id, amount_cents, method, date, note, source, voided,
        checkin_op_id, created_at)
      SELECT ?, o.customer_id, o.id, COALESCE(?, ${owingNow}), ?, ?, '', 'door', 0, ?, ?
      FROM orders o WHERE o.id = ? AND o.checkin_op_id = ? AND COALESCE(?, ${owingNow}) > 0`)
      .bind(randomId('pay'), amount, pay.method, nlDate(deliveredAt), opId, nowIso, o.id, opId, amount))
  }
  // Another op delivered this order in the meantime: leave no check-in row behind for this op.
  stmts.push(db.prepare(`DELETE FROM checkins WHERE op_id = ? AND NOT ${applied}`).bind(opId, o.id, opId))
  let results
  try {
    results = await db.batch(stmts)
  } catch (e) {
    const again = await c.db.prepare('SELECT * FROM checkins WHERE op_id = ?').bind(opId).first()
    if (again) return checkinReply(c, again, true, 200) // the same op landed concurrently
    throw e
  }
  if (results[1].meta.changes === 0) {
    const cur = await c.db.prepare('SELECT status FROM orders WHERE id = ?').bind(o.id).first()
    if (cur.status === 'delivered') throw new ApiError(409, 'already_delivered', 'This stop was already marked delivered.')
    throw badState("This order isn't on a delivery day.")
  }
  const ck = await c.db.prepare('SELECT * FROM checkins WHERE op_id = ?').bind(opId).first()
  return checkinReply(c, ck, false, 201)
}

async function putPhoto(c) {
  const ck = await c.db.prepare('SELECT order_id FROM checkins WHERE op_id = ?').bind(c.params.op_id).first()
  if (!ck) throw notFound("We couldn't find that delivery.")
  const type = (c.request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()
  const ext = PHOTO_TYPES[type]
  if (!ext) throw new ApiError(415, 'unsupported_media', 'Send the photo as a JPEG, PNG or WebP picture.')
  const tooBig = () => new ApiError(413, 'payload_too_large', 'That photo is too big. The most is 5 MB.')
  if (Number(c.request.headers.get('Content-Length') || 0) > MAX_PHOTO_BYTES) throw tooBig()
  const bytes = await c.request.arrayBuffer()
  if (bytes.byteLength > MAX_PHOTO_BYTES) throw tooBig()
  if (bytes.byteLength === 0) throw bad('photo', 'The photo was empty. Take it again.')
  const o = await c.db.prepare('SELECT id, token, photo_key FROM orders WHERE id = ?').bind(ck.order_id).first()
  const key = `orders/${o.id}.${ext}`
  await c.env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: type } })
  if (o.photo_key && o.photo_key !== key) await c.env.PHOTOS.delete(o.photo_key)
  await c.db.prepare('UPDATE orders SET photo_key = ?, photo_type = ?, updated_at = ? WHERE id = ?')
    .bind(key, type, c.nowIso, o.id).run()
  return json({ stored: true, photo_url: `/api/photos/${o.token}` })
}

// ---------- test ----------

const TABLES = ['stock_moves', 'checkins', 'payments', 'orders', 'customers', 'products', 'settings', 'sessions',
  'signin_attempts', 'order_attempts', 'day_starts']

async function testReset(c) {
  await c.db.batch([
    ...TABLES.map((t) => c.db.prepare(`DELETE FROM ${t}`)),
    ...sampleStatements().map(({ sql, params }) => c.db.prepare(sql).bind(...params)),
  ])
  let cursor
  do {
    const list = await c.env.PHOTOS.list({ cursor })
    if (list.objects.length) await c.env.PHOTOS.delete(list.objects.map((o) => o.key))
    cursor = list.truncated ? list.cursor : undefined
  } while (cursor)
  return json({ reset: true })
}

