// Negative control (i), lead polish 2026-09-14: the copy's product cards show "from $220.00" with no unit, so the order spec's
// unit check must go red (green wood would again look dearer than dry).
import { runNegative } from './negative-lib.mjs'

const ok = runNegative({
  name: 'from-unit',
  what: 'product cards show the from price without its unit',
  breaks: [{
    file: 'order/form.js',
    find: "</strong> ${esc(UNIT_EACH[from.unit] || '')}</span>",
    replace: '</strong></span>',
  }],
  spec: 'tests/web/order.spec.mjs',
  grep: 'each product card names the unit',
  red: /from \$120\.00 a face cord/,
})
process.exit(ok ? 0 : 1)
