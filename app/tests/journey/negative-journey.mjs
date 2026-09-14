// Negative control for the journey spec: a copy whose status page shows a delivered order as "Out for delivery" must turn the
// journey red. Copies worker/ and app/public/ into app/.negative/journey/ (git-ignored), breaks the COPY by exact text
// replacement (exit 2 if the anchor isn't there exactly once), runs the journey on chromium-390 against a Worker started from
// the copy (E2E_PORT 7708, E2E_WORKER_DIR), and exits 0 only if it went red on the Delivered check. Appends to negative-control.log.
import { spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(HERE, '..', '..')
const ROOT = path.resolve(APP, '..')
const base = path.join(APP, '.negative', 'journey')

rmSync(base, { recursive: true, force: true })
mkdirSync(path.join(base, 'worker'), { recursive: true })
for (const entry of readdirSync(path.join(ROOT, 'worker'))) {
  if (/^\.state-|^\.negative$|^\.wrangler$|^\.logs$|^node_modules$/.test(entry)) continue
  cpSync(path.join(ROOT, 'worker', entry), path.join(base, 'worker', entry), { recursive: true })
}
cpSync(path.join(APP, 'public'), path.join(base, 'app', 'public'), { recursive: true })

const file = path.join(base, 'app', 'public', 'o', 'status.js')
const find = '  pill.textContent = o.status_label\n'
const text = readFileSync(file, 'utf8')
if (text.split(find).length - 1 !== 1) {
  console.error(`negative-journey: anchor found ${text.split(find).length - 1} times in o/status.js, expected exactly once`)
  process.exit(2)
}
writeFileSync(file, text.replace(find, () => "  pill.textContent = o.status === 'delivered' ? 'Out for delivery' : o.status_label\n"))

const r = spawnSync('npx', ['playwright', 'test', 'tests/journey/journey.spec.mjs', '--project', 'chromium-390', '--reporter=list',
  '--output', path.join(APP, '.negative', 'journey-results')], {
  cwd: APP, encoding: 'utf8', env: { ...process.env, E2E_PORT: '7708', E2E_WORKER_DIR: path.join(base, 'worker') },
})
const out = `${r.stdout}\n${r.stderr}`
const red = r.status !== 0 && /Expected: "Delivered"/.test(out) && /Received: "Out for delivery"/.test(out)
const lines = out.split('\n').filter((l) => /✘|✓|Expected:|Received:|passed|failed/.test(l)).join('\n')
appendFileSync(path.join(HERE, 'negative-control.log'),
  `\n== ${new Date().toISOString()} journey: the copy's status page shows delivered as "Out for delivery"\n${lines}\nRESULT: ${red ? 'RED (good: the journey caught the break)' : 'NOT RED (bad)'}\n`)
console.log(lines)
console.log(red ? 'RED (good): the journey caught the break' : 'NOT RED (bad)')
process.exit(red ? 0 : 1)
