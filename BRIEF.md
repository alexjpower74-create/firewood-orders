# Firewood Orders — brief (Onyx, 2026-09-14)

**Prefix** `fo` · **Ports** app 7701, worker 7702, QA 7709 · **Repo** `firewood-orders` (private) · **Lead effort** xhigh

## What
Order book and delivery route for a small Newfoundland firewood / wood-pellet dealer. Customers order on their
phone (or the dealer types in a phone order), the dealer plans delivery days, the driver works a route, and the
dealer always knows who has paid and who still owes. Sellable to the many one-truck wood dealers across NL.

## Products (dealer settings, PIN)
Firewood by the **cord / half cord / face cord / load** (show what each means in plain words, including the
dealer's own definition of a "load"), species/mix, dry vs green, cut length, split/unsplit, stacking extra;
pellets by the **bag / ton / skid** with brand; delivery fee by zone or distance band; minimum order; season
open/closed. Stock on hand (cords, bags) goes down on delivery, not on order.

## Customer order (phone-first, no account)
Pick product → quantity → address as a map pin (Leaflet + OSM, attribution) + dump spot notes ("by the shed,
not on the lawn") → preferred days → name/phone → **Request sent**. Status link: Requested / Scheduled for
<day> / Out for delivery / Delivered, and the balance owing. Deposit instructions shown as text the dealer
sets (e-Transfer email) — the app **takes no payments** and sends nothing.

## Dealer side
Orders board (new, scheduled, delivered, owing), delivery day planner by truck capacity (a load / a skid limit),
route order for the day (nearest-neighbour + 2-opt from the yard, drag to reorder, "by distance, not road
time"), driver phone view with big Delivered (+ optional photo) and "Cash / e-Transfer / Owes" at the door,
works offline with a queue. Payments ledger per customer; month and season totals with HST 15%; CSV export.
"Copy this text" buttons for "we're coming Tuesday" messages.

## Data
SAMPLE dealer "SAMPLE Wood & Pellets — Springdale (demo)", SAMPLE customers labelled SAMPLE.

## Tests that matter
Capacity: a day can't be over-planned past the truck's load (negative control); stock decrements only on
delivery; offline delivered check-ins sync with original time; owing balance = orders − payments to the cent;
journey customer order → dealer schedules → driver delivers → status page shows Delivered (real clicks,
chromium + webkit, 390 + 1280).
