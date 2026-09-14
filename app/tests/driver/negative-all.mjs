// Every driver-page negative control, one after another (run from app/). Exit 0 only if every one went red.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const NAMES = ['queue-early', 'at-on-send', 'overlay', 'undo-bar', 'amount-omitted', 'old-page']
const results = NAMES.map((n) => [n, spawnSync(process.execPath, [path.join(HERE, `negative-${n}.mjs`)], { stdio: 'inherit' }).status])
console.log('\n== driver negative controls')
for (const [n, code] of results) console.log(`${code === 0 ? 'RED (good)  ' : 'NOT RED (bad)'} ${n} exit ${code}`)
process.exit(results.every(([, code]) => code === 0) ? 0 : 1)
