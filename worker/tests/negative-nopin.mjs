// (fo2 review #1) The copy quotes a pinless order at the yard instead of answering null → the no-pin tests go red.
import { negative } from './negative-lib.mjs'

process.exit(
  await negative({
    name: 'nopin',
    why: 'priceOrder uses the yard as the pin when there is none, so a quote before the map is tapped shows a guessed delivery and total',
    patches: [
      {
        file: 'src/money.js',
        from: 'const pin = input.lat === null || input.lat === undefined ? null : { lat: input.lat, lng: input.lng }',
        to: 'const pin = input.lat === null || input.lat === undefined ? settings.yard : { lat: input.lat, lng: input.lng }',
      },
    ],
    args: ['--unit', 'money.test.mjs', '--grep', '^quote without a pin'],
    expectRed: [
      'without a pin: goods and stacking only, never a guessed delivery or total; the minimum still applies',
      'quote without a pin: goods and stacking, the money that needs a pin is null; below the minimum still refused',
    ],
  }),
)
