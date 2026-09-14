// CSV for spreadsheets. Pure. CRLF line ends; quotes doubled; text that a spreadsheet would run as a formula gets a leading '.
import { plainMoney } from './money.js'

const FORMULA = /^[=+\-@\t\r]/

// A cell is text, a number, null (empty), or { cents } for money written as 123.45 (never formula-guarded: it is a number).
export function csvCell(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object' && Number.isInteger(v.cents)) return plainMoney(v.cents)
  if (typeof v === 'number') return String(v)
  let s = String(v)
  if (FORMULA.test(s)) s = `'${s}`
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

export function csvText(header, rows) {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
