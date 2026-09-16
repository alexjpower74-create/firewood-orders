# Firewood Orders: what deploying needs

**Deployed 2026-09-15** on Alexander's go ("Push Firewood Orders"). One deployment = one dealer.

| Created | Value |
|---|---|
| Worker `firewood-orders` (env `production`) | <https://firewood-orders.alexjpower74.workers.dev> |
| D1 `firewood-orders` | id `97b97222-afb7-4f24-bac9-1b8cd270295d`, migrations 0001 + 0002 applied `--remote` |
| R2 `firewood-orders-photos` | **not created**: R2 is not enabled on the Cloudflare account (dashboard step). The production env has no `PHOTOS` binding; the Worker answers 503 `photos_off` to a photo upload and 404 to a photo read, everything else works. |
| Secrets, cron | none |
| SAMPLE orders | not loaded: the fortnight of SAMPLE orders is only reachable through the `TEST_MODE` seed route, which is never on live. See "Loading SAMPLE orders" below. |

`worker/wrangler.toml` has two levels: the top level for `wrangler dev --local` (with the R2 binding, which Miniflare stands in
for), and `[env.production]` for the live Worker (wrangler environments do not inherit bindings, so D1, assets and vars are
repeated there). Deploy with `cd worker && npx wrangler deploy --env production`.

## Loading SAMPLE orders on the live copy

Seed a local copy (`npm run demo -- --fresh`), dump the rows of every table as `INSERT OR REPLACE` statements, and apply them
with `npx wrangler d1 execute firewood-orders --remote --env production --file <dump.sql>`. The seed is relative to "today", so
do it the day it is shown. Photos in the seed need the R2 bucket; without it the delivered orders show no photo.

## Turning on photos

Enable R2 in the Cloudflare dashboard, then `cd worker && npx wrangler r2 bucket create firewood-orders-photos`, add to
`wrangler.toml` under the production env:

```toml
[[env.production.r2_buckets]]
binding = "PHOTOS"
bucket_name = "firewood-orders-photos"
```

and deploy again.

## The original checklist

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
4. **Map tiles: nothing to set up.** Every map draws OpenFreeMap's vector style (`https://tiles.openfreemap.org/styles/liberty`)
   through MapLibre: free, commercial use allowed, no key, no request limits, and **no SLA** (if it is down, the maps show only
   the pins and the rest of the app keeps working). The attribution OpenFreeMap requires is shown on every map. To switch
   provider or style, change `MAP_STYLE_URL` and `MAP_ATTRIBUTION` under `[vars]` in `worker/wrangler.toml` (a MapLibre style
   URL and that provider's attribution) and deploy again; nothing else changes.
5. **Driver page updates.** The driver page is kept on the phone by a service worker (`app/public/driver/sw.js`) so it opens
   with no signal. It asks the network first (3-second limit) and falls back to the saved copy, so a deployed change reaches a
   phone on its next load with signal; no cache bump is needed. (Not tested end to end: Playwright cannot swap the served file
   under a live service worker in every engine.)
6. The app **takes no payments and sends no messages**: deposit instructions are text, messages are "Copy text". Nothing to set up.

## After deploying

- Smoke test: `GET /api/info` answers with the dealer's name; place one order from a phone; schedule it; deliver it from the
  driver page; the status page says Delivered. Then cancel/void the test order and payment.
- D1 migrations do not run on deploy: every new migration needs `wrangler d1 migrations apply firewood-orders --remote`.
