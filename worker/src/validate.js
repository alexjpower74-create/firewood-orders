// Order input validation (400 bad_request with `field`). Pure.
import { ApiError, bad } from './errors.js'
import { unitName, unitsFor } from './units.js'

export const MAX_PAYMENT_CENTS = 10000000

const str = (v) => (typeof v === 'string' ? v.trim() : null)
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export function phoneDigits(phone) {
  return phone.replace(/\D/g, '')
}

export function validPhone(phone) {
  return (
    typeof phone === 'string' &&
    phone.trim().length >= 7 &&
    phone.trim().length <= 32 &&
    /^[0-9 +\-().]+$/.test(phone.trim()) &&
    phoneDigits(phone).length >= 7
  )
}

// What is ordered and where: product, unit, qty, stacking, pin, zone, and (dealer only) a delivery fee override.
// `quote`: a quote may come before the pin. `dealer` (phone orders and quotes) allows a delivery_cents override.
export function parseProductInput(body, { products, settings, dealer, quote }) {
  const b = isObj(body) ? body : {}
  const product = products.find((p) => p.id === b.product_id && p.active)
  if (!product) throw bad('product_id', 'Pick what you would like.')
  if (!unitsFor(product.kind).includes(b.unit)) throw bad('unit', 'Pick how much you would like.')
  if (product.price_cents[b.unit] === null) {
    throw new ApiError(400, 'not_offered', `We don't sell ${product.name} by the ${unitName(b.unit)}.`, { field: 'unit' })
  }
  if (!Number.isInteger(b.qty) || b.qty < 1 || b.qty > 20) throw bad('qty', 'Pick a quantity from 1 to 20.')
  if (b.stacking !== undefined && b.stacking !== null && typeof b.stacking !== 'boolean') {
    throw bad('stacking', 'Say whether you want it stacked.')
  }
  const stacking = b.stacking === true
  if (stacking && (product.kind !== 'wood' || product.stacking_cents_per_cord === null)) {
    throw bad('stacking', "We don't offer stacking for this.")
  }
  const okNum = (v) => typeof v === 'number' && Number.isFinite(v)
  // Only a quote may leave the pin out, and only whole: lat and lng both absent or null.
  const noPin = !!quote && (b.lat === undefined || b.lat === null) && (b.lng === undefined || b.lng === null)
  if (!noPin && (!okNum(b.lat) || !okNum(b.lng) || b.lat < 46.5 || b.lat > 60.5 || b.lng < -67.9 || b.lng > -52.5)) {
    throw bad('pin', 'Tap the map where the truck should dump it.')
  }
  let deliveryOverride = null
  if (dealer && b.delivery_cents !== undefined && b.delivery_cents !== null) {
    if (!Number.isInteger(b.delivery_cents) || b.delivery_cents < 0 || b.delivery_cents > 50000) {
      throw bad('delivery_cents', 'Enter a delivery fee from $0.00 to $500.00.')
    }
    deliveryOverride = b.delivery_cents
  }
  let zoneId = null
  if (settings.delivery.mode === 'zones') {
    const known = settings.delivery.zones.some((z) => z.id === b.zone_id)
    // With a dealer fee the zone is only a note; without one it sets the fee and is required.
    if (!known && deliveryOverride === null && !noPin) throw bad('zone_id', 'Pick your area.')
    zoneId = known ? b.zone_id : null
  }
  return {
    product,
    unit: b.unit,
    qty: b.qty,
    stacking,
    lat: noPin ? null : b.lat,
    lng: noPin ? null : b.lng,
    zone_id: zoneId,
    delivery_override: deliveryOverride,
  }
}

// Who and when: address, dump notes, preferred days, name, phone, note.
// `deliveryDates` = the dates a customer may prefer.
export function parseContactInput(body, { deliveryDates }) {
  const b = isObj(body) ? body : {}
  const address = str(b.address)
  if (!address || address.length > 120) throw bad('address', 'Tell us where to find you, in up to 120 characters.')
  const dumpNotes = b.dump_notes === undefined || b.dump_notes === null ? '' : str(b.dump_notes)
  if (dumpNotes === null || dumpNotes.length > 200) throw bad('dump_notes', 'Keep the dump spot notes to 200 characters.')
  const pref = isObj(b.preferred) ? b.preferred : null
  const allowed = new Set(deliveryDates.map((d) => d.date))
  let preferredAny = false
  let preferred = []
  if (pref?.any === true) {
    preferredAny = true
  } else {
    const dates = Array.isArray(pref?.dates) ? pref.dates : []
    if (dates.length < 1 || dates.length > 7 || new Set(dates).size !== dates.length || !dates.every((d) => allowed.has(d))) {
      throw bad('preferred', 'Pick up to 7 days from the list, or Any day.')
    }
    preferred = [...dates].sort()
  }
  const name = str(b.name)
  if (!name || name.length > 80) throw bad('name', 'Tell us your name, in up to 80 characters.')
  if (!validPhone(b.phone)) throw bad('phone', 'Enter a phone number we can call, with at least 7 digits.')
  const note = b.note === undefined || b.note === null ? '' : str(b.note)
  if (note === null || note.length > 280) throw bad('note', 'Keep the note to 280 characters.')
  return { address, dump_notes: dumpNotes, preferred_any: preferredAny, preferred_dates: preferred, name, phone: b.phone.trim(), note }
}

// `full` = an order (name, phone, address…); otherwise a quote. `dealer` allows a delivery_cents override.
export function parseOrderInput(body, opts) {
  const input = parseProductInput(body, opts)
  return opts.full ? { ...input, ...parseContactInput(body, opts) } : input
}
