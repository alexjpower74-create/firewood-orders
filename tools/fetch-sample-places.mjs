// Fetch the community points used for SAMPLE customers and the SAMPLE yard from Natural Resources Canada's
// Geographical Names (CGNDB) search API. Public API, Open Government Licence - Canada. One request per 1.2 s, clear UA.
// Raw answers go to data/sources/geonames/, the chosen points to data/sample-places.json.
// (Nominatim was the first choice; its robots.txt disallows /search, so it is not used.)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const UA = 'APCO-Software-Tools-research/1.0 (+https://apcosoftwaretools.ca)'
const NAMES = [
  'Springdale',
  "King's Point",
  'South Brook',
  "Robert's Arm",
  "Pilley's Island",
  'Little Bay',
  'Beachside',
  "St. Patrick's",
  "Harry's Harbour",
  'Middle Arm',
  "Jackson's Cove",
  'Sheppardville',
  'Triton',
  'Baie Verte',
  'Buchans',
]
const norm = (s) => s.normalize('NFKD').replace(/[’']/g, "'").toLowerCase().trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(join(root, 'data/sources/geonames'), { recursive: true })

// Several NL places share a name (there are many Little Bays). Among exact-name populated places, take the one
// nearest the first place (Springdale): this is a Green Bay dealer. Cached answers are reused (no second request).
const km = (a, b) => {
  const r = (x) => (x * Math.PI) / 180
  const dLat = r(b.latitude - a.latitude)
  const dLng = r(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}
const places = []
let anchor = null
for (const name of NAMES) {
  const url = `https://geogratis.gc.ca/services/geoname/en/geonames.json?q=${encodeURIComponent(name)}&province=10`
  const slug = norm(name).replace(/[^a-z0-9]+/g, '-')
  const cache = join(root, `data/sources/geonames/${slug}.json`)
  let fetched, status, text
  if (existsSync(cache)) {
    ;({ fetched, status, body: text } = JSON.parse(readFileSync(cache, 'utf8')))
  } else {
    fetched = new Date().toISOString()
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    status = res.status
    text = await res.text()
    writeFileSync(cache, JSON.stringify({ url, fetched, status, body: text }, null, 2))
    await sleep(1200)
  }
  let items = []
  try {
    items = JSON.parse(text).items || []
  } catch {}
  const exact = items.filter((i) => norm(i.name) === norm(name))
  const populated = exact.filter((i) => /^(TOWN|UNP|CITY|VILG)$/.test(i.concise?.code || ''))
  const pool = populated.length ? populated : exact
  const hit = anchor ? pool.sort((a, b) => km(anchor, a) - km(anchor, b))[0] : pool[0]
  if (!anchor && hit) anchor = hit
  const res = { status }
  console.log(
    name,
    res.status,
    items.length,
    hit
      ? `${hit.latitude},${hit.longitude} ${hit.concise?.code} ${hit.id} ${hit.location} ${anchor ? km(anchor, hit).toFixed(1) + ' km' : ''}`
      : 'NO MATCH',
  )
  if (hit)
    places.push({
      name: hit.name,
      lat: hit.latitude,
      lng: hit.longitude,
      concise: hit.concise?.code,
      cgndb_id: hit.id,
      location: hit.location,
      km_from_springdale: Math.round(km(anchor, hit) * 10) / 10,
      source_url: url,
      fetched,
      record: hit,
    })
}
writeFileSync(
  join(root, 'data/sample-places.json'),
  JSON.stringify(
    {
      about:
        'Community points for SAMPLE customers and the SAMPLE yard. Real place names and CGNDB coordinates; the people and the dealer are SAMPLE. No house numbers.',
      source: 'Natural Resources Canada, Canadian Geographical Names Database (CGNDB) search API',
      licence: 'Open Government Licence - Canada (https://open.canada.ca/en/open-government-licence-canada)',
      places,
    },
    null,
    2,
  ) + '\n',
)
