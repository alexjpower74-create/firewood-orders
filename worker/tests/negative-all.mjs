// `npm run negative`: every negative control, one after another. Exit 0 only if every one went red.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const NAMES = ['capacity', 'race', 'stock', 'idempotent', 'time', 'twoopt', 'month', 'csvguard', 'void', 'undo', 'hst', 'nopin']
const results = NAMES.map((n) => {
  const r = spawnSync(process.execPath, [path.join(HERE, `negative-${n}.mjs`)], { stdio: 'inherit' })
  return [n, r.status]
})
console.log('\n== negative controls')
for (const [n, code] of results) console.log(`${code === 0 ? 'RED (good)  ' : 'NOT RED (bad)'} negative:${n} exit ${code}`)
process.exit(results.every(([, code]) => code === 0) ? 0 : 1)
