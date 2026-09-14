// (n) A transparent overlay over Delivered in the copy → tap()'s elementFromPoint hit-test goes red.
import { negative } from './negative-lib.mjs'

const button = '          <button id="delivered" class="btn delivered" type="button">Delivered</button>\n'

process.exit(await negative({
  name: 'overlay',
  why: 'index.html puts a transparent absolutely positioned div over the next-stop card, on top of Delivered',
  patches: [{ file: 'driver/index.html', from: button,
    to: `${button}          <div style="position:absolute;inset:0;background:transparent;z-index:5"></div>\n` }],
  spec: 'tests/driver/driver.spec.mjs',
  grep: 'the status page says Out for delivery',
  expectRed: ['Start → the status page says Out for delivery; Delivered + Cash → the next stop, and the office has the payment and Paid in full'],
}))
