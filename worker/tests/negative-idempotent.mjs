// (d) The copy stores each check-in under a fresh random id instead of the phone's op_id → the duplicate test must go red.
import { negative } from './negative-lib.mjs'

process.exit(
  await negative({
    name: 'idempotent',
    why: 'checkins rows are inserted (and read back) under crypto.randomUUID() instead of op_id, so a replay is never recognised',
    patches: [
      { file: 'src/index.js', from: '  const opId = b.op_id\n', to: '  const opId = b.op_id\n  const rowId = crypto.randomUUID()\n' },
      { file: 'src/index.js', from: '.bind(opId, o.id, atIso, deliveredAt,', to: '.bind(rowId, o.id, atIso, deliveredAt,' },
      {
        file: 'src/index.js',
        from: "const ck = await c.db.prepare('SELECT * FROM checkins WHERE op_id = ?').bind(opId).first()",
        to: "const ck = await c.db.prepare('SELECT * FROM checkins WHERE op_id = ?').bind(rowId).first()",
      },
    ],
    args: ['--api-only', '--grep', '^idempotent'],
    expectRed: ['idempotent check-in: same op_id twice → 201 then 200 duplicate; stock and door payment once; another op → 409'],
  }),
)
