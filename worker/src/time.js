// Dealer-local dates and people-facing labels in America/St_Johns. Pure (Intl only).
export const TZ = 'America/St_Johns'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// NL wall clock of an instant: { date: 'YYYY-MM-DD', hour, minute }.
export function nlParts(instant) {
  const parts = {}
  for (const p of partsFormat.formatToParts(new Date(instant))) parts[p.type] = p.value
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24, minute: Number(parts.minute) }
}

export function nlDate(instant) {
  return nlParts(instant).date
}

function utcOf(date) {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function isValidDate(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) return false
  return utcOf(date).toISOString().slice(0, 10) === date
}

export function addDays(date, n) {
  const t = utcOf(date)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

// ISO weekday: Monday 1 … Sunday 7.
export function isoWeekday(date) {
  return ((utcOf(date).getUTCDay() + 6) % 7) + 1
}

export function weekdayName(iso) {
  return DAYS[iso - 1]
}

// "Tue Sep 15"
export function shortLabel(date) {
  const t = utcOf(date)
  return `${DAYS[isoWeekday(date) - 1].slice(0, 3)} ${MONTHS[t.getUTCMonth()].slice(0, 3)} ${t.getUTCDate()}`
}

// "Tuesday, September 15"
export function longLabel(date) {
  const t = utcOf(date)
  return `${DAYS[isoWeekday(date) - 1]}, ${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}`
}

// "2:05 PM" in NL time.
export function timeLabel(instant) {
  const { hour, minute } = nlParts(instant)
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
}

// "Mon Sep 14, 9:00 AM"
export function dateTimeLabel(instant) {
  return `${shortLabel(nlDate(instant))}, ${timeLabel(instant)}`
}

// The NL-local month of an instant: '2026-10-01T02:00:00Z' (Sep 30, 11:30 PM NDT) → '2026-09'.
export function nlMonth(instant) {
  return nlDate(instant).slice(0, 7)
}

export function nextMonth(month) {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

// "September 2026"
export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}
