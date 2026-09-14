# Firewood Orders: build report (fo-lead)

Overnight build 2026-09-14. Lead `fo-lead` (Opus xhigh), slices `fo1` (Worker + driver page) and `fo2` (customer + dealer pages),
both Opus medium, run with Rig in herdr tabs. Local only: nothing deployed, nothing sent, no payment taken, SAMPLE data only.
Every number below was measured in a QA worktree pinned to the sha shown, never in a slice's own tree.

## Final QA

**DONE.** Pinned QA worktree at `0f8262d` (main after every slice round was merged), one run, nothing re-run to get green.
Commits after `0f8262d` are documentation, screenshots and the README only.

| Suite | Command (from the QA worktree) | Passed | Failed | Skipped |
|---|---|---|---|---|
| Worker unit | `cd worker && PORT=7709 npm test` | 34 | 0 | 0 |
| Worker API (`wrangler dev --local`, `TEST_MODE`) | same run | 76 | 0 | 0 |
| Playwright web | `cd app && E2E_PORT=7709 npx playwright test` | 106 | 0 | 6 |
| Playwright driver | same run | 76 | 0 | 0 |
| Playwright journey | same run | 4 | 0 | 0 |
| Worker negative controls | `cd worker && npm run negative` | 12 red of 12 | | |
| Web negative controls | `node tests/web/negative-<name>.mjs` × 8 | 8 red of 8 | | |
| Driver negative controls | `node tests/driver/negative-all.mjs` | 6 red of 6 | | |
| Journey negative control | `node tests/journey/negative-journey.mjs` | 1 red of 1 | | |

Playwright: chromium-390 (touch), chromium-1280, webkit-390 (iPhone 14), webkit-1280. All 77xx ports were free afterwards.

## QA history (each milestone was graded before it was merged)

| When | Pinned sha | What | Result |
|---|---|---|---|
| fo1 M1 | `d37b5d9` | Worker core | unit 26 / 0 / 0, API 42 / 0 / 0, 6 negative controls red |
| fo2 M1 | `0633ad4` | order, status, dealer Orders pages (no Worker yet) | mock walkthrough passed in 4 / 4 projects |
| fo1 M2 | `8c36e59` | the rest of the Worker | unit 32 / 0 / 0, API 70 / 0 / 0, 11 negative controls red; **without `TEST_MODE`** `/api/test/reset` and `/api/test/seed` answer 404 and `X-Test-Now` is ignored (lead's check) |
| fo2 M2 | `e17e9e1` | Plan tab, real-Worker web specs | web 66 passed / 0 failed / 6 skipped by width, 4 negative controls red |
| fo1 M3 | `be77119` | M1 cross-review fixes, driver page, offline queue | unit 33 / 0 / 0, API 74 / 0 / 0, 12 Worker negative controls red; driver 36 / 0 / 0, 3 driver negative controls red |
| fo2 M3 | `6dc24ce` | Customers, Totals + CSV, Settings, order changes | web 106 / 0 / 6 skipped by width, 5 negative controls red |
| integration | `1921295` | main with everything above | unit 33 / 0 / 0, API 74 / 0 / 0; Playwright web + driver + journey **146 passed / 0 failed / 6 skipped** |
| journey | main `fa2322d` | customer orders → dealer schedules → driver delivers → status page says Delivered | 4 / 4 projects; its negative control red |

The 6 skips are by width and each has a written reason: the 1280 mouse-drag test in the two 390 projects, the 390 Move up /
Move down test in the two 1280 projects, the 390 tap-target sweep in the two 1280 projects.

## Negative controls (each breaks a copy in `.negative/`, never the shipped code, and must go red)

**Worker (`cd worker && npm run negative`, 12):** (a) capacity guard ignores the day's use → fifth cord accepted; (b) race: check
and write split with a 25 ms wait → more than 4 of 8 concurrent schedules win; (c) stock moved on order → stock test red; (d)
check-ins under random ids → the replay is not a duplicate; (e) `delivered_at` = server now → original-time test red; (f) 2-opt
skipped → crossing instance and local-optimum tests red; (g) UTC month bounds → the Sep 30 11:30 PM NDT delivery lands in October;
(h) CSV formula guard removed → `=SUM(A1)` unquoted; (i) voided payments counted → owing 0.00 instead of 100.00; (j) undo leaves
stock down → 73 728 cu in short; (k) HST floored → 4 996 instead of 4 997; (nopin) quote at the yard instead of null → no-pin test red.

**Web (`node app/tests/web/negative-<name>.mjs`):** (a) the schedule picker hides the 409 → capacity message check red; (b) status
page maps scheduled to "Requested"; (c) transparent cover over Send request → `tap()` hit-test names the cover; (d) price bar adds
HST as an unrounded float → $157.38 instead of $157.39; (e) ledger pill shows total instead of owing → Owing $373.75 instead of
$273.75.

Web, added in fo2's last round: (f) the early quote sends the yard's lat/lng → the no-pin request check sees `lat` and `lng`;
(g) the phone-order form leaves the fee off the quote → no quote with `delivery_cents: 1000` ever comes and the $241.50 check fails;
(h) the ledger's Void sends an order payment's id → the DELETE names the wrong payment.

**Driver (`node app/tests/driver/negative-all.mjs`, 6):** (l) queue removes an item before the office answers → the delivery
vanishes and never reaches the server; (m) `at` stamped at send → `delivered_at` 13:40 instead of 13:00; (n) invisible overlay over
Delivered → hit-test names the div; (amount-omitted) the copy leaves out the cash amount when it equals the owing saved on the
phone → with a $100.00 payment taken by the dealer in between, the door payment is 27 375 instead of the 37 375 collected;
(undo-bar) the Undo bar back at the bottom → Delivered, hit-tested right after a Save, is under the bar; (old-page) the six
review specs run against the page fo2 reviewed (`be77119`) and all six fail there.

**Journey (`node app/tests/journey/negative-journey.mjs`):** the copy's status page shows delivered as "Out for delivery" → the
journey fails with Expected "Delivered", Received "Out for delivery".

## Cross-reviews (every real defect crossed a slice boundary)

1. **fo2 reviewed fo1's Worker M1** against docs/API.md and by running its pages on it: 7 findings. Fixed by fo1: quote without a
   pin (nulls, never a guess), quote honours a delivery fee override, override limit 0–50 000, over-capacity wording names the
   limit actually hit, unknown order on schedule is 404. Already fixed by fo1's M2: the SAMPLE flag. Settled in the contract:
   skids to 2 decimals.
2. **fo1's M2 notes for fo2**, written into docs/API.md: partial PUTs, dotted error field names, CSV money cells as numbers, the
   PIN-change 401 is not "signed out".
3. **fo2 reviewed fo1's driver page and queue** with a live probe: 7 findings, including a money bug (Cash equal to the phone's
   cached owing was sent without an amount, so a payment the dealer took in the meantime changed what was recorded), the Undo bar
   covering the next stop's Delivered for 15 s at 390, prepaid orders forced to "Owes", a duplicated stop hook, Sign out not ending
   the server session, and yesterday's cached day shown as today with no signal. One (a refused photo shown as a refused delivery)
   was already fixed. The other six went back to fo1 and were fixed with a spec each: the Undo bar moved into the sticky header,
   Cash and e-Transfer always send the amount the driver saw, a prepaid order saves the method with no amount, the next-stop card
   has its own `data-next-stop`, Sign out ends the server session, and a day opened with no signal is titled "Saved … (no signal)"
   with Start hidden.
4. **fo2's last round** added Void on ledger payment rows (an on-account payment can now be voided) and "Nothing owing" for a
   cancelled order with nothing paid, both from contract changes fo1 made after fo2's M3 questions.

## What the tests caught (fixed)

- WebKit touch adjustment sent a map tap 3 px from the zoom button to the button (zoomed instead of pinning). Zoom moved; the
  lead's `tapMap` now refuses points within 16 px of a map control.
- A toast sat over "Record a payment" on a phone; the Plan route scrolled sideways by 2 px at 390; the Undo bar covered "Remove
  from this phone" on WebKit-390.
- Chromium's emulated touch dropped key presses typed straight after a touch tap; the shared `type()` now sends text like an
  on-screen keyboard and checks the field's value.
- WebKit threw reading a chosen photo while offline and locked Save for good; any photo failure now clears the lock and says so.
- The journey reloaded the status page before the delivery had reached the office (the sync strip already read "All sent" before
  the new item was saved); it now waits for the office's answer to that request.
- The ledger's new Void column had a hidden screen-reader label that made the page scroll sideways by 153 px at 390 in both
  engines; the sideways-scroll sweep caught it.
- `shot()` now waits for the page to reach the top before a full-page capture. That did not cure the sticky-bar artifact (see
  Known gaps).

## Known gaps and limits

- One truck with a daily limit; the route does not draw reload trips. One product per order.
- Route order is by straight-line distance, not road time (the pages say so).
- e-Transfer at the door counts as paid; there is no "pending" state.
- Not testable headless, so not tested: the status page's refresh when it comes back into view (the 30 s poll is tested), the
  WebKit offline reload of the driver page (Playwright WebKit cannot reload offline; the step is skipped on WebKit only), reading the
  clipboard on WebKit (asserts "Copied" instead), a changed driver page reaching a phone through the network-first service worker.
- Full-page screenshots of phone screens paint the sticky header (WebKit) or the fixed price bar (Chromium) mid-picture. It is a
  capture artifact: the same screens pass the hit-test sweep at 390 in both engines. `docs/shots/` uses viewport captures.
- OpenStreetMap's tile servers are for light use; a dealer with real traffic needs a tile provider (Alexander's call).
