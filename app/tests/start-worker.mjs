// Playwright webServer: a fresh local Worker for the e2e suite. Lead-owned.
// From E2E_WORKER_DIR (default ../worker) it wipes <that dir's app>/tests/.state-<port>, applies the D1 migrations into it
// (--local), then runs wrangler dev on E2E_PORT (inspector +10) with TEST_MODE=1. R2 (PHOTOS) persists in the same dir.
// Local only: never --remote, never deploy.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const WORKER = process.env.E2E_WORKER_DIR ? path.resolve(process.env.E2E_WORKER_DIR) : path.join(APP, '..', 'worker')
const PORT = Number(process.env.E2E_PORT || 7703)
const STATE = path.join(WORKER, '..', 'app', 'tests', `.state-${PORT}`)
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }

rmSync(STATE, { recursive: true, force: true })
mkdirSync(STATE, { recursive: true })
const migrate = spawnSync('wrangler', ['d1', 'migrations', 'apply', 'firewood-orders', '--local', '--persist-to', STATE], {
  cwd: WORKER,
  stdio: ['ignore', 'inherit', 'inherit'],
  env,
})
if (migrate.status !== 0) {
  console.error(`start-worker: migrations failed (exit ${migrate.status}) in ${WORKER}`)
  process.exit(migrate.status || 1)
}

const dev = spawn(
  'wrangler',
  [
    'dev',
    '--local',
    '--port',
    String(PORT),
    '--inspector-port',
    String(PORT + 10),
    '--persist-to',
    STATE,
    '--var',
    'TEST_MODE:1',
    '--show-interactive-dev-session=false',
  ],
  {
    cwd: WORKER,
    stdio: ['ignore', 'inherit', 'inherit'],
    env,
  },
)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => dev.kill(signal))
dev.on('exit', (code) => process.exit(code ?? 0))
