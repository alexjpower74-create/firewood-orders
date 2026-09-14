// Negative control (j), OpenFreeMap switch 2026-09-14: the copy's map module never adds the provider's attribution, so the map
// spec's attribution check must go red (OpenFreeMap's terms need it visible on every map).
import { runNegative } from './negative-lib.mjs'

const ok = runNegative({
  name: 'map-attribution',
  what: 'the base map is drawn without the OpenFreeMap attribution',
  breaks: [{
    file: 'map.js',
    find: '  map.attributionControl.addAttribution(mapInfo.attribution)\n',
    replace: '',
  }],
  spec: 'tests/web/map.spec.mjs',
  grep: 'order page: the pin step draws the OpenFreeMap style',
  red: /OpenFreeMap © OpenMapTiles Data from OpenStreetMap/,
})
process.exit(ok ? 0 : 1)
