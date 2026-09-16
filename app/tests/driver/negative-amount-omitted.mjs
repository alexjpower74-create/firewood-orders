// (fo2 review #2) The copy leaves amount_cents out again when it equals the owing saved on the phone → after the dealer takes
// a payment, the server records a different door payment from the cash collected, and the spec goes red.
import { negative } from './negative-lib.mjs'

process.exit(
  await negative({
    name: 'amount-omitted',
    why: 'driver.js sends amount_cents only when it differs from the owing cached on the phone (the old omission)',
    patches: [
      {
        file: 'driver/driver.js',
        from: '      payment.amount_cents = cents\n',
        to: '      if (cents !== state.sheet.owing) payment.amount_cents = cents\n',
      },
    ],
    spec: 'tests/driver/review.spec.mjs',
    grep: 'review #2',
    expectRed: ['review #2: Cash with the prefilled amount records exactly that amount, even after the dealer took a payment'],
  }),
)
