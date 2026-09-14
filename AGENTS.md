# Firewood Orders

Order book and delivery route for a small Newfoundland firewood / wood-pellet dealer. Customers order on their phone (or
the dealer types in a phone order), the dealer plans delivery days by truck capacity, the driver works the route (offline
queue), and the dealer always knows who has paid and who owes. Overnight build 2026-09-14, lead `fo-lead`, slices `fo1`
(Worker + driver page) and `fo2` (customer + dealer pages).

Read PLAN.md first (the Rig contract), then docs/API.md (the contract between slices), then DECISIONS.md.

## Stack and ports

- `worker/`: Cloudflare Worker, plain JS ESM, no npm deps, D1 `DB` (`firewood-orders`), R2 `PHOTOS`. Serves `/api/*` and `app/public/`.
- `app/public/`: plain HTML/JS/CSS, no build. `/` order page, `/o/?t=` status, `/dealer/`, `/driver/`. Leaflet 1.9.4 vendored.
- `app/tests/`: Playwright 1.63, chromium + webkit, 390 and 1280, against the real Worker. `web/` fo2, `driver/` fo1, `journey/` lead.
- Ports (inspector = port + 10, always pass `--inspector-port`; other crews hold 9229):
  fo1 Worker 7702 · fo1 driver e2e 7704 · fo1 negative copies 7705, 7706 · fo2 dev 7701 · fo2 e2e 7703 · fo2 negative copy 7707 ·
  lead e2e/journey 7708 · QA 7709. `npm run demo` uses 7701 once the slices are done.
- SAMPLE PINs: dealer `1357`, driver `2580`.

## Rules that bite here

- **Local only.** `wrangler dev --local`. No `wrangler deploy`, `secret put`, `d1 create`, `r2 bucket create`, `--remote`, Pages or DNS.
- **Nothing is sent and no payment is taken.** Messages are "Copy text" buttons. The deposit is text the dealer writes.
- **SAMPLE on every screen.** Dealer "SAMPLE Wood & Pellets — Springdale (demo)"; customer names end in "(SAMPLE)"; no house numbers.
- **Money is integer cents, wood is integer cubic inches, pellets are bags.** HST 15 % half-up per order. No floats in sums.
- **Stock moves only on delivery** (and its undo, and a dealer count). Capacity check + write is one SQL statement.
- **Tests never reach a third-party host**: map tiles are routed to a local placeholder and a test fails on any non-127.0.0.1 request.
- Own only your slice's paths; `rig guard` enforces it. Verify → commit (own paths) → report.
- Every important check has a negative control that breaks a copy in `.negative/`, goes red, and is recorded.
- Plain English for Newfoundland users. No emoji as icons. No devils or demons.

## Standing rules (every project, read by Claude Code and Codex alike)

CLAUDE.md is a symlink to this file, so Onyx (Claude Code) and Cobalt (Codex) read the same text. Edit AGENTS.md only.

- **Read PLAN.md first where it exists; it is the contract.** Own only your slice's files.
- **What "done" means:** verified, committed (only your own paths, with a message that says what and why), pushed, and shown: a screenshot via `pwshot` for anything visible. Never hand back an empty screen; seed demo data if the UI needs it. Never leave a green step uncommitted.
- **Nothing leaves without Alexander.** Emails, forms, applications, posts, marketplace submissions and pull requests to other people's repos are staged to one click; he presses send.
- **Tests that cannot lie.** A bug that reached a person gets a test that fails without the fix, proved by reverting the fix. Every guard (grep, lint, check) is shown to fail on a known-bad input in the same run: a check that cannot fail measured nothing. Real dependencies over mocks where practical. Hit-test with elementFromPoint, never rects.
- **Public-repo hygiene.** No secrets, no machine names, no home-folder paths, no invented businesses. Real businesses appear only where Alexander chose to show them. Run `check-no-personal-data` before pushing a public repo.
- **Browser work.** Playwright is the default; WebKit check before calling a WKWebView page done; the Chrome extension only for pages that need his real login.
- **Keep this file short:** commands, gotchas with a why, hard rules. Architecture belongs in the code and README.
