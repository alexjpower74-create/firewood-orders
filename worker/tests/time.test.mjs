// NL dates and labels (America/St_Johns: NDT = UTC−2:30 in September, NST = UTC−3:30 in winter).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addDays,
  dateTimeLabel,
  isoWeekday,
  isValidDate,
  longLabel,
  monthLabel,
  nextMonth,
  nlDate,
  nlMonth,
  shortLabel,
  timeLabel,
} from '../src/time.js'

test('labels', () => {
  assert.equal(shortLabel('2026-09-15'), 'Tue Sep 15')
  assert.equal(longLabel('2026-09-15'), 'Tuesday, September 15')
  assert.equal(isoWeekday('2026-09-20'), 7) // a Sunday
  assert.equal(isoWeekday('2026-09-14'), 1)
  assert.equal(addDays('2026-09-30', 1), '2026-10-01')
  assert.equal(isValidDate('2026-02-30'), false)
  assert.equal(isValidDate('2026-09-15'), true)
})

test('NL local time, not UTC', () => {
  // 17:05 UTC − 2:30 = 2:35 PM NDT
  assert.equal(timeLabel('2026-09-15T17:05:00.000Z'), '2:35 PM')
  assert.equal(timeLabel('2026-09-14T11:30:00.000Z'), '9:00 AM')
  assert.equal(dateTimeLabel('2026-09-14T11:30:00.000Z'), 'Mon Sep 14, 9:00 AM')
  // 02:00 UTC on Oct 1 is 11:30 PM on Sep 30 in St. John's
  assert.equal(nlDate('2026-10-01T02:00:00.000Z'), '2026-09-30')
  assert.equal(timeLabel('2026-10-01T02:00:00.000Z'), '11:30 PM')
  // midnight and noon
  assert.equal(timeLabel('2026-09-15T02:30:00.000Z'), '12:00 AM')
  assert.equal(timeLabel('2026-09-15T14:30:00.000Z'), '12:00 PM')
  // winter: NST is UTC−3:30
  assert.equal(timeLabel('2026-12-15T17:00:00.000Z'), '1:30 PM')
})

test('months: the NL month of an instant, the next month, the label', () => {
  assert.equal(nlMonth('2026-10-01T02:00:00.000Z'), '2026-09') // Sep 30, 11:30 PM NDT
  assert.equal(nlMonth('2026-10-01T03:00:00.000Z'), '2026-10') // Oct 1, 12:30 AM NDT
  assert.equal(nlMonth('2027-01-01T03:00:00.000Z'), '2026-12') // Dec 31, 11:30 PM NST
  assert.equal(nextMonth('2026-09'), '2026-10')
  assert.equal(nextMonth('2026-12'), '2027-01')
  assert.equal(monthLabel('2026-09'), 'September 2026')
})
