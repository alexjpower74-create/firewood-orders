// (j) The copy's undo leaves stock down → the undeliver / driver undo test goes red.
import { negative } from './negative-lib.mjs'

process.exit(await negative({
  name: 'undo',
  why: "undoDelivery's batch no longer puts the stock back (the UPDATE products statement is removed; the undo move is still written)",
  patches: [{ file: 'src/index.js',
    from: '    db.prepare(`UPDATE products SET ${col} = ${col} + ? WHERE id = ? AND ${G}`).bind(change, o.product_id, o.id, op),\n',
    to: '' }],
  args: ['--api-only', '--grep', '^undeliver'],
  expectRed: ['undeliver and driver undo each put stock back and void the door payment (owing restored to the cent)'],
}))
