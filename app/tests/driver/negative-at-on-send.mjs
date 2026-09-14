// (m) The copy stamps `at` when the item is sent instead of when Save was tapped → the original-time assertion goes red.
import { negative } from './negative-lib.mjs'

process.exit(await negative({
  name: 'at-on-send',
  why: "queue.js sends at: new Date().toISOString() (the phone's time at sending) instead of the saved item.at",
  patches: [{ file: 'driver/queue.js', from: '          at: item.at,\n', to: '          at: new Date().toISOString(),\n' }],
  spec: 'tests/driver/offline.spec.mjs',
  grep: 'no signal: two deliveries',
  expectRed: ['no signal: two deliveries are saved with the tap time, survive a reload, and send once signal is back'],
}))
