// (fo2 review #1) The copy puts the Undo bar back as a bar fixed at the bottom of the screen → right after a Save it covers
// the next stop's Delivered, and the hit-test goes red.
import { negative } from './negative-lib.mjs'

process.exit(
  await negative({
    name: 'undo-bar',
    why: 'driver.css makes .undo-bar position: fixed at the bottom again (as before the fix)',
    patches: [
      {
        file: 'driver/driver.css',
        from: '.undo-bar {\n  display: flex;\n',
        to: '.undo-bar {\n  position: fixed;\n  left: 0;\n  right: 0;\n  bottom: 0;\n  z-index: 30;\n  display: flex;\n',
      },
    ],
    spec: 'tests/driver/review.spec.mjs',
    grep: 'review #1',
    expectRed: ["review #1: right after a Save, the next stop's Delivered hit-tests to itself while the Undo bar shows"],
  }),
)
