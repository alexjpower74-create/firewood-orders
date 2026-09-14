// fo2's negative controls: prove a web check can go red. Each control copies the Worker and app/public into
// app/.negative/<name>/ (git-ignored), breaks the COPY's page by exact text replacement (an anchor that isn't found exactly
// once stops the control with exit 2, so it can never pass by breaking nothing), then runs the named test against a fresh
// Worker started from the copy on E2E_PORT 7707. Exit 0 only when that test went red with the expected failure.
// The output is appended to app/tests/web/negative-control.log. The shipped code has no switch that turns a check off.
import { spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(HERE, '..', '..')
const WORKER = path.resolve(APP, '..', 'worker')
const LOG = path.join(HERE, 'negative-control.log')
const PORT = '7707'

function copyTree(name) {
  const base = path.join(APP, '.negative', name)
  rmSync(base, { recursive: true, force: true })
  mkdirSync(path.join(base, 'worker'), { recursive: true })
  for (const entry of readdirSync(WORKER)) {
    if (/^\.state-|^\.negative$|^\.wrangler$|^node_modules$/.test(entry)) continue
    cpSync(path.join(WORKER, entry), path.join(base, 'worker', entry), { recursive: true })
  }
  cpSync(path.join(APP, 'public'), path.join(base, 'app', 'public'), { recursive: true })
  return base
}

function breakCopy(base, breaks) {
  for (const { file, find, replace } of breaks) {
    const target = path.join(base, 'app', 'public', file)
    const text = readFileSync(target, 'utf8')
    const found = text.split(find).length - 1
    if (found !== 1) {
      console.error(`negative: anchor found ${found} times in ${file}, expected exactly once:\n${find}`)
      process.exit(2)
    }
    writeFileSync(target, text.replace(find, () => replace))
  }
}

const tail = (text, lines) => text.trim().split('\n').slice(-lines).join('\n')

/** { name, what, breaks: [{file, find, replace}], spec, grep, project, red: RegExp that the failure output must match } */
export function runNegative({ name, what, breaks, spec, grep, project = 'chromium-390', red }) {
  if (!existsSync(WORKER)) { console.error('negative: no worker/ beside app/'); process.exit(2) }
  const base = copyTree(name)
  breakCopy(base, breaks)
  const started = new Date().toISOString()
  // Its own --output: Playwright empties the output folder when a run starts, and the shared tests/results/ may belong
  // to another run.
  const run = spawnSync('npx', ['playwright', 'test', spec, '--project', project, '--grep', grep, '--reporter=line', '--retries=0',
    '--output', path.join(base, 'results')], {
    cwd: APP,
    env: { ...process.env, E2E_PORT: PORT, E2E_WORKER_DIR: path.join(base, 'worker') },
    encoding: 'utf8',
    timeout: 900_000,
  })
  const output = `${run.stdout || ''}${run.stderr || ''}`
  const wentRed = run.status !== 0 && red.test(output)
  const verdict = wentRed ? 'RED (good: the check caught the break)' : 'NOT RED (bad: the check missed the break, or failed for another reason)'
  appendFileSync(LOG, [
    `== negative:${name}  ${started}`,
    `what: ${what}`,
    ...breaks.map((b) => `break: app/public/${b.file}: ${JSON.stringify(b.find)} -> ${JSON.stringify(b.replace)}`),
    `run: E2E_PORT=${PORT} E2E_WORKER_DIR=app/.negative/${name}/worker npx playwright test ${spec} --project ${project} --grep ${JSON.stringify(grep)}`,
    `exit ${run.status}; expected failure ${red}; ${verdict}`,
    '--- output (tail) ---',
    tail(output, 45),
    '',
    '',
  ].join('\n'))
  console.log(`negative:${name}: exit ${run.status}, ${verdict}`)
  if (!wentRed) console.log(tail(output, 30))
  return wentRed
}
