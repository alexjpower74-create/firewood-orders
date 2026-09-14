# Firewood Orders

An order book and delivery route for a small Newfoundland firewood and wood-pellet dealer. Customers order on their phone, the
dealer plans delivery days by what the truck can carry, the driver works the route even with no signal, and the dealer always
knows who has paid and who still owes.

**Local build from the 2026-09-14 overnight sprint.** Nothing is deployed, nothing is sent to anyone, and the app never takes a
payment. Every business and person on screen is SAMPLE.

## Run it on this computer

```sh
cd ~/Projects/"Firewood Orders"
npm run demo
```

Then open:

| Screen | Address | PIN |
|---|---|---|
| Customer order page | <http://127.0.0.1:7701/> | none |
| Dealer side | <http://127.0.0.1:7701/dealer/> | 1357 |
| Driver's phone (best at phone width) | <http://127.0.0.1:7701/driver/> | 2580 |

The first run seeds a SAMPLE fortnight of orders around today; later runs keep what you changed. `npm run demo -- --fresh` starts
the SAMPLE fortnight again. Stop it with Ctrl+C. Needs Node 22+ and `wrangler` 4.131+ on the PATH (no Cloudflare account; it runs
with `wrangler dev --local`).

## What it does

- **Customer** (`/`): pick firewood (cord, half cord, face cord or the dealer's "load", each explained in plain words) or pellets
  (bag, ton, skid), how much, drop a pin on the map where the truck should dump it, dump-spot notes, which days suit, name and phone.
  A live price with delivery by distance and HST 15 %. "Request sent" gives a status link: Requested, Scheduled for a day, Out for
  delivery, Delivered, and the balance owing. Deposit instructions are text the dealer writes.
- **Dealer** (`/dealer/`): the orders board (New, Scheduled, Delivered, Owing), scheduling by the truck's daily limit (the app refuses
  to plan a day past it), the day's route on a map in best order by distance (nearest neighbour + 2-opt from the yard), drag or Move
  up / Move down to change it, phone orders, payments and a ledger per customer, month and season totals with HST, CSV downloads,
  settings for products, prices, delivery fees, the truck, the season and PINs, and "Copy text" messages ("we're coming Tuesday").
- **Driver** (`/driver/`): today's stops in order, Start the route, Open in Maps, big Delivered with Cash / e-Transfer / Owes and an
  optional photo, Undo, a Daylight mode for bright sun. **Works with no signal:** deliveries are saved on the phone and sent when
  signal comes back, keeping the time the driver tapped.
- Stock on hand goes down when a load is delivered, not when it is ordered.

## Real and SAMPLE

- **Real:** Newfoundland place names and coordinates from Natural Resources Canada's Geographical Names Database
  (`data/sample-places.json`, raw answers in `data/sources/geonames/`), the 15 % NL HST, the definition of a cord, the base map
  (OpenFreeMap's vector style from OpenStreetMap data, with its attribution; tests never fetch it, a stand-in style is served).
- **SAMPLE:** the dealer "SAMPLE Wood & Pellets — Springdale (demo)", every customer (names end in "(SAMPLE)", no house numbers),
  products, prices, stock, the truck, phone numbers (709-555-01xx), the deposit e-mail (example.com) and the delivery photos
  (generated placeholder images).

## Tests

```sh
cd worker && npm test                 # unit tests, then the API suite against wrangler dev --local on 7702
cd worker && npm run negative         # 12 Worker negative controls: each breaks a copy and must go red
cd app && npm install && npx playwright install chromium webkit   # first time only
cd app && npx playwright test         # web + driver + journey: chromium and webkit, 390 and 1280, real taps
node app/tests/web/negative-capacity-message.mjs   # and the other web controls in app/tests/web/negative-*.mjs
node app/tests/driver/negative-all.mjs             # 6 driver negative controls
node app/tests/journey/negative-journey.mjs        # the journey's negative control
```

Final numbers (pinned QA worktree): see **Test numbers** below and `docs/build-report.md`.

### Test numbers

Final QA from a worktree pinned to `0f8262d`, one run, nothing re-run to get green:

| Suite | Passed | Failed | Skipped |
|---|---|---|---|
| Worker unit tests (money, units, route, time, CSV, PNG, sample data) | 34 | 0 | 0 |
| Worker API tests against `wrangler dev --local` | 76 | 0 | 0 |
| Playwright web: customer and dealer pages | 106 | 0 | 6 |
| Playwright driver page and offline queue | 76 | 0 | 0 |
| Playwright journey: order → schedule → deliver → Delivered | 4 | 0 | 0 |

Playwright runs every spec in chromium and webkit at 390 and 1280 px with real taps and typing; the 6 skips are tests written
for the other width. **Negative controls: 27 of 27 went red** (12 Worker, 8 web, 6 driver, 1 journey). Each breaks a copy of the
code, never the shipped code, and proves its check can fail.

Polish after review (`fbce0f5`): product cards name the unit of their "from" price and the firewood icon is a woodpile; the
affected specs (order, targets, dealer, journey) passed 70 / 0 / 2 skipped, and a 28th negative control went red.

## What deploying needs

Not done tonight; Alexander decides. Full checklist in `docs/DEPLOY.md`. In short: a D1 database `firewood-orders` (create, put
its id in `worker/wrangler.toml`, apply the migrations remotely), an R2 bucket `firewood-orders-photos`, deploy the Worker
`firewood-orders` (it serves the pages too). No secrets and no cron. Then change both PINs, enter the real dealer's settings and
turn SAMPLE off. Never set `TEST_MODE`. Map tiles need nothing: OpenFreeMap is free with commercial use
allowed and no key, but has no SLA; switching provider is two lines under `[vars]` in `worker/wrangler.toml`.

## Where to pick this up

- `PLAN.md` is the build contract, `docs/API.md` the API contract, `DECISIONS.md` every call made overnight (and why).
- `docs/build-report.md` has the final QA; `docs/build-report-fo1.md` and `docs/build-report-fo2.md` have each slice's detail,
  negative controls and cross-reviews.
- Known limits: one truck with a daily limit (no reload trips drawn), one product per order, route order by straight-line
  distance (not road time), e-Transfer at the door counts as paid (no "pending" state), one photo per order.
