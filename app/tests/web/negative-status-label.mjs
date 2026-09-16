// Negative control (b): the copy's status page shows "Requested" for a scheduled order, so status.spec must go red.
import { runNegative } from './negative-lib.mjs'

const ok = runNegative({
  name: 'status-label',
  what: 'the status page maps scheduled to "Requested"',
  breaks: [
    {
      file: 'o/status.js',
      find: '  pill.textContent = o.status_label\n',
      replace: "  pill.textContent = o.status === 'scheduled' ? 'Requested' : o.status_label\n",
    },
  ],
  spec: 'tests/web/status.spec.mjs',
  grep: 'each status label as the API moves the order',
  red: /Scheduled for Tuesday, September 15/,
})
process.exit(ok ? 0 : 1)
