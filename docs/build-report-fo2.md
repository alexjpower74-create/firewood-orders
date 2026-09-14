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
