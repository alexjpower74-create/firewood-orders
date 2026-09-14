// Route: haversine, nearest neighbour + 2-opt, local optimum on seeded instances, determinism, edge cases.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { haversineKm, nearestNeighbour, optimizeRoute, pathKm } from '../src/route.js'
import { SAMPLE_PLACES } from '../src/sample-places.js'

const place = (name) => SAMPLE_PLACES.find((p) => p.name === name)
// A local grid near 49.5 N where one unit is about 1.11 km both ways.
const P = (id, x, y) => ({ id, lat: 49.5 + y * 0.01, lng: -56 + (x * 0.01) / Math.cos((49.5 * Math.PI) / 180) })
const ids = (stops) => stops.map((s) => s.id)

test("haversine: Springdale to King's Point, formula written out", () => {
  const a = place('Springdale')
  const b = place("King's Point")
  const R = 6371
  const toRad = Math.PI / 180
  const phi1 = a.lat * toRad
  const phi2 = b.lat * toRad
  const dPhi = (b.lat - a.lat) * toRad
  const dLambda = (b.lng - a.lng) * toRad
  const h = Math.sin(dPhi / 2) * Math.sin(dPhi / 2) + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) * Math.sin(dLambda / 2)
  const expected = 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
  assert.ok(Math.abs(haversineKm(a, b) - expected) < 1e-9, `${haversineKm(a, b)} vs ${expected}`)
  assert.equal(Math.round(expected * 10) / 10, 12.9)
  assert.equal(haversineKm(a, a), 0)
})

// Yard Y(0,0); stops 1(2,3), 2(2,2), 3(-2,0), 4(2,6) in grid units.
// Nearest neighbour from Y: 3 (2.0 away, vs 2 at 2.83) → from 3: 2 (4.47, vs 1 at 5.0) → 1 (1.0) → 4 (3.0) → back to Y.
// The leg 3→2 crosses the leg 4→Y (at about (0.4, 1.2)). Reversing 2,1,4 gives Y→3→4→1→2→Y, which does not cross.
const Y = P('yard', 0, 0)
const CROSSING = [P('o_1', 2, 3), P('o_2', 2, 2), P('o_3', -2, 0), P('o_4', 2, 6)]

test('crossing instance: nearest neighbour crosses itself, 2-opt uncrosses it', () => {
  const nn = nearestNeighbour(Y, CROSSING)
  assert.deepEqual(ids(nn), ['o_3', 'o_2', 'o_1', 'o_4'])
  const best = optimizeRoute(Y, CROSSING, Y)
  assert.deepEqual(ids(best), ['o_3', 'o_4', 'o_1', 'o_2'])
  assert.ok(pathKm(Y, best, Y) < pathKm(Y, nn, Y) - 0.5)
})

function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomInstance(rand) {
  const n = 2 + Math.floor(rand() * 11)
  const start = { lat: 49.3 + rand() * 0.6, lng: -56.5 + rand() * 1 }
  const yard = place('Springdale')
  const stops = []
  for (let i = 0; i < n; i++) stops.push({ id: `o_${String(i).padStart(2, '0')}`, lat: 49.3 + rand() * 0.6, lng: -56.5 + rand() })
  return { start, yard, stops }
}

test('50 seeded instances: no single segment reversal shortens the result by more than 1 m, and never worse than NN', () => {
  const rand = mulberry32(49511)
  for (let k = 0; k < 50; k++) {
    const { start, yard, stops } = randomInstance(rand)
    const best = optimizeRoute(start, stops, yard)
    assert.deepEqual([...ids(best)].sort(), [...ids(stops)].sort(), `instance ${k} keeps every stop once`)
    const len = pathKm(start, best, yard)
    for (let i = 0; i < best.length; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const trial = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)]
        const shorter = len - pathKm(start, trial, yard)
        assert.ok(shorter <= 0.001, `instance ${k}: reversing ${i}..${j} saves ${(shorter * 1000).toFixed(1)} m`)
      }
    }
    assert.ok(len <= pathKm(start, nearestNeighbour(start, stops), yard) + 1e-9, `instance ${k} no worse than NN`)
  }
})

test('deterministic: same input, same order, whatever order the stops arrive in', () => {
  const rand = mulberry32(7)
  const { start, yard, stops } = randomInstance(rand)
  const a = ids(optimizeRoute(start, stops, yard))
  const b = ids(optimizeRoute(start, [...stops].reverse(), yard))
  assert.deepEqual(a, ids(optimizeRoute(start, stops, yard)))
  assert.deepEqual(a, b)
})

test('ties go to the lower id', () => {
  const twins = [P('o_b', 1, 0), P('o_a', -1, 0)]
  assert.deepEqual(ids(nearestNeighbour(Y, twins)), ['o_a', 'o_b'])
})

test('empty and one-stop inputs', () => {
  assert.deepEqual(optimizeRoute(Y, [], Y), [])
  assert.deepEqual(ids(optimizeRoute(Y, [P('o_1', 3, 3)], Y)), ['o_1'])
  assert.equal(pathKm(Y, [], Y), 0)
})

test('a start other than the yard (mid-route re-optimize)', () => {
  // Driver is at S(6,0) after a delivery; stops at A(5,0), B(3,0), C(1,0) on the way home; yard at (0,0).
  const S = P('last', 6, 0)
  const stops = [P('o_c', 1, 0), P('o_a', 5, 0), P('o_b', 3, 0)]
  assert.deepEqual(ids(optimizeRoute(S, stops, Y)), ['o_a', 'o_b', 'o_c'])
  // From the yard instead, the same stops go outward-first by nearest neighbour then 2-opt: C, B, A then home.
  const fromYard = ids(optimizeRoute(Y, stops, Y))
  assert.equal(fromYard[0], 'o_c')
})
