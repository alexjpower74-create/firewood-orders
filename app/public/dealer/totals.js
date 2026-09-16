// The dealer's Totals tab: a season's months with goods, stacking, delivery, subtotal, HST, total and payments, the season
// totals and what is still owing, and "Download CSV" for the season's delivered orders and payments (fetched with the
// sign-in token, saved from the bytes the API sent).

import { api } from '/api.js'
import { esc, money } from '/ui.js'

const $ = (sel, root = document) => root.querySelector(sel)
const COLUMNS = [
  ['goods_cents', 'Goods'],
  ['stacking_cents', 'Stacking'],
  ['delivery_cents', 'Delivery'],
  ['subtotal_cents', 'Subtotal'],
  ['hst_cents', 'HST'],
  ['total_cents', 'Total'],
  ['payments_cents', 'Payments'],
]

let root = null
let currentYear = null
let latestYear = null

export function initTotals(el) {
  root = el
  root.addEventListener('change', (ev) => {
    if (ev.target.id === 'season') showTotals(ev.target.value)
  })
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-csv]')
    if (b && root.contains(b)) downloadCsv(b)
  })
}

export async function showTotals(season = null) {
  root.innerHTML = '<p class="small">Loading the totals…</p>'
  let data
  try {
    data = await api.totals(season)
  } catch (e) {
    if (e.status !== 401) root.innerHTML = `<p class="alert" role="alert">${esc(e.message)}</p>`
    return
  }
  currentYear = data.season.year
  if (latestYear === null || season === null) latestYear = Math.max(latestYear ?? 0, currentYear)
  render(data)
}

function render({ season, months, totals }) {
  const years = [latestYear, latestYear - 1, latestYear - 2]
  if (!years.includes(season.year)) years.push(season.year)
  const cells = (row) => COLUMNS.map(([k]) => `<td class="num" data-col="${k}">${money(row[k])}</td>`).join('')
  root.innerHTML = `
    <div class="totals-head">
      <label class="field season-field"><span class="field-label">Season</span>
        <select id="season" class="input">${years
          .sort((a, b) => b - a)
          .map((y) => `<option value="${y}"${y === season.year ? ' selected' : ''}>${y}–${String(y + 1).slice(2)} season</option>`)
          .join('')}</select>
      </label>
      <p class="small season-dates">${esc(season.label)}: ${esc(season.from)} to ${esc(season.to)}. Deliveries count in the month they were delivered, payments in the month they were paid. HST is 15 %, worked out per order.</p>
    </div>

    <div class="stats totals-stats">
      <div class="stat static"><span class="stat-count" id="season-total">${money(totals.total_cents)}</span><span class="stat-label">Total sales</span></div>
      <div class="stat static"><span class="stat-count" id="season-hst">${money(totals.hst_cents)}</span><span class="stat-label">HST collected</span></div>
      <div class="stat static"><span class="stat-count" id="season-payments">${money(totals.payments_cents)}</span><span class="stat-label">Payments</span></div>
      <div class="stat static" data-bucket="owing"><span class="stat-count" id="season-owing">${money(totals.owing_cents)}</span><span class="stat-label">Still owing</span></div>
    </div>

    <section class="card">
      <h2 class="card-title">By month</h2>
      <div class="table-wrap">
        <table id="totals-table" class="money-table">
          <thead><tr><th scope="col">Month</th><th scope="col" class="num">Delivered</th>${COLUMNS.map(([, l]) => `<th scope="col" class="num">${l}</th>`).join('')}</tr></thead>
          <tbody>${
            months.length
              ? months
                  .map(
                    (m) =>
                      `<tr data-month="${esc(m.month)}"><th scope="row">${esc(m.label)}</th><td class="num" data-col="delivered">${m.delivered}</td>${cells(m)}</tr>`,
                  )
                  .join('')
              : '<tr><td colspan="9" class="small">This season hasn\'t started yet.</td></tr>'
          }</tbody>
          <tfoot><tr data-month="season"><th scope="row">Season</th><td class="num" data-col="delivered">${totals.delivered}</td>${cells(totals)}</tr></tfoot>
        </table>
      </div>
    </section>

    <section class="card downloads">
      <h2 class="card-title">Download CSV</h2>
      <p class="small">For your accountant or a spreadsheet. The files hold this season only.</p>
      <div class="download-row">
        <div class="download"><strong>Delivered orders</strong><span class="small">One row per delivered order, with HST and what is owing.</span>
          <button type="button" class="btn btn-secondary" data-csv="orders">Download CSV</button></div>
        <div class="download"><strong>Payments</strong><span class="small">One row per payment. Voided payments are left out.</span>
          <button type="button" class="btn btn-secondary" data-csv="payments">Download CSV</button></div>
      </div>
      <p class="small" id="download-status" role="status"></p>
      <p class="alert" id="download-error" role="alert" hidden></p>
    </section>`
}

async function downloadCsv(button) {
  const status = $('#download-status', root)
  const error = $('#download-error', root)
  error.hidden = true
  button.disabled = true
  try {
    const { blob, filename } = await api.exportCsv(button.dataset.csv, currentYear)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.hidden = true
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    status.textContent = `Saved ${filename}.`
  } catch (e) {
    if (e.status !== 401) {
      error.textContent = e.message
      error.hidden = false
    }
  } finally {
    button.disabled = false
  }
}
