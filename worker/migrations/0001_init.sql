-- Firewood Orders schema. Money is integer cents, wood integer cubic inches, pellets integer bags.
-- Times are ISO-8601 UTC instants; `date` columns are dealer-local (America/St_Johns) YYYY-MM-DD.

-- One dealer per deployment: a single settings row. `data` is the JSON the dealer edits (docs/API.md Settings);
-- the columns are what SQL itself needs (the capacity guard) and the PIN hashes, which never leave the Worker.
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  load_cu_in INTEGER NOT NULL,
  cap_cu_in INTEGER NOT NULL,
  cap_bags INTEGER NOT NULL,
  dealer_pin_hash TEXT NOT NULL,
  dealer_pin_salt TEXT NOT NULL,
  driver_pin_hash TEXT NOT NULL,
  driver_pin_salt TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('wood', 'pellets')),
  name TEXT NOT NULL,
  species TEXT,
  dryness TEXT CHECK (dryness IS NULL OR dryness IN ('dry', 'green')),
  cut_in INTEGER,
  split INTEGER,
  stacking_cents_per_cord INTEGER,
  price_cord INTEGER,
  price_half_cord INTEGER,
  price_face_cord INTEGER,
  price_load INTEGER,
  brand TEXT,
  bag_lb INTEGER,
  bags_per_ton INTEGER,
  bags_per_skid INTEGER,
  price_bag INTEGER,
  price_ton INTEGER,
  price_skid INTEGER,
  stock_cu_in INTEGER NOT NULL DEFAULT 0,
  stock_bags INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

-- Customers are matched by the last 10 digits of their phone number.
CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

-- Product label, explain text, volume and money are snapshotted at creation; only a dealer edit recomputes them.
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('requested', 'scheduled', 'out_for_delivery', 'delivered', 'cancelled')),
  source TEXT NOT NULL CHECK (source IN ('online', 'phone')),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  kind TEXT NOT NULL,
  product_label TEXT NOT NULL,
  unit TEXT NOT NULL,
  qty INTEGER NOT NULL,
  explain TEXT NOT NULL,
  stacking INTEGER NOT NULL DEFAULT 0,
  wood_cu_in INTEGER NOT NULL DEFAULT 0,
  pellet_bags INTEGER NOT NULL DEFAULT 0,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  distance_km REAL NOT NULL,
  zone_id TEXT,
  address TEXT NOT NULL,
  dump_notes TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  preferred_any INTEGER NOT NULL DEFAULT 0,
  preferred_dates TEXT NOT NULL DEFAULT '[]',
  goods_cents INTEGER NOT NULL,
  stacking_cents INTEGER NOT NULL,
  delivery_cents INTEGER NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  hst_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  delivery_date TEXT,
  route_pos INTEGER,
  delivered_at TEXT,
  door_payment TEXT CHECK (door_payment IS NULL OR door_payment IN ('cash', 'etransfer', 'owes')),
  checkin_op_id TEXT,
  photo_key TEXT,
  photo_type TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT
);
CREATE INDEX orders_day ON orders (delivery_date, status);
CREATE INDEX orders_customer ON orders (customer_id);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  order_id TEXT REFERENCES orders(id),
  amount_cents INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash', 'etransfer', 'cheque', 'card', 'other')),
  date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('dealer', 'door')),
  voided INTEGER NOT NULL DEFAULT 0,
  voided_at TEXT,
  checkin_op_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX payments_customer ON payments (customer_id);
CREATE INDEX payments_order ON payments (order_id);

-- One row per delivered tap on the phone. op_id is made on the phone, so a replay hits the primary key.
CREATE TABLE checkins (
  op_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  at TEXT NOT NULL,
  delivered_at TEXT NOT NULL,
  at_adjusted INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash', 'etransfer', 'owes')),
  amount_cents INTEGER,
  note TEXT NOT NULL DEFAULT '',
  undone_at TEXT
);

-- `change` is in the product's own unit: cubic inches for wood, bags for pellets.
CREATE TABLE stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES products(id),
  change INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('delivered', 'undo', 'adjust')),
  order_id TEXT,
  checkin_op_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
);

-- A day stays "started" once the driver taps Start the route, even after every stop is delivered.
CREATE TABLE day_starts (
  date TEXT PRIMARY KEY,
  started_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('dealer', 'driver')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE signin_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  ok INTEGER NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX signin_attempts_ip ON signin_attempts (ip, at);

CREATE TABLE order_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX order_attempts_ip ON order_attempts (ip, at);
