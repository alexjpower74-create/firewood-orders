// Negative control (g): the copy's phone-order form leaves the dealer's fee off the quote, so the total before saving is the
// distance-fee total and dealer.spec's $241.50 check must go red.
import { runNegative } from './negative-lib.mjs'

const ok = runNegative({
  name: 'phone-fee-quote',
  what: 'the phone-order form does not pass delivery_cents to the quote',
  breaks: [{
    file: 'dealer/dealer.js',
    find: "{ info, mode: 'dealer', onChange: renderPrice, deliveryOverride: override }",
    replace: "{ info, mode: 'dealer', onChange: renderPrice }",
  }],
  spec: 'tests/web/dealer.spec.mjs',
  grep: 'a phone order through the dealer form',
  red: /delivery_cents === 1000|waitForResponse|Test timeout|\$241\.50/,
})
process.exit(ok ? 0 : 1)
