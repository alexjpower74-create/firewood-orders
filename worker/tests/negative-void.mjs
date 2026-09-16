// (i) The copy counts voided payments → the "voided payments leave every sum" test goes red.
import { negative } from './negative-lib.mjs'

process.exit(
  await negative({
    name: 'void',
    why: 'money.counts returns true for every payment, voided or not (the one place every sum asks)',
    patches: [{ file: 'src/money.js', from: 'export const counts = (p) => !p.voided', to: 'export const counts = (p) => true' }],
    args: ['--api-only', '--grep', '^voided'],
    expectRed: ['voided payments leave every sum'],
  }),
)
