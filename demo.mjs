// npm run demo: Firewood Orders on this computer with the SAMPLE dealer and a SAMPLE fortnight of orders.
// Local only. TEST_MODE is on so the seed route exists; never deploy with it (docs/DEPLOY.md).
// Usage: npm run demo            keeps the orders from last time (seeds only the first time)
//        npm run demo -- --fresh starts again from the SAMPLE fortnight
// PORT (default 7701) picks the port; the wrangler inspector uses PORT + 10.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const worker = join(dirname(fileURLToPath(import.meta.url)), 'worker')
const PORT = Number(process.env.PORT || 7701)
const BASE = `http://127.0.0.1:${PORT}`
const state = join(worker, '.state-demo')
const fresh = process.argv.includes('--fresh') || !existsSync(state)
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' }

if (fresh) {
  rmSync(state, { recursive: true, force: true })
  const m = spawnSync('wrangler', ['d1', 'migrations', 'apply', 'firewood-orders', '--local', '--persist-to', state], { cwd: worker, env, stdio: 'inherit' })
  if (m.status !== 0) process.exit(m.status ?? 1)
}

const child = spawn('wrangler', ['dev', '--local', '--port', String(PORT), '--inspector-port', String(PORT + 10), '--persist-to', state,
  '--var', 'TEST_MODE:1', '--show-interactive-dev-session=false'], { cwd: worker, env, stdio: ['ignore', 'ignore', 'inherit'], detached: true })
const stop = () => { try { process.kill(-child.pid, 'SIGTERM') } catch {} process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
child.on('exit', code => { console.error(`wrangler dev stopped (${code}).`); process.exit(code ?? 1) })

for (let i = 0; ; i++) {
  try { if ((await fetch(`${BASE}/api/info`)).ok) break } catch {}
  if (i > 120) { console.error(`The Worker did not answer on ${BASE}.`); stop() }
  await new Promise(r => setTimeout(r, 500))
}

let example = ''
if (fresh) {
  const r = await fetch(`${BASE}/api/test/seed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario: 'demo' }) })
  const body = await r.json().catch(() => ({}))
  console.log(r.ok ? `Seeded the SAMPLE fortnight around ${body.today ?? 'today'}.` : `Seeding failed: ${JSON.stringify(body)}`)
  if (body.status_url) example = `\n  A customer's status page  ${BASE}${body.status_url}`
}

console.log(`
Firewood Orders is running (SAMPLE data, local only, nothing is sent, no payments taken).
  Customer order page        ${BASE}/
  Dealer side                ${BASE}/dealer/    PIN 1357
  Driver's phone             ${BASE}/driver/    PIN 2580${example}
Press Ctrl+C to stop.`)
