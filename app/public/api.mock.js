// In-browser stand-in for the Worker, for development only (open a page with ?mock=1). Written from docs/API.md before
// fo1's Worker existed: the same shapes, codes, field names and error texts, the SAMPLE settings and products, a fixed
// clock (Mon Sep 14 2026, 9:00 AM NDT, like the tests' X-Test-Now). State lives in sessionStorage so a status link
// survives navigation in the same tab. Playwright specs never use this: they run against the real Worker.
// Demo status tokens: demo-requested-sample, demo-scheduled-sample, demo-out-sample, demo-delivered-sample,
// demo-cancelled-sample. Dev knob: ?closed=1 closes the season. ?reset=1 clears the mock store.

const NOW = '2026-09-14T11:30:00.000Z'
const TODAY = '2026-09-14'
const STORE_KEY = 'firewood-orders:mock-store'
const CLOSED_KEY = 'firewood-orders:mock-closed'
const CORD = 221184
const DAY_MS = 86400000
const TZ = 'America/St_Johns'

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const msOf = (date) => Date.parse(`${date}T00:00:00Z`)
const addDays = (date, n) => new Date(msOf(date) + n * DAY_MS).toISOString().slice(0, 10)
const weekday = (date) => new Date(msOf(date)).getUTCDay()
const label = (date) => `${WD[weekday(date)]} ${MON[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`
const longLabel = (date) => `${WEEKDAY[weekday(date)]}, ${MONTH[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`
function instantLabel(iso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    .formatToParts(Date.parse(iso)).map((x) => [x.type, x.value]))
  return { day: `${p.weekday} ${p.month} ${p.day}`, time: `${p.hour}:${p.minute} ${p.dayPeriod}` }
}
const money = (c) => `$${String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(c % 100).padStart(2, '0')}`
const cords2 = (cu) => (Math.floor((cu * 100 + CORD / 2) / CORD) / 100).toFixed(2)

const YARD = { lat: 49.5119027, lng: -56.0642695, label: 'Our yard, Springdale (SAMPLE)' }
const PLACES = {
  "King's Point": [49.5807861, -56.208], 'South Brook': [49.4029722, -56.089675], "Robert's Arm": [49.4766556, -55.8347694],
  'Little Bay': [49.5992389, -55.9518361], "St. Patrick's": [49.566667, -55.9825], 'Middle Arm': [49.7030277, -56.1148445],
  "Jackson's Cove": [49.6852778, -55.9936111], Sheppardville: [49.4508334, -56.4316666], 'Baie Verte': [49.9087083, -56.1946584],
}

const SETTINGS = {
  name: 'SAMPLE Wood & Pellets — Springdale (demo)', short_name: 'SAMPLE Wood & Pellets', phone: '709-555-0100',
  season_message: "We're closed for the season. Call 709-555-0100 and we'll take your name for the fall.",
  deposit_text: 'This page takes no payments. To pay a deposit, send an Interac e-Transfer to sample-wood@example.com with your name in the message. You can also pay cash or e-Transfer when we deliver.',
  min_order_cents: 11000, hst_registered: true, window_days: 21, weekdays: [1, 2, 3, 4, 5, 6],
  bands: [
    { up_to_km: 10, fee_cents: 0, label: 'Up to 10 km: free' },
    { up_to_km: 30, fee_cents: 2500, label: 'Up to 30 km: $25.00' },
    { up_to_km: 60, fee_cents: 5000, label: 'Up to 60 km: $50.00' },
  ],
  beyond_message: "That's farther than we deliver. Call us at 709-555-0100 and we'll see what we can do.",
  load: { cords: 1.5, description: 'A load is what our dump truck carries in one trip, dumped in a pile, not stacked.' },
  cap_cu_in: Math.round(4.5 * CORD), cap_bags: 210,
}

const PRODUCTS = [
  { id: 'p_softwood_dry', kind: 'wood', name: 'Mixed softwood, dry', species: 'Spruce and fir', dryness: 'dry', cut_in: 16, split: true, stacking_cents_per_cord: 6000, price: { cord: 30000, half_cord: 17000, face_cord: 12000, load: 42000 } },
  { id: 'p_birch_dry', kind: 'wood', name: 'Birch, dry', species: 'Birch', dryness: 'dry', cut_in: 16, split: true, stacking_cents_per_cord: 6000, price: { cord: 37500, half_cord: 20000, face_cord: 14000, load: null } },
  { id: 'p_softwood_green', kind: 'wood', name: 'Mixed softwood, green', species: 'Spruce and fir', dryness: 'green', cut_in: 16, split: false, stacking_cents_per_cord: null, price: { cord: 22000, half_cord: null, face_cord: null, load: 30000 } },
  { id: 'p_pellets', kind: 'pellets', name: 'SAMPLE Premium wood pellets', brand: 'SAMPLE Premium', bag_lb: 40, bags_per_ton: 50, bags_per_skid: 70, price: { bag: 799, ton: 36500, skid: 49900 } },
]

const UNIT_NAME = { cord: ['cord', 'cords'], half_cord: ['half cord', 'half cords'], face_cord: ['face cord', 'face cords'], load: ['load', 'loads'], bag: ['bag', 'bags'], ton: ['ton', 'tons'], skid: ['skid', 'skids'] }
const qtyLabel = (unit, qty) => `${qty} ${UNIT_NAME[unit][qty === 1 ? 0 : 1]}`

function unitInfo(p, unit) {
  if (p.kind === 'wood') {
    const vol = { cord: CORD, half_cord: CORD / 2, face_cord: 4608 * p.cut_in, load: Math.round(SETTINGS.load.cords * CORD) }[unit]
    const explain = {
      cord: 'A full cord: a stack 4 feet high, 4 feet wide and 8 feet long (128 cubic feet).',
      half_cord: 'Half a cord: 64 cubic feet, half of a full cord.',
      face_cord: `A face cord: one row 4 feet high and 8 feet long, as deep as the pieces are long (${p.cut_in} inches). That is ${(p.cut_in / 48).toFixed(2)} of a full cord.`,
      load: `${SETTINGS.load.description} We count a load as ${SETTINGS.load.cords} cords.`,
    }[unit]
    return { unit, price_cents: p.price[unit], explain, wood_cu_in: vol }
  }
  const bags = { bag: 1, ton: p.bags_per_ton, skid: p.bags_per_skid }[unit]
  const explain = {
    bag: `One ${p.bag_lb} lb bag.`,
    ton: `A ton: ${p.bags_per_ton} bags of ${p.bag_lb} lb.`,
    skid: `A skid: ${p.bags_per_skid} bags of ${p.bag_lb} lb, shrink-wrapped on a pallet.`,
  }[unit]
  return { unit, price_cents: p.price[unit], explain, pellet_bags: bags }
}

function publicProduct(p) {
  const units = Object.keys(p.price).filter((u) => p.price[u] !== null).map((u) => unitInfo(p, u))
  const { price, ...rest } = p
  return { ...rest, units }
}

function haversine(a, b) {
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(s))
}

function deliveryDates() {
  const out = []
  for (let d = addDays(TODAY, 1); out.length < 14; d = addDays(d, 1)) {
    if (SETTINGS.weekdays.includes(weekday(d) || 7)) out.push({ date: d, label: label(d), long_label: longLabel(d) })
  }
  return out
}

/* ---- store --------------------------------------------------------------- */

const closed = () => { try { return sessionStorage.getItem(CLOSED_KEY) === '1' } catch { return false } }
try {
  const params = new URLSearchParams(location.search)
  if (params.get('closed') === '1') sessionStorage.setItem(CLOSED_KEY, '1')
  if (params.get('closed') === '0') sessionStorage.removeItem(CLOSED_KEY)
  if (params.get('reset') === '1') sessionStorage.removeItem(STORE_KEY)
} catch {}

let seq = 100
const err = (status, code, error, extra = {}) => ({ status, body: { error, code, ...extra } })
const bad = (field, error) => err(400, 'bad_request', error, { field })

function price(body) {
  const p = PRODUCTS.find((x) => x.id === body.product_id)
  if (!p) return bad('product_id', 'Choose what you would like.')
  if (!(body.unit in p.price) || p.price[body.unit] === null) return err(400, 'not_offered', "We don't sell that by that amount.", { field: 'unit' })
  if (!Number.isInteger(body.qty) || body.qty < 1 || body.qty > 20) return bad('qty', 'Choose how many, from 1 to 20.')
  if (body.stacking && (p.kind !== 'wood' || p.stacking_cents_per_cord === null)) return bad('stacking', "We don't stack that one.")
  if (typeof body.lat !== 'number' || typeof body.lng !== 'number' || body.lat < 46.5 || body.lat > 60.5 || body.lng < -67.9 || body.lng > -52.5) {
    return bad('pin', 'Tap the map where the truck should dump it.')
  }
  const u = unitInfo(p, body.unit)
  const wood = p.kind === 'wood' ? u.wood_cu_in * body.qty : 0
  const bags = p.kind === 'pellets' ? u.pellet_bags * body.qty : 0
  const goods = u.price_cents * body.qty
  const stacking = body.stacking ? Math.floor((p.stacking_cents_per_cord * wood * 2 + CORD) / (2 * CORD)) : 0
  const km = haversine(YARD, body)
  const band = SETTINGS.bands.find((b) => km <= b.up_to_km)
  if (!band) return err(400, 'outside_area', SETTINGS.beyond_message, { field: 'pin' })
  if (goods + stacking < SETTINGS.min_order_cents) return err(400, 'below_minimum', `The smallest order we deliver is ${money(SETTINGS.min_order_cents)} before delivery.`, { field: 'qty' })
  const delivery = Number.isInteger(body.delivery_cents) ? body.delivery_cents : band.fee_cents
  const subtotal = goods + stacking + delivery
  const hst = SETTINGS.hst_registered ? Math.floor((subtotal * 15 + 50) / 100) : 0
  return {
    status: 200,
    body: {
      product_label: p.name, qty_label: qtyLabel(body.unit, body.qty), explain: u.explain, wood_cu_in: wood, pellet_bags: bags,
      distance_km: Math.round(km * 10) / 10, goods_cents: goods, stacking_cents: stacking, delivery_cents: delivery,
      subtotal_cents: subtotal, hst_cents: hst, total_cents: subtotal + hst,
    },
  }
}

function seed() {
  const s = { orders: [], customers: [], payments: [] }
  const mk = (name, phone, placeName, product_id, unit, qty, status, extra = {}) => {
    const [lat, lng] = PLACES[placeName]
    const digits = phone.replace(/\D/g, '').slice(-10)
    let c = s.customers.find((x) => x.digits === digits)
    if (!c) { c = { id: `c_${++seq}`, name, phone, digits }; s.customers.push(c) }
    const q = price({ product_id, unit, qty, lat, lng }).body
    const o = {
      id: `o_${++seq}`, token: extra.token || `mock-${seq}-token-sample-0000`, status, source: extra.source || 'online', customer_id: c.id,
      address: `Near ${placeName} (SAMPLE)`, dump_notes: extra.dump_notes ?? 'By the woodshed, not on the lawn', lat, lng,
      product_id, unit, qty, stacking: false, preferred_any: !extra.dates, preferred_dates: extra.dates || [], note: '',
      delivery_date: extra.date || null, route_pos: null, delivered_at: extra.delivered_at || null, door_payment: extra.door || null,
      has_photo: false, created_at: extra.created_at || '2026-09-13T14:10:00.000Z', ...q,
    }
    s.orders.push(o)
    return o
  }
  mk('Wade R. (SAMPLE)', '709-555-0142', "King's Point", 'p_softwood_dry', 'cord', 1, 'requested', { token: 'demo-requested-sample', dates: ['2026-09-16', '2026-09-17'] })
  mk('Maureen B. (SAMPLE)', '709-555-0117', 'Little Bay', 'p_pellets', 'skid', 1, 'requested', { created_at: '2026-09-14T10:05:00.000Z' })
  mk('Gerald P. (SAMPLE)', '709-555-0163', "St. Patrick's", 'p_birch_dry', 'half_cord', 1, 'requested', { source: 'phone', created_at: '2026-09-14T11:02:00.000Z' })
  const a = mk('Darlene K. (SAMPLE)', '709-555-0128', "Robert's Arm", 'p_softwood_dry', 'cord', 2, 'scheduled', { token: 'demo-scheduled-sample', date: '2026-09-15' })
  const b = mk('Cyril H. (SAMPLE)', '709-555-0190', 'South Brook', 'p_softwood_green', 'load', 1, 'scheduled', { date: '2026-09-15' })
  const c = mk('Brenda F. (SAMPLE)', '709-555-0155', 'Middle Arm', 'p_pellets', 'ton', 1, 'scheduled', { date: '2026-09-16' })
  a.route_pos = 1; b.route_pos = 2; c.route_pos = 1
  mk('Leonard S. (SAMPLE)', '709-555-0171', "Jackson's Cove", 'p_softwood_dry', 'face_cord', 2, 'out_for_delivery', { token: 'demo-out-sample', date: TODAY }).route_pos = 1
  const d1 = mk('Patsy W. (SAMPLE)', '709-555-0134', 'Sheppardville', 'p_birch_dry', 'cord', 1, 'delivered', { token: 'demo-delivered-sample', date: '2026-09-11', delivered_at: '2026-09-11T17:05:00.000Z', door: 'owes' })
  const d2 = mk('Rodney T. (SAMPLE)', '709-555-0182', 'Little Bay', 'p_softwood_dry', 'cord', 1, 'delivered', { date: '2026-09-12', delivered_at: '2026-09-12T15:40:00.000Z', door: 'cash' })
  d1.route_pos = 1; d2.route_pos = 1
  mk('Glenda M. (SAMPLE)', '709-555-0199', 'Baie Verte', 'p_softwood_dry', 'cord', 1, 'cancelled', { token: 'demo-cancelled-sample' })
  s.payments.push({ id: `pay_${++seq}`, customer_id: d1.customer_id, order_id: d1.id, amount_cents: 10000, method: 'etransfer', date: '2026-09-08', note: 'Deposit', source: 'dealer', voided: false })
  s.payments.push({ id: `pay_${++seq}`, customer_id: d2.customer_id, order_id: d2.id, amount_cents: d2.total_cents, method: 'cash', date: '2026-09-12', note: '', source: 'door', voided: false })
  s.payments.push({ id: `pay_${++seq}`, customer_id: a.customer_id, order_id: a.id, amount_cents: 5000, method: 'etransfer', date: '2026-09-13', note: 'Deposit', source: 'dealer', voided: false })
  s.seq = seq
  return s
}

function load() {
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    if (raw) { const s = JSON.parse(raw); seq = s.seq; return s }
  } catch {}
  return seed()
}
function save(s) { s.seq = seq; try { sessionStorage.setItem(STORE_KEY, JSON.stringify(s)) } catch {} }

/* ---- views --------------------------------------------------------------- */

const paidOf = (s, o) => s.payments.filter((p) => p.order_id === o.id && !p.voided).reduce((t, p) => t + p.amount_cents, 0)
const owingOf = (s, o) => (o.status === 'cancelled' ? 0 : o.total_cents) - paidOf(s, o)
const owingLabel = (c) => (c > 0 ? `Balance owing ${money(c)}` : c < 0 ? `Credit ${money(-c)}` : 'Paid in full')
const preferredLabel = (o) => (o.preferred_any ? 'Any day' : o.preferred_dates.map(label).join(', '))
function statusLabel(o) {
  if (o.status === 'scheduled') return `Scheduled for ${longLabel(o.delivery_date)}`
  return { requested: 'Requested', out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled' }[o.status]
}
function deliveredLabel(o) {
  if (!o.delivered_at) return null
  const l = instantLabel(o.delivered_at)
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(Date.parse(o.delivered_at))
  return `Delivered ${longLabel(date)} at ${l.time}`
}
function createdLabel(o) { const l = instantLabel(o.created_at); return `${l.day}, ${l.time}` }

function summary(s, o) {
  const c = s.customers.find((x) => x.id === o.customer_id)
  const paid = paidOf(s, o)
  return {
    id: o.id, token: o.token, status: o.status, status_label: statusLabel(o), source: o.source, customer_id: c.id, name: c.name, phone: c.phone,
    address: o.address, dump_notes: o.dump_notes, lat: o.lat, lng: o.lng, product_id: o.product_id,
    kind: PRODUCTS.find((p) => p.id === o.product_id).kind, product_label: o.product_label, unit: o.unit, qty: o.qty, qty_label: o.qty_label,
    stacking: o.stacking, wood_cu_in: o.wood_cu_in, pellet_bags: o.pellet_bags, cords: Number(cords2(o.wood_cu_in)),
    preferred_label: preferredLabel(o), preferred_dates: o.preferred_dates, preferred_any: o.preferred_any,
    delivery_date: o.delivery_date, delivery_label: o.delivery_date ? label(o.delivery_date) : null, route_pos: o.route_pos, distance_km: o.distance_km,
    goods_cents: o.goods_cents, stacking_cents: o.stacking_cents, delivery_cents: o.delivery_cents, subtotal_cents: o.subtotal_cents,
    hst_cents: o.hst_cents, total_cents: o.total_cents, paid_cents: paid, owing_cents: owingOf(s, o),
    delivered_at: o.delivered_at, delivered_label: deliveredLabel(o), door_payment: o.door_payment, has_photo: o.has_photo, note: o.note,
    created_at: o.created_at, created_label: createdLabel(o),
  }
}

function info() {
  return {
    name: SETTINGS.name, short_name: SETTINGS.short_name, sample: true, timezone: TZ, today: TODAY, now: NOW, phone: SETTINGS.phone,
    season_open: !closed(), season_message: SETTINGS.season_message, deposit_text: SETTINGS.deposit_text,
    min_order_cents: SETTINGS.min_order_cents, hst_registered: SETTINGS.hst_registered, yard: YARD,
    delivery: { mode: 'bands', bands: SETTINGS.bands, zones: [], beyond_message: SETTINGS.beyond_message },
    load: SETTINGS.load, products: PRODUCTS.map(publicProduct), delivery_dates: deliveryDates(),
    map: { style: 'https://tiles.openfreemap.org/styles/liberty', attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>' },
  }
}

function validateOrder(s, body, { dealer = false } = {}) {
  if (!dealer && closed()) return err(403, 'season_closed', SETTINGS.season_message)
  const q = price(body)
  if (q.status !== 200) return q
  const str = (v) => (typeof v === 'string' ? v.trim() : '')
  if (str(body.address).length < 1 || str(body.address).length > 120) return bad('address', 'Tell us where the place is, like the road and what it is near.')
  if (str(body.dump_notes).length > 200) return bad('dump_notes', 'Keep the dump spot notes under 200 characters.')
  const dates = deliveryDates().map((d) => d.date)
  const pref = body.preferred || {}
  if (!pref.any && (!Array.isArray(pref.dates) || pref.dates.length < 1 || pref.dates.length > 7 || !pref.dates.every((d) => dates.includes(d)))) {
    return bad('preferred', 'Pick the days that suit you, or Any day.')
  }
  if (str(body.name).length < 1 || str(body.name).length > 80) return bad('name', 'Tell us your name.')
  const phone = str(body.phone)
  if (!/^[\d\s+\-().]{7,32}$/.test(phone) || phone.replace(/\D/g, '').length < 7) return bad('phone', 'Enter a phone number we can call, like 709-555-0142.')
  if (str(body.note).length > 280) return bad('note', 'Keep the note under 280 characters.')
  return q
}

function createOrder(s, body, source) {
  const q = validateOrder(s, body, { dealer: source === 'phone' })
  if (q.status !== 200) return q
  const digits = body.phone.replace(/\D/g, '').slice(-10)
  let c = s.customers.find((x) => x.digits === digits)
  if (!c) { c = { id: `c_${++seq}`, digits }; s.customers.push(c) }
  c.name = body.name.trim(); c.phone = body.phone.trim()
  const token = `mock${(++seq).toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 32)
  const o = {
    id: `o_${seq}`, token, status: 'requested', source, customer_id: c.id, address: body.address.trim(), dump_notes: (body.dump_notes || '').trim(),
    lat: body.lat, lng: body.lng, product_id: body.product_id, unit: body.unit, qty: body.qty, stacking: !!body.stacking,
    preferred_any: !!body.preferred.any, preferred_dates: body.preferred.any ? [] : body.preferred.dates, note: (body.note || '').trim(),
    delivery_date: null, route_pos: null, delivered_at: null, door_payment: null, has_photo: false, created_at: NOW, ...q.body,
  }
  s.orders.push(o)
  save(s)
  return { status: 201, body: { id: o.id, token, status: 'requested', status_url: `/o/?t=${token}`, quote: q.body } }
}

function dayOf(s, date, excludeId = null) {
  const on = s.orders.filter((o) => o.delivery_date === date && o.id !== excludeId && ['scheduled', 'out_for_delivery', 'delivered'].includes(o.status))
  const wood = on.reduce((t, o) => t + o.wood_cu_in, 0)
  const bags = on.reduce((t, o) => t + o.pellet_bags, 0)
  const delivers = SETTINGS.weekdays.includes(weekday(date) || 7)
  return {
    date, label: label(date), long_label: longLabel(date), delivers, reason: delivers ? null : 'No deliveries on Sundays', orders: on.length,
    started: on.some((o) => o.status !== 'scheduled'), over: wood > SETTINGS.cap_cu_in || bags > SETTINGS.cap_bags,
    wood: { used_cu_in: wood, cap_cu_in: SETTINGS.cap_cu_in, used_cords: Number(cords2(wood)), cap_cords: Number(cords2(SETTINGS.cap_cu_in)) },
    pellets: { used_bags: bags, cap_bags: SETTINGS.cap_bags, used_skids: Math.floor(bags / 70), cap_skids: SETTINGS.cap_bags / 70 },
  }
}

function messages(s, o) {
  const c = s.customers.find((x) => x.id === o.customer_id)
  const first = c.name.split(/\s+/)[0]
  const owing = owingOf(s, o)
  const link = `${location.origin}/o/?t=${o.token}`
  const out = []
  if (o.status === 'scheduled') out.push({ kind: 'scheduled', label: "We're coming", text: `Hi ${first}, this is ${SETTINGS.short_name}. Your order (${o.qty_label} of ${o.product_label}) is booked for delivery on ${longLabel(o.delivery_date)}. Amount owing: ${money(Math.max(owing, 0))}. Check your order: ${link}` })
  if (o.status === 'out_for_delivery') out.push({ kind: 'on_the_way', label: 'On the way', text: `Hi ${first}, this is ${SETTINGS.short_name}. We're on the way with your ${o.qty_label} of ${o.product_label}. See you soon.` })
  if (o.status === 'delivered' && owing > 0) out.push({ kind: 'balance', label: 'Balance reminder', text: `Hi ${first}, this is ${SETTINGS.short_name}. Thanks again for your order. The balance of ${money(owing)} is still owing. ${SETTINGS.deposit_text}` })
  return out
}

function compact(s, date) {
  if (!date) return
  s.orders.filter((o) => o.delivery_date === date && o.status !== 'cancelled').sort((a, b) => a.route_pos - b.route_pos).forEach((o, i) => { o.route_pos = i + 1 })
}

/* ---- router -------------------------------------------------------------- */

export async function handle(method, path, body, headers) {
  await new Promise((r) => setTimeout(r, 60))
  const s = load()
  const url = new URL(path, location.origin)
  const p = url.pathname
  let m

  if (method === 'GET' && p === '/api/info') return { status: 200, body: info() }
  if (method === 'POST' && p === '/api/quote') {
    if (closed()) return err(403, 'season_closed', SETTINGS.season_message)
    return price(body || {})
  }
  if (method === 'POST' && p === '/api/orders') return createOrder(s, body || {}, 'online')
  if (method === 'GET' && (m = p.match(/^\/api\/o\/([^/]+)$/))) {
    const o = s.orders.find((x) => x.token === decodeURIComponent(m[1]))
    if (!o) return err(404, 'not_found', "We couldn't find that order.")
    const v = summary(s, o)
    return {
      status: 200,
      body: {
        dealer: { name: SETTINGS.name, short_name: SETTINGS.short_name, sample: true, phone: SETTINGS.phone }, deposit_text: SETTINGS.deposit_text,
        order: {
          status: v.status, status_label: v.status_label, product_label: v.product_label, qty_label: v.qty_label, explain: o.explain, stacking: v.stacking,
          address: v.address, dump_notes: v.dump_notes, preferred_label: v.preferred_label, delivery_date: v.delivery_date,
          delivered_label: v.delivered_label, photo_url: o.has_photo ? `/api/photos/${o.token}` : null,
          goods_cents: v.goods_cents, stacking_cents: v.stacking_cents, delivery_cents: v.delivery_cents, subtotal_cents: v.subtotal_cents,
          hst_cents: v.hst_cents, total_cents: v.total_cents, paid_cents: v.paid_cents, owing_cents: v.owing_cents,
          owing_label: owingLabel(v.owing_cents), created_label: v.created_label,
        },
      },
    }
  }
  if (method === 'POST' && p === '/api/signin') {
    const pin = String(body?.pin ?? '')
    if (pin === '1357') return { status: 200, body: { token: 'mock-dealer-token-sample', role: 'dealer', expires_at: '2026-09-14T23:30:00.000Z' } }
    if (pin === '2580') return { status: 200, body: { token: 'mock-driver-token-sample', role: 'driver', expires_at: '2026-09-28T11:30:00.000Z' } }
    return err(401, 'unauthorized', 'That PIN is not right.', { field: 'pin' })
  }
  if (method === 'POST' && p === '/api/signout') return { status: 200, body: {} }

  if (p.startsWith('/api/dealer/')) {
    const auth = headers.authorization || ''
    if (auth === 'Bearer mock-driver-token-sample') return err(403, 'forbidden', 'The driver PIN cannot open the dealer page.')
    if (auth !== 'Bearer mock-dealer-token-sample') return err(401, 'unauthorized', 'Please sign in again.')

    if (method === 'GET' && p === '/api/dealer/board') {
      const sums = s.orders.map((o) => summary(s, o))
      const byCreated = (a, b) => a.created_at.localeCompare(b.created_at)
      const out = {
        new: sums.filter((o) => o.status === 'requested').sort(byCreated),
        scheduled: sums.filter((o) => ['scheduled', 'out_for_delivery'].includes(o.status)).sort((a, b) => a.delivery_date.localeCompare(b.delivery_date) || a.route_pos - b.route_pos),
        delivered: sums.filter((o) => o.status === 'delivered').sort((a, b) => b.delivered_at.localeCompare(a.delivered_at)),
        owing: sums.filter((o) => o.status === 'delivered' && o.owing_cents > 0).sort((a, b) => a.delivered_at.localeCompare(b.delivered_at)),
      }
      return { status: 200, body: { counts: { new: out.new.length, scheduled: out.scheduled.length, delivered: out.delivered.length, owing: out.owing.length, cancelled: sums.filter((o) => o.status === 'cancelled').length }, ...out } }
    }
    if (method === 'GET' && p === '/api/dealer/days') {
      return { status: 200, body: { days: Array.from({ length: SETTINGS.window_days }, (_, i) => dayOf(s, addDays(TODAY, i))) } }
    }
    if (method === 'POST' && p === '/api/dealer/orders') return createOrder(s, body || {}, 'phone')
    if ((m = p.match(/^\/api\/dealer\/orders\/([^/]+)(?:\/(schedule|unschedule))?$/))) {
      const o = s.orders.find((x) => x.id === decodeURIComponent(m[1]))
      if (!o) return err(404, 'not_found', "We couldn't find that order.")
      if (method === 'GET' && !m[2]) {
        const c = s.customers.find((x) => x.id === o.customer_id)
        const mine = s.orders.filter((x) => x.customer_id === c.id)
        const balance = mine.filter((x) => x.status !== 'cancelled').reduce((t, x) => t + x.total_cents, 0) -
          s.payments.filter((x) => x.customer_id === c.id && !x.voided).reduce((t, x) => t + x.amount_cents, 0)
        return {
          status: 200,
          body: {
            order: summary(s, o), customer: { id: c.id, name: c.name, phone: c.phone, balance_cents: balance },
            payments: s.payments.filter((x) => x.order_id === o.id), messages: messages(s, o),
          },
        }
      }
      if (method === 'POST' && m[2] === 'schedule') {
        const date = body?.date
        const window = Array.from({ length: SETTINGS.window_days }, (_, i) => addDays(TODAY, i))
        if (!window.includes(date)) return bad('date', `Pick a day from today to ${label(window.at(-1))}.`)
        if (!SETTINGS.weekdays.includes(weekday(date) || 7)) return bad('date', "We don't deliver on Sundays.")
        if (!['requested', 'scheduled'].includes(o.status)) return err(409, 'bad_state', 'That order is past scheduling.')
        const day = dayOf(s, date, o.id)
        if (day.wood.used_cu_in + o.wood_cu_in > SETTINGS.cap_cu_in || day.pellets.used_bags + o.pellet_bags > SETTINGS.cap_bags) {
          const error = o.kind === 'pellets' || o.pellet_bags
            ? `That's more than the truck can carry that day: ${day.pellets.used_bags} of ${SETTINGS.cap_bags} bags already planned, this order needs ${o.pellet_bags}.`
            : `That's more than the truck can carry that day: ${cords2(day.wood.used_cu_in)} of ${cords2(SETTINGS.cap_cu_in)} cords already planned, this order needs ${cords2(o.wood_cu_in)}.`
          return err(409, 'over_capacity', error, { day: { date, wood: day.wood, pellets: day.pellets }, needs: { wood_cu_in: o.wood_cu_in, pellet_bags: o.pellet_bags } })
        }
        const from = o.delivery_date
        if (from !== date) {
          o.route_pos = s.orders.filter((x) => x.delivery_date === date && x.status !== 'cancelled').length + 1
          o.delivery_date = date
          compact(s, from)
        }
        o.status = 'scheduled'
        save(s)
        return { status: 200, body: { order: summary(s, o) } }
      }
      if (method === 'POST' && m[2] === 'unschedule') {
        if (o.status !== 'scheduled') return err(409, 'bad_state', "That order isn't on the schedule.")
        const from = o.delivery_date
        o.status = 'requested'; o.delivery_date = null; o.route_pos = null
        compact(s, from)
        save(s)
        return { status: 200, body: { order: summary(s, o) } }
      }
    }
    if (method === 'POST' && p === '/api/dealer/payments') {
      const b = body || {}
      const c = s.customers.find((x) => x.id === b.customer_id)
      if (!c) return err(404, 'not_found', "We couldn't find that customer.")
      if (b.order_id && !s.orders.some((x) => x.id === b.order_id && x.customer_id === c.id)) return err(404, 'not_found', "We couldn't find that order.")
      if (!Number.isInteger(b.amount_cents) || b.amount_cents < 1 || b.amount_cents > 10000000) return bad('amount_cents', 'Enter an amount from $0.01 to $100,000.00.')
      if (!['cash', 'etransfer', 'cheque', 'card', 'other'].includes(b.method)) return bad('method', 'Choose how they paid.')
      const date = b.date || TODAY
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > TODAY) return bad('date', "A payment can't be dated in the future.")
      const payment = { id: `pay_${++seq}`, customer_id: c.id, order_id: b.order_id || null, amount_cents: b.amount_cents, method: b.method, date, note: (b.note || '').trim(), source: 'dealer', voided: false }
      s.payments.push(payment)
      save(s)
      return { status: 201, body: { payment } }
    }
  }
  return err(404, 'not_found', 'Not in the mock.')
}
