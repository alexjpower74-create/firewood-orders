// Units: every volume, face cords by piece length, explain texts exact, qty_label plurals.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cordsOf, cordsText, cordsToCuIn, explain, qtyLabel, unitVolume } from '../src/units.js'

const wood = { kind: 'wood', name: 'Mixed softwood, dry', cut_in: 16 }
const pellets = { kind: 'pellets', name: 'SAMPLE Premium wood pellets', bag_lb: 40, bags_per_ton: 50, bags_per_skid: 70 }
const load = { cords: 1.5, description: 'A load is what our dump truck carries in one trip, dumped in a pile, not stacked.' }
const LOAD_CU_IN = 331776 // 1.5 × 221 184

test('every unit has the volume in the table', () => {
  // 4 ft × 4 ft × 8 ft = 48 × 48 × 96 cubic inches
  assert.deepEqual(unitVolume(wood, 'cord', LOAD_CU_IN), { wood_cu_in: 48 * 48 * 96, pellet_bags: 0 })
  assert.equal(48 * 48 * 96, 221184)
  assert.deepEqual(unitVolume(wood, 'half_cord', LOAD_CU_IN), { wood_cu_in: 110592, pellet_bags: 0 })
  assert.deepEqual(unitVolume(wood, 'face_cord', LOAD_CU_IN), { wood_cu_in: 73728, pellet_bags: 0 })
  assert.deepEqual(unitVolume(wood, 'load', LOAD_CU_IN), { wood_cu_in: 331776, pellet_bags: 0 })
  assert.deepEqual(unitVolume(pellets, 'bag', LOAD_CU_IN), { wood_cu_in: 0, pellet_bags: 1 })
  assert.deepEqual(unitVolume(pellets, 'ton', LOAD_CU_IN), { wood_cu_in: 0, pellet_bags: 50 })
  assert.deepEqual(unitVolume(pellets, 'skid', LOAD_CU_IN), { wood_cu_in: 0, pellet_bags: 70 })
  assert.throws(() => unitVolume(pellets, 'cord', LOAD_CU_IN), { code: 'not_offered' })
})

test('a face cord is 48 in × 96 in × the piece length', () => {
  for (const [cut, cuIn, f] of [
    [12, 55296, '0.25'],
    [16, 73728, '0.33'],
    [18, 82944, '0.38'],
    [24, 110592, '0.50'],
  ]) {
    const p = { ...wood, cut_in: cut }
    assert.equal(unitVolume(p, 'face_cord', 0).wood_cu_in, 48 * 96 * cut)
    assert.equal(unitVolume(p, 'face_cord', 0).wood_cu_in, cuIn)
    assert.equal(
      explain(p, 'face_cord', load),
      `A face cord: one row 4 feet high and 8 feet long, as deep as the pieces are long (${cut} inches). That is ${f} of a full cord.`,
    )
  }
  // 16 in is exactly a third of a cord
  assert.equal(73728 * 3, 221184)
})

test('explain texts are exact', () => {
  assert.equal(explain(wood, 'cord', load), 'A full cord: a stack 4 feet high, 4 feet wide and 8 feet long (128 cubic feet).')
  assert.equal(explain(wood, 'half_cord', load), 'Half a cord: 64 cubic feet, half of a full cord.')
  assert.equal(
    explain(wood, 'load', load),
    'A load is what our dump truck carries in one trip, dumped in a pile, not stacked. We count a load as 1.5 cords.',
  )
  assert.equal(explain(wood, 'load', { cords: 2, description: 'Our load.' }), 'Our load. We count a load as 2 cords.')
  assert.equal(explain(pellets, 'bag', load), 'One 40 lb bag.')
  assert.equal(explain(pellets, 'ton', load), 'A ton: 50 bags of 40 lb.')
  assert.equal(explain(pellets, 'skid', load), 'A skid: 70 bags of 40 lb, shrink-wrapped on a pallet.')
})

test('qty_label singular and plural', () => {
  assert.equal(qtyLabel('cord', 1), '1 cord')
  assert.equal(qtyLabel('cord', 2), '2 cords')
  assert.equal(qtyLabel('half_cord', 2), '2 half cords')
  assert.equal(qtyLabel('face_cord', 3), '3 face cords')
  assert.equal(qtyLabel('load', 1), '1 load')
  assert.equal(qtyLabel('load', 4), '4 loads')
  assert.equal(qtyLabel('bag', 10), '10 bags')
  assert.equal(qtyLabel('bag', 1), '1 bag')
  assert.equal(qtyLabel('ton', 1), '1 ton')
  assert.equal(qtyLabel('skid', 2), '2 skids')
})

test('cords shown to people and cords typed by the dealer', () => {
  assert.equal(cordsToCuIn(4.5), 995328)
  assert.equal(cordsToCuIn(1.5), 331776)
  assert.equal(cordsToCuIn(0.33), Math.round((33 * 221184) / 100))
  assert.equal(cordsOf(884736), 4)
  assert.equal(cordsOf(995328), 4.5)
  assert.equal(cordsOf(73728), 0.33)
  assert.equal(cordsText(884736), '4.00')
  assert.equal(cordsText(995328), '4.50')
})
