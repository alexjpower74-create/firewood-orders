// Reading rows and shaping them into the API's JSON. Labels and balances come from the pure modules.
import { ApiError } from './errors.js'
import { cordsOf, explain, qtyLabel, unitsFor, unitVolume } from './units.js'
import { bandLabel, formatMoney, owingCents, owingLabel, paidCents } from './money.js'
import { addDays, dateTimeLabel, isoWeekday, longLabel, nlDate, shortLabel, timeLabel } from './time.js'

export const DAY_STATUSES = "('scheduled', 'out_for_delivery', 'delivered')"
export const NOTE = 'Order is by distance, not road time.'
// The base map: one style URL and the attribution that provider requires, set as [vars] in wrangler.toml (MAP_STYLE_URL,
// MAP_ATTRIBUTION). Defaults are OpenFreeMap (free, commercial use allowed, no key, no SLA).
export const DEFAULT_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
export const DEFAULT_MAP_ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'
export function mapInfo(env) {
  return { style: env?.MAP_STYLE_URL || DEFAULT_MAP_STYLE, attribution: env?.MAP_ATTRIBUTION || DEFAULT_MAP_ATTRIBUTION }
}

export async function loadSettings(db) {
  const row = await db.prepare('SELECT data, load_cu_in, cap_cu_in, cap_bags FROM settings WHERE id = 1').first()
  if (!row) throw new ApiError(500, 'server_error', 'The dealer settings are missing.')
  const data = JSON.parse(row.data)
  // `sample` arrived in M2; a database seeded before it is the SAMPLE dealer.
  return { ...data, sample: data.sample !== false, load_cu_in: row.load_cu_in, cap_cu_in: row.cap_cu_in, cap_bags: row.cap_bags }
}

export function productFromRow(r) {
  const base = { id: r.id, kind: r.kind, name: r.name, active: !!r.active, sort: r.sort }
  if (r.kind === 'wood') {
    return { ...base, species: r.species, dryness: r.dryness, cut_in: r.cut_in, split: !!r.split,
      stacking_cents_per_cord: r.stacking_cents_per_cord,
      price_cents: { cord: r.price_cord, half_cord: r.price_half_cord, face_cord: r.price_face_cord, load: r.price_load },
      stock_cu_in: r.stock_cu_in, stock_cords: cordsOf(r.stock_cu_in) }
  }
  return { ...base, brand: r.brand, bag_lb: r.bag_lb, bags_per_ton: r.bags_per_ton, bags_per_skid: r.bags_per_skid,
    price_cents: { bag: r.price_bag, ton: r.price_ton, skid: r.price_skid }, stock_bags: r.stock_bags }
}

export async function loadProducts(db) {
  const { results } = await db.prepare('SELECT * FROM products ORDER BY sort, id').all()
  return results.map(productFromRow)
}

// The public product card: no stock, only offered units.
export function publicProduct(p, settings) {
  const units = unitsFor(p.kind).filter((u) => p.price_cents[u] !== null).map((u) => {
    const v = unitVolume(p, u, settings.load_cu_in)
    const unit = { unit: u, price_cents: p.price_cents[u], explain: explain(p, u, settings.load) }
    if (p.kind === 'wood') unit.wood_cu_in = v.wood_cu_in
    else unit.pellet_bags = v.pellet_bags
    return unit
  })
  if (p.kind === 'wood') {
    return { id: p.id, kind: p.kind, name: p.name, species: p.species, dryness: p.dryness, cut_in: p.cut_in, split: p.split,
      stacking_cents_per_cord: p.stacking_cents_per_cord, units }
  }
  return { id: p.id, kind: p.kind, name: p.name, brand: p.brand, bag_lb: p.bag_lb, bags_per_ton: p.bags_per_ton,
    bags_per_skid: p.bags_per_skid, units }
}

export function deliveryView(delivery) {
  return { mode: delivery.mode, bands: delivery.bands.map((b) => ({ ...b, label: bandLabel(b) })), zones: delivery.zones,
    beyond_message: delivery.beyond_message }
}

// The next `count` delivery weekdays starting the day after `today`.
export function nextDeliveryDates(settings, today, count) {
  const out = []
  let d = today
  while (out.length < count) {
    d = addDays(d, 1)
    if (settings.delivery_weekdays.includes(isoWeekday(d))) out.push(dateView(d))
  }
  return out
}

export function dateView(date) {
  return { date, label: shortLabel(date), long_label: longLabel(date) }
}

export const ORDER_SELECT =
  'SELECT o.*, c.name AS name, c.phone AS phone FROM orders o JOIN customers c ON c.id = o.customer_id'

export function statusLabel(o) {
  switch (o.status) {
    case 'requested': return 'Requested'
    case 'scheduled': return `Scheduled for ${longLabel(o.delivery_date)}`
    case 'out_for_delivery': return 'Out for delivery'
    case 'delivered': return 'Delivered'
    case 'cancelled': return 'Cancelled'
  }
  return o.status
}

export function deliveredLabel(o) {
  return o.delivered_at ? `Delivered ${longLabel(nlDate(o.delivered_at))} at ${timeLabel(o.delivered_at)}` : null
}

export function preferredDates(o) {
  return JSON.parse(o.preferred_dates || '[]')
}

export function preferredLabel(o) {
  return o.preferred_any ? 'Any day' : preferredDates(o).map(shortLabel).join(', ')
}

export const qtyLabelOf = (o) => qtyLabel(o.unit, o.qty)

// `payments` must include every payment of this order (others are ignored).
export function orderSummary(o, payments) {
  return {
    id: o.id, token: o.token, status: o.status, status_label: statusLabel(o), source: o.source,
    customer_id: o.customer_id, name: o.name, phone: o.phone, address: o.address, dump_notes: o.dump_notes,
    lat: o.lat, lng: o.lng, product_id: o.product_id, kind: o.kind, product_label: o.product_label, unit: o.unit,
    qty: o.qty, qty_label: qtyLabelOf(o), stacking: !!o.stacking, wood_cu_in: o.wood_cu_in, pellet_bags: o.pellet_bags,
    cords: cordsOf(o.wood_cu_in), preferred_label: preferredLabel(o), preferred_dates: preferredDates(o),
    preferred_any: !!o.preferred_any, delivery_date: o.delivery_date,
    delivery_label: o.delivery_date ? shortLabel(o.delivery_date) : null, route_pos: o.route_pos,
    distance_km: o.distance_km, goods_cents: o.goods_cents, stacking_cents: o.stacking_cents,
    delivery_cents: o.delivery_cents, subtotal_cents: o.subtotal_cents, hst_cents: o.hst_cents, total_cents: o.total_cents,
    paid_cents: paidCents(o.id, payments), owing_cents: owingCents(o, payments),
    delivered_at: o.delivered_at, delivered_label: deliveredLabel(o), door_payment: o.door_payment,
    has_photo: !!o.photo_key, note: o.note, created_at: o.created_at, created_label: dateTimeLabel(o.created_at),
  }
}

export function customerOrderView(o, payments, settings) {
  const owing = owingCents(o, payments)
  return {
    dealer: { name: settings.name, short_name: settings.short_name, sample: settings.sample, phone: settings.phone },
    deposit_text: settings.deposit_text,
    order: {
      status: o.status, status_label: statusLabel(o), product_label: o.product_label, qty_label: qtyLabelOf(o),
      explain: o.explain, stacking: !!o.stacking, address: o.address, dump_notes: o.dump_notes,
      preferred_label: preferredLabel(o), delivery_date: o.delivery_date, delivered_label: deliveredLabel(o),
      photo_url: o.photo_key ? `/api/photos/${o.token}` : null,
      goods_cents: o.goods_cents, stacking_cents: o.stacking_cents, delivery_cents: o.delivery_cents,
      subtotal_cents: o.subtotal_cents, hst_cents: o.hst_cents, total_cents: o.total_cents,
      paid_cents: paidCents(o.id, payments), owing_cents: owing, owing_label: owingLabel(owing, { cancelled: o.status === 'cancelled' }),
      created_label: dateTimeLabel(o.created_at),
    },
  }
}

export function paymentView(p) {
  return { id: p.id, customer_id: p.customer_id, order_id: p.order_id, amount_cents: p.amount_cents, method: p.method,
    date: p.date, note: p.note, source: p.source, voided: !!p.voided }
}

export const METHOD_LABELS = { cash: 'Cash', etransfer: 'e-Transfer', cheque: 'Cheque', card: 'Card', other: 'Other', owes: 'Owes' }

// Copy-text messages for the dealer. Text exact per docs/API.md.
export function orderMessages(o, payments, settings, origin) {
  const first = o.name.trim().split(/\s+/)[0]
  const owing = owingCents(o, payments)
  const who = `Hi ${first}, this is ${settings.short_name}.`
  const what = `${qtyLabelOf(o)} of ${o.product_label}`
  const out = []
  if (o.status === 'scheduled') {
    out.push({ kind: 'scheduled', label: "We're coming",
      text: `${who} Your order (${what}) is booked for delivery on ${longLabel(o.delivery_date)}. ` +
        `Amount owing: ${formatMoney(owing)}. Check your order: ${origin}/o/?t=${o.token}` })
  }
  if (o.status === 'out_for_delivery') {
    out.push({ kind: 'on_the_way', label: 'On the way', text: `${who} We're on the way with your ${what}. See you soon.` })
  }
  if (o.status === 'delivered' && owing > 0) {
    out.push({ kind: 'balance', label: 'Balance reminder',
      text: `${who} Thanks again for your order. The balance of ${formatMoney(owing)} is still owing. ${settings.deposit_text}` })
  }
  return out
}
