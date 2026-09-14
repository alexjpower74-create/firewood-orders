// Negative control (c): a transparent cover over Send request in the copy (only while Send shows), so the tap()
// hit-test in order.spec must go red at Send.
import { runNegative } from './negative-lib.mjs'

const ok = runNegative({
  name: 'send-overlay',
  what: 'a transparent element lies over Send request; it looks the same, but a tap would not reach the button',
  breaks: [
    {
      file: 'index.html',
      find: '<button type="button" id="send" class="btn btn-primary" hidden>Send request</button>',
      replace: '<button type="button" id="send" class="btn btn-primary" hidden>Send request</button><div class="send-cover"></div>',
    },
    {
      file: 'index.html',
      find: '</head>',
      replace: '<style>.bar-actions{position:relative}.send-cover{display:none}#send:not([hidden])~.send-cover{display:block;position:absolute;inset:0;z-index:5;background:transparent}</style></head>',
    },
  ],
  spec: 'tests/web/order.spec.mjs',
  grep: 'five steps with real taps',
  red: /tap\(locator\('#send'\)\) hit-test[\s\S]*something else is on top/,
})
process.exit(ok ? 0 : 1)
