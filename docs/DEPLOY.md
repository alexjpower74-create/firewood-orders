# Firewood Orders: what deploying needs

**Nothing here has been run.** Tonight's build is local only (Alexander's order, 2026-09-14). This is the checklist for when he
says go. One deployment = one dealer.

## Cloudflare pieces

| Piece | Name | Command (his call, not run) |
|---|---|---|
| Worker (API + static app) | `firewood-orders` | `cd worker && wrangler deploy` |
| D1 database | `firewood-orders` | `wrangler d1 create firewood-orders`, paste the id into `worker/wrangler.toml` (replacing the all-zero placeholder), then `wrangler d1 migrations apply firewood-orders --remote` |
| R2 bucket (delivery photos) | `firewood-orders-photos` | `wrangler r2 bucket create firewood-orders-photos` |
| Secrets | none | PINs live hashed in D1; there are no API keys |
| Cron | none | nothing runs on a schedule |
| Domain | optional | `firewood-orders.<account>.workers.dev`, or a route on a dealer's own domain |

## Before a real dealer uses it

1. **Never set `TEST_MODE`.** It enables the test clock header, the test IP header and the reset/seed routes. It is not in
   `wrangler.toml` and must never be added to `[vars]` or set as a secret.
2. Sign in to `/dealer/` with the SAMPLE PIN `1357` and **change both PINs** (dealer and driver `2580`) in Settings.
3. In Settings: the dealer's real name, phone, yard pin, deposit text (their own e-Transfer email), delivery bands or zones,
   the load definition, truck limits, delivery weekdays, products and prices, stock counts; then turn **SAMPLE** off.
   `migrations/0002_sample.sql` seeds the SAMPLE dealer so a fresh database is usable at once; everything it sets is editable.
4. **Map tiles.** The pages load tiles from `tile.openstreetmap.org`, whose usage policy is for light use with attribution
   (shown on every map). A dealer with real traffic should move to a tile provider with a plan (a settings change in the pages'
   `map.tiles` from `GET /api/info`). Alexander's decision.
5. **Driver page updates.** The driver page is kept on the phone by a service worker (`app/public/driver/sw.js`) so it opens
   with no signal. It asks the network first (3-second limit) and falls back to the saved copy, so a deployed change reaches a
   phone on its next load with signal; no cache bump is needed. (Not tested end to end: Playwright cannot swap the served file
   under a live service worker in every engine.)
6. The app **takes no payments and sends no messages**: deposit instructions are text, messages are "Copy text". Nothing to set up.

## After deploying

- Smoke test: `GET /api/info` answers with the dealer's name; place one order from a phone; schedule it; deliver it from the
  driver page; the status page says Delivered. Then cancel/void the test order and payment.
- D1 migrations do not run on deploy: every new migration needs `wrangler d1 migrations apply firewood-orders --remote`.
