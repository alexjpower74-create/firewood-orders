// Negative control (e): the copy's Customers view shows an order's total where it should show what is owing, so
// ledger.spec's per-order owing check must go red.
import { runNegative } from './negative-lib.mjs'

const ok = runNegative({
  name: 'ledger-owing',
  what: "the customer's order list shows each order's total_cents as its owing",
  breaks: [{
    file: 'dealer/customers.js',
    find: '  const cents = o.owing_cents\n',
    replace: '  const cents = o.total_cents\n',
  }],
  spec: 'tests/web/ledger.spec.mjs',
  grep: 'payments and a void move the balance',
  red: /order-owing[\s\S]*Owing \$273\.75/,
})
process.exit(ok ? 0 : 1)
