# Firewood Orders: build contract

One plan file. It is the contract, and it lives at the repo root so every agent reads the same copy.
Then read `docs/API.md` (the contract between slices) and `DECISIONS.md`. `BRIEF.md` is the original brief. `AGENTS.md` has ports.

## The brief (Onyx for Alexander, 2026-09-14)
Order book and delivery route for a small Newfoundland firewood / wood-pellet dealer, sellable to the many one-truck wood dealers
across NL. Customers order on their phone (or the dealer types in a phone order), the dealer plans delivery days by truck capacity,
the driver works a route, and the dealer always knows who has paid and who still owes.

- **Products (dealer settings, PIN):** firewood by the cord / half cord / face cord / load, with each unit explained in plain
  words (including the dealer's own definition of a "load"), species/mix, dry vs green, cut length, split/unsplit, stacking extra;
  pellets by the bag / ton / skid with brand; delivery fee by distance band or zone; minimum order; season open/closed. **Stock on
  hand goes down on delivery, not on order.**
- **Customer order (phone-first, no account):** product → quantity → address as a map pin (Leaflet + OSM, attribution) + dump
  spot notes ("by the shed, not on the lawn") → preferred days → name/phone → **Request sent**. Status link: Requested / Scheduled
  for <day> / Out for delivery / Delivered, and the balance owing. Deposit instructions are text the dealer sets. **The app takes no
  payments and sends nothing.**
- **Dealer:** orders board (new, scheduled, delivered, owing), delivery day planner by truck capacity, route for the day (nearest
  neighbour + 2-opt from the yard, drag to reorder, "by distance, not road time"), payments ledger per customer, month and season
  totals with HST 15 %, CSV export, "Copy text" buttons for "we're coming Tuesday" messages.
- **Driver (phone):** the day's stops, big **Delivered** (+ optional photo) and **Cash / e-Transfer / Owes** at the door, **works
  offline with a queue** that keeps the time the driver tapped.
- **Data:** "SAMPLE Wood & Pellets — Springdale (demo)", SAMPLE customers whose names end in "(SAMPLE)", at real community points
  from `data/sample-places.json` (NRCan geographical names), never house numbers.

## Design
Tokens are in `app/public/theme.css` (lead-owned; read it, do not edit it, style your pages in your own CSS). Dark navy ground,
ember orange accent, teal for pellets, status colours Requested amber / Scheduled sky / Out for delivery violet / Delivered green /
Cancelled slate / Owing rose. The look is Alexander's approved portfolio look: tonal surfaces, hairlines, soft shadows, colour on
data, pills, edges and icons, never a loud backdrop (`.aurora` at 0.2 is allowed on customer and dealer pages, never the driver's).
System fonts only. No emoji as icons (inline SVG where an icon helps). Everything quiet under `prefers-reduced-motion`.
Tap targets ≥ 44 px everywhere, ≥ 64 px on the driver page (56 px floor). Phone-first at 390, comfortable at 1280. Sticky headers
carry `data-sticky-header` (the `tap()` helper reads it). Every screen shows the dealer name with a visible `.sample-badge` SAMPLE.

- **Order page `/`:** single column; a progress header (1 What · 2 How much · 3 Where · 4 When · 5 You); product cards with a coloured
  left edge (wood ember / pellets teal) and chips (Dry or Green, 16 in, Split); units as large radio cards with price, and the
  selected unit's `explain` text shown under it (the dealer's load definition for `load`); a −/+ quantity stepper; stacking row with its
  price; the map (≥ 300 px tall at 390) with a hint "Tap the map where the truck should dump it" until pinned, a draggable marker,
  and "3.4 km from our yard, as the crow flies"; address + dump spot notes; day chips + "Any day"; name, phone, note. A sticky glass
  price bar at the bottom: goods, stacking, delivery, HST, **Total**, and the step's primary button; errors inline under the field
  the API names. Confirmation "Request sent" with an inline-SVG check, the status link, "Copy link".
- **Status page `/o/?t=`:** dealer header + SAMPLE; the big status pill (status colour) with `status_label`; a 4-step timeline
  (Requested → Scheduled → Out for delivery → Delivered); the order card (product, quantity + explain, stacking, address, dump notes,
  preferred days); the money card (goods, stacking, delivery, HST, total, paid, and `owing_label` large); the deposit box
  ("This page takes no payments." + `deposit_text`); the photo when delivered; the dealer phone as a `tel:` link.
- **Dealer `/dealer/`:** 1280: a left rail (Orders, Plan, Customers, Totals, Settings); 390: a top segmented tab bar that scrolls.
  Orders: stat cards (New, Scheduled, Delivered, Owing) with coloured icons and counts; order cards with a status-coloured left edge,
  wood/pellet volume chips (tinted), total and owing pills, preferred days. Plan: 21 day rows, each with a wood bar (ember) and a
  pellet bar (teal), "3.00 of 4.50 cords", "70 of 210 bags", a red edge and "Over the truck's limit" when `over`; tapping a day opens
  its route: map with the yard marker, numbered stop markers and the route line, beside (1280) or above (390) the stop list with drag
  handles and Move up / Move down, "Put in best order", total km, and "Order is by distance, not road time."
- **Driver `/driver/`:** solid ground, no aurora; header with dealer name, SAMPLE, date and a **Daylight** toggle
  (`<html data-theme="daylight">`, remembered on the phone). A sync strip always visible under the header: "All sent" or
  "No signal. 2 deliveries saved on this phone. They send when signal comes back and keep the time you tapped." "Stop 2 of 6";
  the next stop: name ≥ 32 px bold, address 20 px, dump notes 20 px in a raised ember-edged box, product + quantity, owing pill.
  Full-width buttons ≥ 64 px, 16 px apart: "Open in Maps" (outline), **Delivered** (`--act-delivered`). Delivered opens a sheet:
  "How did they pay?" **Cash** / **e-Transfer** / **Owes** (their `--act-*` colours), amount prefilled with the owing, "Take a photo"
  (optional), **Save**. After Save the next stop shows at once and an **Undo** bar stays 15 s. All stops listed below.

**Words (use exactly; tests read them):** "Order firewood or pellets", "What would you like?", "How much?", "Where should we drop it?",
"Tap the map where the truck should dump it", "Dump spot notes", "Which days suit you?", "Any day", "Your name", "Phone number",
"Send request", "Request sent", "Keep this link to check on your order.", "Copy link", "Copied", "This page takes no payments.",
"Orders", "New", "Scheduled", "Delivered", "Owing", "Plan", "Customers", "Totals", "Settings", "Add a phone order", "Schedule",
"Take off the schedule", "Record a payment", "Put in best order", "Order is by distance, not road time.", "Move up", "Move down",
"Copy text", "Download CSV", "Today's deliveries", "Start the route", "Open in Maps", "How did they pay?", "Cash", "e-Transfer",
"Owes", "Take a photo", "Save", "Undo", "All sent", "Daylight", "That PIN is not right."

**Hooks the lead's journey test relies on (keep these ids/attributes):**
`/`: `button.product[data-product="<id>"]`, `button.unit[data-unit="<unit>"]`, `#qty-plus`, `#qty-minus`, `#map`, `#address`,
`#dump-notes`, `button.day[data-date="<date>"]`, `#any-day`, `#name`, `#phone`, `#send`, `#status-link` (readonly input), `#quote-total`,
and a "Next" button `#next` between steps. `/o/`: `#status`, `#owing`, `#deposit`, `#photo`. `/dealer/`: `#pin`, `#signin-btn`,
tabs `role="tab"` named as above, order cards `[data-order="<id>"]`, inside a card the "Schedule" button, the schedule picker's
`button.day[data-date]`, and inline errors with `role="alert"`. `/driver/`: `#pin`, `#signin-btn`, `#start-route`,
stops `[data-stop="<order id>"]`, `#delivered`, `button.pay[data-method="cash|etransfer|owes"]`, `#amount`, `#take-photo` (label) over
`#photo-input` (file input), `#save-delivery`, `#sync-strip`, `#undo`, `#daylight`.

## Stack
- `worker/`: Cloudflare Worker, plain JS ESM, no build, **no npm dependencies** (use the `wrangler` on PATH, 4.131+).
  `worker/wrangler.toml`: name `firewood-orders`, `main = "src/index.js"`, `compatibility_date = "2026-09-01"`, D1 binding `DB`
  (`database_name = "firewood-orders"`, `database_id = "00000000-0000-0000-0000-000000000000"` with a comment that deploy replaces it,
  `migrations_dir = "migrations"`), R2 binding `PHOTOS` (`bucket_name = "firewood-orders-photos"`), `[assets] directory = "../app/public"`,
  `run_worker_first = ["/api/*"]`. **No `TEST_MODE` in `[vars]`, ever.**
- `app/public/`: plain HTML/JS/CSS served by the same Worker. Leaflet 1.9.4 is vendored in `app/public/vendor/leaflet/` (lead-owned).
- `app/tests/`: Playwright 1.63; `app/node_modules` is installed on main and the lead symlinks it into your worktree. Config, helpers
  (`fresh`, `newContext`, `tap`, `type`, `tapMap`, `expectTapTarget`, `contrastOf`, `api`, `dealerToken`, `driverToken`, `orderViaApi`,
  `samplePhotoPng`, `shot`, `assertNoThirdParty`, `place`) and `start-worker.mjs` are lead-owned: import them; ask in your report for changes.
  Every spec calls `fresh(context, request)` first and `assertNoThirdParty(context)` last. Real input only: taps and clicks through
  `tap()`, typing through `page.keyboard`, drags through `page.mouse`, photos through the real file chooser after a real tap; never set
  app state with `evaluate`. Native `<select>` may use `selectOption`.
- Local dev everywhere: `wrangler dev --local --port <p> --inspector-port <p+10> --persist-to <dir>`; tests add `--var TEST_MODE:1`.
  Migrations: `wrangler d1 migrations apply firewood-orders --local --persist-to <dir>` (from `worker/`).
- **Reference, read only:** `~/Projects/Book a Bay` and `~/Projects/Snow Route` are sibling builds with the same shape. Book a Bay's
  `worker/tests/run.mjs`, `worker/tests/negative-lib.mjs` + `negative-*.mjs` (copy-the-worker-and-break-it controls) are good patterns
  to copy and adapt. Never write in those folders, never run anything from them.
- **Ports (never use another):** fo1 Worker 7702 (inspector 7712), fo1 driver e2e 7704 (7714), fo1 negative copies 7705 (7715) and
  7706 (7716). fo2 dev Worker 7701 (7711), fo2 e2e 7703 (7713), fo2 negative copy 7707 (7717). Lead 7708 (7718), QA 7709 (7719).
  Other crews run wrangler on this machine and hold the default inspector port 9229.

## Rules
- You own the files listed under your id and **nothing else**. If you need a change in someone else's file, say so in your report;
  do not reach in. `rig guard` enforces this. The lead owns `docs/API.md`: if the contract is wrong or unclear, write the question in
  your report and end your turn; do not invent a different contract.
- Verify, then commit, then report. Never leave a verified step uncommitted: a usage-limit pause lands mid-task with no warning.
- Your report goes in `docs/build-report-<your id>.md`, committed with your work: tests passed/failed/skipped, every negative control
  with the exact break and the red output, known gaps, and anything you want the lead to decide.
- Commit only your own paths: `git commit -- <paths>`. Never grade the shared tree; the lead's numbers come from `rig qa`.
- A check that cannot fail measured nothing. Every task below names its negative controls: make each red once, record it, restore.
  Controls break a **copy** (in `.negative/`, git-ignored), never the shipped code, and the shipped code has no switch that turns a guard
  off. A Worker copy keeps the relative `../app/public` (copy or symlink it beside the copied `worker/`).
- **Milestones.** Finish the milestone, commit, update your report, and end your turn with a one-paragraph summary. The lead merges,
  sends a cross-review, then prompts you for the next milestone. Do not start the next one before that prompt.
- Local only: no deploy, no `--remote`, no `d1 create`, no `r2 bucket create`, no `secret put`. Nothing is sent anywhere, no payment is
  taken. If auto mode denies something, do not work around it; note it in your report and carry on.
- No devils or demons, no emoji icons, SAMPLE on every screen, no real businesses, no house numbers.
- No request to a real third-party host from any test (the helpers route tiles to a placeholder and fail on anything else).
- Keep scratch files inside your own worktree; never `/tmp`. Stop every server you start before you end a turn.

## Agents

### fo1 — Worker, D1, R2, money, capacity, route, check-ins; the driver page
Owns:
- worker/**
- app/public/driver/**
- app/tests/driver/**

Report: docs/build-report-fo1.md

Task:
Implement `docs/API.md` exactly in `worker/src/` (suggested split: `index.js` router, `units.js`, `money.js`, `route.js`, `time.js`
NL labels + month bounds via `Intl`, `auth.js` PIN/tokens, `clock.js` now/IP with the TEST_MODE rule, `csv.js`, `sample.js` + generated
`sample-places.js`). `worker/tools/build-sample-data.mjs` reads `../data/sample-places.json` and writes `src/sample-places.js` (commit the
output; the Worker never reads outside `worker/`). `npm test` = `node tests/run.mjs`: pure unit tests first, then wipe
`worker/.state-<PORT>`, apply migrations there, start `wrangler dev --local --var TEST_MODE:1` on `PORT` (default 7702, inspector +10) if
nothing answers, run `node --test tests/api.test.mjs`, stop what it started. `npm run negative` runs every negative control; each appends
its output to `tests/negative-control.log` and exits 0 only if its check went red. `npm run dev` = migrate + wrangler dev on 7702.

**M1 (Worker core; commit as soon as it is green, then stop):** `wrangler.toml`; `migrations/0001_init.sql` (settings single row,
products, customers, orders with the snapshotted money columns and `route_pos`, payments, checkins with `op_id TEXT PRIMARY KEY`,
stock_moves, sessions, signin_attempts, order_attempts); `migrations/0002_sample.sql` (the SAMPLE settings, products and both PINs as
PBKDF2 hash + salt, per API.md). Routes: `GET /api/info`, `POST /api/quote`, `POST /api/orders`, `GET /api/o/:token`, `GET /api/photos/:token`,
`POST /api/signin`, `POST /api/signout`; dealer `GET board`, `GET orders/:id` (with `messages`), `POST orders`, `POST orders/:id/schedule`,
`POST orders/:id/unschedule`, `GET days`, `GET days/:date/route`, `POST days/:date/route/optimize`, `PUT days/:date/route`, `GET customers`,
`GET customers/:id/ledger`, `POST payments`; driver `GET day`, `POST day/:date/start`, `POST checkins`, `PUT checkins/:op_id/photo`;
`POST /api/test/reset`.
M1 unit tests: `tests/units.test.mjs` (every unit's volume; face cord at 12, 16, 18 and 24 inches; explain texts exact; `qty_label`
plurals); `tests/money.test.mjs` (goods; stacking half-up: 6 500 ¢/cord on a 16-inch face cord = 2 167; band edges: exactly 10.0 km →
the free band, 10.01 km → $25.00, 60.01 km → `outside_area`; zones; HST: subtotal 33 310 → 4 997, subtotal 10 → 2; min order at and below
the line; **owing to the cent**: 300 seeded random ledgers of orders (some cancelled) and payments (some voided, some without an order)
where every order `owing_cents` and the customer `balance_cents` equal an independent sum written out in the test);
`tests/route.test.mjs` (haversine for Springdale → King's Point against a value computed in the test with the formula written out; a
crafted crossing instance where nearest neighbour crosses itself and the result does not, with the exact expected order; on 50 seeded
random instances no single segment reversal shortens the returned path by more than 1 m; result ≤ nearest-neighbour length;
deterministic; empty and one-stop inputs; a start other than the yard).
M1 API tests (`tests/api.test.mjs`): info shape against API.md (4 products, `delivery_dates` start tomorrow and skip Sundays); quote
numbers for three orders written out by hand; order validation one test per field; 201 → status page `Requested`, owing = total;
customer found again by phone; signin 401 with `field: "pin"`, dealer and driver roles, driver token on a dealer route → 403, no token →
401; board buckets and counts; schedule to a Sunday → 400 `field: "date"`; **capacity**: four 1-cord orders on Tue Sep 15, a fifth 1-cord →
409 `over_capacity` with the exact `day` numbers and message, a half cord then fits (4.5 = the cap exactly) → 200, then even a face cord →
409; pellets: 3 skids planned then 1 bag → 409; moving an order between days frees the first day; **the race**: 8 concurrent schedule calls
for 1-cord orders into an empty day → exactly 4 × 200 and 4 × 409, and `GET days` shows 4.00 cords used; **stock**: unchanged after
order, schedule and start; a delivered check-in of a 16-inch face cord drops `stock_cu_in` by exactly 73 728 (read through the settings
table in a test-only way you document, or `GET /api/dealer/settings` once M2 lands; say which); **idempotent check-in**: the same `op_id`
twice → 201 then 200 `duplicate: true`, stock moved once, one door payment; another `op_id` for that order → 409 `already_delivered`;
`requested` order → 409 `bad_state`; **original time**: `at` = T, server now = T + 45 min → `delivered_at` = T, `at_adjusted` false, the
status page `delivered_label` shows T's NL time; `at` 2 h in the future → adjusted; **door payment**: Cash without amount → payment =
owing and `Paid in full`; e-Transfer of part → owing is the difference to the cent; Owes → no payment, `Balance owing $…`; start → board
shows out for delivery and the status page says `Out for delivery`; ledger running balance on 3 orders + 4 payments (one on account);
route optimize on 6 SAMPLE stops matches the pure module's order and `total_km`; route PUT refuses missing, duplicate and foreign ids;
photo PUT png → `GET /api/photos/:token` returns the same bytes and type; 415 for `text/plain`; 413 for 5 000 001 bytes.
M1 negative controls: (a) `negative:capacity` — the copy's capacity guard ignores the day's current use → the over-plan test goes red;
(b) `negative:race` — the copy reads the day's use in one awaited statement and writes in another, with an honest
`await scheduler.wait(25)` between → the race test sees more than 4 winners and goes red; (c) `negative:stock` — the copy moves stock when
the order is created → the stock test goes red; (d) `negative:idempotent` — the copy inserts check-ins under a fresh random id instead of
`op_id` → the duplicate test sees stock moved twice and goes red; (e) `negative:time` — the copy stores server now instead of `at` → the
original-time test goes red; (f) `negative:twoopt` — the copy skips 2-opt → the crossing and local-optimum tests go red.

**M2 (Worker, the rest; after the lead's prompt):** every remaining route in API.md: `POST /api/o/:token/cancel`; dealer `PUT orders/:id`,
`cancel`, `undeliver`, `DELETE payments/:id`, `GET totals`, both CSV exports, `GET/PUT settings`, `POST/PUT products`, `POST products/:id/stock`,
`PUT pin`; driver `DELETE checkins/:op_id`; rate guards (sign-in 5 wrong / 15 min per IP → 429 then even the right PIN; orders 10/hour per
IP); `season_closed`; zones mode end to end; `POST /api/test/seed {scenario: "demo"}` (12 SAMPLE customers at the SAMPLE places with small
fixed offsets, orders from 10 days ago to 7 days ahead in every status, one day at 4.00 of 4.50 cords, payments so that some owe and some
are paid, two delivered orders with a generated placeholder PNG photo labelled SAMPLE). Tests: every route's happy path and its main
refusals; settings validation one test per field group; an edit that changes volume on a scheduled order re-checks capacity; undeliver and
driver undo each put stock back and void the door payment (owing restored to the cent); undo after 16 min → 409 `too_late`; voided payments
leave every sum; **totals**: HST and totals equal row sums, zero months present, **NL month boundary** (delivered at
`2026-10-01T02:00:00Z` = Sep 30, 11:30 PM NDT counts in September, not October); CSV: header exact, CRLF, quoting of `Smith, "Junior"`,
formula guard on a customer named `=SUM(A1)`, filename; messages text exact for each kind; season closed → public 403, phone order still
201; the demo seed produces non-empty totals for September 2026. M2 negative controls: (g) `negative:month` — UTC month bounds → the
boundary test goes red; (h) `negative:csvguard` — no formula guard → the CSV test goes red; (i) `negative:void` — voided payments counted →
the void test goes red; (j) `negative:undo` — undo leaves stock down → the undo test goes red; (k) `negative:hst` — `Math.floor` of 15 % →
the HST test goes red.

**M3 (the driver page; after the lead's prompt, `git rebase main` first):** `app/public/driver/` per Design, talking only to docs/API.md
through `driver/driver-api.js`. PIN sign-in (token in `localStorage` `firewood-orders:driver-token`; a 401 later keeps the queue and asks
to sign in again); today's day (a "Tomorrow" link for planning ahead); "Start the route"; "Stop N of M" and the next not-delivered stop;
"Open in Maps" = the API's `maps_url`, a real link with `target="_blank"`; Delivered → the pay sheet → Save; the Undo bar (a queued
check-in is removed; a sent one calls DELETE); all stops below with status and door payment; Daylight toggle. **Offline queue**
(`driver/queue.js`): every Start and Delivered is written to IndexedDB first (with its photo blob, downscaled on a canvas to max 1600 px,
JPEG 0.7) with `op_id` (`crypto.randomUUID()`) and `at` = the moment Save was tapped; the screen updates from the cached day + the queue at
once; a sender posts oldest first and removes an item **only** after 200/201 (then PUTs its photo, removed only after 200); a 409/404/400
moves it to a visible "Not accepted" list with the server's message, never silently dropped; network errors and 5xx leave it queued with
backoff; the sender runs on each new item, on `online`, on `visibilitychange` to visible, and every 20 s while anything is queued. The day
is cached (`firewood-orders:day:<date>`) so the page shows it with no signal. **Service worker** `driver/sw.js` (scope `/driver/`): caches the
driver page, its JS/CSS, `/theme.css` on install, cache-first, never touches `/api/*`.
Playwright in `app/tests/driver/` (run `E2E_PORT=7704 npx playwright test tests/driver`): `driver.spec.mjs` (wrong PIN shows "That PIN is not
right." **and** the sign-in response is 401 via `waitForResponse`; right PIN → today's stops in route order; Start → the customer status page
says "Out for delivery"; Delivered + Cash → next stop shows and the API has the payment and `Paid in full`; Delivered + e-Transfer of part
with a generated photo through the file chooser → owing to the cent and `photo_url` returns an image; Owes → the status page shows
`Balance owing`; Undo on a sent delivery → the stop is back and stock restored), `offline.spec.mjs` (load online; `context.setOffline(true)`;
with `page.clock` at T deliver two stops (one with a photo); the strip says 2 saved; reload while offline and the day and "2 deliveries saved"
are still there (chromium; if WebKit's service worker cannot do this under Playwright, skip only that reload step on webkit with a written
reason); advance the phone clock 40 minutes and move the server clock (`context.setExtraHTTPHeaders`) 45 minutes; online → "All sent" → the
API shows both with `delivered_at` = T, the photo stored, stock moved once each; and: the Worker answering 500 once (route one request) leaves
both queued and they send on the next try), `targets.spec.mjs` (every driver button ≥ 56 px and hit-tests to itself at 390 in both engines;
the action buttons' contrast ≥ 4.5 in dark and Daylight; SAMPLE visible; no horizontal scroll at 390). Screenshots (sign-in, day, pay sheet,
offline strip, Daylight) at 390 and 1280 via `shot(page, testInfo, 'driver', name)`.
M3 negative controls (`app/tests/driver/negative-*.mjs`, copies in `app/.negative/`, E2E_PORT 7706 with `E2E_WORKER_DIR`): (l) the copy's
queue deletes an item **before** the server answers, with the Worker answering 500 once → the offline spec goes red because a delivery never
reached the server; (m) the copy stamps `at` when the item is sent → the original-time assertion goes red; (n) a transparent overlay over
Delivered in a copy → the `tap()` hit-test goes red. Exit 0 only if red; append to `app/tests/driver/negative-control.log`.

### fo2 — Customer order page, status page, dealer side, Playwright for them
Owns:
- app/public/index.html
- app/public/style.css
- app/public/ui.js
- app/public/api.js
- app/public/api.mock.js
- app/public/order/**
- app/public/o/**
- app/public/dealer/**
- app/tests/web/**

Report: docs/build-report-fo2.md

Task:
Build the pages per the brief and Design, talking only to docs/API.md through `app/public/api.js` (same-origin `fetch('/api/…')`; errors
surface the API's `error` text as is and place it under the input named by `field`). Money is formatted from cents in one function in
`ui.js` (`$1,234.56`); dates and "today" come from the API, never the browser clock. Until fo1's M1 is merged into your branch you may develop
against `app/public/api.mock.js` (`?mock=1`, in-memory, same shapes as API.md), but **every Playwright test runs against the real Worker**.

**M1 (pages; commit when green, then stop):** `style.css`, `ui.js`, `api.js`; the order page `/` (`index.html` + `order/`) with all five
steps, the Leaflet map (vendored; tiles and attribution from `GET /api/info`; `.leaflet-control-attribution` visible), a live quote from
`POST /api/quote` (debounced 300 ms) in the sticky price bar, the season-closed screen (`season_message` + phone), Request sent + Copy link
(clipboard, "Copied"); the status page `/o/?t=` per Design (polls every 30 s and on `visibilitychange`; a plain "We couldn't find that order.
Check the link or call us." for 404); the dealer page `/dealer/` sign-in (token in `localStorage` `firewood-orders:dealer-token`, "Sign out")
and the **Orders** tab: stat cards, the four buckets, order cards, an order detail panel (customer + balance, money, payments list, **Record a
payment** form in dollars, `messages` as "Copy text" buttons that say "Copied", **Schedule** with a day picker from `GET /api/dealer/days`
showing each day's capacity, and the 409 `over_capacity` message inline in `role="alert"`, "Take off the schedule"), and **Add a phone order**
(the same steps in a dealer form, with an optional delivery fee override). Screenshots of `/` at each step, Request sent, the status page in
each status, dealer sign-in and Orders, at 390 and 1280, via `pwshot` or `shot(page, testInfo, 'web', name)` into `app/tests/web/shots/`.

**M2 (after the lead's prompt; `git rebase main` first, fo1 M1 is merged by then):** the **Plan** tab (21 day rows with the two capacity bars
and `over`; a day's route view with the Leaflet map, yard + numbered markers + the route line, the stop list with drag handles using pointer
events **and** Move up / Move down, "Put in best order" (optimize), total km and "Order is by distance, not road time.", saved through route
PUT). Playwright in `app/tests/web/` (run `E2E_PORT=7703 npx playwright test tests/web`): `order.spec.mjs` (real taps through all five steps;
the map pin by `tapMap`; the price bar total equals the API quote and the hand-computed number for 1 cord of dry softwood to King's Point
(goods $300.00 + delivery $25.00 + HST $48.75 = $373.75); a unit's explain text changes with the unit; below-minimum and outside-area messages
appear under their fields (a pin at Buchans); Request sent → the status link opens `Requested` with `Balance owing $373.75` and the deposit
text; the map attribution "OpenStreetMap" visible), `status.spec.mjs` (each status label as the API moves the order; photo shown when
delivered; bad token → the plain message), `dealer.spec.mjs` (wrong PIN "That PIN is not right." **and** the response 401 via
`waitForResponse`; a new online order appears under New; Schedule into Tue Sep 15 → it moves to Scheduled and the status page says
"Scheduled for Tuesday, September 15"; **capacity**: with the day at 4.00 cords (setup via API), scheduling a 1-cord order shows the API's
over-capacity message in `role="alert"` and the order stays under New; Record a payment of $100.00 → owing drops by exactly 10 000 cents on the
card and on the status page; Copy text puts the API's exact `scheduled` text on the clipboard (grant `clipboard-read`/`clipboard-write` in
chromium; on webkit assert "Copied" and skip the read with a written reason); a phone order through the dealer form appears with source phone),
`plan.spec.mjs` (day bars show "4.00 of 4.50 cords" after setup; open the day → stops listed; "Put in best order" → the list order equals the
API's optimized order; 1280: a real `page.mouse` drag of stop 3 above stop 1 → the order persists after reload; 390: Move up / Move down
persists; the note text visible), `targets.spec.mjs` (SAMPLE badge on `/`, `/o/`, `/dealer/`; every button and tab ≥ 44 px and hit-tests to
itself at 390; no horizontal scroll at 390 on each page; the primary button's contrast ≥ 4.5; the sticky price bar never covers the focused
input or the Send button: hit-test after typing into the last field). M2 negative controls (`app/tests/web/negative-*.mjs`, copies in
`app/.negative/`, E2E_PORT 7707 with `E2E_WORKER_DIR`): (a) the copy's dealer page swallows the 409 message (shows nothing) → the capacity
check in `dealer.spec` goes red; (b) the copy's status page maps `scheduled` to "Requested" → `status.spec` goes red; (c) a transparent
overlay over Send request in the copy → the `tap()` hit-test goes red; (d) the copy's price bar adds HST to the subtotal as a float without
rounding → the $373.75 check goes red (use a quantity whose HST is not whole cents). Record all four with the red output.

**M3 (after the lead's prompt; rebase on main, fo1 M2 merged):** **Customers** (list by balance; a ledger with running balance; record and
void a payment), **Totals** (season select, month table with goods, stacking, delivery, subtotal, HST, total, payments; season totals and
owing; "Download CSV" for orders and payments: fetch with the token → blob download), **Settings** (dealer name, phone, deposit text, season
open + message, minimum order in dollars, HST registered, yard pin on the map, delivery bands editor or zones, the load definition, truck
limits, delivery weekdays, products add/edit/deactivate with a price per unit or "not sold", stock count set/add, change PINs), order edit /
cancel / "Mark not delivered" (undeliver) in the detail panel, and the customer's "Cancel my order" on the status page while Requested.
Specs: `ledger.spec.mjs` (payments and a void move the customer balance to the cent; running balance column equals the API),
`totals.spec.mjs` (after deliveries set up via API check-ins, the September row matches the API and a hand-computed HST; the CSV download's
text equals `GET …/orders.csv` byte for byte), `settings.spec.mjs` (change the load description → the order page's load explain shows it;
close the season → `/` shows the season message; change a price → the quote changes; a bad band list shows the API's message under the
field). M3 negative control: (e) the copy's ledger shows `total` instead of `owing` for an order → `ledger.spec` goes red. Final screenshots of
every screen per project into `app/tests/web/shots/`.

## Main (fo-lead, not a slice)
Owns PLAN.md, AGENTS.md, DECISIONS.md, BRIEF.md, docs/API.md, docs/DEPLOY.md, docs/build-report.md, docs/shots/**, data/**, tools/**,
README.md, package.json, demo.mjs, .gitignore, app/package.json, app/package-lock.json, app/playwright.config.mjs, app/tests/helpers.mjs,
app/tests/start-worker.mjs, app/tests/journey/**, app/public/theme.css, app/public/vendor/**. Merges each milestone after reading the diff,
sends cross-reviews (fo2 reviews fo1's M1 against API.md before building M2; fo1 reviews fo2's M2 API calls read-only before M3; fo2 reviews
fo1's M3 queue against API.md), writes `app/tests/journey/journey.spec.mjs` (customer orders on the page → dealer schedules on the page → driver
starts and delivers on the page → the status page shows Delivered and the owing; chromium + webkit, 390 + 1280), runs `rig qa <sha>` on 7709
for the Worker suite, every negative control and the whole Playwright suite, takes `pwshot` screenshots into `docs/shots/` from `npm run demo`,
writes README / DEPLOY / build report, pushes the private repo, closes the slice tabs by id, removes worktrees, writes the status file.

## Open questions
None blocking. Anything that needs Alexander goes under NEEDS ALEXANDER in the status file.
