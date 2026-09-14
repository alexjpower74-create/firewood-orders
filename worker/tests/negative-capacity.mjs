// (a) The copy's capacity guard ignores what the day already carries → the over-plan test must go red.
import { negative } from './negative-lib.mjs'

const used = (col) =>
  `(SELECT COALESCE(SUM(${col}), 0) FROM orders WHERE delivery_date = ?1 AND id <> ?2 AND status IN \${DAY_STATUSES})\n`

process.exit(await negative({
  name: 'capacity',
  why: "the guard's SUM of the day's current use is replaced by 0 (wood and pellets), so only the order itself is compared to the cap",
  patches: [
    { file: 'src/index.js', from: `AND ${used('wood_cu_in')}`, to: 'AND 0\n' },
    { file: 'src/index.js', from: `AND ${used('pellet_bags')}`, to: 'AND 0\n' },
  ],
  args: ['--api-only', '--grep', '^capacity'],
  expectRed: ['capacity: 4 cords on Tue, a fifth refused with exact numbers; a half cord fits to 4.50; then even a face cord is refused',
    'capacity for pellets: 3 skids planned, then 1 bag is refused'],
}))
