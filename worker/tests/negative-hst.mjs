// (k) The copy floors 15 % instead of rounding half-up → the HST unit test and the totals test go red.
import { negative } from './negative-lib.mjs'

process.exit(
  await negative({
    name: 'hst',
    why: 'hstCents = Math.floor(subtotal × 15 / 100) (no + 50 half-up)',
    patches: [
      {
        file: 'src/money.js',
        from: 'Math.floor((subtotalCents * HST_PERCENT + 50) / 100)',
        to: 'Math.floor((subtotalCents * HST_PERCENT) / 100)',
      },
    ],
    args: ['--unit', 'money.test.mjs', '--grep', '^totals'],
    expectRed: [
      'HST 15 % half-up per order',
      'totals: HST and totals equal row sums, zero months present, NL month boundary (Oct 1 02:00 UTC counts in September)',
    ],
  }),
)
