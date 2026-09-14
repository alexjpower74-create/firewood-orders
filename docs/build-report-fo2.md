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
