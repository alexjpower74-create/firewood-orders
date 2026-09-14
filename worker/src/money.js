// Money: integer cents, no floats in sums. Pure; the Worker calls these and nothing else for prices and balances.
import { ApiError } from './errors.js'
import { CU_IN_PER_CORD, qtyLabel, unitName, unitVolume, explain } from './units.js'
import { haversineKm } from './route.js'

export const HST_PERCENT = 15

// Half-up integer division for non-negative a, positive b.
export function halfUpDiv(a, b) {
  return Math.floor((2 * a + b) / (2 * b))
}

export function priceOf(product, unit) {
  const p = product.price_cents?.[unit]
  return p === undefined ? null : p
}

export function goodsCents(product, unit, qty) {
  const price = priceOf(product, unit)
  if (price === null) {
    throw new ApiError(400, 'not_offered', `We don't sell ${product.name} by the ${unitName(unit)}.`, { field: 'unit' })
  }
  return price * qty
}

export function stackingCents(perCord, woodCuIn) {
  return halfUpDiv(perCord * woodCuIn, CU_IN_PER_CORD)
}

export function hstCents(subtotalCents, registered) {
  return registered ? Math.floor((subtotalCents * HST_PERCENT + 50) / 100) : 0
}

// Delivery fee for a pin. `delivery` = settings.delivery.
export function deliveryCents(delivery, distanceKm, zoneId) {
  if (delivery.mode === 'zones') {
    const zone = delivery.zones.find((z) => z.id === zoneId)
    if (!zone) throw new ApiError(400, 'bad_request', 'Pick your area.', { field: 'zone_id' })
    return zone.fee_cents
  }
  const bands = [...delivery.bands].sort((a, b) => a.up_to_km - b.up_to_km)
  const band = bands.find((b) => distanceKm <= b.up_to_km)
  if (!band) throw new ApiError(400, 'outside_area', delivery.beyond_message, { field: 'pin' })
  return band.fee_cents
}

export function bandLabel(band) {
  return `Up to ${band.up_to_km} km: ${band.fee_cents === 0 ? 'free' : formatMoney(band.fee_cents)}`
}

// The full price of an order. `input` = { product, unit, qty, stacking, lat, lng, zone_id, delivery_override }.
// `settings` = { delivery, yard, min_order_cents, hst_registered, load, load_cu_in }.
export function priceOrder(input, settings) {
  const { product, unit, qty } = input
  const goods = goodsCents(product, unit, qty)
  const one = unitVolume(product, unit, settings.load_cu_in)
  const wood = one.wood_cu_in * qty
  const bags = one.pellet_bags * qty
  let stacking = 0
  if (input.stacking) {
    if (product.kind !== 'wood' || product.stacking_cents_per_cord === null || product.stacking_cents_per_cord === undefined) {
      throw new ApiError(400, 'bad_request', "We don't offer stacking for this.", { field: 'stacking' })
    }
    stacking = stackingCents(product.stacking_cents_per_cord, wood)
  }
  // A quote before the map is tapped has no pin: nothing that depends on distance is guessed (all null).
  const pin = input.lat === null || input.lat === undefined ? null : { lat: input.lat, lng: input.lng }
  const distance = pin ? haversineKm(settings.yard, pin) : null
  const delivery = pin ? input.delivery_override ?? deliveryCents(settings.delivery, distance, input.zone_id) : null
  if (goods + stacking < settings.min_order_cents) {
    throw new ApiError(400, 'below_minimum',
      `The smallest order we deliver is ${formatMoney(settings.min_order_cents)} before delivery.`, { field: 'qty' })
  }
  const subtotal = pin ? goods + stacking + delivery : null
  const hst = pin ? hstCents(subtotal, settings.hst_registered) : null
  return {
    product_label: product.name, qty_label: qtyLabel(unit, qty), explain: explain(product, unit, settings.load),
    wood_cu_in: wood, pellet_bags: bags, distance_km: pin ? Math.round(distance * 10) / 10 : null,
    goods_cents: goods, stacking_cents: stacking, delivery_cents: delivery,
    subtotal_cents: subtotal, hst_cents: hst, total_cents: pin ? subtotal + hst : null,
  }
}

// "$1,234.56"; negative "-$1.00".
export function formatMoney(cents) {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`
}

// "123.45" for CSV.
export function plainMoney(cents) {
  return formatMoney(cents).replace('$', '').replace(/,/g, '')
}

// --- Balances. A payment counts unless voided; a cancelled order charges nothing. ---

// A payment counts toward every sum unless it was voided.
export const counts = (p) => !p.voided

export function paidCents(orderId, payments) {
  let sum = 0
  for (const p of payments) if (p.order_id === orderId && counts(p)) sum += p.amount_cents
  return sum
}

export function owingCents(order, payments) {
  return (order.status === 'cancelled' ? 0 : order.total_cents) - paidCents(order.id, payments)
}

// `orders` and `payments` are that customer's rows.
export function customerBalance(orders, payments) {
  let charged = 0
  for (const o of orders) if (o.status !== 'cancelled') charged += o.total_cents
  let paid = 0
  for (const p of payments) if (counts(p)) paid += p.amount_cents
  return charged - paid
}

// A cancelled order with nothing paid never says "Paid in full": no money changed hands.
export function owingLabel(owing, { cancelled = false } = {}) {
  if (owing === 0) return cancelled ? 'Nothing owing' : 'Paid in full'
  return owing > 0 ? `Balance owing ${formatMoney(owing)}` : `Credit ${formatMoney(-owing)}`
}
