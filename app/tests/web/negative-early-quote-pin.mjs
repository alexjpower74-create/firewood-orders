// Negative control (f): the copy's order form sends the yard's lat/lng on the quote before the map is tapped (the old
// workaround), so order.spec's no-pin check must go red.
import { runNegative } from './negative-lib.mjs'

const ok = runNegative({
  name: 'early-quote-pin',
  what: 'the quote before the pin carries the yard lat/lng instead of no pin',
  breaks: [
    {
      file: 'order/form.js',
      find: '    if (state.pin) {\n      body.lat = state.pin.lat\n      body.lng = state.pin.lng\n    }\n',
      replace: '    const at = state.pin || info.yard\n    body.lat = at.lat\n    body.lng = at.lng\n',
    },
  ],
  spec: 'tests/web/order.spec.mjs',
  grep: 'five steps with real taps',
  red: /a quote before the pin carries no lat\/lng/,
})
process.exit(ok ? 0 : 1)
