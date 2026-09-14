# Build report — fo2 (customer order page, status page, dealer side)

Record, not a queue. Items marked DONE / REJECTED / OPEN in place.

## M1 — pages (2026-09-14)

### Situation when I built it

fo1's Worker did not exist yet (`rig/fo1` was still at the setup commit, no `worker/`). As the brief allows, I built and
checked every page against `app/public/api.mock.js` (`?mock=1`). **Nothing below has run against the real Worker.** The
real-Worker specs (`order`, `status`, `dealer`, `plan`, `targets`) are M2 work, after fo1 M1 is merged into this branch.

### What I built — DONE

- `api.js` — the pages' only door to the API. Same-origin `fetch('/api/…')`. A failure throws `ApiError` carrying the
  API's `error` text as is, plus `code`, `field` and `status`. The dealer token lives in localStorage under
  `firewood-orders:dealer-token`; a 401 on a dealer route clears it and signs the page out. `?mock=1` swaps in the mock
  (remembered for the tab); `?mock=0` turns it off.
- `ui.js` — `money()` is the one place cents become `$1,234.56`, using integer arithmetic only. Also: dollars→cents
  without floats, cords from cubic inches, balance labels, inline SVG icons, the dealer header + SAMPLE badge, copy
  ("Copied"), and inline field errors (`[data-error-for=<field>]`).
- `api.mock.js` — docs/API.md in the browser: SAMPLE settings and products, units / money / HST half-up / bands /
  minimum, capacity with the exact 409 wording, board buckets, messages, and payments. Fixed clock: Mon Sep 14 9:00 AM NDT.
  Demo tokens for each status. `?closed=1` closes the season.
- `/` (`index.html`, `order/form.js`, `order/order.js`)
  - The five steps with the progress header; `#next` / `#back` / `#send`.
  - Product cards with a coloured edge and chips; unit radio cards, with the selected unit's `explain` under them.
  - The −/+ stepper and the stacking switch.
  - The Leaflet map, with tiles and attribution from `/api/info`, the yard marker, the hint until pinned, a draggable
    pin, and "N km from our yard, as the crow flies" from the quote.
  - Address, dump spot notes, zones select (zones mode), day chips + Any day, name / phone / note.
  - The sticky glass price bar: goods, stacking, delivery, HST and `#quote-total`, from `POST /api/quote` debounced
    300 ms.
  - The season-closed screen with `season_message` and a `tel:` link.
  - Request sent: SVG check, `#status-link`, Copy link → "Copied".
  - All ids and hooks from PLAN.md are kept.
- `/o/?t=` (`o/index.html`, `o/status.js`)
  - Dealer header + SAMPLE + Call.
  - `#status` pill in the status colour, the 4-step timeline, `delivered_label`.
  - The order card with `explain`, the money card, `#owing` = `owing_label`, `#deposit` ("This page takes no payments."
    is added only when the dealer's text doesn't already contain it), and `#photo` when delivered.
  - Polls every 30 s and on `visibilitychange`. A 404 shows "We couldn't find that order. Check the link or call us."
- `/dealer/` (`dealer/index.html`, `dealer/dealer.js`, `dealer/dealer.css`)
  - PIN sign-in (`#pin`, `#signin-btn`, errors in `role="alert"`) and Sign out.
  - Tabs with `role="tab"`: a left rail at 1280, a sticky scrolling bar at 390 that carries `data-sticky-header` only at
    that width.
  - Orders tab:
    - Stat cards pick the bucket.
    - Order cards `[data-order]` show a status edge, a volume chip, total and owing pills, preferred days, and a
      Schedule button.
    - The day picker (`button.day[data-date]`) shows each day's cords and bags from `GET /api/dealer/days`, "Over the
      truck's limit" and non-delivery reasons. The API's 409 text appears inline in `role="alert"`.
    - The detail panel shows the customer + balance, a copyable status link, the order, money and payments.
    - "Record a payment" takes dollars and sends cents.
    - Messages have "Copy text" → "Copied". The detail also has Schedule / Change day and "Take off the schedule".
    - "Add a phone order" reuses the same form with every section shown, plus the optional delivery fee override.
  - Plan, Customers, Totals and Settings are **placeholder panels** saying they come later (M2/M3).

### How I verified it, and how it could have failed

`app/tests/web/mock-walkthrough.mjs` is not a spec; the Playwright config only picks up `*.spec.mjs`. It drives every M1
screen with the lead's real-input helpers (`tap`, `type`, `tapMap`, `shot`, `guardContext`, `assertNoThirdParty`).
It fails on any page error or console error.

Ran in chromium-390 (touch), chromium-1280, webkit-390 (iPhone 14) and webkit-1280, against a static server for
`app/public` on 7701. **All four pass.**

Checked with assertions:
- Next without a product → the message under it.
- A unit's explain changes: cord → face cord ("0.33 of a full cord") → load (the dealer's description + "1.5 cords").
- Next without a pin → "Tap the map where the truck should dump it."
- Pin at King's Point by `tapMap` → `#quote-total` $373.75 and HST $48.75.
- The attribution contains OpenStreetMap.
- The address is required before step 4.
- Hit-test taps on `#phone` and `#note` while the price bar is showing.
- Send request contrast is 6.76.
- Request sent → Copy link: "Copied", and in chromium the clipboard equals the link.
- The status link opens `Requested` with `Balance owing $373.75` and the deposit text.
- The four other statuses each show their label; a bad token shows the plain message.
- A bag of pellets → the below-minimum text under qty.
- A pin at Buchans (zoomed out) → the dealer's beyond message under the pin, and the total goes to "—".
- Season closed → `season_message`.
- Dealer:
  - A wrong PIN → "That PIN is not right."
  - The new online order shows under New.
  - Schedule into Tue Sep 15 (picker says 3.50 of 4.50) → it moves to Scheduled "On Tue Sep 15".
  - Wade's 1 cord into the now-full day → "That's more than the truck can carry that day: 4.50 of 4.50 cords already
    planned, this order needs 1.00." in `role="alert"`, and the order stays under New.
  - Record $100.00 → owing $373.75 → $273.75.
  - Copy text → "Copied", and in chromium the clipboard matches the `scheduled` message.
  - Take off the schedule → Requested.
  - A phone order with a $10.00 fee → its detail, and a `data-source="phone"` card under New.
- No request left 127.0.0.1 (tiles go to the helpers' placeholder).

Screenshots of every M1 screen at 390 and 1280 in both engines (80 files) are in `app/tests/web/shots/`, named `mock-…`
because the data behind them is the mock. I looked at them: order steps, Request sent, each status, sign-in, Orders,
the picker, over capacity, detail and phone order.

### Bugs the walkthrough caught (fixed)

1. **Toast over a button.** The "Scheduled for …" toast sat at the bottom of the phone screen over "Record a payment";
   the `tap()` hit-test went red. Fixed: the toast now sits under the header with `pointer-events: none`.
2. **A pin next to the zoom buttons zoomed the map in WebKit on a phone.** In the phone-order form (326 px map) the
   King's Point tap landed 3 px right of the zoom-out button. A probe showed `pointerdown` on the map but `click` on
   `.leaflet-control-zoom-out`: WebKit touch adjustment moves the tap, and the map went from zoom 10 to 9 with no pin.
   Fixed: the zoom control is now `bottomleft`, away from the upper corner.
   **Negative control:** a copy in `app/.negative/pin-zoom/` with `position: 'topleft'` put back, served on 7707:
   ```
   [mock-webkit-390] FAILED: expect(locator).toHaveText(expected) failed
   Locator:  locator('#map-hint')
   Expected: "Drag the pin if it isn't quite right."
   Received: "Tap the map where the truck should dump it"
   ```
   The shipped code passes the same run.
3. "Sign out" wrapped onto two lines at 390. Fixed (`white-space: nowrap`).

### Not done in M1 — OPEN (by plan)

- Every real-Worker spec and the four M2 negative controls (a–d). No Worker existed to run them against.
- The Plan tab (M2); Customers, Totals, Settings, order edit / cancel / undeliver, and the customer's "Cancel my order" (M3).
- Cross-review of fo1's M1 against API.md (the lead sends it after merging).

### For the lead — OPEN

1. **`tapMap` cannot see WebKit touch adjustment.** Its `elementFromPoint` check passes 3 px from a Leaflet control,
   but the real tap goes to the control (bug 2 above). Suggestion for `helpers.mjs`: refuse a point within ~16 px of
   any `.leaflet-control` box.
2. **Quote before the pin.** `POST /api/quote` needs a pin. Until the map is tapped, the page quotes at the yard's
   point only to show goods and stacking and to raise `below_minimum` under qty. Delivery then shows "after the map
   pin" and the total "—"; the page never works a price out itself. If the API would accept a quote without a pin
   (goods, stacking, minimum only), I'd switch to that.
3. **Texts the page writes itself** (API.md gives no wording, and the check is before any call):
   - "Choose what you would like." (no product)
   - "Tell us where to find the place, like the road and what it is near." (empty address)
   - "Pick the days that suit you, or Any day." (no preferred days)
   - "Pick your area." (zones mode, no zone)
   - "Enter the amount in dollars, like 100.00." (payment amount that isn't money)
   - "Enter the fee in dollars, like 25.00, or leave it blank." (phone-order fee)
   - "That's the driver PIN. The dealer page needs the dealer PIN." (a driver PIN on the dealer page; sign-in answers
     200 with role `driver`)

   Everything the API sends is shown as is.
4. **Phone-order total with a fee override.** `POST /api/quote` has no `delivery_cents`, so the dealer form shows the
   distance-fee quote with a note: "the total is worked out again when you save". The saved order detail shows the
   API's real numbers.
5. **`app/node_modules` shows up in `rig guard`.** It is untracked (the lead's symlink), and `.gitignore`'s
   `node_modules/` does not match a symlink. I did not commit it. A plain `node_modules` line would fix it.
6. **Mock error texts.** For `bad_request` fields that API.md gives no wording for, the mock's texts are placeholders.
   The real Worker's words will show instead.

Lead's answers (after the M1 merge), so these are closed:
- DONE: `tapMap` now refuses points within 16 px of a control.
- DONE: a quote without a pin, and `delivery_cents` on the quote, are accepted into API.md. fo1 builds them after its M2;
  the page keeps the yard workaround until the lead says they're on main.
- DONE: the seven page-written messages are signed off as DECISIONS.md #23.
- DONE: `.gitignore` has a plain `node_modules` line.
- DONE: `shot()` is fixed.
- DONE: on the status page, the first card's heading is now "Order status" (it used to say "Your order", which also heads
  the order card).

## Cross-review of fo1 M1 (2026-09-14, read-only)

**Method.** I read `git diff d1918cd d37b5d9 -- worker/`: `index.js`, `views.js`, `validate.js`, `errors.js`, `time.js`.
I checked it line by line against docs/API.md as it stands on main. Then I ran the Worker on my dev port 7701 with
`TEST_MODE:1` and probed every route my pages call with the test clock. The probe script is not committed; it lives in the
git-ignored `app/tests/results/`.

The probe covered:
- info, and quotes: with and without a pin, below the minimum, not offered, Buchans, and with `delivery_cents`
- placing orders: a good order, no address, no pin
- the status page: a good token and a 404
- sign-in: wrong PIN, dealer PIN, driver PIN
- the board with a driver token, no token and after sign-out
- days, and scheduling: a Sunday, four cords then a fifth (409), a pellet 409, unschedule
- the order detail and its messages
- payments: an unknown customer, zero, a future date
- a phone order with a fee override
- a day's route

I also drove my own pages on it without `?mock`, with real taps: the order flow → status → dealer (wrong PIN, driver PIN,
board, schedule, Record a payment, Copy text, phone order).

**What matches the contract, exactly:**
- `/api/info` shape and `delivery_dates`.
- Quote numbers: King's Point is $300.00 + $25.00 + $48.75 = $373.75.
- The error texts for `below_minimum`, `outside_area` (the dealer's `beyond_message`) and `not_offered`, each with its
  `field`.
- The 201 order body and `status_url`.
- The `/api/o/:token` shape, `status_label` ("Scheduled for Tuesday, September 15") and `owing_label`, plus a 404 for an
  unknown token.
- Sign-in: 401 `field: "pin"` "That PIN is not right."; roles and expiry times; 403 `forbidden` for a driver token;
  401 with no token and after sign-out.
- The board buckets and every order-summary field.
- `/api/dealer/days`, including "No deliveries on Sundays".
- The Sunday schedule: 400 `field: "date"` "We don't deliver on Sundays."
- The `over_capacity` 409: body byte-for-byte with API.md's example (4.00 of 4.50 cords, `day`, `needs`); the pellet
  wording "210 of 210 bags already planned, this order needs 20."
- The `scheduled` message text, character for character.
- Payment 400s with `field` (the new contract line).
- The phone-order override ($10.00 → HST $46.50).
- The route's `label` and `long_label`.

**Mismatches** (OPEN, for the lead to route to fo1):

1. **Quote without a pin.**
   - API.md (quote): "**Without a pin** (`lat`/`lng` absent or null) the quote still answers 200 with goods and stacking …
     `distance_km`, `delivery_cents`, `subtotal_cents`, `hst_cents` and `total_cents` are `null`".
   - Worker: `validate.js` `parseOrderInput` throws `400 bad_request field: "pin"` for quotes too. The probe with no pin
     and with `lat: null` both got 400.
   - Fix: when `!full` and `lat`/`lng` are absent or null, skip the pin check, and have `priceOrder` return those five
     fields as `null` (keeping `below_minimum`).
   - Already scheduled by the lead for after fo1 M2.
2. **Quote ignores `delivery_cents`.**
   - API.md (quote): "An optional `delivery_cents` (0–50 000) in the body skips the band lookup exactly as on a dealer
     phone order".
   - Worker: `quote()` calls `parseOrderInput(..., dealer: false)`, so the field is dropped. The probe sent 1000 and got
     `delivery_cents: 2500`.
   - Fix: parse `delivery_cents` on the quote route too (`dealer: true` for that field only). Same timing as 1.
3. **Override range.**
   - API.md: `delivery_cents` "(0–50 000)", which matches the settings band/zone fee limit of 0–50 000.
   - Worker: `validate.js` accepts 0–100 000, with the message "Enter a delivery fee from $0.00 to $1,000.00."
   - Fix: limit it to 50 000 with "…from $0.00 to $500.00."
4. **Over-capacity wording can name the wrong load.**
   - API.md (Capacity): cords wording for the wood limit, and "(Pellet wording: … bags …)" for the pellet limit.
   - Worker: `overCapacity()` uses the cords wording whenever `woodShort || o.kind === 'wood'`. So a pellet order refused on
     a day whose wood use is already past a lowered truck limit (`over: true`, which API.md allows) says "… cords already
     planned, this order needs 0.00." And a wood order refused because the pellets are over quotes cords that fit.
   - Fix: choose the wording by the limit that is actually exceeded (`woodShort ? cords : bags`, and cords when both).
5. **`sample` is hard-coded.**
   - API.md (Settings): "`sample` (boolean; `false` for a real dealer removes every SAMPLE badge, reported by
     `GET /api/info`)".
   - Worker: `info()`, `customerOrderView()` and `driverDay()` all return the literal `sample: true`. The pages hide the
     badge from this flag.
   - Fix: store `sample` in settings (SAMPLE reset = `true`) and return it in all three. This belongs with fo1's M2
     settings work.
6. **Unknown order + bad date gives 400, not 404.**
   - API.md: `not_found` 404 for an unknown order.
   - Worker: `schedule()` runs `checkScheduleDate` before `orderById`, so `POST /api/dealer/orders/o_nope/schedule` with a
     Sunday answers 400 `field: "date"`.
   - Fix: load the order first. Minor; no page hits it.
7. **`used_skids` precision.**
   - API.md (`GET /api/dealer/days`): shows `"used_skids": 1, "cap_skids": 3` as whole numbers.
   - Worker: returns a 2-decimal fraction (20 bags → `0.29`).
   - Fix: either the contract says "2 decimals", or the Worker floors to whole skids. The pages don't read it; they show
     bags.

**No change needed:**
- `POST /api/signout` answers `{ "signed_out": true }`; API.md only says 200.
- The 401 texts ("Sign in first.", "Your sign-in has run out. Sign in again.") aren't set by the contract; the dealer
  page shows them under the PIN.

**My own side, found by the same run:** the dealer's phone order sent an empty `name` on the real Worker, which answered
400 "Tell us your name, in up to 80 characters." under the name field. So the Worker behaved correctly; the bug is in my
page, and it is being fixed in M2 below.
Real API 4xx answers also log "Failed to load resource" console errors in the browser. My M2 specs therefore fail only on
page errors and on console errors that are not a failed resource load.

## M2: Plan tab, and the real-Worker specs (2026-09-14)

Branch fast-forwarded to main first (fo1 M1 + lead fixes). Everything below runs against the real Worker. The mock is a
development aid only; it does not implement the route endpoints.

### What I built — DONE

- **Plan tab** (`dealer/plan.js`, the panel in `dealer/index.html`, styles in `dealer/dealer.css`):
  - The 21 days from `GET /api/dealer/days`. Each has a wood bar (ember) and a pellet bar (teal) reading "4.00 of 4.50
    cords" and "0 of 210 bags", a stop count, and a red edge plus "Over the truck's limit" when `over`. Non-delivery days
    are plain rows with the API's reason.
  - Tapping a day opens its route: the Leaflet map with the yard marker, numbered stop markers and the route line
    (yard → stops → yard), fitted to the stops.
  - Beside the map at 1280, below it at 390: the stop list. Each stop has a drag handle driven by pointer events
    (`setPointerCapture`, `touch-action: none`) plus **Move up** / **Move down** buttons. Delivered stops are locked at
    the front.
  - **Put in best order** (`POST …/optimize`), the total km, and "Order is by distance, not road time."
  - Every reorder is saved with `PUT …/route`, and the list is redrawn from the API's answer. A refusal shows the API's
    words in `role="alert"`.
- **URL hash.** The open tab and the open day live in the hash (`#plan/2026-09-15`), so a reload comes back to the same
  route.
- **Status page.** The first card is now headed "Order status" (lead's request).

### The specs (`app/tests/web/`, run `E2E_PORT=7703 npx playwright test tests/web`)

Every spec calls `fresh()` first and `assertNoThirdParty()` last. Taps go through `tap()`, map pins through `tapMap()`,
drags through `page.mouse`. Setup goes only through the API. `web-helpers.mjs` adds three things:
- `watch(page)`: page errors and console errors fail the test. The browser's own "Failed to load resource" line for an
  API 4xx that the test provokes is allowed.
- `hstOf()`: the contract's half-up HST, written out.
- `typeIn()`: see the finding below.

How each spec could fail:
- `order.spec.mjs`
  - The five steps with real taps.
  - A unit's explain text for cord → face cord → load → cord.
  - `#quote-total` equals the API quote for the **exact body the page sent** (re-asked of the API), and equals $373.75
    worked out by hand (goods 30 000 + delivery 2 500 + HST `hstOf(32 500)` = 4 875).
  - A second price check where the HST is **not whole cents**: 14 bags → 2 052.9 ¢ → $20.53, total $157.39. That is what
    negative control (d) needs.
  - The API's below-minimum message under qty; the dealer's beyond message under the pin at Buchans (zoomed out with the
    real zoom button), and Next refusing both.
  - Request sent → `#status-link` equals the API's `status_url` → Requested, "Balance owing $373.75", and the deposit
    text from `/api/info`.
  - The attribution is visible and contains OpenStreetMap.
- `status.spec.mjs`
  - One order moved by the API: schedule → driver start → check-in with a generated PNG photo.
  - The page's own 30 s poll brings each change (`page.clock.runFor`), so a broken poll fails too.
  - Labels exact: Requested, "Scheduled for Tuesday, September 15", "Out for delivery", "Delivered" with
    `delivered_label`.
  - The photo is visible and loaded at 320 px wide.
  - A bad token shows the plain message.
- `dealer.spec.mjs`
  - A wrong PIN shows "That PIN is not right." in `role="alert"`, **and** the sign-in response is 401.
  - A new online order is under New; Schedule into Tue Sep 15 moves it to Scheduled, and a second page on its status link
    says "Scheduled for Tuesday, September 15".
  - **Capacity:** with 4 one-cord orders set up through the API, the picker shows 4.00 of 4.50. Tapping the day gets a
    409 whose `error` equals the contract's sentence, and the card's `role="alert"` shows exactly that text. After a
    reload the order is still under New, on the page and in the API.
  - Record $100.00: the payment's `amount_cents` is 10 000; the detail, the card and the status page drop from $373.75
    to $273.75; the API's `owing_cents` difference is exactly 10 000.
  - Copy text: the shown text equals the API's `scheduled` message, and the button says "Copied". In chromium the
    clipboard is read and must equal it. In WebKit the read is skipped with a written annotation, because Playwright
    cannot grant `clipboard-read` there.
  - A phone order (birch half cord, King's Point, $10.00 fee) answers 201. Detail total $241.50 by hand. The card has
    `data-source="phone"`, and the API board says `source: "phone"`, `delivery_cents: 1000`.
- `plan.spec.mjs`
  - Day bars "4.00 of 4.50 cords" and "0 of 210 bags", and "No deliveries on Sundays".
  - The route lists the 4 stops in API order, with 4 markers.
  - **Put in best order:** the list equals the order in the optimize response and in a fresh `GET`, and the test first
    asserts that order **differs** from the starting one (104.5 → 79.9 km), so it cannot pass by doing nothing.
  - 1280: a real `page.mouse` drag of stop 3's handle above stop 1 → a `PUT` answering 200, the list and API equal
    [3, 1, 2, 4], still so after `page.reload()`.
  - 390: Move up then Move down → the list and API equal [2, 1, 4, 3], still so after a reload.
  - The note is visible.
- `targets.spec.mjs`
  - The SAMPLE badge and dealer name on `/`, `/o/` and `/dealer/`.
  - Contrast of Next and Sign in ≥ 4.5.
  - 390: on every screen (order steps 1–5, status, sign-in, Orders, schedule picker, order detail, phone order, Plan
    days, Plan route), every visible button and tab is ≥ 44 px and hit-tests to itself, and nothing scrolls sideways.
  - After typing into the last field (`#note`), `elementFromPoint` at the field's middle **and** its lower edge is the
    field, not the price bar; then Send is hit-tested.

### Finding: key presses lost after an emulated touch tap in Chromium (my tests, not the page) — DONE, for the lead

On the real Worker, the dealer's phone order first failed with 400 "Tell us your name…". The name I typed had never
reached the field. I bisected it on the dealer's phone-order form, typing the name and then the address:

| variant (chromium, 390, touch) | address typed? |
|---|---|
| lead's `type()` (touch tap, then `keyboard.type`) | no: `keydown` fires, no `beforeinput`/`input`, no `preventDefault` anywhere (trapped) |
| map element removed / `autocomplete="off"` / 1 s wait after the tap | no |
| the same field after `keyboard.insertText` | yes, and key presses after that work |
| a **mouse** click, then `keyboard.type` | yes |
| chromium 1280 (mouse), webkit 390 (touch) | yes |

A phone's on-screen keyboard sends text as `insertText`, so this is not a bug a customer or dealer would hit. My
`typeIn()` therefore does a hit-tested `tap()`, then on touch projects `page.keyboard.insertText`, and on mouse projects
the lead's `type()`. It then **asserts the field's value**, so any lost text fails where it happens.

For the lead: `helpers.mjs` `type()` can lose characters in the chromium-390 project. You may want the same value check
there.

### Negative controls (M2) — all four RED

`node app/tests/web/negative-<name>.mjs` for each control. The shared `negative-lib.mjs` does this:
1. Copies `worker/` and `app/public/` into the git-ignored `app/.negative/<name>/`.
2. Breaks the **copy** by exact text replacement. If an anchor isn't found exactly once, it exits 2, so a control can
   never pass by breaking nothing.
3. Runs the one named test on a fresh Worker from the copy (`E2E_PORT=7707`, `E2E_WORKER_DIR`), with its own `--output`.
4. Exits 0 only if that test failed with the expected message.

The full output is in `app/tests/web/negative-control.log`.

| control | the break in the copy | red output |
|---|---|---|
| (a) `negative-capacity-message` | the schedule picker's catch sets `alert.hidden = true` instead of showing `e.message` | `expect(locator).toHaveText(expected) failed` / `Expected: "That's more than the truck can carry that day: 4.00 of 4.50 cords already planned, this order needs 1.00."` / `element(s) not found` |
| (b) `negative-status-label` | `pill.textContent = o.status === 'scheduled' ? 'Requested' : o.status_label` | `Expected: "Scheduled for Tuesday, September 15"` / `Received: "Requested"` |
| (c) `negative-send-overlay` | a transparent `.send-cover` over the bar's buttons, shown only while Send is | `tap(locator('#send')) hit-test …: something else is on top` / `Received: "<div class=\"send-cover\"></div>"` |
| (d) `negative-hst-float` | price bar total = `subtotal + subtotal * 0.15`, a float with no rounding | `Expected: "$157.39"` / `Received: "$157.38"` (14 bags: HST 2 052.9 ¢) |

The shipped code passes the same four tests (final run below).

### What the real-Worker runs caught (fixed)

1. **Plan route scrolled sideways at 390 (2 px), in both engines.** The one-column route layout was only applied between
   900 and 1100 px, so at phone width the 360 px stop list stayed beside a squeezed map. `targets.spec` found it with its
   sideways-scroll check, which doubles as that check's red run on a known-bad page. Fixed: the one-column layout now
   applies at ≤ 1100 px, and the route header, stop rows and day list stack at phone width.
2. **`targets.spec` checked screens before they were drawn** (e.g. step 1 before `/api/info` answered, `/dealer/` before
   it chose to show sign-in). That gave zero buttons, which the test refuses; a half-drawn screen would have passed with
   too few. Fixed: each screen now waits for its own content before the check.
3. **Playwright empties `app/tests/results/` when a run starts.** My first logs, kept there, were deleted by the run that
   wrote them; one run's output was lost and the run was stopped. Logs now go to the git-ignored `app/.logs/`, and each
   negative control has its own `--output`.
4. The phone-order typing finding above.

### Screenshots — DONE

`shot(page, testInfo, 'web', …)` from the specs, against the real Worker, at 390 and 1280 in both engines:
- order steps 1–5, outside the area, Request sent
- status: requested, scheduled, out for delivery, delivered, not found
- dealer: sign-in, Orders, schedule picker, over capacity, order detail, phone order
- Plan: days and route

The 80 `mock-*` shots are `git rm`'d. Not shot, because M2 can't reach them on the real Worker: the season-closed screen
(needs `PUT /api/dealer/settings`, fo1 M2) and a cancelled status (needs cancel, fo1 M2). Both come in M3.

### Left undone — OPEN

- M3 (Customers, Totals, Settings, edit / cancel / undeliver, "Cancel my order"): not started, as the milestone rule says.
- The page's quote-before-pin workaround (quoting at the yard) stays until the lead says the null-pin quote is on main.
- `api.mock.js` has no route endpoints, so the Plan tab doesn't work under `?mock=1`. It is a dev aid only; every
  spec uses the real Worker.
- The status page's refresh when it comes back into view (`visibilitychange`) is not driven by any test; only the
  30-second poll is.

### Final result (M2)

`E2E_PORT=7703 npx playwright test tests/web` on a fresh real Worker (fo1 M1 on main), all four projects:
**66 passed, 0 failed, 6 skipped**. The skips are by design, each with a written reason:
- the 1280 drag test in both 390 projects
- the 390 Move up / Move down test in both 1280 projects
- the 390 tap-target sweep in both 1280 projects

Negative controls (a)–(d): 4 of 4 red. Servers I started (dev Worker on 7701, the e2e and control Workers on 7703 and
7707) are stopped.

## M3: Customers, Totals, Settings, order changes, Cancel my order (2026-09-14)

Branch fast-forwarded to main first. That brought in fo1 M2 (every remaining Worker route), the lead's `type()` change, and
the contract notes: partial PUTs, dotted error fields, CSV money cells, the PIN-change 401, and `used_skids` to 2 decimals.
The yard workaround for a quote before the pin stays, as asked.

### What I built — DONE

- **`api.js`**
  - Every M3 route.
  - A 401 on `PUT /api/dealer/pin` with `field: "current_dealer_pin"` does **not** sign the page out; every other dealer
    401 still does.
  - CSV downloads fetch with the token and keep the response **bytes** (a `Blob` from `res.blob()`, never re-encoded
    text), with the file name from `Content-Disposition`.
- **Customers** (`dealer/customers.js`)
  - The list sorted by balance, as the API sends it, with each customer's balance label.
  - One customer's view:
    - their balance
    - their recent and unpaid orders, each with its **owing** pill and an **Open** button into the order detail
    - the ledger table, whose running-balance column shows the API's `balance_cents` per entry
    - **Record a payment**: on account, or for one of their orders
- **Voiding a payment.** The detail panel's payments each have **Void**, with an inline confirm (no browser dialogs). See
  "for the lead" below for why it lives there.
- **Totals** (`dealer/totals.js`)
  - A season select, and stat cards for total sales, HST, payments and still owing.
  - The month table (delivered, goods, stacking, delivery, subtotal, HST, total, payments) with a season row. The table
    scrolls inside its own box at 390.
  - **Download CSV** for the season's delivered orders and for its payments.
- **Settings** (`dealer/settings.js`): one form per group, each saving only its own group (partial PUT):
  - business, with the SAMPLE switch
  - season and prices (open/closed, message, first day, minimum order in dollars, HST)
  - the yard pin on a Leaflet map, with its name
  - delivery fees: a bands editor and a zones editor, plus the too-far message
  - the load definition
  - the truck
  - delivery weekdays and the planning window
  - products: add, edit, a price per unit or blank for "not sold", For sale on/off
  - stock count, set or add
  - change the dealer or driver PIN

  A number that isn't clean is sent as typed, so the API's own message lands under the field it names (dotted names
  included).
- **Order detail**
  - **Change order**: quantity, unit, stacking, delivery fee, address, notes, name, phone, note. Only changed fields are
    sent. The amount and price are locked on a delivered order, and the page says why.
  - **Cancel order** and **Mark not delivered**, each with an inline confirm.
- **Status page:** **Cancel my order** while Requested, with an inline confirm. The API's refusal ("This order is already
  on the schedule. Call us to change it.") stays visible after the page reloads.

### Specs (against the real Worker)

- **`ledger.spec`**
  - Two orders for one customer, worked out by hand: $373.75 + $224.25 = $598.00.
  - On the page: $50.00 on account moves the balance to $548.00, and no order's owing changes. $100.00 on the first order
    moves the balance to $448.00 and that order to Owing $273.75.
  - The running column equals the API's entries **and** `[37375, 59800, 54800, 44800]` by hand.
  - Void the $100.00 from the order's detail: back to $548.00 and Owing $373.75, running column equal again.
- **`totals.spec`**
  - Setup through the API: two deliveries via driver check-ins (1 cord paid cash at the door; 14 bags owing) and a $20.00
    payment.
  - The September row on the page equals the API row. The API row equals a hand-worked row: HST 4 875 + 2 053 = $69.28;
    owing $137.39.
  - Each **Download CSV**: the saved file's bytes `equals` the bytes of `GET …/orders.csv` and `…/payments.csv`, and the
    file name is `firewood-orders-2026-<kind>.csv`.
- **`settings.spec`**
  - A new load description reaches the order page's load explanation.
  - Closing the season puts the dealer's message on `/`, with Call and no Next.
  - A $320.00 cord makes the quote $396.75, worked out by hand.
  - A band list that isn't farther each time answers 400 `field: "delivery.bands"`. The page shows exactly that `error`
    under the bands, and `GET` settings is unchanged.
- **`status.spec` (added)**
  - Cancel my order → 200, Cancelled, no timeline, no cancel card, "Paid in full".
  - A second order is scheduled by the API while its page is still open as Requested. The cancel gets 409 with the
    contract's sentence, shown in `#cancel-error`; the page then says Scheduled, with no Cancel button.
- **`dealer.spec` (added)**
  - Change order 1 → 2 cords: the PUT body is exactly `{ qty: 2 }`; $718.75 on the page, and in the API
    `[2, 71875, 442368]`.
  - Cancel order: Cancelled, and gone from New.
  - Mark not delivered after a cash check-in: Scheduled for Tuesday, September 15; Owing $373.75; the door payment Voided;
    the API agrees.
- **`targets.spec` (added)**
  - The 390 sweep now covers the status page and its cancel confirm, Change order, Customers, the ledger, Totals and
    Settings.

### For the lead — OPEN

1. **Ledger entries carry no payment id** (`GET /api/dealer/customers/:id/ledger` → `entries[]` has `kind`/`text`/amounts
   only), so a payment can't be voided from the ledger itself. It is voided from the order detail, where
   `GET /api/dealer/orders/:id` lists payments with ids. **Payments on account (no order) cannot be voided from any page
   today.** A `payment_id` on payment entries would let the ledger offer Void. Contract question, not changed by me.
2. **The `visibilitychange` refresh is not tested, on purpose.** I probed it in chromium and webkit-390: opening a second
   page and `bringToFront()` on each leaves `document.visibilityState` at `"visible"` in headless Playwright, and no
   `visibilitychange` fires. A test built on that could never fail, so I didn't write one. The 30-second poll is tested.
3. I kept my `typeIn()`. It is now the same approach as your `type()` (insertText on touch, value check), so either works.
4. Carried from M2 and still OPEN until you say so: the quote-before-pin yard workaround, and the phone-order total that
   doesn't include the fee override until `delivery_cents` is on the quote.
5. A cancelled order with nothing paid shows `owing_label` "Paid in full" on the status page. That is what the contract says for
   owing 0, but a customer may read it as money changing hands. Wording question for the lead; I show the API's label as is.

### Negative control (M3) and the M2 controls re-run — all five RED

`app/tests/web/negative-control.log` is rewritten from this run, on the M3 code. It proves the four M2 anchors still apply
exactly once after the M3 edits.

| control | the break in the copy | red output |
|---|---|---|
| (a) capacity-message | the picker hides the 409 instead of showing it | `Expected: "That's more than the truck can carry that day: 4.00 of 4.50 cords already planned, this order needs 1.00."` / element not found |
| (b) status-label | `scheduled` shown as "Requested" | `Expected: "Scheduled for Tuesday, September 15"` / `Received: "Requested"` |
| (c) send-overlay | transparent cover over Send request | `Received: "<div class=\"send-cover\"></div>"` … `something else is on top` |
| (d) hst-float | total = subtotal + subtotal × 0.15, unrounded | `Expected: "$157.39"` / `Received: "$157.38"` |
| **(e) ledger-owing** | `customers.js` order pill uses `o.total_cents` instead of `o.owing_cents` | `Expected: "Owing $273.75"` / `Received: "Owing $373.75"` |

### Final result (M3)

`E2E_PORT=7703 npx playwright test tests/web` on a fresh real Worker (main with fo1 M2), all four projects:
**106 passed, 0 failed, 6 skipped** — the same by-width skips as M2.

Screenshots: **27 screens × 4 projects = 108**, all from the specs against the real Worker, in `app/tests/web/shots/`:
- order steps 1–5, outside area, Request sent, season closed
- status: requested, scheduled, out for delivery, delivered, cancelled, not found
- dealer: sign-in, Orders, schedule picker, over capacity, order detail, Change order, phone order, Customers, ledger,
  Totals, Settings
- Plan: days and route

Both M2 gaps are now shot. All servers I started are stopped (7701 dev, 7703 e2e, 7707 controls).

M3 is DONE apart from the OPEN items above. The driver-queue cross-review waits for the lead's prompt.

## Cross-review of fo1 M3: driver page and offline queue (2026-09-14, read-only)

**Method.** I read `app/public/driver/**` (`index.html`, `driver.js`, `driver-api.js`, `queue.js`, `sw.js`) and
`app/tests/driver/**` from commits 485f5d9 and be77119 against docs/API.md and PLAN.md. I then ran the page on my dev port
7701 (fo1's Worker, `TEST_MODE:1`) with driver PIN 2580, using a Playwright probe with real taps at 390. The probe:
- set up three SAMPLE orders scheduled today: Alma (owing), Paid P. (prepaid $373.75 by the dealer) and Quinn;
- delivered them on the page;
- read the server state back through the dealer API.

The probe script lives in the git-ignored `app/.logs/`, not in fo1's paths. I edited nothing of fo1's. Every numbered item below
is OPEN for the lead to route to fo1.

1. **The Undo bar covers the next stop's Delivered button for 15 seconds** (confirmed live).
   - PLAN.md, driver: "After Save the next stop shows at once and an **Undo** bar stays 15 s", and tap targets must hit-test
     to themselves.
   - Page: `#undo-bar` is fixed at the bottom. At 390, straight after a Save and with no scrolling, `#delivered` sits at
     760–824 px and the bar at 767–844 px. `elementFromPoint` at Delivered's centre returns `undo-bar`, and still does after
     scrolling Delivered into view, because the page is at `scrollY 0` and cannot scroll further. So the driver cannot tap
     Delivered for the next stop until the bar goes. `app/tests/driver/targets.spec.mjs` checks the buttons before any Save,
     so it never sees this.
   - Fix: while the bar shows, pad the page bottom by the bar's height (or put the bar at the top), and hit-test
     `#delivered` in the spec right after a Save.
2. **Cash collected equal to the phone's cached owing is not what gets recorded** (confirmed live).
   - API.md, check-ins: `amount_cents` (1–10 000 000) "or, when omitted, the order's owing **at that moment**".
   - Page (`driver.js` `save`): `if (cents !== state.sheet.owing) payment.amount_cents = cents`, so the amount is left out
     whenever it equals the owing **cached on the phone**. Probe: the phone showed Balance owing $373.75 for Quinn. The dealer
     then recorded $100.00. The driver took Cash with the prefilled 373.75, and the server stored a door payment of
     **27 375**, not the 37 375 the driver entered. The cash in hand and the books disagree by $100.00.
   - Fix: always send `amount_cents` for Cash and e-Transfer; it is the amount the driver saw and typed.
3. **A prepaid order cannot be saved as Cash or e-Transfer, and the only way through records it as "Owes"** (confirmed live).
   - API.md: an omitted amount means the owing, "none if ≤ 0". `door_payment` is the method.
   - Page: for an owing of 0 the amount prefills `0.00`, `parseAmount` refuses anything under 1 cent, and Save shows "Enter
     the amount they paid, like 120.00." with the sheet still open. Probe: Paid P. could only be saved with **Owes**. The
     server now has `door_payment: "owes"` on an order with owing 0, so the dealer sees "Owes" on a paid customer.
   - Fix: when the owing is ≤ 0, allow an empty or 0 amount and send the method with no `amount_cents`, or offer a "Paid
     already" choice.
4. **The stop hook is on two elements** (confirmed live).
   - PLAN.md hooks: "stops `[data-stop="<order id>"]`".
   - Page: `renderDay` sets `data-stop` on the next-stop card (`#next`) **and** on that stop's row in the list, so
     `[data-stop="<id>"]` matches 2 elements (probe count 2). A strict-mode locator in the journey spec would fail on it.
   - Fix: keep `data-stop` on the list rows only, and give the card its own attribute (e.g. `data-next-stop`).
5. **Sign out leaves the session valid on the server** (confirmed live).
   - API.md: "`POST /api/signout` (Bearer) → 200"; driver tokens last 14 days.
   - Page: Sign out only does `clearToken()`. The probe saw **no** API request when it was tapped, so the token stays valid
     for up to 14 days on a phone that is handed on.
   - Fix: send `POST /api/signout` with the token (best effort, ignoring no signal) before clearing it.
6. **A refused photo is shown as the delivery not being accepted** (code read).
   - PLAN.md: a 409/404/400 "moves it to a visible 'Not accepted' list with the server's message".
   - Page (`queue.js`): after the check-in answers 201 the item becomes `state: 'photo'`. If the photo PUT then gets 404, 413
     or 415, `answered()` marks the whole item `rejected`. The list heading says "The office did not accept these", although
     the delivery **was** accepted and only the picture was not. "Remove from this phone" then drops just the photo, with no
     word of that.
   - Fix: for a photo refusal, say "Delivered and saved. The photo was not accepted: <error>", and label the button
     "Remove the photo".
7. **With no signal on first open, yesterday shows as today** (code read).
   - API.md: "The app never uses the browser clock for dealer dates: it takes `today` and `now` from `GET /api/info`."
   - Page: `state.info` (with `today`) is cached. Opening the page with no signal the next morning shows the cached day under
     "Today's deliveries" and "Start the route", with yesterday's long label in the header.
   - Fix: when `today` came from the cache and not a fresh `/api/info`, title the day "Saved <long label> (no signal)" rather
     than "Today's deliveries", and hide Start.

**Checked and in line with the contract:**
- **Check-in body:** `{ op_id, order_id, at, payment, note }`. `op_id` comes from `crypto.randomUUID()`.
- **`at`:** stamped at the tap of Save, before any sending, and kept through retries. fo1's control (m) proves it.
- **Queue removal:** a check-in leaves the queue only after 200/201; a photo only after 200. A replay's 200 `duplicate` is
  handled.
- **401:** keeps the queue and asks to sign in again ("Nothing saved on this phone is lost").
- **429, 5xx and no signal:** the item stays queued, with backoff from 5 s to 60 s.
- **400/403/404/409/413/415:** the item goes to "Not accepted" with the API's `error`.
- **Photos:** downscaled to ≤ 1600 px JPEG 0.7, kept as ArrayBuffer + type, then PUT with its type.
- **Undo:** a queued delivery is removed from the phone; a sent one gets `DELETE`, and Undo waits for the sender first. A
  refusal shows the API's words (`too_late`).
- **Day cache:** under `firewood-orders:day:<date>`, with the queue laid over it.
- **Service worker:** registered with scope `/driver/` (probe: `…/driver/`). It answers only its listed files and returns
  early for anything under `/api/*`, non-GET or cross-origin.
- **PLAN hooks:** all present: `#pin`, `#signin-btn`, `#start-route`, `#delivered`, `button.pay[data-method]`, `#amount`,
  `#take-photo` for `#photo-input`, `#save-delivery`, `#sync-strip`, `#undo`, `#daylight`. `data-stop` is item 4.
- **Wording:**
  - the PLAN words ("Today's deliveries", "Start the route", "Open in Maps", "How did they pay?", Cash, e-Transfer, Owes,
    "Take a photo", Save, Undo, "All sent", Daylight, "That PIN is not right.")
  - the offline strip sentence, exactly
  - the owing pill using the API's labels (Balance owing / Paid in full / Credit)

## Step 3 after fo1 M3: the no-pin quote and the fee on the quote — DONE

The yard workaround is removed.
- **`order/form.js`**
  - Before a pin, the quote is sent with **no `lat`/`lng` at all**, and no guessed zone.
  - The bar shows the API's goods and stacking with "Delivery: after the map pin", no HST, and Total "—", because
    `total_cents` is `null`. The total appears only when the API sends one.
  - A dealer's fee override goes on the quote as `delivery_cents`. A refused fee lands under its field (`delivery_cents` is
    now a quote field).
- **`dealer/dealer.js`:** the phone-order form passes its fee to the quote and re-quotes as it is typed. The note "the total
  is worked out again when you save" is gone, because the shown total is now the saved one.
- **`order.spec`:** at step 2 with stacking on, the quote request has no `lat` and no `lng` keys, the API answers
  `[goods 30000, stacking 6000, distance null, delivery null, HST null, total null]`, and the bar shows $300.00, $60.00,
  "after the map pin", no HST and Total "—". Stacking goes off again before the pin, and $373.75 is checked as before.
- **`dealer.spec`:** after typing the $10.00 fee, a quote carrying `delivery_cents: 1000` answers 24 150, and the form shows
  **$241.50 before Save**: half cord 20 000 + 1 000, HST 3 150, by hand. The distance fee would have made it $270.25.
- **Negative controls:** not run this turn, as asked, because QA holds 7707.
- **Result:** `E2E_PORT=7703 npx playwright test tests/web` on a fresh real Worker (main with fo1 M3):
  **106 passed, 0 failed, 6 skipped** (the by-width skips).
- **How the new checks could fail:** the removed workaround sent the yard's `lat`/`lng` on every quote before the pin, so
  `not.toContain('lat')` would have failed against it; the old phone form quoted without the fee ($270.25), so `$241.50`
  would have failed. Neither is re-proved with a copy this turn, because QA holds 7707. The standing controls (a)–(e) were
  last red at 6dc24ce.
- **Servers:** the dev Worker on 7701 and the e2e Worker on 7703 are stopped.
