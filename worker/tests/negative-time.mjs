// (e) The copy stores the server's now instead of the moment the driver tapped → the original-time test must go red.
import { negative } from './negative-lib.mjs'

process.exit(
  await negative({
    name: 'time',
    why: "delivered_at = server now, always (the phone's `at` is ignored)",
    patches: [{ file: 'src/index.js', from: 'const deliveredAt = adjusted ? nowIso : atIso', to: 'const deliveredAt = nowIso' }],
    args: ['--api-only', '--grep', '^original time'],
    expectRed: ['original time: at = T with server now T + 45 min keeps T; 2 h in the future is adjusted'],
  }),
)
