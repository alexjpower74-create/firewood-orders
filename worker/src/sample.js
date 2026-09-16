// The SAMPLE dealer: what migrations/0002_sample.sql installs and POST /api/test/reset restores.
// One source: tools/build-sample-data.mjs renders sampleStatements() into the migration.
import { SAMPLE_PLACES } from './sample-places.js'
import { cordsToCuIn } from './units.js'

const springdale = SAMPLE_PLACES.find((p) => p.name === 'Springdale')

export const SAMPLE_SETTINGS = {
  name: 'SAMPLE Wood & Pellets — Springdale (demo)',
  short_name: 'SAMPLE Wood & Pellets',
  sample: true,
  phone: '709-555-0100',
  deposit_text:
    'This page takes no payments. To pay a deposit, send an Interac e-Transfer to sample-wood@example.com with ' +
    'your name in the message. You can also pay cash or e-Transfer when we deliver.',
  season_open: true,
  season_message: "We're closed for the season. Call 709-555-0100 and we'll take your name for the fall.",
  season_start: '09-01',
  min_order_cents: 11000,
  hst_registered: true,
  yard: { lat: springdale.lat, lng: springdale.lng, label: 'Our yard, Springdale (SAMPLE)' },
  delivery: {
    mode: 'bands',
    bands: [
      { up_to_km: 10, fee_cents: 0 },
      { up_to_km: 30, fee_cents: 2500 },
      { up_to_km: 60, fee_cents: 5000 },
    ],
    zones: [],
    beyond_message: "That's farther than we deliver. Call us at 709-555-0100 and we'll see what we can do.",
  },
  load: { cords: 1.5, description: 'A load is what our dump truck carries in one trip, dumped in a pile, not stacked.' },
  truck: { name: 'SAMPLE one-ton dump truck', wood_cords_per_day: 4.5, pellet_skids_per_day: 3 },
  delivery_weekdays: [1, 2, 3, 4, 5, 6],
  window_days: 21,
}

// The SAMPLE PINs are public (docs/API.md); only their PBKDF2 hashes are stored. tests/sample.test.mjs re-derives them.
export const SAMPLE_PINS = {
  dealer: {
    pin: '1357',
    salt: '5a4d504c45446561c1e7d0f1a2b3c4d5',
    hash: '2cfa6aa78c2e2e43c6c45cc496b109305c3d04b1a113f6c5bff32f90fa16cdd7',
  },
  driver: {
    pin: '2580',
    salt: '5a4d504c45447276e8f9a0b1c2d3e4f5',
    hash: '769d4ae8e09a9e5453443c77c34cf8c25dbee57fe53109f9c71bc812414be5ae',
  },
}

const wood = (id, name, species, split, prices, stacking, stockCords, sort) => ({
  id,
  kind: 'wood',
  name,
  species,
  dryness: name.endsWith('green') ? 'green' : 'dry',
  cut_in: 16,
  split: split ? 1 : 0,
  stacking_cents_per_cord: stacking,
  price_cord: prices[0],
  price_half_cord: prices[1],
  price_face_cord: prices[2],
  price_load: prices[3],
  stock_cu_in: cordsToCuIn(stockCords),
  stock_bags: 0,
  active: 1,
  sort,
})

export const SAMPLE_PRODUCTS = [
  wood('p_softwood_dry', 'Mixed softwood, dry', 'Spruce and fir', true, [30000, 17000, 12000, 42000], 6000, 40, 1),
  wood('p_birch_dry', 'Birch, dry', 'Birch', true, [37500, 20000, 14000, null], 6000, 12, 2),
  wood('p_softwood_green', 'Mixed softwood, green', 'Spruce and fir', false, [22000, null, null, 30000], null, 25, 3),
  {
    id: 'p_pellets',
    kind: 'pellets',
    name: 'SAMPLE Premium wood pellets',
    brand: 'SAMPLE Premium',
    bag_lb: 40,
    bags_per_ton: 50,
    bags_per_skid: 70,
    price_bag: 799,
    price_ton: 36500,
    price_skid: 49900,
    stock_cu_in: 0,
    stock_bags: 600,
    active: 1,
    sort: 4,
  },
]

export const PRODUCT_COLUMNS = [
  'id',
  'kind',
  'name',
  'species',
  'dryness',
  'cut_in',
  'split',
  'stacking_cents_per_cord',
  'price_cord',
  'price_half_cord',
  'price_face_cord',
  'price_load',
  'brand',
  'bag_lb',
  'bags_per_ton',
  'bags_per_skid',
  'price_bag',
  'price_ton',
  'price_skid',
  'stock_cu_in',
  'stock_bags',
  'active',
  'sort',
]

const SAMPLE_TIME = '2026-09-14T00:00:00.000Z'

export function sampleStatements() {
  const s = SAMPLE_SETTINGS
  const bagsPerSkid = SAMPLE_PRODUCTS.find((p) => p.kind === 'pellets' && p.active).bags_per_skid
  const out = [
    {
      sql:
        'INSERT INTO settings (id, data, load_cu_in, cap_cu_in, cap_bags, dealer_pin_hash, dealer_pin_salt, ' +
        'driver_pin_hash, driver_pin_salt, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      params: [
        JSON.stringify(s),
        cordsToCuIn(s.load.cords),
        cordsToCuIn(s.truck.wood_cords_per_day),
        s.truck.pellet_skids_per_day * bagsPerSkid,
        SAMPLE_PINS.dealer.hash,
        SAMPLE_PINS.dealer.salt,
        SAMPLE_PINS.driver.hash,
        SAMPLE_PINS.driver.salt,
        SAMPLE_TIME,
      ],
    },
  ]
  for (const p of SAMPLE_PRODUCTS) {
    out.push({
      sql: `INSERT INTO products (${PRODUCT_COLUMNS.join(', ')}) VALUES (${PRODUCT_COLUMNS.map(() => '?').join(', ')})`,
      params: PRODUCT_COLUMNS.map((c) => p[c] ?? null),
    })
  }
  return out
}
