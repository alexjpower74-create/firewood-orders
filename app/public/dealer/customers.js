// The dealer's Customers tab: everyone who has ordered, most owing first; one customer's balance, their recent and
// unpaid orders, the ledger with its running balance (the API's numbers), and Record a payment.
// Payments are voided from an order's detail panel, where each payment has its id (the ledger entries carry none).

import { api } from '/api.js'
import { esc, money, balanceLabel, METHODS, icon, clearErrors, showError, dollarsToCents } from '/ui.js'

const $ = (sel, root = document) => root.querySelector(sel)
const kindOf = (cents) => (cents > 0 ? 'owing' : cents < 0 ? 'credit' : 'paid')

let root = null
let info = null
let onPath = () => {}
let onOpenOrder = () => {}

export function initCustomers(el, { dealerInfo, onPathChange, openOrder }) {
  root = el
  info = dealerInfo
  onPath = onPathChange || (() => {})
  onOpenOrder = openOrder || (() => {})
  root.addEventListener('click', click)
}

/** The list (id null) or one customer. */
export function showCustomers(id = null) {
  return id ? openCustomer(id) : showList()
}

async function showList() {
  onPath(null)
  root.innerHTML = '<p class="small">Loading customers…</p>'
  let customers
  try {
    customers = (await api.customers()).customers
  } catch (e) {
    if (e.status !== 401) root.innerHTML = `<p class="alert" role="alert">${esc(e.message)}</p>`
    return
  }
  root.innerHTML = customers.length
    ? `<p class="small plan-intro">Everyone who has ordered, most owing first.</p>
       <ul class="customers" aria-label="Customers">${customers.map((c) => `<li>
        <button type="button" class="customer" data-customer="${esc(c.id)}">
          <span class="customer-main"><strong>${esc(c.name)}</strong>
            <span class="small">${esc(c.phone)} · ${c.orders} ${c.orders === 1 ? 'order' : 'orders'}${c.last_order_label ? ` · last ${esc(c.last_order_label)}` : ''}</span></span>
          <span class="pill balance-pill" data-kind="${kindOf(c.balance_cents)}">${balanceLabel(c.balance_cents)}</span>
        </button></li>`).join('')}</ul>`
    : '<p class="empty">No customers yet. They appear here with their first order.</p>'
}

async function openCustomer(id) {
  onPath(id)
  root.innerHTML = '<p class="small">Loading the ledger…</p>'
  let ledger
  let board
  try {
    ;[ledger, board] = await Promise.all([api.ledger(id), api.board()])
  } catch (e) {
    if (e.status !== 401) {
      root.innerHTML = `<button type="button" class="btn btn-ghost" data-action="list">${icon.back}<span>Back to customers</span></button>
        <p class="alert" role="alert">${esc(e.message)}</p>`
    }
    return
  }
  render(ledger, board)
}

function customerOrders(board, id) {
  const seen = new Map()
  for (const key of ['new', 'scheduled', 'delivered', 'owing']) {
    for (const o of board[key] || []) if (o.customer_id === id && !seen.has(o.id)) seen.set(o.id, o)
  }
  return [...seen.values()]
}

function owingPill(o) {
  const cents = o.owing_cents
  const text = cents > 0 ? `Owing ${money(cents)}` : cents < 0 ? `Credit ${money(-cents)}` : 'Paid in full'
  return `<span class="pill order-owing" data-kind="${kindOf(cents)}">${text}</span>`
}

function render({ customer: c, entries, balance_cents: balance }, board) {
  const orders = customerOrders(board, c.id)
  const methodOptions = Object.entries(METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')
  root.innerHTML = `
    <button type="button" class="btn btn-ghost" data-action="list">${icon.back}<span>Back to customers</span></button>
    <div class="ledger-head" data-customer="${esc(c.id)}">
      <h2 id="ledger-name" class="route-title" tabindex="-1">${esc(c.name)}</h2>
      <a class="tel" href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${icon.phone}<span>${esc(c.phone)}</span></a>
      <p id="ledger-balance" class="owing-big" data-kind="${kindOf(balance)}">${balanceLabel(balance)}</p>
    </div>

    <section class="card">
      <h3 class="card-title">Recent and unpaid orders</h3>
      ${orders.length ? `<ul class="cust-orders">${orders.map((o) => `<li class="cust-order" data-order="${esc(o.id)}" data-status="${esc(o.status)}">
          <span class="cust-order-main"><strong>${esc(o.qty_label)} of ${esc(o.product_label)}</strong>
            <span class="small">${esc(o.status_label)} · total ${money(o.total_cents)}</span></span>
          ${owingPill(o)}
          <button type="button" class="btn btn-secondary" data-action="open-order" data-id="${esc(o.id)}">Open</button>
        </li>`).join('')}</ul>` : '<p class="small">Nothing open or recent. Older paid orders are in the ledger below.</p>'}
    </section>

    <section class="card">
      <h3 class="card-title">Ledger</h3>
      <div class="table-wrap">
        <table id="ledger" class="money-table">
          <thead><tr><th scope="col">Date</th><th scope="col">What</th><th scope="col" class="num">Charge</th><th scope="col" class="num">Paid</th><th scope="col" class="num">Balance</th></tr></thead>
          <tbody>${entries.length ? entries.map((e) => `<tr data-kind="${esc(e.kind)}">
              <td class="date">${esc(e.label)}</td><td class="text">${esc(e.text)}</td>
              <td class="num charge">${e.charge_cents ? money(e.charge_cents) : ''}</td>
              <td class="num payment">${e.payment_cents ? money(e.payment_cents) : ''}</td>
              <td class="num running">${money(e.balance_cents)}</td></tr>`).join('')
            : '<tr><td colspan="5" class="small">Nothing yet.</td></tr>'}</tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <form id="cust-pay-form" class="pay-form" novalidate>
        <h4>Record a payment</h4>
        <p class="small">For money you already have. This page takes no payments.</p>
        <div class="pay-grid">
          <label class="field"><span class="field-label">For</span>
            <select id="cust-pay-order" class="input" data-field="order_id">
              <option value="">On account (no order)</option>
              ${orders.map((o) => `<option value="${esc(o.id)}">${esc(o.qty_label)} of ${esc(o.product_label)} (${esc(o.status_label)})</option>`).join('')}
            </select>
            <p class="error" data-error-for="order_id" role="alert" hidden></p></label>
          <label class="field"><span class="field-label">Amount</span>
            <span class="money-input"><span aria-hidden="true">$</span><input id="cust-pay-amount" class="input" inputmode="decimal" autocomplete="off" data-field="amount_cents" placeholder="0.00"></span>
            <p class="error" data-error-for="amount_cents" role="alert" hidden></p></label>
          <label class="field"><span class="field-label">How they paid</span>
            <select id="cust-pay-method" class="input" data-field="method">${methodOptions}</select>
            <p class="error" data-error-for="method" role="alert" hidden></p></label>
          <label class="field"><span class="field-label">Date</span>
            <input id="cust-pay-date" class="input" type="date" data-field="date" ${info?.today ? `value="${esc(info.today)}" max="${esc(info.today)}"` : ''}>
            <p class="error" data-error-for="date" role="alert" hidden></p></label>
          <label class="field"><span class="field-label">Note (optional)</span>
            <input id="cust-pay-note" class="input" data-field="note" maxlength="200">
            <p class="error" data-error-for="note" role="alert" hidden></p></label>
        </div>
        <p class="alert" data-error-for="form" role="alert" hidden></p>
        <button type="submit" class="btn btn-primary" id="cust-pay-submit">Record a payment</button>
        <p class="small" id="cust-pay-done" role="status"></p>
      </form>
    </section>`
  $('#cust-pay-form', root).addEventListener('submit', (ev) => record(ev, c))
}

async function record(ev, c) {
  ev.preventDefault()
  const form = ev.currentTarget
  clearErrors(form)
  const cents = dollarsToCents($('#cust-pay-amount', form).value)
  if (cents === null || cents < 1) {
    showError(form, 'amount_cents', 'Enter the amount in dollars, like 100.00.')
    return
  }
  const body = { customer_id: c.id, amount_cents: cents, method: $('#cust-pay-method', form).value }
  const orderId = $('#cust-pay-order', form).value
  const date = $('#cust-pay-date', form).value
  const note = $('#cust-pay-note', form).value.trim()
  if (orderId) body.order_id = orderId
  if (date) body.date = date
  if (note) body.note = note
  const button = $('#cust-pay-submit', form)
  button.disabled = true
  try {
    await api.recordPayment(body)
    await openCustomer(c.id)
    const done = $('#cust-pay-done', root)
    if (done) done.textContent = `Payment of ${money(cents)} recorded.`
  } catch (e) {
    if (!showError(form, e.field, e.message)) showError(form, 'form', e.message)
    button.disabled = false
  }
}

function click(ev) {
  const b = ev.target.closest('button')
  if (!b || !root.contains(b)) return
  if (b.matches('.customer')) return openCustomer(b.dataset.customer)
  if (b.dataset.action === 'list') return showList()
  if (b.dataset.action === 'open-order') return onOpenOrder(b.dataset.id)
}
