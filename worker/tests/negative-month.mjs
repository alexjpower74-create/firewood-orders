// (g) The copy groups deliveries by the UTC month instead of the St. John's month → the month-boundary totals test goes red.
import { negative } from './negative-lib.mjs'

process.exit(
  await negative({
    name: 'month',
    why: 'nlMonth returns the UTC month of the instant (new Date(instant).toISOString().slice(0, 7)) instead of the NL month',
    patches: [
      {
        file: 'src/time.js',
        from: 'export function nlMonth(instant) {\n  return nlDate(instant).slice(0, 7)\n}',
        to: 'export function nlMonth(instant) {\n  return new Date(instant).toISOString().slice(0, 7)\n}',
      },
    ],
    args: ['--api-only', '--grep', '^totals'],
    expectRed: ['totals: HST and totals equal row sums, zero months present, NL month boundary (Oct 1 02:00 UTC counts in September)'],
  }),
)
