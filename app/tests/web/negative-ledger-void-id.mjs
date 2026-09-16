// Negative control (h): the copy's ledger Void sends the id of a payment on an order instead of the confirmed row's own
// payment_id, so ledger.spec's on-account void check must go red.
import { runNegative } from './negative-lib.mjs'

const ok = runNegative({
  name: 'ledger-void-id',
  what: "the ledger's Void voids the first payment made on an order, not the row's payment_id",
  breaks: [
    {
      file: 'dealer/customers.js',
      find: '  const id = button.dataset.payment\n',
      replace:
        "  const id = root.querySelector('#ledger tr[data-payment-id][data-order-id]')?.dataset.paymentId || button.dataset.payment\n",
    },
  ],
  spec: 'tests/web/ledger.spec.mjs',
  grep: 'payments and a void move the balance',
  red: /the void names the row's own payment|Balance owing \$498\.00/,
})
process.exit(ok ? 0 : 1)
