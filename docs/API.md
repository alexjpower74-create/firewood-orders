# Firewood Orders: API contract (v1)

The contract between the Worker (fo1) and the pages (fo2 for customer + dealer, fo1 for the driver page). If the code and
this file disagree, this file wins until the lead changes it. Written by fo-lead 2026-09-14. Questions go in your build
report; do not invent a different contract.

One Worker `firewood-orders` serves the API under `/api/*` and the static app from `app/public/` (same origin, no CORS).
One deployment = one dealer. Local only tonight: `wrangler dev --local`.

JSON in, JSON out. Money is always **integer cents** (`*_cents`). Wood volume is always **integer cubic inches**
(`*_cu_in`); pellets are always **integer bags**. Errors are always
`{ "error": "<plain English for a Newfoundland customer or dealer>", "code": "<machine code>", "field"?: "<input name>" }`.

| code | HTTP | when |
|---|---|---|
| `bad_request` | 400 | validation; `field` names the input |
| `not_offered` | 400 | that unit is not sold for that product (`field: "unit"`) |
| `below_minimum` | 400 | goods + stacking under the minimum order (`field: "qty"`) |
| `outside_area` | 400 | the pin is past the last delivery band (`field: "pin"`); `error` is the dealer's `beyond_message` |
| `unauthorized` | 401 | missing/expired token, or wrong PIN |
| `forbidden` | 403 | a driver token on a dealer-only route |
| `season_closed` | 403 | customer order while the season is closed; `error` is the dealer's `season_message` |
| `not_found` | 404 | unknown token, order, product, payment, check-in |
| `over_capacity` | 409 | scheduling would put the day past the truck's limit; body has `day` and `needs` |
| `bad_state` | 409 | a status change not allowed from the current status |
| `already_delivered` | 409 | a delivered check-in for an order another check-in already delivered |
| `too_late` | 409 | driver undo more than 15 minutes after the check-in reached the server |
| `payload_too_large` | 413 | photo over 5 000 000 bytes |
| `unsupported_media` | 415 | photo not `image/jpeg`, `image/png` or `image/webp` |
| `rate_limited` | 429 | too many PIN tries or order requests |

## Time and test clock

- The dealer's zone is `America/St_Johns`. Every `date` is dealer-local `YYYY-MM-DD`. People-facing labels:
  `label` = `"Tue Sep 15"`, `long_label` = `"Tuesday, September 15"`, time labels `"2:05 PM"`.
- The app never uses the browser clock for dealer dates: it takes `today` and `now` from `GET /api/info`.
  (The driver page stamps `at` from the phone clock on purpose: that is the moment the driver tapped.)
- Only when the Worker runs with var `TEST_MODE=1` (never in `wrangler.toml`): header `X-Test-Now: <ISO instant>` replaces
  "now" and `X-Test-IP: <string>` replaces the client IP. Without `TEST_MODE=1` both headers are ignored.
- Test routes exist only under `TEST_MODE=1` (404 otherwise): `POST /api/test/reset` (wipe everything, then the SAMPLE
  settings and products below, no customers or orders) and `POST /api/test/seed { "scenario": "demo" }` (M2: SAMPLE
  customers and a realistic fortnight of orders around `today`, some paid, some owing, one day near capacity, two delivered
  orders with a generated placeholder photo). Seed places come from `data/sample-places.json` via a generated module.

## Units (the maths; fo1 implements it once in `worker/src/units.js`, pure)

| unit | kind | volume | plain words (`explain`) |
|---|---|---|---|
| `cord` | wood | 221 184 cu in | `A full cord: a stack 4 feet high, 4 feet wide and 8 feet long (128 cubic feet).` |
| `half_cord` | wood | 110 592 cu in | `Half a cord: 64 cubic feet, half of a full cord.` |
| `face_cord` | wood | 4 608 × `cut_in` cu in | `A face cord: one row 4 feet high and 8 feet long, as deep as the pieces are long ({cut_in} inches). That is {f} of a full cord.` |
| `load` | wood | `load_cu_in` (dealer) | `{load_description} We count a load as {load_cords} cords.` |
| `bag` | pellets | 1 bag | `One {bag_lb} lb bag.` |
| `ton` | pellets | `bags_per_ton` bags | `A ton: {bags_per_ton} bags of {bag_lb} lb.` |
| `skid` | pellets | `bags_per_skid` bags | `A skid: {bags_per_skid} bags of {bag_lb} lb, shrink-wrapped on a pallet.` |

`{f}` is the fraction `cut_in / 48` written with two decimals (`0.33`). `{load_cords}` is the dealer's decimal as typed,
trimmed (`1.5`). Cords shown to people = `cu_in / 221184` rounded to 2 decimals. Settings take cords as decimal numbers
with at most 2 decimals and store `round(cords × 221184)` cubic inches.

`qty` is an integer 1–20 of the chosen unit. `qty_label` examples: `"1 cord"`, `"2 half cords"`, `"3 face cords"`,
`"1 load"`, `"10 bags"`, `"1 ton"`, `"2 skids"`.

## Money (fo1 implements it once in `worker/src/money.js`, pure)

For an order of `qty` × `unit` of a product:

1. `goods_cents` = `price_cents[unit]` × `qty` (400 `not_offered` when that price is `null`).
2. `stacking_cents` = 0 unless `stacking: true` (wood only, product has a `stacking_cents_per_cord`; 400 `bad_request`
   `field: "stacking"` otherwise) = **half-up** round of `stacking_cents_per_cord × wood_cu_in / 221184`.
3. `distance_km` = haversine from the yard to the pin, **R = 6371 km**, unrounded for band choice, 1 decimal for display.
4. `delivery_cents`: mode `bands` → the fee of the first band (sorted by `up_to_km`) with `distance_km ≤ up_to_km`; past
   the last band → 400 `outside_area`. Mode `zones` → the chosen zone's fee (`zone_id` required, `field: "zone_id"`).
   A dealer phone order may send `delivery_cents` to override.
5. `below_minimum` when `goods_cents + stacking_cents < min_order_cents` (message
   `"The smallest order we deliver is $110.00 before delivery."`).
6. `subtotal_cents` = goods + stacking + delivery.
7. `hst_cents` = `hst_registered ? floor((subtotal_cents × 15 + 50) / 100) : 0` (15 % NL HST, half-up, **per order**).
   Example: subtotal 33 310 → HST 4 997. The rate is a constant, not a setting.
8. `total_cents` = subtotal + HST. Prices are snapshotted onto the order at creation and recomputed only by a dealer edit.

**Balances.** `paid_cents` (order) = sum of **non-voided** payments with that `order_id`. `owing_cents` (order) =
`total_cents − paid_cents` for any order that is not cancelled, and `0 − paid_cents` for a cancelled one (a credit).
Customer `balance_cents` = Σ `total_cents` of that customer's non-cancelled orders − Σ that customer's non-voided payments
(payments without an order count too). Negative = credit. Labels: `"Balance owing $120.00"`, `"Paid in full"` (exactly 0),
`"Credit $20.00"`.

## Capacity (the truck)

Settings `truck = { name, wood_cords_per_day, pellet_skids_per_day }` → `cap_cu_in = round(cords × 221184)`,
`cap_bags = skids × bags_per_skid of the first active pellet product` (store `cap_bags` when settings are saved).
A day's use = Σ `wood_cu_in` and Σ `pellet_bags` of its orders in status `scheduled`, `out_for_delivery` or `delivered`.
**Scheduling an order into a day must leave use ≤ cap for both.** The check and the write are **one SQL statement**
(`UPDATE … WHERE id = ? AND status IN (…) AND (SELECT SUM … excluding this order) + this ≤ cap`), between
`// CAPACITY-GUARD:BEGIN` and `// CAPACITY-GUARD:END` markers in `worker/src/index.js` (or the module it calls), so two
dealers scheduling into the last space at once cannot both win. Zero rows changed → re-read and answer
`409 over_capacity`:
```json
{ "error": "That's more than the truck can carry that day: 4.00 of 4.50 cords already planned, this order needs 1.00.",
  "code": "over_capacity",
  "day": { "date": "2026-09-15", "wood": { "used_cu_in": 884736, "cap_cu_in": 995328, "used_cords": 4, "cap_cords": 4.5 },
           "pellets": { "used_bags": 0, "cap_bags": 210 } },
  "needs": { "wood_cu_in": 221184, "pellet_bags": 0 } }
```
(Pellet wording: `"That's more than the truck can carry that day: 180 of 210 bags already planned, this order needs 50."`)
Lowering the truck limit never unschedules anything; such a day reports `over: true` and refuses further scheduling.

## Stock

`stock_cu_in` (wood products) and `stock_bags` (pellet products) change **only** on a delivered check-in (down by the
order's volume), its undo (back up) and a dealer stock adjustment. Never on order, schedule, start or edit. Every change
is a row in `stock_moves (product_id, change, reason 'delivered'|'undo'|'adjust', order_id, at)` written in the **same
`DB.batch()`** as the change it belongs to. Stock may go below zero (the dealer's count was off); it is shown, not refused.

## Route (fo1 implements it once in `worker/src/route.js`, pure)

- Distance is haversine (R = 6371 km) between pins. The page always says `"Order is by distance, not road time."`
- **Optimize** a day: the stops not yet delivered, from a start point (the pin of the day's last delivered stop, or the
  yard when none) back to the yard: nearest neighbour from the start (ties → lower order id), then 2-opt (reverse any
  segment of the stop sequence while it shortens the closed path start → stops → yard by more than 1 m; repeat until no
  improving move). Delivered stops keep their positions at the front. Deterministic.
- `route_pos` is stored on each order. A newly scheduled order goes to the end of its day; unscheduling/moving compacts.
- `total_km` = start at the yard, through every stop in route order, back to the yard; 1 decimal.

## Public routes (no sign-in)

`GET /api/info`
```json
{ "name": "SAMPLE Wood & Pellets — Springdale (demo)", "short_name": "SAMPLE Wood & Pellets", "sample": true,
  "timezone": "America/St_Johns", "today": "2026-09-14", "now": "2026-09-14T11:30:00.000Z",
  "phone": "709-555-0100", "season_open": true, "season_message": "…", "deposit_text": "…",
  "min_order_cents": 11000, "hst_registered": true,
  "yard": { "lat": 49.5, "lng": -56.07, "label": "Our yard, Springdale" },
  "delivery": { "mode": "bands", "bands": [ { "up_to_km": 10, "fee_cents": 0, "label": "Up to 10 km: free" } ],
                "zones": [], "beyond_message": "…" },
  "load": { "cords": 1.5, "description": "…" },
  "products": [ {
      "id": "p_softwood_dry", "kind": "wood", "name": "Mixed softwood, dry", "species": "Spruce and fir",
      "dryness": "dry", "cut_in": 16, "split": true, "stacking_cents_per_cord": 6000,
      "units": [ { "unit": "cord", "price_cents": 30000, "explain": "A full cord: …", "wood_cu_in": 221184 },
                 { "unit": "face_cord", "price_cents": 12000, "explain": "A face cord: …", "wood_cu_in": 73728 } ] },
    { "id": "p_pellets", "kind": "pellets", "name": "SAMPLE Premium wood pellets", "brand": "SAMPLE Premium", "bag_lb": 40,
      "bags_per_ton": 50, "bags_per_skid": 70,
      "units": [ { "unit": "bag", "price_cents": 799, "explain": "One 40 lb bag.", "pellet_bags": 1 } ] } ],
  "delivery_dates": [ { "date": "2026-09-15", "label": "Tue Sep 15", "long_label": "Tuesday, September 15" } ],
  "map": { "tiles": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
           "attribution": "© <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors" } }
```
Only active products, only offered units (price not null), in `sort` order. Stock is never public. `delivery_dates` = the
next 14 delivery weekdays starting **tomorrow**.

`POST /api/quote` — same body as `POST /api/orders` minus name/phone/address/notes/preferred; nothing is written.
→ `200 { "product_label", "qty_label", "explain", "wood_cu_in", "pellet_bags", "distance_km", "goods_cents", "stacking_cents",
"delivery_cents", "subtotal_cents", "hst_cents", "total_cents" }` or the 400s above. No rate guard.

`POST /api/orders`
```json
{ "product_id": "p_softwood_dry", "unit": "cord", "qty": 1, "stacking": false,
  "lat": 49.52, "lng": -56.1, "address": "Up the lane past the church", "dump_notes": "By the shed, not on the lawn",
  "zone_id": null, "preferred": { "any": false, "dates": ["2026-09-16", "2026-09-17"] },
  "name": "Wade R. (SAMPLE)", "phone": "709-555-0142", "note": "" }
```
Validation (400 `bad_request` + `field`): `product_id` active; `unit` offered; `qty` integer 1–20; `lat` 46.5–60.5 and `lng`
−67.9 to −52.5 (`field: "pin"`, `"Tap the map where the truck should dump it."`); `address` 1–120; `dump_notes` 0–200;
`preferred.any` true, or 1–7 `dates` all in `delivery_dates` (`field: "preferred"`); `name` 1–80; `phone` 7–32 chars of
digits, spaces, `+ - ( ) .` with ≥ 7 digits; `note` 0–280. 403 `season_closed` when closed. Rate guard 10 orders per hour per
IP → 429. The customer is found or created by phone digits (last 10); the name updates to the newest one given.
→ `201 { "id": "o_…", "token": "<32+ url-safe chars>", "status": "requested", "status_url": "/o/?t=<token>", "quote": { … } }`

`GET /api/o/:token` → the customer's view (never another customer, never dealer-only fields):
```json
{ "dealer": { "name": "…", "short_name": "…", "sample": true, "phone": "709-555-0100" },
  "deposit_text": "…",
  "order": { "status": "scheduled", "status_label": "Scheduled for Tuesday, September 15",
    "product_label": "Mixed softwood, dry", "qty_label": "1 cord", "explain": "A full cord: …", "stacking": false,
    "address": "…", "dump_notes": "…", "preferred_label": "Wed Sep 16, Thu Sep 17",
    "delivery_date": "2026-09-15", "delivered_label": null, "photo_url": null,
    "goods_cents": 30000, "stacking_cents": 0, "delivery_cents": 2500, "subtotal_cents": 32500, "hst_cents": 4875,
    "total_cents": 37375, "paid_cents": 10000, "owing_cents": 27375, "owing_label": "Balance owing $273.75",
    "created_label": "Mon Sep 14, 9:00 AM" } }
```
`status_label` exactly: `Requested` · `Scheduled for <long_label>` · `Out for delivery` · `Delivered` · `Cancelled`.
`delivered_label` = `"Delivered Tuesday, September 15 at 2:05 PM"` from the stored (original) time. `preferred_label` =
`"Any day"` or the short labels joined by `", "`. `photo_url` = `/api/photos/<token>` when a photo is stored.

`POST /api/o/:token/cancel` (M2) → only from `requested`; `200 { status: "cancelled" }`, otherwise 409 `bad_state`
(`"This order is already on the schedule. Call us to change it."`).

`GET /api/photos/:token` → the stored image bytes with their content type; 404 when none.

## Sign-in

`POST /api/signin { "pin": "1357" }` → `200 { "token", "role": "dealer" | "driver", "expires_at" }`. The dealer PIN gives role
`dealer` (12 h), the driver PIN role `driver` (14 days, so the phone stays signed in all week). PINs are 4–8 digits, stored
PBKDF2-SHA256 (100 000 iterations) hash + salt; tokens stored as SHA-256 hashes. Wrong PIN → 401 `field: "pin"`,
`"That PIN is not right."`. 5 wrong tries per IP in 15 minutes → 429 (then even the right PIN) `"Too many tries. Wait 15
minutes and try again."`. `POST /api/signout` (Bearer) → 200. SAMPLE PINs: dealer **1357**, driver **2580**.

All routes below take `Authorization: Bearer <token>`. `/api/dealer/*` need role `dealer` (driver token → 403 `forbidden`);
`/api/driver/*` accept either role.

## Dealer routes

**Order summary** (used by board, days, route):
```json
{ "id": "o_…", "token": "…", "status": "requested", "status_label": "Requested", "source": "online" | "phone",
  "customer_id": "c_…", "name": "…", "phone": "…", "address": "…", "dump_notes": "…", "lat": 49.52, "lng": -56.1,
  "product_id": "…", "kind": "wood", "product_label": "…", "unit": "cord", "qty": 1, "qty_label": "1 cord",
  "stacking": false, "wood_cu_in": 221184, "pellet_bags": 0, "cords": 1,
  "preferred_label": "…", "preferred_dates": ["2026-09-16"], "preferred_any": false,
  "delivery_date": null, "delivery_label": null, "route_pos": null, "distance_km": 3.4,
  "goods_cents": 30000, "stacking_cents": 0, "delivery_cents": 0, "subtotal_cents": 30000, "hst_cents": 4500,
  "total_cents": 34500, "paid_cents": 0, "owing_cents": 34500,
  "delivered_at": null, "delivered_label": null, "door_payment": null | "cash" | "etransfer" | "owes",
  "has_photo": false, "note": "", "created_at": "…", "created_label": "Mon Sep 14, 9:00 AM" }
```

`GET /api/dealer/board` → `{ "counts": { "new", "scheduled", "delivered", "owing", "cancelled" }, "new": [summary…],
"scheduled": […], "delivered": […], "owing": […] }` — `new` = requested (oldest first); `scheduled` = scheduled +
out_for_delivery (by date, then route_pos); `delivered` = delivered in the last 30 days (newest first); `owing` =
delivered with `owing_cents > 0` (oldest delivery first). Cancelled only counted.

`GET /api/dealer/orders/:id` → `{ "order": summary, "customer": { id, name, phone, balance_cents }, "payments": [payment…],
"messages": [ { "kind", "label", "text" } ] }`.

`POST /api/dealer/orders` → a phone order: the `POST /api/orders` body plus optional `delivery_cents` override; `source`
`phone`; no rate guard; allowed while the season is closed. → 201 same shape as the public route.

`PUT /api/dealer/orders/:id` (M2) → edit `qty`, `unit`, `stacking`, `delivery_cents`, `lat`/`lng`, `address`, `dump_notes`,
`name`, `phone`, `note`, `preferred`; money recomputed; volume/price edits on a delivered order → 409 `bad_state`; an edit that
would push a scheduled day past capacity → 409 `over_capacity`.

`POST /api/dealer/orders/:id/schedule { "date" }` → from `requested` or `scheduled` (a move). `date` must be today or later,
within `window_days`, a delivery weekday (`400 field: "date"`, `"We don't deliver on Sundays."`). Capacity guard above.
→ `200 { "order": summary }`. `POST …/unschedule` → back to `requested` (only from `scheduled`). `POST …/cancel` (M2) → from
`requested` or `scheduled`. `POST …/undeliver` (M2) → from `delivered`: back to `out_for_delivery` if that day was started,
else `scheduled`; the stock move reversed and the door payment from that check-in voided, in one batch.

`GET /api/dealer/days` → the `window_days` dates starting today:
```json
{ "days": [ { "date": "2026-09-15", "label": "Tue Sep 15", "long_label": "Tuesday, September 15", "delivers": true,
  "reason": null, "orders": 3, "started": false, "over": false,
  "wood": { "used_cu_in": 663552, "cap_cu_in": 995328, "used_cords": 3, "cap_cords": 4.5 },
  "pellets": { "used_bags": 70, "cap_bags": 210, "used_skids": 1, "cap_skids": 3 } } ] }
```
Non-delivery days are listed with `delivers: false` and `reason: "No deliveries on Sundays"`.

`GET /api/dealer/days/:date/route` →
```json
{ "date": "2026-09-15", "label": "…", "yard": { "lat", "lng", "label" }, "started": false,
  "stops": [ summary… in route_pos order ], "total_km": 42.7, "note": "Order is by distance, not road time." }
```
`POST /api/dealer/days/:date/route/optimize` → saves the order per the Route rules, returns the route.
`PUT /api/dealer/days/:date/route { "order_ids": [...] }` → must be exactly that day's non-cancelled orders with delivered
stops unchanged at the front; missing / duplicate / foreign id → 400 `field: "order_ids"`. Returns the route.

`GET /api/dealer/customers` → `{ "customers": [ { id, name, phone, orders, total_cents, paid_cents, balance_cents,
last_order_label } ] }` sorted by `balance_cents` descending, then name.

`GET /api/dealer/customers/:id/ledger` → `{ "customer": {…}, "entries": [ { "date", "label", "kind": "order" | "payment",
"text", "charge_cents", "payment_cents", "balance_cents" } ], "balance_cents" }` — orders (non-cancelled, dated by creation)
and non-voided payments, oldest first, `balance_cents` running.

`POST /api/dealer/payments { "customer_id", "order_id"?, "amount_cents", "method": "cash"|"etransfer"|"cheque"|"card"|"other",
"date"?, "note"? }` → amount 1–10 000 000; `date` defaults to today, never in the future; → `201 { "payment": { id, customer_id,
order_id, amount_cents, method, date, note, source: "dealer"|"door", voided: false } }`. `DELETE /api/dealer/payments/:id` (M2)
→ voided (kept, excluded from every sum).

`GET /api/dealer/totals?season=2026` (M2) → season = `<year>-09-01` (setting `season_start` `MM-DD`) to the day before the next
season. Months from the season start through the month containing today (or the season end), zero rows included:
```json
{ "season": { "year": 2026, "from": "2026-09-01", "to": "2027-08-31", "label": "2026–27 season" },
  "months": [ { "month": "2026-09", "label": "September 2026", "delivered": 4, "goods_cents", "stacking_cents",
                "delivery_cents", "subtotal_cents", "hst_cents", "total_cents", "payments_cents" } ],
  "totals": { same money fields summed, "delivered", "payments_cents", "owing_cents" } }
```
Delivered orders count in the NL-local month of `delivered_at`; payments in the month of their `date`. `owing_cents` = Σ
positive `owing_cents` of delivered orders now.

`GET /api/dealer/export/orders.csv?season=2026` and `…/payments.csv?season=2026` (M2) → `text/csv; charset=utf-8`,
`Content-Disposition: attachment; filename="firewood-orders-2026-orders.csv"`, CRLF line ends, header row exactly
`Order,Delivered,Customer,Phone,Address,Product,Quantity,Goods,Stacking,Delivery,Subtotal,HST,Total,Paid,Owing,Door payment`
(delivered orders in the season) and `Date,Customer,Phone,Order,Method,Amount,Note` (non-voided payments). Money as `123.45`,
dates `YYYY-MM-DD`. A cell containing `,` `"` or a line break is quoted with `"` doubled; a cell starting with `=` `+` `-` `@`
tab or CR gets a leading `'`.

**Messages** (in `GET /api/dealer/orders/:id`, text exact; `{first}` = the name's first word, `{status_link}` = request origin +
`status_url`; money `$1,234.56`):
- `scheduled` (status scheduled), label `We're coming`: `Hi {first}, this is {short_name}. Your order ({qty_label} of {product_label}) is booked for delivery on {long_label}. Amount owing: {owing}. Check your order: {status_link}`
- `on_the_way` (out_for_delivery), label `On the way`: `Hi {first}, this is {short_name}. We're on the way with your {qty_label} of {product_label}. See you soon.`
- `balance` (delivered with owing > 0), label `Balance reminder`: `Hi {first}, this is {short_name}. Thanks again for your order. The balance of {owing} is still owing. {deposit_text}`

**Settings** (M2). `GET /api/dealer/settings` → `{ settings, products: [ full product incl. stock_cu_in / stock_bags,
stock_cords, active, sort ] }`. `PUT /api/dealer/settings` validates everything and answers 400 with `field`:
`name` 1–80, `short_name` 1–40, `sample` (boolean; `false` for a real dealer removes every SAMPLE badge, reported by `GET /api/info`),
`phone` 0–32, `deposit_text` 0–400, `season_open`, `season_message` 0–200, `season_start` `MM-DD`,
`min_order_cents` 0–100 000, `hst_registered`, `yard {lat,lng,label}`, `delivery {mode, bands [1–6, up_to_km increasing 0.1–500,
fee 0–50 000], zones [0–30 {id,name 1–40,fee}], beyond_message 0–200}`, `load {cords 0.25–10 (2 dp), description 1–200}`,
`truck {name, wood_cords_per_day 0–40 (2 dp), pellet_skids_per_day 0–20}`, `delivery_weekdays` (ISO 1–7, ≥ 1), `window_days`
7–42. `POST /api/dealer/products`, `PUT /api/dealer/products/:id` (kind fixed after creation; prices `null` = not sold; wood:
`species`, `dryness` dry|green, `cut_in` 12–24, `split`, `stacking_cents_per_cord` null|0–50 000, `price_cents {cord, half_cord,
face_cord, load}`; pellets: `brand`, `bag_lb` 10–80, `bags_per_ton` 1–200, `bags_per_skid` 1–200, `price_cents {bag, ton, skid}`;
`active`, `sort`). `POST /api/dealer/products/:id/stock { "mode": "set"|"add", "cords"? | "bags"?, "note"? }` → a stock move.
`PUT /api/dealer/pin { "which": "dealer"|"driver", "current_dealer_pin", "new_pin" }` → 200; wrong current → 401.

## Driver routes

`GET /api/driver/day?date=YYYY-MM-DD` (default today) →
```json
{ "dealer": { "name", "short_name", "sample" }, "date": "2026-09-14", "long_label": "Monday, September 14",
  "yard": {…}, "started": false, "note": "Order is by distance, not road time.",
  "counts": { "done": 1, "total": 5 },
  "stops": [ { "order_id", "pos": 1, "status", "name", "phone", "address", "dump_notes", "lat", "lng", "product_label",
               "qty_label", "stacking", "total_cents", "paid_cents", "owing_cents", "delivered_label", "door_payment",
               "maps_url": "https://www.google.com/maps/dir/?api=1&destination=49.52,-56.1" } ] }
```
Stops of that date in route order (not cancelled).

`POST /api/driver/day/:date/start` → every `scheduled` order on that date becomes `out_for_delivery`; idempotent →
`200 { "started": true, "changed": 3 }`.

`POST /api/driver/checkins` — one check-in per request, safe to replay:
```json
{ "op_id": "<uuid made on the phone>", "order_id": "o_…", "at": "2026-09-14T17:05:00.000Z",
  "payment": { "method": "cash" | "etransfer" | "owes", "amount_cents": 34500 }, "note": "" }
```
- The **same `op_id` again → `200 { "duplicate": true, … }`** and nothing changes (no second stock move, no second payment).
  `checkins.op_id` is the PRIMARY KEY; the check-in, the order update, the stock move and the payment are one `DB.batch()`.
- A new check-in: order `scheduled` or `out_for_delivery` → `201 { "duplicate": false, "order": summary, "at": "…",
  "at_adjusted": false }`. `requested` → 409 `bad_state` (`"This order isn't on a delivery day."`); `cancelled` → 409
  `bad_state`; already delivered by another op → 409 `already_delivered`; unknown order → 404.
- **Original time kept:** stored `delivered_at` = `at` when `server_now − 7 days ≤ at ≤ server_now + 5 minutes`; otherwise
  `server_now` with `at_adjusted: true`. `received_at` = server now.
- `payment.method` `cash`/`etransfer` → a payment row (`source: "door"`, `date` = NL date of the stored time) of
  `amount_cents` (1–10 000 000) or, when omitted, the order's owing at that moment (none if ≤ 0). `owes` → no payment row.
  `door_payment` on the order = the method. Missing `payment` → 400 `field: "payment"`.

`PUT /api/driver/checkins/:op_id/photo` — raw body, `Content-Type` `image/jpeg|png|webp`, ≤ 5 000 000 bytes → stored in R2
`PHOTOS` under `orders/<order id>.<ext>` (a second photo replaces the first) → `200 { "stored": true, "photo_url" }`; unknown
op → 404; 413; 415.

`DELETE /api/driver/checkins/:op_id` (M2) → within 15 minutes of `received_at`: the order back to `out_for_delivery` (day
started) or `scheduled`, stock move reversed, door payment voided, check-in row kept with `undone_at` → `200 { order }`;
after 15 minutes → 409 `too_late` (`"Too late to undo here. Ask the dealer to change it."`).

## SAMPLE settings and products (what `POST /api/test/reset` leaves)

- Dealer `SAMPLE Wood & Pellets — Springdale (demo)`, short `SAMPLE Wood & Pellets`, phone `709-555-0100`, season open,
  `season_start` `09-01`, `season_message` `We're closed for the season. Call 709-555-0100 and we'll take your name for the fall.`,
  min order 11 000, HST registered, `window_days` 21, delivery weekdays Mon–Sat (1–6).
- Yard: the Springdale point from `data/sample-places.json`, label `Our yard, Springdale (SAMPLE)`.
- Deposit text: `This page takes no payments. To pay a deposit, send an Interac e-Transfer to sample-wood@example.com with your
  name in the message. You can also pay cash or e-Transfer when we deliver.`
- Bands: up to 10 km free (`Up to 10 km: free`), up to 30 km $25.00, up to 60 km $50.00; beyond: `That's farther than we
  deliver. Call us at 709-555-0100 and we'll see what we can do.`
- Load: 1.5 cords, `A load is what our dump truck carries in one trip, dumped in a pile, not stacked.`
- Truck: `SAMPLE one-ton dump truck`, 4.5 cords a day, 3 skids a day (= 210 bags).
- Products (SAMPLE prices):
  1. `p_softwood_dry` Mixed softwood, dry · Spruce and fir · 16 in · split · cord 30 000, half 17 000, face 12 000, load 42 000 ·
     stacking 6 000/cord · stock 40 cords.
  2. `p_birch_dry` Birch, dry · Birch · 16 in · split · cord 37 500, half 20 000, face 14 000, load null · stacking 6 000 · stock 12 cords.
  3. `p_softwood_green` Mixed softwood, green · Spruce and fir · 16 in · not split · cord 22 000, half null, face null, load 30 000 ·
     stacking null · stock 25 cords.
  4. `p_pellets` SAMPLE Premium wood pellets · brand `SAMPLE Premium` · 40 lb · 50 bags/ton · 70 bags/skid · bag 799, ton 36 500,
     skid 49 900 · stock 600 bags.
- PINs: dealer 1357, driver 2580.
