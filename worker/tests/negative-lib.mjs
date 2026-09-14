// Negative controls: copy worker/ into worker/.negative/<name>/worker (git-ignored), break one thing in the COPY, run the
// copy's own tests, and pass only if the named tests go red. The shipped code has no switch that turns a guard off.
// Every run appends to tests/negative-control.log. Exit 0 = the check went red (good); 1 = it stayed green; 2 = the
// break did not apply (the anchor text moved), which is also a failure, never a silent pass.
import { spawn } from 'node:child_process'
import { appendFileSync, cpSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOG = path.join(WORKER, 'tests', 'negative-control.log')
const SKIP = new Set(['.negative', '.wrangler', 'node_modules', '.logs', '.scratch'])

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// patches: [{ file, from, to }] — `from` must occur exactly once in the file.
export async function negative({ name, why, patches, args, expectRed, port = 7705 }) {
  const root = path.join(WORKER, '.negative', name)
  const copy = path.join(root, 'worker')
  rmSync(root, { recursive: true, force: true })
  // Entry by entry: node refuses to cpSync a directory into its own subdirectory (.negative lives inside worker/).
  mkdirSync(copy, { recursive: true })
  for (const entry of readdirSync(WORKER)) {
    if (SKIP.has(entry) || entry.startsWith('.state-')) continue
    cpSync(path.join(WORKER, entry), path.join(copy, entry), { recursive: true })
  }
  mkdirSync(path.join(root, 'app'), { recursive: true })
  symlinkSync(realpathSync(path.join(WORKER, '..', 'app', 'public')), path.join(root, 'app', 'public'))

  const header = `\n=== negative:${name} — ${new Date().toISOString()}\nbreak: ${why}\n`
  for (const p of patches) {
    const file = path.join(copy, p.file)
    const text = readFileSync(file, 'utf8')
    const count = text.split(p.from).length - 1
    if (count !== 1) {
      const msg = `${header}RESULT: BREAK DID NOT APPLY — "${p.from.slice(0, 80)}" found ${count} times in ${p.file}\n`
      appendFileSync(LOG, msg)
      console.error(msg)
      return 2
    }
    writeFileSync(file, text.replace(p.from, p.to))
  }

  const out = await new Promise((resolve) => {
    let buf = ''
    const child = spawn(process.execPath, [path.join(copy, 'tests', 'run.mjs'), '--fresh', ...args], {
      cwd: copy, env: { ...process.env, PORT: String(port), TEST_REPORTER: 'tap', NO_COLOR: '1' },
    })
    child.stdout.on('data', (d) => (buf += d))
    child.stderr.on('data', (d) => (buf += d))
    child.on('close', (code) => resolve({ code, buf }))
  })

  const lines = out.buf.split('\n')
  const missing = expectRed.filter((t) => !new RegExp(`not ok \\d+ - ${escape(t)}`).test(out.buf))
  const red = out.code !== 0 && missing.length === 0
  // Keep the red lines and the assertion detail under each, not the whole run.
  const detail = []
  lines.forEach((l, i) => {
    if (/^\s*not ok \d+ - /.test(l)) detail.push(...lines.slice(i, i + 22))
  })
  const summary = lines.filter((l) => /^(# (tests|pass|fail)\b|== (api|unit):)/.test(l))
  const result = red
    ? `RESULT: RED as intended (exit ${out.code}); red tests: ${expectRed.join(' | ')}`
    : `RESULT: STAYED GREEN — the check measured nothing (exit ${out.code}; not red: ${missing.join(' | ') || 'none'})`
  const text = `${header}patched: ${patches.map((p) => p.file).join(', ')}\nrun: node tests/run.mjs --fresh ${args.join(' ')} (PORT ${port})\n` +
    `${summary.join('\n')}\n${detail.join('\n')}\n${result}\n`
  appendFileSync(LOG, text)
  console.log(text)
  rmSync(root, { recursive: true, force: true })
  return red ? 0 : 1
}
