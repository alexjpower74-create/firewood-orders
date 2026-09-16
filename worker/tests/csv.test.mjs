// CSV cells and rows: quoting, the spreadsheet formula guard, money cells, CRLF.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { csvCell, csvText } from '../src/csv.js'

test('cells: plain text, quoting with doubled quotes, line breaks, empty, numbers and money', () => {
  assert.equal(csvCell('Mixed softwood'), 'Mixed softwood')
  assert.equal(csvCell('Smith, "Junior"'), '"Smith, ""Junior"""')
  assert.equal(csvCell('He said "hi"'), '"He said ""hi"""')
  assert.equal(csvCell('Up the hill\nleft at the pond'), '"Up the hill\nleft at the pond"')
  assert.equal(csvCell(null), '')
  assert.equal(csvCell(undefined), '')
  assert.equal(csvCell(7), '7')
  assert.equal(csvCell({ cents: 123456 }), '1234.56')
  assert.equal(csvCell({ cents: 5 }), '0.05')
  assert.equal(csvCell({ cents: -2000 }), '-20.00', 'money is a number, never formula-guarded')
})

test('formula guard: = + - @ tab CR get a leading apostrophe', () => {
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)")
  assert.equal(csvCell('+1 709 555 0100'), "'+1 709 555 0100")
  assert.equal(csvCell('-5'), "'-5")
  assert.equal(csvCell('@home'), "'@home")
  assert.equal(csvCell('\tcmd'), "'\tcmd")
  assert.equal(csvCell('\rcmd'), `"'\rcmd"`)
  assert.equal(csvCell('=A1,B1'), `"'=A1,B1"`, 'guarded and then quoted')
  assert.equal(csvCell('a=b'), 'a=b', 'only a leading character counts')
})

test('text: CRLF after every row, including the last', () => {
  assert.equal(
    csvText(
      ['A', 'B'],
      [
        ['1', { cents: 250 }],
        ['x, y', null],
      ],
    ),
    'A,B\r\n1,2.50\r\n"x, y",\r\n',
  )
  assert.equal(csvText(['Only'], []), 'Only\r\n')
})
