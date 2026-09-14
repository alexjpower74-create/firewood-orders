// (b) The copy reads the day's use in one awaited statement and writes in another, with an honest wait between →
// the race test must see more than 4 winners.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { negative } from './negative-lib.mjs'

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js'), 'utf8')
const begin = src.indexOf('  // CAPACITY-GUARD:BEGIN')
const end = src.indexOf('// CAPACITY-GUARD:END') + '// CAPACITY-GUARD:END'.length
const guarded = begin >= 0 && end > begin ? src.slice(begin, end) : '<<markers not found>>'

const split = `  // CAPACITY-GUARD:BEGIN (negative copy: read, wait, then write)
  const use = await db.prepare(\`SELECT COALESCE(SUM(wood_cu_in), 0) AS wood, COALESCE(SUM(pellet_bags), 0) AS bags
    FROM orders WHERE delivery_date = ?1 AND id <> ?2 AND status IN \${DAY_STATUSES}\`).bind(date, o.id).first()
  await scheduler.wait(25)
  const fits = use.wood + o.wood_cu_in <= s.cap_cu_in && use.bags + o.pellet_bags <= s.cap_bags
  const r = fits
    ? await db.prepare(\`UPDATE orders SET status = 'scheduled', delivery_date = ?1, updated_at = ?3,
        route_pos = (SELECT COALESCE(MAX(route_pos), 0) + 1 FROM orders WHERE delivery_date = ?1 AND id <> ?2 AND status IN \${DAY_STATUSES})
      WHERE id = ?2 AND status IN ('requested', 'scheduled')\`).bind(date, o.id, nowIso).run()
    : { meta: { changes: 0 } }
  // CAPACITY-GUARD:END`

process.exit(await negative({
  name: 'race',
  why: 'the one-statement check-and-write is split into SELECT use → await scheduler.wait(25) → UPDATE',
  patches: [{ file: 'src/index.js', from: guarded, to: split }],
  args: ['--api-only', '--grep', '^the race'],
  expectRed: ['the race: 8 concurrent schedule calls into an empty day → exactly 4 × 200 and 4 × 409'],
}))
