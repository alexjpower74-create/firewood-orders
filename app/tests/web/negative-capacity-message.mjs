// Negative control (a): the copy's dealer page swallows the 409 over-capacity message (shows nothing), so the capacity
// check in dealer.spec must go red.
import { runNegative } from './negative-lib.mjs'

const ok = runNegative({
  name: 'capacity-message',
  what: "the schedule picker hides the API's refusal instead of showing it in role=alert",
  breaks: [
    {
      file: 'dealer/dealer.js',
      find: '      alert.textContent = e.message\n      alert.hidden = false\n',
      replace: '      alert.hidden = true\n',
    },
  ],
  spec: 'tests/web/dealer.spec.mjs',
  grep: 'capacity: with the day at 4.00 cords',
  red: /getByRole\('alert'\)[\s\S]*(toHaveText|toBeVisible)/,
})
process.exit(ok ? 0 : 1)
