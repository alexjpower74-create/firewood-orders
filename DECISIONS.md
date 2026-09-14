# Firewood Orders: decisions

Alexander was asleep; the lead (fo-lead) made these calls so the build could keep moving. Each one is easy to reverse.
Newest at the bottom.

1. **Two slices, split by who knows the contract best.** fo1 = the Worker **and** the driver page (the offline check-in
   semantics live on both sides of one API call); fo2 = the customer order page, status page and dealer side. The lead owns
   the shared test scaffolding (`app/playwright.config.mjs`, `app/tests/helpers.mjs`, `app/tests/start-worker.mjs`), the design
   tokens (`app/public/theme.css`), vendored Leaflet, and writes the cross-slice journey spec. Because fo1 writes both sides of
   the check-in, fo2 cross-reviews fo1's driver queue against docs/API.md.
2. **Look: dark navy, ember accent.** Alexander's approved portfolio look (Shop Board calm pass) with wood-ember orange as the
   one accent and teal for pellets. The driver page has no aurora and a **Daylight** toggle (light, high-contrast tokens) because
   deliveries happen in sun, unlike Snow Route's night cab.
3. **Units are integers.** Wood volume in cubic inches (a cord = 221 184), pellets in bags, money in cents. A face cord is computed
   from the product's piece length (4 ft × 8 ft × cut length), so a 16-inch face cord is exactly a third of a cord and nothing is a
   float in a sum.
4. **One product per order** in v1. A customer who wants wood and pellets sends two requests. Keeps pricing, capacity and the
   driver screen simple; order lines are a v2.
5. **Truck capacity is per day, one truck.** `wood_cords_per_day` and `pellet_skids_per_day`. The route does not draw reload trips
   back to the yard. Most NL wood dealers are one truck; more trucks are a v2.
6. **The capacity check and the write are one SQL statement**, so two schedule taps into the last space cannot both win (tested
   with 8 concurrent calls, with a negative control that splits read and write).
7. **Stock can go below zero.** Stock only moves on delivery; if the yard count was wrong the dealer sees a negative number and
   fixes the count, rather than the driver being blocked at a customer's door.
8. **HST 15 % half-up per order, on the subtotal including delivery**, with an `hst_registered` switch for small suppliers who
   aren't registered. The rate is a constant, not a setting.
9. **Balance = non-cancelled order totals − non-voided payments.** A payment on a cancelled order becomes a credit. The board's
   "Owing" tab lists delivered orders with money still due.
10. **e-Transfer at the door is recorded as a payment** (the customer shows the sent confirmation); the dealer voids it if it never
    lands. No "pending" state in v1.
11. **Driver signs in with a driver PIN** (token lasts 14 days so the phone stays signed in all week, including offline). The
    dealer PIN works on the driver page too, because the dealer is often the driver. Not a secret link: a one-truck dealer hands
    the phone to whoever drives.
12. **One photo per order, in R2** (`PHOTOS`), replaced if retaken. Local R2 persists with wrangler dev.
13. **Status links are stored plain** (a capability link the dealer can re-share in a message); PINs are PBKDF2 and session
    tokens SHA-256.
14. **Delivery fee by straight-line distance bands from the yard** (default), or named zones the customer picks. Distance is
    haversine and labelled "as the crow flies".
15. **Customers are matched by phone number** (last 10 digits); no accounts.
16. **SAMPLE map points come from NRCan's Geographical Names Database.** Nominatim was the first choice but its robots.txt
    disallows `/search`. Raw answers are in `data/sources/geonames/`, the chosen points in `data/sample-places.json`, picked as
    the exact-name populated place nearest Springdale. Customers are SAMPLE people at real community points, no house numbers.
17. **Optimize starts from the last delivered stop** (or the yard) and ends at the yard; delivered stops stay first. Mid-route
    re-optimizing then makes sense.
18. **Season starts September 1** (setting); months are NL-local by delivery time for sales and by date for payments.
19. **Tests never reach OpenStreetMap.** Tiles are routed to a generated placeholder and any other outside request fails the test.
20. **Offline queue in IndexedDB**, removed only after the server answers 200/201; a service worker caches the driver page so it
    reloads with no signal.
21. **`.rig/` is not committed.** `rig init` marks it machine state; LEAD-RULES says "commit" after init, which here means the
    plan and the rest of the setup.
22. **A quote works without a pin** and answers `null` for distance, delivery, HST and total rather than quoting at the yard, and
    it takes an optional `delivery_cents` like a phone order (fo2's M1 questions). The page never works a price out itself.
23. **Page-written messages** for checks made before any API call are fo2's wording, signed off by the lead: "Choose what you would
    like.", "Tell us where to find the place, like the road and what it is near.", "Pick the days that suit you, or Any day.",
    "Pick your area.", "Enter the amount in dollars, like 100.00.", "Enter the fee in dollars, like 25.00, or leave it blank.",
    "That's the driver PIN. The dealer page needs the dealer PIN."
