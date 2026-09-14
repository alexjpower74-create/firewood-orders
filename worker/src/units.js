// Units: wood is integer cubic inches, pellets are integer bags. Pure.
import { ApiError } from './errors.js'

export const CU_IN_PER_CORD = 221184 // 4 ft × 4 ft × 8 ft = 128 cu ft × 1728
export const FACE_CORD_CU_IN_PER_INCH = 4608 // 4 ft × 8 ft face = 48 in × 96 in
export const WOOD_UNITS = ['cord', 'half_cord', 'face_cord', 'load']
export const PELLET_UNITS = ['bag', 'ton', 'skid']

const NAMES = {
  cord: ['cord', 'cords'], half_cord: ['half cord', 'half cords'], face_cord: ['face cord', 'face cords'],
  load: ['load', 'loads'], bag: ['bag', 'bags'], ton: ['ton', 'tons'], skid: ['skid', 'skids'],
}

export function unitsFor(kind) {
  return kind === 'wood' ? WOOD_UNITS : PELLET_UNITS
}

export function unitName(unit, qty = 1) {
  return NAMES[unit][qty === 1 ? 0 : 1]
}

export function qtyLabel(unit, qty) {
  return `${qty} ${unitName(unit, qty)}`
}

// Volume of ONE unit: { wood_cu_in, pellet_bags }. `loadCuIn` is the dealer's load, already in cubic inches.
export function unitVolume(product, unit, loadCuIn) {
  if (product.kind === 'wood') {
    const v = { cord: CU_IN_PER_CORD, half_cord: CU_IN_PER_CORD / 2, face_cord: FACE_CORD_CU_IN_PER_INCH * product.cut_in,
      load: loadCuIn }[unit]
    if (v === undefined) throw new ApiError(400, 'not_offered', 'Pick how much you would like.', { field: 'unit' })
    return { wood_cu_in: v, pellet_bags: 0 }
  }
  const b = { bag: 1, ton: product.bags_per_ton, skid: product.bags_per_skid }[unit]
  if (b === undefined) throw new ApiError(400, 'not_offered', 'Pick how much you would like.', { field: 'unit' })
  return { wood_cu_in: 0, pellet_bags: b }
}

// Cords shown to people: rounded to 2 decimals (a number, e.g. 4.5).
export function cordsOf(cuIn) {
  return Math.round((cuIn * 100) / CU_IN_PER_CORD) / 100
}

// "4.50"
export function cordsText(cuIn) {
  return cordsOf(cuIn).toFixed(2)
}

// Settings take cords with at most 2 decimals and store round(cords × 221184).
export function cordsToCuIn(cords) {
  return Math.round((Math.round(cords * 100) * CU_IN_PER_CORD) / 100)
}

// "{f}": cut_in / 48 with two decimals, half-up, computed in integers.
export function faceFraction(cutIn) {
  const hundredths = Math.floor((cutIn * 200 + 48) / 96)
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`
}

// The dealer's decimal as typed, trimmed: 1.5 → "1.5", 2 → "2".
export function trimDecimal(n) {
  return String(Number(Number(n).toFixed(2)))
}

export function explain(product, unit, load) {
  switch (unit) {
    case 'cord': return 'A full cord: a stack 4 feet high, 4 feet wide and 8 feet long (128 cubic feet).'
    case 'half_cord': return 'Half a cord: 64 cubic feet, half of a full cord.'
    case 'face_cord':
      return `A face cord: one row 4 feet high and 8 feet long, as deep as the pieces are long (${product.cut_in} inches). ` +
        `That is ${faceFraction(product.cut_in)} of a full cord.`
    case 'load': return `${load.description} We count a load as ${trimDecimal(load.cords)} cords.`
    case 'bag': return `One ${product.bag_lb} lb bag.`
    case 'ton': return `A ton: ${product.bags_per_ton} bags of ${product.bag_lb} lb.`
    case 'skid': return `A skid: ${product.bags_per_skid} bags of ${product.bag_lb} lb, shrink-wrapped on a pallet.`
  }
  throw new Error(`unknown unit ${unit}`)
}
