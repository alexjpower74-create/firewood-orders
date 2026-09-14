// `npm test`: pure unit tests, then the API suite against a fresh local Worker.
//   PORT (default 7702, inspector PORT+10). State in worker/.state-<PORT>, wiped first.
//   If something already answers on PORT, it is used as is and not stopped.
//   --unit-only       unit tests only
//   --api-only        skip the unit tests
//   --unit <files>    comma list of unit test files (default: all *.test.mjs except api)
//   --grep <regex>    only API tests whose name matches
//   --fresh           refuse to reuse a Worker already answering on PORT (negative controls must test their own copy)
// Exit code is non-zero when any test fails. Local only: never --remote.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT || 7702)
const BASE = `http://127.0.0.1:${PORT}`
const STATE = path.join(WORKER, `.state-${PORT}`)
const args = process.argv.slice(2)
const flag = (f) => args.includes(f)
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null)
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' }
const reporter = process.env.TEST_REPORTER ? [`--test-reporter=${process.env.TEST_REPORTER}`] : []

function runNodeTests(files, extra = [], extraEnv = {}) {
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...reporter, ...extra, ...files],
    { cwd: WORKER, stdio: 'inherit', env: { ...env, ...extraEnv } })
  return r.status ?? 1
}

async function answers() {
  try {
    const r = await fetch(`${BASE}/api/info`, { signal: AbortSignal.timeout(1500) })
    return r.status > 0
  } catch {
    return false
  }
}

let failed = 0

if (!flag('--api-only')) {
  const unit = opt('--unit')
    ? opt('--unit').split(',').map((f) => path.join('tests', f))
    : readdirSync(path.join(WORKER, 'tests')).filter((f) => f.endsWith('.test.mjs') && f !== 'api.test.mjs')
      .map((f) => path.join('tests', f))
  console.log(`\n== unit: ${unit.join(' ')}`)
  failed |= runNodeTests(unit)
}

if (!flag('--unit-only')) {
  let dev = null
  if (await answers()) {
    if (flag('--fresh')) {
      console.error(`\n== api: REFUSED — something already answers on ${BASE} and --fresh was given`)
      process.exit(1)
    }
    console.log(`\n== api: using the Worker already answering on ${BASE}`)
  } else {
    console.log(`\n== api: fresh Worker on ${BASE} (state ${path.relative(WORKER, STATE)})`)
    rmSync(STATE, { recursive: true, force: true })
    mkdirSync(STATE, { recursive: true })
    const m = spawnSync('wrangler', ['d1', 'migrations', 'apply', 'firewood-orders', '--local', '--persist-to', STATE],
      { cwd: WORKER, stdio: ['ignore', 'ignore', 'inherit'], env })
    if (m.status !== 0) {
      console.error('migrations failed')
      process.exit(1)
    }
    dev = spawn('wrangler', ['dev', '--local', '--port', String(PORT), '--inspector-port', String(PORT + 10), '--persist-to',
      STATE, '--var', 'TEST_MODE:1', '--show-interactive-dev-session=false'],
    { cwd: WORKER, stdio: ['ignore', 'ignore', 'inherit'], env, detached: true })
    const t0 = Date.now()
    while (!(await answers())) {
      if (dev.exitCode !== null || Date.now() - t0 > 90000) {
        console.error('the Worker did not start')
        try { process.kill(-dev.pid, 'SIGTERM') } catch {}
        process.exit(1)
      }
      await new Promise((r) => setTimeout(r, 300))
    }
  }
  const grep = opt('--grep')
  failed |= runNodeTests(['tests/api.test.mjs'], grep ? [`--test-name-pattern=${grep}`] : [],
    { API_BASE: BASE, STATE_DIR: STATE })
  if (dev) {
    try { process.kill(-dev.pid, 'SIGTERM') } catch {}
    // Wait until the port is really free, so the next run cannot talk to this Worker.
    const t0 = Date.now()
    while ((await answers()) && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 200))
    if (await answers()) {
      try { process.kill(-dev.pid, 'SIGKILL') } catch {}
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
}

process.exit(failed ? 1 : 0)
