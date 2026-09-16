// (l) The copy's queue deletes a delivery BEFORE the office answers; with the Worker answering 500 once, that delivery never
// reaches the server → the offline spec's 500 test goes red.
import { negative } from './negative-lib.mjs'

process.exit(
  await negative({
    name: 'queue-early',
    why: 'queue.js removes the item from IndexedDB just before POST /api/driver/checkins, instead of after 200/201',
    patches: [
      {
        file: 'driver/queue.js',
        from: '        const r = await api.checkin({\n',
        to: '        await removeItem(item.seq) // negative copy: gone before the office answers\n        const r = await api.checkin({\n',
      },
    ],
    spec: 'tests/driver/offline.spec.mjs',
    grep: 'a 500 from the office',
    expectRed: ['a 500 from the office leaves both deliveries queued; they send on the next try'],
  }),
)
