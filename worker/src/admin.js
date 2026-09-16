// Dealer settings, products, stock counts and PINs (docs/API.md, Settings).
import { ApiError, bad, notFound } from './errors.js'
import { hashPin, randomId, randomSaltHex, sameHex, sha256Hex } from './auth.js'
import { assertSigninAllowed, signinAttempt } from './guards.js'
import { json } from './http.js'
import { PRODUCT_COLUMNS } from './sample.js'
import { isValidDate } from './time.js'
import { cordsToCuIn, unitsFor } from './units.js'
import { loadProducts, loadSettings, productFromRow } from './views.js'

export const SETTING_KEYS = [
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
]

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi
const isNum = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
const twoDp = (v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6
const isText = (v, lo, hi) => typeof v === 'string' && v.trim().length >= lo && v.trim().length <= hi
const inNL = (lat, lng) => isNum(lat, 46.5, 60.5) && isNum(lng, -67.9, -52.5)

function need(ok, field, message) {
  if (!ok) throw bad(field, message)
}

export function settingsView(s) {
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, s[k]]))
}

// Validates a whole settings object and returns it cleaned (trimmed text, only known keys).
export function validateSettings(b) {
  need(isText(b.name, 1, 80), 'name', 'Enter the business name, up to 80 characters.')
  need(isText(b.short_name, 1, 40), 'short_name', 'Enter a short name, up to 40 characters.')
  need(typeof b.sample === 'boolean', 'sample', 'Say whether this is a SAMPLE demo dealer.')
  need(isText(b.phone, 0, 32), 'phone', 'Keep the phone number to 32 characters.')
  need(isText(b.deposit_text, 0, 400), 'deposit_text', 'Keep the deposit text to 400 characters.')
  need(typeof b.season_open === 'boolean', 'season_open', 'Say whether the season is open.')
  need(isText(b.season_message, 0, 200), 'season_message', 'Keep the closed-season message to 200 characters.')
  need(
    typeof b.season_start === 'string' && /^\d{2}-\d{2}$/.test(b.season_start) && isValidDate(`2001-${b.season_start}`),
    'season_start',
    'Enter the first day of the season as MM-DD, like 09-01.',
  )
  need(isInt(b.min_order_cents, 0, 100000), 'min_order_cents', 'Enter a minimum order from $0.00 to $1,000.00.')
  need(typeof b.hst_registered === 'boolean', 'hst_registered', 'Say whether you charge HST.')
  const y = b.yard
  need(
    isObj(y) && inNL(y.lat, y.lng) && isText(y.label, 1, 80),
    'yard',
    'Put the yard pin in Newfoundland and Labrador and give it a name.',
  )
  const d = b.delivery
  need(isObj(d) && (d.mode === 'bands' || d.mode === 'zones'), 'delivery.mode', 'Pick distance bands or zones.')
  const bands = d.bands
  need(
    Array.isArray(bands) &&
      bands.length >= 1 &&
      bands.length <= 6 &&
      bands.every(
        (x, i) =>
          isObj(x) && isNum(x.up_to_km, 0.1, 500) && isInt(x.fee_cents, 0, 50000) && (i === 0 || x.up_to_km > bands[i - 1].up_to_km),
      ),
    'delivery.bands',
    'Use 1 to 6 bands, each farther than the one before (0.1 to 500 km), with a fee from $0.00 to $500.00.',
  )
  const zones = d.zones
  need(
    Array.isArray(zones) &&
      zones.length <= 30 &&
      zones.every(
        (z) =>
          isObj(z) && typeof z.id === 'string' && /^[a-z0-9_-]{1,40}$/.test(z.id) && isText(z.name, 1, 40) && isInt(z.fee_cents, 0, 50000),
      ) &&
      new Set(zones.map((z) => z.id)).size === zones.length &&
      (d.mode !== 'zones' || zones.length >= 1),
    'delivery.zones',
    'Give each zone its own name (up to 40 characters) and a fee from $0.00 to $500.00. Zones need at least one zone.',
  )
  need(isText(d.beyond_message, 0, 200), 'delivery.beyond_message', 'Keep the too-far message to 200 characters.')
  const l = b.load
  need(isObj(l) && isNum(l.cords, 0.25, 10) && twoDp(l.cords), 'load.cords', 'Enter a load from 0.25 to 10 cords, with at most 2 decimals.')
  need(isText(l.description, 1, 200), 'load.description', 'Say what a load is, in up to 200 characters.')
  const t = b.truck
  need(isObj(t) && isText(t.name, 1, 80), 'truck.name', 'Give the truck a name, up to 80 characters.')
  need(
    isNum(t.wood_cords_per_day, 0, 40) && twoDp(t.wood_cords_per_day),
    'truck.wood_cords_per_day',
    'Enter from 0 to 40 cords a day, with at most 2 decimals.',
  )
  need(isInt(t.pellet_skids_per_day, 0, 20), 'truck.pellet_skids_per_day', 'Enter from 0 to 20 skids a day.')
  const w = b.delivery_weekdays
  need(
    Array.isArray(w) && w.length >= 1 && w.every((x) => isInt(x, 1, 7)) && new Set(w).size === w.length,
    'delivery_weekdays',
    'Pick at least one delivery day of the week.',
  )
  need(isInt(b.window_days, 7, 42), 'window_days', 'Plan from 7 to 42 days ahead.')
  return {
    name: b.name.trim(),
    short_name: b.short_name.trim(),
    sample: b.sample,
    phone: b.phone.trim(),
    deposit_text: b.deposit_text.trim(),
    season_open: b.season_open,
    season_message: b.season_message.trim(),
    season_start: b.season_start,
    min_order_cents: b.min_order_cents,
    hst_registered: b.hst_registered,
    yard: { lat: y.lat, lng: y.lng, label: y.label.trim() },
    delivery: {
      mode: d.mode,
      bands: bands.map((x) => ({ up_to_km: x.up_to_km, fee_cents: x.fee_cents })),
      zones: zones.map((z) => ({ id: z.id, name: z.name.trim(), fee_cents: z.fee_cents })),
      beyond_message: d.beyond_message.trim(),
    },
    load: { cords: l.cords, description: l.description.trim() },
    truck: { name: t.name.trim(), wood_cords_per_day: t.wood_cords_per_day, pellet_skids_per_day: t.pellet_skids_per_day },
    delivery_weekdays: [...w].sort((a, b2) => a - b2),
    window_days: b.window_days,
  }
}

// cap_bags = skids a day × bags per skid of the first active pellet product (by sort).
export function capBagsFor(s, products) {
  const pellets = products.find((p) => p.kind === 'pellets' && p.active)
  return pellets ? s.truck.pellet_skids_per_day * pellets.bags_per_skid : 0
}

export async function getSettings(c) {
  const [s, products] = await Promise.all([loadSettings(c.db), loadProducts(c.db)])
  return json({ settings: settingsView(s), products })
}

export async function putSettings(c) {
  const body = await c.body()
  if (!isObj(body)) throw bad('body', 'Send the settings as JSON.')
  const merged = settingsView(await loadSettings(c.db))
  for (const k of SETTING_KEYS) if (body[k] !== undefined) merged[k] = body[k]
  const s = validateSettings(merged)
  const products = await loadProducts(c.db)
  await c.db
    .prepare('UPDATE settings SET data = ?, load_cu_in = ?, cap_cu_in = ?, cap_bags = ?, updated_at = ? WHERE id = 1')
    .bind(JSON.stringify(s), cordsToCuIn(s.load.cords), cordsToCuIn(s.truck.wood_cords_per_day), capBagsFor(s, products), c.nowIso)
    .run()
  return getSettings(c)
}

async function refreshCapBags(c) {
  const [s, products] = await Promise.all([loadSettings(c.db), loadProducts(c.db)])
  await c.db.prepare('UPDATE settings SET cap_bags = ? WHERE id = 1').bind(capBagsFor(s, products)).run()
}

// ---------- products ----------

const PRICE_MAX = 10000000

function mergePrices(base, given) {
  if (given === undefined) return base
  if (!isObj(given)) throw bad('price_cents', 'Enter a price for each unit, or leave it not sold.')
  return { ...base, ...given }
}

// A product in API shape → its table row (without id and stock).
function validateProduct(p) {
  need(p.kind === 'wood' || p.kind === 'pellets', 'kind', 'Pick firewood or pellets.')
  need(isText(p.name, 1, 80), 'name', 'Give the product a name, up to 80 characters.')
  need(typeof p.active === 'boolean', 'active', 'Say whether the product is for sale.')
  need(isInt(p.sort, 0, 1000), 'sort', 'Enter a sort position from 0 to 1000.')
  for (const u of unitsFor(p.kind)) {
    const v = p.price_cents[u]
    need(
      v === null || v === undefined || isInt(v, 1, PRICE_MAX),
      `price_cents.${u}`,
      'Enter a price from $0.01 to $100,000.00, or leave it not sold.',
    )
  }
  const price = (u) => p.price_cents[u] ?? null
  const row = {
    kind: p.kind,
    name: p.name.trim(),
    active: p.active ? 1 : 0,
    sort: p.sort,
    species: null,
    dryness: null,
    cut_in: null,
    split: null,
    stacking_cents_per_cord: null,
    price_cord: null,
    price_half_cord: null,
    price_face_cord: null,
    price_load: null,
    brand: null,
    bag_lb: null,
    bags_per_ton: null,
    bags_per_skid: null,
    price_bag: null,
    price_ton: null,
    price_skid: null,
  }
  if (p.kind === 'wood') {
    need(isText(p.species, 0, 80), 'species', 'Keep the species to 80 characters.')
    need(p.dryness === 'dry' || p.dryness === 'green', 'dryness', 'Pick dry or green.')
    need(isInt(p.cut_in, 12, 24), 'cut_in', 'Enter a piece length from 12 to 24 inches.')
    need(typeof p.split === 'boolean', 'split', 'Say whether the wood is split.')
    need(
      p.stacking_cents_per_cord === null || isInt(p.stacking_cents_per_cord, 0, 50000),
      'stacking_cents_per_cord',
      'Enter a stacking price from $0.00 to $500.00 a cord, or leave stacking off.',
    )
    Object.assign(row, {
      species: p.species.trim(),
      dryness: p.dryness,
      cut_in: p.cut_in,
      split: p.split ? 1 : 0,
      stacking_cents_per_cord: p.stacking_cents_per_cord,
      price_cord: price('cord'),
      price_half_cord: price('half_cord'),
      price_face_cord: price('face_cord'),
      price_load: price('load'),
    })
  } else {
    need(isText(p.brand, 0, 80), 'brand', 'Keep the brand to 80 characters.')
    need(isInt(p.bag_lb, 10, 80), 'bag_lb', 'Enter a bag weight from 10 to 80 lb.')
    need(isInt(p.bags_per_ton, 1, 200), 'bags_per_ton', 'Enter from 1 to 200 bags in a ton.')
    need(isInt(p.bags_per_skid, 1, 200), 'bags_per_skid', 'Enter from 1 to 200 bags on a skid.')
    Object.assign(row, {
      brand: p.brand.trim(),
      bag_lb: p.bag_lb,
      bags_per_ton: p.bags_per_ton,
      bags_per_skid: p.bags_per_skid,
      price_bag: price('bag'),
      price_ton: price('ton'),
      price_skid: price('skid'),
    })
  }
  return row
}

async function productById(c, id) {
  const row = await c.db.prepare('SELECT * FROM products WHERE id = ?').bind(id).first()
  if (!row) throw notFound("We couldn't find that product.")
  return productFromRow(row)
}

export async function createProduct(c) {
  const b = await c.body()
  if (!isObj(b)) throw bad('body', 'Send the product as JSON.')
  need(b.kind === 'wood' || b.kind === 'pellets', 'kind', 'Pick firewood or pellets.')
  const next = await c.db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM products').first()
  const defaults =
    b.kind === 'wood'
      ? {
          species: '',
          dryness: 'dry',
          cut_in: 16,
          split: true,
          stacking_cents_per_cord: null,
          price_cents: { cord: null, half_cord: null, face_cord: null, load: null },
        }
      : { brand: '', bag_lb: 40, bags_per_ton: 50, bags_per_skid: 70, price_cents: { bag: null, ton: null, skid: null } }
  const row = validateProduct({
    ...defaults,
    active: true,
    sort: Math.min(next.n, 1000),
    ...b,
    kind: b.kind,
    price_cents: mergePrices(defaults.price_cents, b.price_cents),
  })
  const full = { ...row, id: randomId('p'), stock_cu_in: 0, stock_bags: 0 }
  await c.db
    .prepare(`INSERT INTO products (${PRODUCT_COLUMNS.join(', ')}) VALUES (${PRODUCT_COLUMNS.map(() => '?').join(', ')})`)
    .bind(...PRODUCT_COLUMNS.map((k) => full[k]))
    .run()
  await refreshCapBags(c)
  return json({ product: await productById(c, full.id) }, 201)
}

export async function updateProduct(c) {
  const b = await c.body()
  if (!isObj(b)) throw bad('body', 'Send the product as JSON.')
  const existing = await productById(c, c.params.id)
  if (b.kind !== undefined && b.kind !== existing.kind) {
    throw bad('kind', "A product can't change between firewood and pellets. Add a new product instead.")
  }
  const row = validateProduct({ ...existing, ...b, kind: existing.kind, price_cents: mergePrices(existing.price_cents, b.price_cents) })
  const cols = Object.keys(row).filter((k) => k !== 'kind')
  await c.db
    .prepare(`UPDATE products SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .bind(...cols.map((k) => row[k]), existing.id)
    .run()
  await refreshCapBags(c)
  return json({ product: await productById(c, existing.id) })
}

export async function adjustStock(c) {
  const b = (await c.body()) || {}
  const p = await productById(c, c.params.id)
  need(b.mode === 'set' || b.mode === 'add', 'mode', 'Pick set the count or add to it.')
  const set = b.mode === 'set'
  let change
  let col
  if (p.kind === 'wood') {
    need(
      isNum(b.cords, set ? 0 : -10000, 10000) && twoDp(b.cords) && (set || b.cords !== 0),
      'cords',
      set
        ? 'Enter the cords in the yard, from 0 to 10,000, with at most 2 decimals.'
        : 'Enter the cords to add (or take off with a minus), with at most 2 decimals.',
    )
    col = 'stock_cu_in'
    change = set ? cordsToCuIn(b.cords) - p.stock_cu_in : cordsToCuIn(b.cords)
  } else {
    need(
      isInt(b.bags, set ? 0 : -1000000, 1000000) && (set || b.bags !== 0),
      'bags',
      set ? 'Enter the bags in the yard, from 0 to 1,000,000.' : 'Enter the bags to add (or take off with a minus).',
    )
    col = 'stock_bags'
    change = set ? b.bags - p.stock_bags : b.bags
  }
  const note = b.note === undefined || b.note === null ? '' : b.note
  need(isText(note, 0, 200), 'note', 'Keep the note to 200 characters.')
  if (change !== 0) {
    await c.db.batch([
      c.db.prepare(`UPDATE products SET ${col} = ${col} + ? WHERE id = ?`).bind(change, p.id),
      c.db
        .prepare(`INSERT INTO stock_moves (product_id, change, reason, note, at) VALUES (?, ?, 'adjust', ?, ?)`)
        .bind(p.id, change, note.trim(), c.nowIso),
    ])
  }
  return json({ product: await productById(c, p.id) })
}

// ---------- PINs ----------

export async function changePin(c) {
  const b = (await c.body()) || {}
  need(b.which === 'dealer' || b.which === 'driver', 'which', 'Pick the dealer PIN or the driver PIN.')
  await assertSigninAllowed(c)
  const row = await c.db
    .prepare('SELECT dealer_pin_hash, dealer_pin_salt, driver_pin_hash, driver_pin_salt FROM settings WHERE id = 1')
    .first()
  const current = typeof b.current_dealer_pin === 'string' ? b.current_dealer_pin : ''
  const ok = /^\d{4,8}$/.test(current) && sameHex(await hashPin(current, row.dealer_pin_salt), row.dealer_pin_hash)
  if (!ok) {
    await signinAttempt(c, false).run()
    throw new ApiError(401, 'unauthorized', 'That PIN is not right.', { field: 'current_dealer_pin' })
  }
  need(typeof b.new_pin === 'string' && /^\d{4,8}$/.test(b.new_pin), 'new_pin', 'A PIN is 4 to 8 digits.')
  const other = b.which === 'dealer' ? 'driver' : 'dealer'
  if (sameHex(await hashPin(b.new_pin, row[`${other}_pin_salt`]), row[`${other}_pin_hash`])) {
    throw bad('new_pin', `Use a different PIN from the ${other}'s PIN.`)
  }
  const salt = randomSaltHex()
  const hash = await hashPin(b.new_pin, salt)
  // Everyone signed in with the old PIN of that role must sign in again; the dealer making the change stays signed in.
  await c.db.batch([
    c.db
      .prepare(`UPDATE settings SET ${b.which}_pin_hash = ?, ${b.which}_pin_salt = ?, updated_at = ? WHERE id = 1`)
      .bind(hash, salt, c.nowIso),
    c.db.prepare('DELETE FROM sessions WHERE role = ? AND token_hash <> ?').bind(b.which, await sha256Hex(c.token)),
  ])
  return json({ changed: b.which })
}
