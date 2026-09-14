# Build report: fo1 (Worker + driver page)

A record, not a queue. Items are marked DONE or REJECTED in place.

## M1: Worker core (2026-09-14)

### What I built: DONE

- `worker/wrangler.toml` as PLAN.md says: D1 `DB` with a placeholder id, R2 `PHOTOS`, `[assets] ../app/public` with `run_worker_first = ["/api/*"]`,
  and **no `TEST_MODE` in `[vars]`**. It also adds `binding = "ASSETS"` so the Worker can hand non-API paths to the assets.
- `migrations/0001_init.sql` holds 11 tables: settings (single row), products, customers, orders (snapshotted money, label, explain
  text and volume, plus `route_pos`), payments, checkins (`op_id TEXT PRIMARY KEY`), stock_moves, sessions, signin_attempts,
  order_attempts, and one addition, **`day_starts`**. That table keeps a day "started" after every stop is delivered, which undeliver
  (M2) needs.
- `migrations/0002_sample.sql` is **generated** by `tools/build-sample-data.mjs` from `src/sample.js`. `POST /api/test/reset` runs the
  same statements, so the two cannot drift. `tests/sample.test.mjs` runs the tool with `--check`. The tool also generates
  `src/sample-places.js` from `data/sample-places.json`, and the Worker never reads outside `worker/`.
- Modules in `worker/src/`:
  - `units.js`, `money.js`, `route.js` and `time.js` are pure.
  - `auth.js` handles PBKDF2-SHA256 at 100 000 iterations and SHA-256 tokens.
  - `clock.js` honours `X-Test-Now` / `X-Test-IP` only when `TEST_MODE === '1'`.
  - `validate.js` checks order input.
  - `views.js` builds the order summary, the labels and the messages.
  - `sample.js` holds the SAMPLE dealer.
  - `index.js` is the router plus handlers.
- Every M1 route in the brief is built, plus the test route `POST /api/test/reset`.
- **Capacity guard** sits between `// CAPACITY-GUARD:BEGIN/END` in `src/index.js`. It is one `UPDATE … WHERE id = ?2 AND status IN (…)
  AND (SELECT SUM wood …) + wood_cu_in <= (SELECT cap_cu_in FROM settings) AND (… bags …)`. The new `route_pos` (end of the day) is set
  in the same statement. Zero rows changed → the order is re-read → `409 over_capacity` with the exact `day` and `needs`.
- **Check-in** is one `DB.batch()`, in this order:
  1. Insert the check-in (`op_id` PK).
  2. Update the order, guarded by status.
  3. Update the stock, the stock move and the door payment. Each runs only if `orders.checkin_op_id = op_id`.
  4. Delete this op's check-in row if another op won.

  A replay is answered `200 duplicate` from the existing row. A concurrent replay that hits the PK aborts the whole batch and is
  answered as a duplicate too. When no amount is sent, the door payment amount is the owing, computed in SQL at that moment.
- **Balances** are computed only in `money.js` (`paidCents`, `owingCents`, `customerBalance`) over the rows. The Worker never sums
  money in SQL for display.

### What I verified, and how it could have failed

`npm test` (from `worker/`) runs unit tests, then a fresh `wrangler dev --local --var TEST_MODE:1` on 7702 with state in
`worker/.state-7702`, then the API suite, then stops the Worker. Result: **26 unit + 42 API tests pass, 0 fail, 0 skipped.**

- Unit tests cover the brief's list:
  - Every unit's volume, and face cords at 12/16/18/24 inches (0.25/0.33/0.38/0.50).
  - Explain texts exact, and `qty_label` plurals.
  - Stacking 6 500 ¢ on a 16-inch face cord = 2 167.
  - Band edges: 10.0 → free, 10.01 → $25, 60.01 → `outside_area`. Zones.
  - HST 33 310 → 4 997 and 10 → 2.
  - Minimum order at the line and a cent below.
  - **300 seeded ledgers** checked against sums written out by hand.
  - Haversine against the formula written out.
  - The crossing instance, with the exact expected order and the NN steps explained in the comment.
  - 50 seeded instances at a 2-opt local optimum and ≤ NN length. Determinism, empty and one-stop inputs, a start other than the yard.
  - NL time: `2026-10-01T02:00Z` → Sep 30, 11:30 PM.
  - PIN hashes re-derived from 1357/2580.
- API tests cover the brief's M1 list, including:
  - Three hand-written quotes. For 14 bags to Little Bay, HST 20.529 → $20.53.
  - One validation test per field (19 cases).
  - Capacity with the exact 409 body, a half cord to exactly 4.50, then a face cord refused.
  - Pellets refused at 210 bags.
  - A move frees the first day.
  - **8 concurrent schedules → exactly 4 × 200 and 4 × 409.**
  - Stock unchanged by order, schedule and start; −73 728 on delivery.
  - Duplicate op → 200, stock and payment once, plus a burst of 3 identical replays → 201, 200, 200.
  - Original time kept at +45 min; adjusted at +2 h and at −8 days.
  - Door payments to the cent.
  - Start, and a ledger of 3 orders + 4 payments.
  - Optimize equals the pure module; route PUT refusals.
  - Photo round trip byte-for-byte, 415, 413 at 5 000 001 bytes, and 200 at exactly 5 000 000.
- **How stock is read in M1:** stock is not public and `GET /api/dealer/settings` is M2. The API tests therefore open the local D1 SQLite
  file (`STATE_DIR/v3/d1/miniflare-D1DatabaseObject/*.sqlite`) **read-only through `node:sqlite`**. Nothing in the Worker knows about
  this. When M2 lands I will switch those reads to `GET /api/dealer/settings` and keep `stock_moves` as the only direct read.

### Negative controls (M1)

`npm run negative` (from `worker/`) runs all six. The result is recorded in `worker/tests/negative-control.log`. **All six went red, and
`negative-all` exits 0.**

How a control runs:
1. Copy `worker/` to `worker/.negative/<name>/worker`, which is git-ignored, with `app/public` symlinked beside it.
2. Break the **copy** by exact text replacement. If the anchor text is not found exactly once, the control exits 2 and never passes.
3. Run the copy's own tests with `run.mjs --fresh` on port 7705. `--fresh` refuses to reuse a Worker already answering there.
4. Count the control as red only if the named tests print `not ok`.

The shipped code has no switch that turns a guard off.

| control | the break in the copy | what went red (from the log) |
|---|---|---|
| (a) `negative:capacity` | the guard's `SUM` of the day's current use replaced by `0` (wood and pellets) | the fifth 1-cord order was accepted: expected 409, got 200. The pellet test was also accepted: expected 409, got 200. |
| (b) `negative:race` | the one-statement check-and-write split into `SELECT` → `await scheduler.wait(25)` → `UPDATE` | `8 concurrent schedule calls` saw 200s where the four 409s belong. The first, ambiguous run of this control recorded 8 × 200. |
| (c) `negative:stock` | `POST /api/orders` also decrements stock in its batch | stock after the order was `8 773 632`, not `8 847 360` cu in |
| (d) `negative:idempotent` | check-in rows inserted under `crypto.randomUUID()` instead of `op_id` | the replay got 409 instead of 200 `duplicate` |
| (e) `negative:time` | `delivered_at` = server now | `delivered_at` was `17:50Z` (server now), not the tapped `17:05Z` |
| (f) `negative:twoopt` | `optimizeRoute` returns nearest neighbour without 2-opt | the crossing instance kept NN's crossed order, and seeded instance 0 could be shortened 11 134.6 m by reversing stops 2..3 |

Honest notes on the controls:
- **(d) went red differently from the brief's wording.** The brief expected "stock moved twice". In this Worker the order update is also
  guarded by status, and stock, stock move and payment only apply when `orders.checkin_op_id` matches. So with random ids the replay is
  refused with `409 already_delivered`, and stock still moves once. The test goes red at the `200 duplicate` assertion. I kept the
  status guard because it is a second line of defence, not a gap.
- **The first `negative-all` run crashed before testing anything.** Node's `cpSync` refuses to copy a folder into its own subfolder. It
  printed "NOT RED (bad)" for all six. Fixed by copying `worker/` entry by entry.
- **The second run was all red, but I did not trust it.** `run.mjs` reused any Worker already answering on the port, and it waited only
  500 ms after stopping its own. A control could therefore have run against the previous control's still-running broken copy; the race
  result (8 × 200) could come from a capacity-broken Worker. Fixed:
  - `run.mjs --fresh` refuses to reuse a Worker.
  - `run.mjs` now waits until the port stops answering, then SIGKILLs.
  - The log records `== api: fresh Worker on … 7705` per control.

  The committed log is the clean third run.

Mistakes in my own tests, found by the first API run and fixed in the tests, not the Worker:
- The board and ledger tests used a 12-hour dealer token at a test clock more than 12 hours later, so they got 401. They now sign in
  again at the later time.
- The `node:sqlite` rows have a null prototype, so a deep-equal against plain objects failed. The rows are now spread into plain
  objects.

### Left undone / notes

- M2 and M3 are not started, as the milestone rule says.
- `signin_attempts` and `order_attempts` exist but are not written yet; the rate guards are M2.
- `rig status` flags `app/node_modules` as outside my slice. It is the lead's symlink into this worktree. It is untracked and I have
  not committed it.

### Questions for the lead

1. `GET /api/dealer/days/:date/route` returns `label` ("Tue Sep 15") and also `long_label`. API.md shows `"label": "…"` only.
2. Optimize and route PUT treat "delivered stops at the front" as the day's delivered stops **in the order they were delivered**
   (`delivered_at`). The optimize start is the last of them. Say if you meant their existing `route_pos` order instead.
3. On a dealer phone order with a `delivery_cents` override, the band lookup is skipped, so a pin past the last band is accepted with
   the dealer's fee. A public order past the last band is still refused with `outside_area`.
4. Payment refusals for an unknown `customer_id` or `order_id` answer `400` with `field`, not `404`, so the form can place the message.

All four were accepted by the lead and written into docs/API.md on main at aae0e30. **DONE**

## M2: Worker, the rest (2026-09-14)

### What I built: DONE

Every remaining route in docs/API.md, on top of `git merge --ff-only main` at aae0e30. New modules:
- `admin.js`: settings, products, stock counts, PINs.
- `reports.js`: totals and CSV.
- `csv.js`, `guards.js` (rate guards), `seed.js`, `png.js` and `http.js`.

`validate.js` is split into product input and contact input, so a dealer edit reuses the same checks.

- **Order changes.**
  - `POST /api/o/:token/cancel` works only from `requested`.
  - Dealer `cancel` works from `requested` or `scheduled`. It clears the day, and the day's route compacts.
  - `PUT /api/dealer/orders/:id` merges the changes onto the order and checks the result.
    - Money is recomputed, with today's prices, **only** when `qty`, `unit`, `stacking`, `delivery_cents`, `lat`/`lng` or `zone_id`
      actually change.
    - A moved pin recomputes the band or zone fee, unless `delivery_cents` is sent.
    - On a delivered order those fields refuse with 409 `bad_state`; words (address, notes, note, name, phone, preferred) still save.
    - A new phone moves the order and its payments to the customer with that phone, and the newest name wins.
- **Capacity on edit** is one guarded `UPDATE`, like scheduling. It allows the edit when the order doesn't grow, or when the day still
  fits. A day over a lowered truck limit can therefore always be fixed by shrinking. Otherwise 409 `over_capacity` with the same body
  as scheduling.
- **Undo.** `undeliver` (dealer, any time) and `DELETE /api/driver/checkins/:op_id` (driver, up to 15 minutes after `received_at`)
  share one `DB.batch()`:
  1. The check-in gets `undone_at`.
  2. Stock goes back up.
  3. An `undo` stock move is written.
  4. The door payment is voided.
  5. The order returns to `out_for_delivery` if its day was started, otherwise to `scheduled`.

  Every statement applies only while the order is still delivered by that check-in, so a second undo changes nothing. After 15
  minutes the driver gets 409 `too_late`; an already-undone check-in gets 409 `bad_state`.
- **Payments.** `DELETE /api/dealer/payments/:id` voids the payment and keeps it; a second call is harmless. Whether a payment counts is
  decided in one place, `money.counts`. Order paid and owing, customer balance, ledger, customers list, board, totals and the CSV all
  go through it.
- **Totals.** The season runs from `<year>-season_start` to the day before the next season. There is one row per month from the season
  start to the month containing today (or the season end), including months with nothing in them. Deliveries count in the NL-local
  month of `delivered_at` (`time.nlMonth`), payments in the month of their `date`. `owing_cents` is the sum of positive owing on the
  season's delivered orders.
- **CSV.** Headers exact, CRLF after every row, quoting with doubled `"`. The formula guard puts a `'` in front of text starting with
  `= + - @` tab or CR. Filenames per API.md.
- **Settings.** `GET` returns `{ settings, products }` with stock, and no PIN hash or salt. `PUT` merges the groups sent onto the saved
  settings, validates the whole result, recomputes `load_cu_in`, `cap_cu_in` and `cap_bags`, and returns the same shape as `GET`.
  `sample` (boolean) is honoured by `GET /api/info`, the status page and the driver day.
- **Products.** `POST` and `PUT` validate per field; prices use `price_cents.<unit>` fields. Kind is fixed after creation. `cap_bags`
  is recomputed after every product change, because it depends on the first active pellet product.
- **Stock.** `POST /api/dealer/products/:id/stock` takes `set` or `add`, in `cords` for firewood or `bags` for pellets, and writes an
  `adjust` stock move.
- **PIN.** `PUT /api/dealer/pin` checks `current_dealer_pin`; a wrong one counts toward the sign-in guard. A new PIN must differ from the
  other role's PIN. Sessions of the changed role end, except the dealer making the change.
- **Rate guards.** 5 wrong PINs in 15 minutes per IP → 429, then even the right PIN, until the oldest wrong try is 15 minutes old.
  10 accepted public orders an hour per IP → 429. Refused requests and dealer phone orders don't count.
- **Season closed and zones:** end to end, per API.md.
- **`POST /api/test/seed { scenario: "demo" }`** resets first, then writes:
  - 12 SAMPLE customers at the SAMPLE places with small fixed offsets.
  - 20 orders from 10 days back to 7 days ahead, in every status.
  - The day after tomorrow at exactly 4.00 of 4.50 cords.
  - Paid, part-paid, owing and one credit.
  - Two delivered orders with a generated 240 × 120 PNG that says SAMPLE: a stored-block PNG, no dependencies.
  - Check-ins, stock moves and stock that agree with the deliveries.

  It answers `{ seeded, scenario, today, customers, orders, busy_day, status_url }`, where `status_url` is a scheduled order. `demo.mjs`
  reads `today` and `status_url`.

### What I verified, and how it could have failed

`npm test`: **unit 32 / 0 failed / 0 skipped, API 70 / 0 / 0** (M1 42 + M2 28). The API suites are now two files with shared helpers
(`api-helpers.mjs`). Every request sends its own `X-Test-IP` unless a test sets one, so the rate guards only apply where a test means
them to. **Stock is now read through `GET /api/dealer/settings`**, as planned. `stock_moves` has no route, so the tests still read that
one table read-only through `node:sqlite`.

M2 tests, each against hand-written numbers:
- **Edit** recomputes money: 2 cords stacked 828.00 → King's Point 856.75 → $10 fee 839.50. Refused edits save nothing; a delivered
  order refuses a quantity change but takes a note; a phone change moves the order and its payment (old customer balance 0).
- **Edit capacity:** a half cord → cord is refused with the exact 409; half → face cord fits. With the truck lowered to 3 cords,
  growing is refused and shrinking is accepted.
- **Undo:** stock is back to the cubic inch, the door payment is voided, owing is back to 166.75, and the stock moves read
  `[-73728, +73728, -73728, +73728]`. Undeliver of pellets on an unstarted day returns to `scheduled`. A second undo moves nothing.
- **Driver undo window:** exactly 15 minutes → 200; 16 → 409 `too_late`, counted from `received_at`, not the tap.
- **Voided payments leave every sum:** order, customer, status page, ledger, customers list, board owing, totals and the payments CSV.
- **Messages:** the balance reminder text is exact.
- **Settings:** round trip with `sample: false` reaching info, the status page and the driver day; truck caps; `cap_bags` following
  `bags_per_skid`.
- **Settings validation:** 9 group tests covering 34 cases, each checked for `field` and that nothing was saved.
- **Zones:** Buchans is accepted with the zone fee, 385.25.
- **Season closed:** public 403 with the dealer's message, quote 200, phone order 201 past the bands with the dealer's fee.
- **Products:** add, edit, not-sold units, deactivate, and refusals per field.
- **Stock counts:** set and add with the moves.
- **PIN change:** wrong current PIN 401; old driver sessions end.
- **Sign-in guard:** 5 wrong → 429, still 429 at 14 minutes, 200 at 16, another IP fine.
- **Order guard:** the 11th order → 429; an invalid request doesn't count; phone orders and another IP fine; 61 minutes later fine.
- **Totals:** Sep / Oct (zero) / Nov rows written out by hand. The Oct 1 02:00 UTC delivery counts in September; HST 20.53 on 136.86;
  totals equal the row sums; owing 287.39; the 2025 season has 12 empty months.
- **CSV:** both files byte for byte, including `"Smith, ""Junior"" (SAMPLE)"`, `'=SUM(A1) (SAMPLE)`, a quoted two-line address and
  `'+ extra`.
- **Seed:** counts per bucket, every status, Wed Sep 16 at 4.00 of 4.50, both photos are PNGs, stock equals the deliveries, September
  totals non-empty.
- **Unit tests:** CSV cells, guard and CRLF; the PNG checked with zlib for signature, CRCs, dimensions, inflate and ink pixels; NL months.

Mistake in my own test, found by the first run: the totals test used the 14-day driver token from Sep 14 on Oct 1 and got 401. The
driver now signs in again on Sep 30.

### Negative controls (M2, and M1 re-run)

`npm run negative` now runs all 11 controls, re-running M1's six against the M2 code. **All 11 went red; `negative-all` exit 0.**
- Every API control logged `== api: fresh Worker on … 7705`: ten of them. twoopt is unit-only.
- None was refused by `--fresh`, and every break applied exactly once, so the M1 anchors survived the M2 edits.
- The log is `worker/tests/negative-control.log`. Port 7705 was free afterwards.

| control | the break in the copy | what went red (from the log) |
|---|---|---|
| (g) `negative:month` | `nlMonth` returns the UTC month (`toISOString().slice(0, 7)`) | the September row had `delivered: 1, goods 30000, delivery 2500, hst 4875`, not `2, 41186, 5000, 6928`: the Sep 30, 11:30 PM delivery moved into October |
| (h) `negative:csvguard` | the `'` prefix line removed from `csvCell` | unit `formula guard`: got `=SUM(A1)`, expected `'=SUM(A1)`. The CSV export test also went red. |
| (i) `negative:void` | `money.counts` returns true for every payment | the order showed paid 345.00 / owing 0.00 and the customer −20.00, not 245.00 / 100.00 / 100.00 |
| (j) `negative:undo` | `undoDelivery`'s `UPDATE products` statement removed (the undo move is still written) | stock after the driver's undo was 8 773 632 cu in, not 8 847 360 |
| (k) `negative:hst` | `hstCents` = `Math.floor(subtotal × 15 / 100)` | unit HST: 33 310 → 4 996, not 4 997. Totals: September HST 6 927, not 6 928; the 20.529 on 136.86 floored to 20.52. |

M1 controls on the M2 code went red exactly as recorded for M1: (a) capacity, (b) race, (c) stock, (d) idempotent, (e) time,
(f) twoopt.

### Choices you may want to know about (fo2 and the lead)

- Settings validation `field` names use dots for groups: `delivery.mode`, `delivery.bands`, `delivery.zones`,
  `delivery.beyond_message`, `load.cords`, `load.description`, `truck.name`, `truck.wood_cords_per_day`,
  `truck.pellet_skids_per_day`. The top-level ones are plain (`name`, `yard`, `delivery_weekdays`, `window_days`, …). Product prices
  use `price_cents.cord`, etc.
- `PUT /api/dealer/settings` and `PUT /api/dealer/products/:id` accept partial bodies: fields not sent are kept.
- The CSV formula guard applies to text cells only. Money cells are written as numbers, so a credit is `-20.00`, not `'-20.00`.
- `owing_cents` in totals covers the season's delivered orders.
- `PUT /api/dealer/pin` answers a wrong `current_dealer_pin` with 401 and `field: "current_dealer_pin"`, as API.md says. The dealer page
  should not treat that particular 401 as "signed out".
- `migrations/0002_sample.sql` was regenerated to add `sample: true`. A database migrated before that is still read as the SAMPLE
  dealer, because `loadSettings` treats a missing `sample` as `true`.
- **Verified by the lead** (QA at 8c36e59): a Worker started without `TEST_MODE` answers 404 to `/api/test/reset` and
  `/api/test/seed` and ignores `X-Test-Now`. I could not run that check myself. **DONE**
- Previously untested here: that `/api/test/*` answer 404 without `TEST_MODE`. That needs a second Worker started without the var. The code path
  is one `if` in the router.

The lead accepted every choice above and wrote it into docs/API.md, together with `used_skids` / `cap_skids` to 2 decimals.
**DONE**

## fo2's cross-review of M1: fixes (2026-09-14, before M3)

The findings are in fo2's report under "Cross-review of fo1 M1". Each fix has a test in `worker/tests/api-m2.test.mjs`, plus a unit
test in `money.test.mjs` for #1. These fixes are their own commit.

1. **Quote without a pin: DONE.**
   - `parseProductInput` takes a `quote` option. Only a quote may leave the pin out, and only whole: `lat` and `lng` both absent or
     null. Half a pin is still 400 `field: "pin"`, and `POST /api/orders` still requires the pin.
   - `priceOrder` then returns goods, stacking and volume, with `distance_km`, `delivery_cents`, `subtotal_cents`, `hst_cents` and
     `total_cents` all `null`. It still raises `below_minimum`. A `delivery_cents` override does not stand in for a pin: still null,
     as API.md reads.
   - Tests: the exact body for 3 stacked face cords of birch; null with an override; below the minimum; half a pin; an order with
     no pin.
2. **The quote honours `delivery_cents`: DONE.** The quote route parses the override exactly like a phone order: the band lookup is
   skipped, so Buchans with $10.00 quotes $356.50. The public order route still ignores an override (Buchans stays `outside_area`).
3. **Override range 0–50 000: DONE.** Error text "Enter a delivery fee from $0.00 to $500.00." It applies to both the quote and the
   phone order: 50 000 → 200, 50 001 → 400 with that text.
4. **Over-capacity wording: DONE.** `overCapacity` uses the cords wording when wood is short or both are, and the bags wording when
   only pellets are. Tests:
   - A cord on a day over a lowered 2-skid limit: "210 of 140 bags already planned, this order needs 0."
   - 14 bags on a day over a lowered 3-cord limit: "4.00 of 3.00 cords already planned, this order needs 0.00."
   - Both short: cords.

   The dealer edit's 409 uses the same function.
5. **`sample` hard-coded: already fixed by M2.** `sample` lives in settings (`true` after reset) and is returned by `GET /api/info`,
   the status page and the driver day. M2's settings test checks `sample: false` reaching all three.
6. **Schedule of an unknown order: DONE.** `schedule()` loads the order before checking the date, so `o_nope` is 404 with a Sunday,
   a Tuesday or a malformed date.
7. **Settled in the contract by the lead; no code change.**

Verified: `npm test` unit 33 / 0 / 0, API 74 / 0 / 0.

Negative control for #1:

`negative:nopin`: the copy's `priceOrder` uses the yard as the pin when there is none. **Red** in both tests:
- Unit: distance 0, delivery 0, subtotal 36 000, HST 5 400, total 41 400, where null was expected.
- API: `distance_km: 0, delivery_cents: 0, hst_cents: 7200`, where null was expected.

`npm run negative` now runs 12 controls. All 12 went red on this commit's code, with a fresh Worker for all 11 API controls. The log
is `worker/tests/negative-control.log`; the M2 run is superseded by this one.

## M3: the driver page (2026-09-14)

### What I built: DONE

`app/public/driver/`: `index.html`, `driver.css`, `driver.js`, `driver-api.js`, `queue.js`, `sw.js`. Plain ES modules, no build,
tokens from `/theme.css`, solid ground with no aurora.

- **Hooks.** Every `/driver/` hook in PLAN.md is kept: `#pin`, `#signin-btn`, `#start-route`, `[data-stop="<order id>"]` (on each stop in
  the list), `#delivered`, `button.pay[data-method]`, `#amount`, `#take-photo` (label) for `#photo-input`, `#save-delivery`,
  `#sync-strip`, `#undo`, `#daylight`.
- **Sign-in.** The token is kept in `localStorage` under `firewood-orders:driver-token`. Wrong PIN → "That PIN is not right." A 401
  later shows sign-in again ("Nothing saved on this phone is lost") and keeps the queue.
- **Header.** Dealer name, SAMPLE badge (hidden when `sample: false`), the day's long label, and a Daylight toggle
  (`<html data-theme="daylight">`, remembered on the phone and applied before first paint). The sync strip sits inside the sticky
  header, so it is always visible.
- **The day.** "Today's deliveries" with a Today / Tomorrow switch; "Order is by distance, not road time."; "Start the route".
  "Stop N of M" and the next stop that is not delivered: name 32 px, address 20 px, dump notes 20 px in an ember-edged box, product
  and quantity, owing pill. "Open in Maps" is a real link to the API's `maps_url` with `target="_blank"`. Delivered opens the sheet.
  All stops are listed below with their status and door payment.
- **Pay sheet.** "How did they pay?" with Cash / e-Transfer / Owes in their `--act-*` colours. The amount is prefilled with the owing
  and parsed from the text into cents (no floats); it is only sent when changed, so the office works out the owing at that moment.
  "Take a photo" is optional. Save is enabled once a method is chosen.
- **After Save.** The next stop shows at once, and an Undo bar stays for 15 s. Undo of a delivery still queued removes it; one already
  sent calls `DELETE /api/driver/checkins/:op_id`. Undo first waits for the sender, so it never decides while that delivery is on its
  way.
- **Offline queue** (`queue.js`):
  - Every Start and Delivered goes to IndexedDB first, with `op_id` from `crypto.randomUUID()`, `at` = the moment Save was tapped,
    and the photo downscaled on a canvas to at most 1600 px, JPEG 0.7. Photos are stored as ArrayBuffer + type, because WebKit
    cannot always keep a Blob in IndexedDB.
  - The screen is the cached day (`firewood-orders:day:<date>`) with the queue laid over it.
  - The sender posts oldest first. An item leaves the queue **only** after 200/201, then its photo is PUT and the item removed only
    after 200.
  - 400/403/404/409/413/415 move the item to a visible "Not accepted" list with the server's message and a "Remove from this phone"
    button.
  - No signal, 429 and 5xx leave it queued, with backoff from 5 s doubling to 60 s.
  - Triggers: each new item, `online`, `visibilitychange` to visible, and every 20 s while anything is queued.
- **Service worker** `sw.js` (scope `/driver/`) caches the page, its JS and CSS, and `/theme.css` on install, answers cache-first, and
  never touches `/api/*`.

### What I verified, and how it could have failed

`E2E_PORT=7704 npx playwright test tests/driver`: **36 passed, 0 failed** on chromium-390, chromium-1280, webkit-390 and webkit-1280.
One step is skipped on WebKit, described below.

- **`driver.spec.mjs`:**
  - Wrong PIN: the message is shown **and** the sign-in response is 401 (`waitForResponse`).
  - Right PIN: stops in exactly the API's route order; "Stop 1 of 3"; the owing pill; the Maps link's `href` and `target`; Tomorrow
    and back.
  - Start → fo2's status page says "Out for delivery".
  - Cash → "Stop 2 of 3", and the API has a 373.75 cash door payment and "Paid in full".
  - e-Transfer of 120.50 with a generated photo through the real file chooser → owing 253.25 to the cent; `photo_url` returns
    `image/jpeg` starting FF D8 FF.
  - Owes → the status page shows "Balance owing $373.75".
  - Undo on a sent delivery → "Stop 1 of 3" again, stock back to the cubic inch, and the door payment voided.
- **`offline.spec.mjs`:**
  - With `page.clock` paused at T and `context.setOffline(true)`, two stops are delivered (one with a photo). The strip reads "No
    signal. 2 deliveries saved on this phone. They send when signal comes back and keep the time you tapped."
  - Reload with no signal: the day and the "2 deliveries saved" strip are still there (Chromium).
  - The API still shows both out for delivery. Then the phone clock is moved +40 min and the server clock +45 min, and signal comes
    back → "All sent".
  - Both orders have `delivered_at` = T, the photo is stored, stock moved exactly once each, and the cash payment is 345.00.
  - Second test: the first check-in routed to a 500 → both stay queued, then "All sent" on the next try (the 20 s timer) with
    `delivered_at` = T.
- **`targets.spec.mjs`:** every driver button, the PIN and amount inputs, the pay buttons, the photo label, Save, Cancel and Undo are
  ≥ 56 px and hit-test to themselves (`expectTapTarget`). Action buttons have contrast ≥ 4.5 in dark and in Daylight; Daylight
  survives a reload; SAMPLE is visible; no sideways scroll at 390.
- **Screenshots** via `shot(page, testInfo, 'driver', name)` in `app/tests/driver/shots/`: signin, day, pay-sheet, offline-strip and
  daylight for each of the four projects (20 files).

What the first runs caught (each fixed, and each checked with a probe before I believed the explanation):
1. **A race in my own specs.** The strip already reads "All sent" before a Start is saved, so waiting for "All sent" right after tapping
   Start passed at once. The Start then stayed queued when the signal went. The specs now wait for `#start-route` to hide (the Start
   is saved) and then for "All sent". **The lead's journey spec has the same shape:** it reloads the status page right after tapping
   Start and expects "Out for delivery". My page sends at once and it usually wins, but waiting for `#start-route` to hide (or the
   strip to read All sent) would remove the race.
2. **Chromium-1280 once got `delivered_at` = the old server clock.** The phone's 20 s timer fired during `fastForward`, while there was
   no signal. The request it created still carried the old `X-Test-Now`, and in that run it went out once signal came back.
   A probe showed offline really blocks every request, even through the service worker, and that the new header arrives. The spec
   now moves the server clock before `fastForward`.
3. **A real page bug, fixed.** In WebKit under `setOffline(true)`, reading the chosen photo throws `NotReadableError`. `photoChosen`
   did not catch it, so Save stayed disabled for good. Now any failure clears the busy state and says "That photo can't be used. Try
   again, or save without it." The offline spec picks the photo while there is still signal and taps Save with none. A real phone
   reads the file without network.
4. **WebKit, checked with a probe:**
   - The page is controlled by the service worker.
   - `online` does fire on `setOffline(false)`.
   - **`page.reload()` under `setOffline(true)` fails** ("WebKit encountered an internal error").

   The offline reload step is therefore **skipped on WebKit only**, with that reason in the spec and a test annotation. The rest of
   the offline test runs on WebKit.
5. **WebKit and routing.** In WebKit, the 500 test never saw its routed request. It does not need the service worker, so it runs with
   `serviceWorkers: 'block'`, as Playwright recommends when routing. The service-worker path is covered by the reload test.

### Negative controls (M3)

Run from `app/` with `node tests/driver/negative-all.mjs`; each result is appended to `app/tests/driver/negative-control.log`.

How a control runs:
1. Copy `worker/` and `app/public/` into `app/.negative/<name>/` (git-ignored).
2. Break the copy's driver page. If the anchor is not found exactly once, the control exits 2.
3. Run one spec on chromium-390 with `E2E_PORT=7706` and `E2E_WORKER_DIR` pointing at the copy, and read Playwright's JSON report.
4. Count the control as red only if the named test failed.

**All three went red; exit 0.**

| control | the break in the copy | what went red (from the log) |
|---|---|---|
| (l) queue-early | `queue.js` removes the item just before `POST /api/driver/checkins` | the 500 test: the delivery saved with no signal vanished from the phone at once ("Stop 1 of 2" stayed where "Stop 2 of 2" belongs), so it could never reach the server |
| (m) at-on-send | the check-in is sent with `at: new Date().toISOString()` instead of the saved `at` | the offline test: `delivered_at` 13:40 (sent 40 minutes later), expected 13:00, the time Save was tapped |
| (n) overlay | a transparent absolutely positioned div over the next-stop card | the Start/Cash test: `tap(Delivered) hit-test … something else is on top`, naming the div |

Honest note on (l): the brief expected the red at "a delivery never reached the server". With no signal, the copy loses the delivery
the moment Save is tapped, so the same loss shows one step earlier, on the phone's own screen. That run shared Playwright's output
folder with a journey run; the reds above are the specific assertion failures, not artifact errors.

### Found outside my slice (for the lead)

- **The journey spec stops before the driver part.** I ran `tests/journey` against this branch on 7704. All four projects fail at line 56:
  `getByRole('tab', { name: 'New' })`. fo2's dealer page has the tabs Orders, Plan, Customers, Totals and Settings, and "New" is a
  bucket inside Orders. The journey therefore has not exercised the driver hooks yet. That mismatch is fo2's page or the lead's spec,
  not mine to change.

### Left undone / not tested

- Driver behaviour that is built but has no Playwright test yet:
  - a 401 while items are queued (sign-in shown again, queue kept);
  - Undo of a delivery still queued;
  - the "Not accepted" list with a real 409.
- The service worker is cache-first with a fixed cache name, so a changed driver page reaches a phone only when `CACHE` is bumped in
  `sw.js`. That is fine for tonight; a deploy step should bump it.

## Round after M3: ledger ids, Nothing owing, the untested driver paths, network-first service worker (2026-09-14)

On top of `git merge --ff-only main` at d4da601, with the contract at ec1030c.

### Worker: DONE
- **(a) Ledger ids.** Every `GET /api/dealer/customers/:id/ledger` entry now carries `order_id` and `payment_id`. `payment_id` is null on
  order rows, and `order_id` is null on a payment made on account.
  - Test: an order, a payment on it and a payment on account give the exact `[kind, order_id, payment_id, charge, payment, balance]`
    rows. The on-account row's `payment_id` then voids that payment, and the balance moves back to 273.75.
- **(b) Nothing owing.** `money.owingLabel(owing, { cancelled })` answers "Nothing owing" for a cancelled order with nothing paid. The
  status page's `owing_label` is the only place the API builds that label, and it passes the flag.
  - Unit test: the label with and without the flag, a credit, and a balance.
  - API test: a customer-cancelled order → `0`, "Nothing owing"; a dealer-cancelled order with a 50.00 deposit → "Credit $50.00";
    a live order paid in full → "Paid in full".
- `npm test`: unit 34 / 0 / 0, API 76 / 0 / 0. **All 12 worker negative controls red**, each API control against a fresh Worker on
  7705, with no refusals.

### Driver: DONE
- **New `queue.spec.mjs`, passing on all four projects:**
  - **(i) A 401 while deliveries wait.** With no signal, a delivery is saved at 8:50 AM on the phone clock. The dealer changes the
    driver PIN through the API, which ends the phone's session. When signal returns, sign-in shows "Sign in again. Nothing saved on
    this phone is lost." and the strip "Sign in again to send them. 1 delivery saved on this phone." The API shows the order not
    delivered. Signing in with the new PIN → "All sent" and `delivered_at` = the tap time, with the 373.75 cash payment.
  - **(ii) Undo of a delivery still queued.** With no signal, Undo removes it: "Stop 1 of 2" is back and the strip reads All sent.
    After signal and a reload the stop is still back, and the API shows `scheduled`, no `delivered_at` and no payment.
  - **(iii) Not accepted with a real 409.** With no signal, the driver saves Owes; the dealer cancels that order through the API. When
    signal returns, "Not accepted" lists "Alma P. (SAMPLE): This order was cancelled.", the Worker's own 409 message. "Remove from
    this phone" clears it, and it stays cleared after a reload.
  - **(iv) A refused photo is not a refused delivery.** The photo PUT is routed to a 415, with the service worker blocked as in the
    offline spec. The delivery is saved, the page says "The delivery was saved; the photo couldn't be used.", "Not accepted" stays
    hidden, and the API shows the order delivered with no photo.
- **Page change for (iv).** `queue.js` handles a refused photo PUT (413, 415 and other 4xx except 401/429) by removing the item and
  calling `onPhotoRefused`. It never marks the delivery rejected, because its check-in was already accepted.
- **Page bug caught by (iii) on WebKit-390**, where the screen is only 664 px tall: the Undo bar sat over "Remove from this phone", so
  the hit-test failed. Now:
  - the bar hides once its own delivery is refused (an Undo for it means nothing);
  - while the bar is open, `html` gets 96 px of bottom scroll padding, so scrolling to a control stops above the bar.
- **`sw.js` is network-first** with a 3 s timeout. A good answer is served and written to the cache; no answer, a slow one or an error
  status falls back to the cached copy; `/api/*` is never touched. A changed driver page reaches phones on their next load with signal,
  without a cache bump. The offline reload test still passes (Chromium; WebKit still skips that one step, as before).
- `E2E_PORT=7704 npx playwright test tests/driver`: **52 passed, 0 failed** (13 tests × 4 projects). **All 3 driver negative controls
  red** on this code, with the same failures as before. No other Playwright run shared the output folder this time.

### Not tested
- That a changed page reaches a phone through the network-first service worker. That needs the served file to change between two loads
  of the same browser context, and Playwright cannot route requests the service worker makes in every engine. The code path is short
  and commented in `sw.js`.
