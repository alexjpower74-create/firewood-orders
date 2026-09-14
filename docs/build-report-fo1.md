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
- Not tested here: that `/api/test/*` answer 404 without `TEST_MODE`. That needs a second Worker started without the var. The code path
  is one `if` in the router.

### Left undone

M3 (the driver page) is not started, as asked.
