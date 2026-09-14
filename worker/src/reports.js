// Season totals and CSV exports. Delivered orders count in the NL-local month of delivered_at; payments in the month of
// their date. Voided payments never count (money.counts).
import { bad } from './errors.js'
import { csvText } from './csv.js'
import { json } from './http.js'
import { counts, owingCents, paidCents } from './money.js'
import { addDays, monthLabel, nextMonth, nlDate, nlMonth } from './time.js'
import { loadSettings, METHOD_LABELS, ORDER_SELECT, qtyLabelOf } from './views.js'

const MONEY = ['goods_cents', 'stacking_cents', 'delivery_cents', 'subtotal_cents', 'hst_cents', 'total_cents']

// `param` = the ?season= year or null for the season that contains today.
export function seasonFor(s, today, param) {
  let year
  if (param === null || param === undefined || param === '') {
    const y = Number(today.slice(0, 4))
    year = today.slice(5) >= s.season_start ? y : y - 1
  } else {
    if (!/^\d{4}$/.test(param) || Number(param) < 2000 || Number(param) > 2100) {
      throw bad('season', 'Pick a season by the year it starts, like 2026.')
    }
    year = Number(param)
  }
  const from = `${year}-${s.season_start}`
  const to = addDays(`${year + 1}-${s.season_start}`, -1)
  return { year, from, to, label: `${year}–${String(year + 1).slice(2)} season` }
}

async function seasonData(c) {
  const s = await loadSettings(c.db)
  const season = seasonFor(s, c.today, c.url.searchParams.get('season'))
  const { results: delivered } = await c.db.prepare(`${ORDER_SELECT}
    WHERE o.status = 'delivered' AND o.delivered_at IS NOT NULL ORDER BY o.delivered_at, o.id`).all()
  const { results: payments } = await c.db.prepare(`SELECT p.*, c.name AS name, c.phone AS phone FROM payments p
    JOIN customers c ON c.id = p.customer_id ORDER BY p.date, p.created_at, p.id`).all()
  const inSeason = (date) => date >= season.from && date <= season.to
  return {
    season, payments,
    orders: delivered.filter((o) => inSeason(nlDate(o.delivered_at))),
    seasonPayments: payments.filter((p) => counts(p) && inSeason(p.date)),
  }
}

export async function totals(c) {
  const { season, orders, payments, seasonPayments } = await seasonData(c)
  const zero = () => ({ delivered: 0, ...Object.fromEntries(MONEY.map((k) => [k, 0])), payments_cents: 0 })
  const months = []
  if (c.today >= season.from) {
    const last = (c.today < season.to ? c.today : season.to).slice(0, 7)
    for (let m = season.from.slice(0, 7); m <= last; m = nextMonth(m)) months.push({ month: m, label: monthLabel(m), ...zero() })
  }
  const byMonth = Object.fromEntries(months.map((m) => [m.month, m]))
  for (const o of orders) {
    const row = byMonth[nlMonth(o.delivered_at)]
    if (!row) continue
    row.delivered += 1
    for (const k of MONEY) row[k] += o[k]
  }
  for (const p of seasonPayments) {
    const row = byMonth[p.date.slice(0, 7)]
    if (row) row.payments_cents += p.amount_cents
  }
  const sum = zero()
  for (const m of months) {
    sum.delivered += m.delivered
    sum.payments_cents += m.payments_cents
    for (const k of MONEY) sum[k] += m[k]
  }
  let owing = 0
  for (const o of orders) {
    const v = owingCents(o, payments)
    if (v > 0) owing += v
  }
  return json({ season, months, totals: { ...sum, owing_cents: owing } })
}

function csvResponse(text, filename) {
  return new Response(text, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store' },
  })
}

export async function ordersCsv(c) {
  const { season, orders, payments } = await seasonData(c)
  const header = ['Order', 'Delivered', 'Customer', 'Phone', 'Address', 'Product', 'Quantity', 'Goods', 'Stacking', 'Delivery',
    'Subtotal', 'HST', 'Total', 'Paid', 'Owing', 'Door payment']
  const rows = orders.map((o) => [o.id, nlDate(o.delivered_at), o.name, o.phone, o.address, o.product_label, qtyLabelOf(o),
    ...MONEY.map((k) => ({ cents: o[k] })), { cents: paidCents(o.id, payments) }, { cents: owingCents(o, payments) },
    o.door_payment ? METHOD_LABELS[o.door_payment] : ''])
  return csvResponse(csvText(header, rows), `firewood-orders-${season.year}-orders.csv`)
}

export async function paymentsCsv(c) {
  const { season, seasonPayments } = await seasonData(c)
  const header = ['Date', 'Customer', 'Phone', 'Order', 'Method', 'Amount', 'Note']
  const rows = seasonPayments.map((p) => [p.date, p.name, p.phone, p.order_id || '', METHOD_LABELS[p.method],
    { cents: p.amount_cents }, p.note])
  return csvResponse(csvText(header, rows), `firewood-orders-${season.year}-payments.csv`)
}
