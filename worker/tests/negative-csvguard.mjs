// (h) The copy has no spreadsheet formula guard → the CSV tests go red.
import { negative } from './negative-lib.mjs'

process.exit(await negative({
  name: 'csvguard',
  why: "csvCell no longer prefixes ' to text starting with = + - @ tab or CR",
  patches: [{ file: 'src/csv.js', from: "  if (FORMULA.test(s)) s = `'${s}`\n", to: '' }],
  args: ['--unit', 'csv.test.mjs', '--grep', '^CSV exports'],
  expectRed: ['formula guard: = + - @ tab CR get a leading apostrophe',
    'CSV exports: header exact, CRLF, quoting, formula guard, filename, money as 123.45'],
}))
