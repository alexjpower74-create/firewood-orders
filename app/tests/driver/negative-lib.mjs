// Driver-page negative controls: copy worker/ and app/public/ into app/.negative/<name>/ (git-ignored), break one thing in
// the COPY of the driver page, run one real spec against the copy (E2E_PORT 7706, E2E_WORKER_DIR = the copy) and pass only
// if the named tests fail. Appends to app/tests/driver/negative-control.log. Exit 0 = went red; 1 = stayed green; 2 = the
// break did not apply. Run from app/: node tests/driver/negative-all.mjs
import { spawn } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP = path.join(HERE, '..', '..')
const WORKER = path.join(APP, '..', 'worker')
const LOG = path.join(HERE, 'negative-control.log')
const PORT = 7706
const SKIP = new Set(['.negative', '.wrangler', 'node_modules', '.logs', '.scratch'])

const stripAnsi = (s) => s.replace(/\[[0-9;]*m/g, '')

function flatten(suite, out = []) {
  for (const spec of suite.specs || []) {
    for (const t of spec.tests || []) {
      const last = t.results?.[t.results.length - 1]
      out.push({ title: spec.title, project: t.projectName, status: last?.status || 'none',
        message: stripAnsi(last?.error?.message || '') })
    }
  }
  for (const child of suite.suites || []) flatten(child, out)
  return out
}

// patches: [{ file (under app/public), from, to }]; from must occur exactly once.
// overwrite: [{ file (under app/public), content }] replaces whole files first (e.g. an older version of the page).
export async function negative({ name, why, patches = [], overwrite = [], spec, grep, project = 'chromium-390', expectRed }) {
  const root = path.join(APP, '.negative', name)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(path.join(root, 'worker'), { recursive: true })
  for (const entry of readdirSync(WORKER)) {
    if (SKIP.has(entry) || entry.startsWith('.state-')) continue
    cpSync(path.join(WORKER, entry), path.join(root, 'worker', entry), { recursive: true })
  }
  cpSync(path.join(APP, 'public'), path.join(root, 'app', 'public'), { recursive: true })

  const header = `\n=== ${name} — ${new Date().toISOString()}\nbreak: ${why}\n`
  for (const o of overwrite) writeFileSync(path.join(root, 'app', 'public', o.file), o.content)
  for (const p of patches) {
    const file = path.join(root, 'app', 'public', p.file)
    const text = readFileSync(file, 'utf8')
    const count = text.split(p.from).length - 1
    if (count !== 1) {
      const msg = `${header}RESULT: BREAK DID NOT APPLY — found ${count} times in ${p.file}: ${p.from.slice(0, 80)}\n`
      appendFileSync(LOG, msg)
      console.error(msg)
      return 2
    }
    writeFileSync(file, text.replace(p.from, p.to))
  }

  const report = path.join(root, 'report.json')
  const args = ['playwright', 'test', spec, `--project=${project}`, '--reporter=json', '-g', grep]
  const code = await new Promise((resolve) => {
    const child = spawn('npx', args, {
      cwd: APP, stdio: ['ignore', 'ignore', 'inherit'],
      env: { ...process.env, E2E_PORT: String(PORT), E2E_WORKER_DIR: path.join(root, 'worker'), PLAYWRIGHT_JSON_OUTPUT_NAME: report },
    })
    child.on('close', resolve)
  })
  const results = existsSync(report) ? flatten(JSON.parse(readFileSync(report, 'utf8'))) : []
  const failed = (title) => results.some((r) => r.title === title && !['passed', 'skipped'].includes(r.status))
  const missing = expectRed.filter((t) => !failed(t))
  const red = code !== 0 && results.length > 0 && missing.length === 0
  const lines = results.map((r) => `  ${r.status.toUpperCase()}  [${r.project}] ${r.title}` +
    (r.message ? `\n${r.message.split('\n').slice(0, 10).map((l) => `      ${l}`).join('\n')}` : ''))
  const result = red
    ? `RESULT: RED as intended (exit ${code})`
    : `RESULT: STAYED GREEN — the check measured nothing (exit ${code}; not red: ${missing.join(' | ') || 'no results'})`
  const text = `${header}patched: ${[...overwrite, ...patches].map((p) => p.file).join(', ')}\n` +
    `run: E2E_PORT=${PORT} E2E_WORKER_DIR=app/.negative/${name}/worker npx ${args.join(' ')}\n${lines.join('\n')}\n${result}\n`
  appendFileSync(LOG, text)
  console.log(text)
  if (red) rmSync(root, { recursive: true, force: true })
  return red ? 0 : 1
}
