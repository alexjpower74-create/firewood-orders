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
