// Route order by straight-line distance. Pure and deterministic.
export const EARTH_RADIUS_KM = 6371
const IMPROVE_KM = 0.001 // a 2-opt move must shorten the path by more than 1 m

const rad = (d) => (d * Math.PI) / 180

export function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

// Length of start → points… → end.
export function pathKm(start, points, end) {
  let km = 0
  let prev = start
  for (const p of [...points, end]) {
    km += haversineKm(prev, p)
    prev = p
  }
  return km
}

// Nearest neighbour from `start`; ties go to the lower id.
export function nearestNeighbour(start, stops) {
  const left = [...stops]
  const out = []
  let at = start
  while (left.length) {
    let best = 0
    let bestKm = haversineKm(at, left[0])
    for (let i = 1; i < left.length; i++) {
      const km = haversineKm(at, left[i])
      if (km < bestKm || (km === bestKm && left[i].id < left[best].id)) {
        best = i
        bestKm = km
      }
    }
    at = left.splice(best, 1)[0]
    out.push(at)
  }
  return out
}

// 2-opt on the open sequence between fixed `start` and `end`: reverse any segment while that shortens the path by
// more than 1 m; repeat until no move improves.
export function twoOpt(start, seq, end) {
  const s = [...seq]
  const n = s.length
  const at = (i) => (i < 0 ? start : i >= n ? end : s[i])
  let improved = true
  while (improved) {
    improved = false
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const before = haversineKm(at(i - 1), s[i]) + haversineKm(s[j], at(j + 1))
        const after = haversineKm(at(i - 1), s[j]) + haversineKm(s[i], at(j + 1))
        if (before - after > IMPROVE_KM) {
          reverse(s, i, j)
          improved = true
        }
      }
    }
  }
  return s
}

function reverse(arr, i, j) {
  while (i < j) {
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
    i++
    j--
  }
}

// stops: [{ id, lat, lng }] → the same objects in route order.
export function optimizeRoute(start, stops, end) {
  if (stops.length < 2) return [...stops]
  return twoOpt(start, nearestNeighbour(start, stops), end)
}
