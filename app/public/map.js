// The base map under every Leaflet map (order pin, dealer route, yard pin): the vector style named by GET /api/info's
// map.style (OpenFreeMap by default, set once in worker/wrangler.toml), drawn by MapLibre GL through @maplibre/maplibre-gl-leaflet.
// Leaflet still owns the map: pins, taps, zoom buttons and the attribution control. MapLibre (about 1 MB) loads only when a map
// mounts, so the order page's first step stays quick on a phone. If MapLibre cannot start (no WebGL), the map still takes taps
// and pins, and the provider's attribution is shown either way.
const MAPLIBRE_CSS = '/vendor/maplibre-gl/maplibre-gl.css'
const MAPLIBRE_JS = '/vendor/maplibre-gl/maplibre-gl.js'
const BINDING_JS = '/vendor/maplibre-gl-leaflet/leaflet-maplibre-gl.js'

let loading = null

function addScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = resolve
    s.onerror = () => reject(new Error(`could not load ${src}`))
    document.head.append(s)
  })
}

function loadMapLibre() {
  if (typeof window.maplibregl !== 'undefined' && typeof L.maplibreGL === 'function') return Promise.resolve(true)
  if (!loading) {
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = MAPLIBRE_CSS
    document.head.append(css)
    loading = addScript(MAPLIBRE_JS)
      .then(() => addScript(BINDING_JS))
      .then(
        () => true,
        (e) => {
          console.warn('[map] the base map could not load', e)
          return false
        },
      )
  }
  return loading
}

/** Put the provider's attribution in Leaflet's control at once, then draw the vector style under the map when MapLibre is ready. */
export function addBaseLayer(map, mapInfo) {
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>')
  if (!mapInfo?.style) return
  map.attributionControl.addAttribution(mapInfo.attribution)
  let removed = false
  map.once('unload', () => {
    removed = true
  })
  loadMapLibre().then((ok) => {
    if (!ok || removed) return
    try {
      L.maplibreGL({ style: mapInfo.style, interactive: false }).addTo(map)
    } catch (e) {
      console.warn('[map] the base map could not start', e)
    }
  })
}
