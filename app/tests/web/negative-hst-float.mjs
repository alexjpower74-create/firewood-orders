// Negative control (d): the copy's price bar works the total out itself, adding 15 % HST to the subtotal as a float with
// no rounding. With 14 bags to King's Point the HST is 2 052.9 cents, so the shown total must be wrong and order.spec's
// $157.39 check must go red.
import { runNegative } from './negative-lib.mjs'

const ok = runNegative({
  name: 'hst-float',
  what: 'the price bar total = subtotal + subtotal * 0.15 (float, unrounded) instead of the API total',
  breaks: [
    {
      file: 'order/form.js',
      find: '      if (pinned) total = money(q.total_cents)\n',
      replace: '      if (pinned) total = money(q.subtotal_cents + q.subtotal_cents * 0.15)\n',
    },
  ],
  spec: 'tests/web/order.spec.mjs',
  grep: 'not whole cents',
  red: /#quote-total[\s\S]*\$157\.39/,
})
process.exit(ok ? 0 : 1)
