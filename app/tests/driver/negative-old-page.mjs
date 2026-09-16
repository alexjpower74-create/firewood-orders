// fo2's review of M3: every review spec must fail on the driver page fo2 reviewed (commit be77119, the M3 merge point).
// Not 85beb53: that commit already had the Undo-bar scroll padding from the follow-up round, which let review #1 pass at
// chromium-390 (recorded in negative-control.log), so it is not the code the finding was made against.
import { execFileSync } from 'node:child_process'
import { negative } from './negative-lib.mjs'

const OLD = 'be77119'
const FILES = ['index.html', 'driver.css', 'driver.js', 'driver-api.js', 'queue.js', 'sw.js']
const overwrite = FILES.map((f) => ({
  file: `driver/${f}`,
  content: execFileSync('git', ['show', `${OLD}:app/public/driver/${f}`], { encoding: 'utf8', maxBuffer: 1 << 24 }),
}))

process.exit(
  await negative({
    name: 'old-page',
    why: `the whole driver page replaced by its files at ${OLD}, before the review fixes`,
    overwrite,
    spec: 'tests/driver/review.spec.mjs',
    grep: 'review #',
    expectRed: [
      "review #1: right after a Save, the next stop's Delivered hit-tests to itself while the Undo bar shows",
      'review #2: Cash with the prefilled amount records exactly that amount, even after the dealer took a payment',
      'review #3: a prepaid order is saved as Cash or e-Transfer with no amount: no payment row, and door_payment is the method',
      'review #4: data-stop is on the list row only; the next-stop card has data-next-stop',
      'review #5: Sign out ends the session on the server: the old token gets 401',
      'review #7: opened with no signal the next day, the saved day is not called today and Start is hidden',
    ],
  }),
)
