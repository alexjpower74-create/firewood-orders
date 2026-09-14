// The dealer page (/dealer/): PIN sign-in, the section tabs, and the Orders tab — stat cards, the four buckets, order
// cards, the order detail panel (customer and balance, money, payments, Record a payment, Copy text messages, Schedule
// with each day's truck capacity, Take off the schedule) and Add a phone order.

import { api, session, SIGNED_OUT } from '/api.js'
import {
  esc, money, cords, volumeText, balanceLabel, METHODS, icon, showDealer, copyButton, clearErrors, showError, dollarsToCents,
} from '/ui.js'
import { createOrderForm, FIELD_STEP } from '/order/form.js'

const $ = (sel) => document.querySelector(sel)
const BUCKETS = [
  ['new', 'New', icon.inbox],
  ['scheduled', 'Scheduled', icon.calendar],
  ['delivered', 'Delivered', icon.done],
  ['owing', 'Owing', icon.dollar],
]
const EMPTY = {
  new: 'No new orders right now.',
  scheduled: 'Nothing on the schedule yet.',
  delivered: 'No deliveries in the last 30 days.',
  owing: 'Nobody owes on a delivered order.',
}

let info = null
let board = null
let bucket = 'new'
let openId = null
let phoneForm = null

/* ---------- start, sign-in, tabs ---------- */

async function start() {
  try {
    info = await api.info()
    showDealer(info)
  } catch {}
  const topbar = $('#topbar')
  new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`)).observe(topbar)
  // At phone width the tab bar sticks under the header, so it counts as a sticky header for tap targets.
  const narrow = matchMedia('(max-width: 899px)')
  const markTabs = () => $('#tabs').toggleAttribute('data-sticky-header', narrow.matches)
  narrow.addEventListener('change', markTabs)
  markTabs()

  window.addEventListener(SIGNED_OUT, (ev) => showSignin(ev.detail))
  $('#signin-form').addEventListener('submit', signin)
  $('#signout').addEventListener('click', signout)
  $('#tabs').addEventListener('click', (ev) => { const t = ev.target.closest('[role="tab"]'); if (t) selectTab(t.dataset.tab) })
  $('#tabs').addEventListener('keydown', tabKeys)
  $('#stats').addEventListener('click', (ev) => {
    const b = ev.target.closest('.stat')
    if (!b) return
    bucket = b.dataset.bucket
    renderBoard()
  })
  $('#order-list').addEventListener('click', listClick)
  $('#add-phone-order').addEventListener('click', openPhoneOrder)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && session.get() && !$('#app').hidden) loadBoard()
  })

  if (session.get()) showApp()
  else showSignin()
}

function showSignin(message = '') {
  $('#app').hidden = true
  $('#signout').hidden = true
  $('#signin').hidden = false
  const form = $('#signin-form')
  clearErrors(form)
  if (message) showError(form, 'pin', message)
  $('#pin').value = ''
}

async function signin(ev) {
  ev.preventDefault()
  const form = $('#signin-form')
  const button = $('#signin-btn')
  clearErrors(form)
  button.disabled = true
  try {
    const r = await api.signin($('#pin').value.trim())
    if (r.role !== 'dealer') {
      showError(form, 'pin', "That's the driver PIN. The dealer page needs the dealer PIN.")
      return
    }
    session.set(r.token)
    showApp()
  } catch (e) {
    showError(form, e.field || 'pin', e.message)
    $('#pin').select()
  } finally {
    button.disabled = false
  }
}

async function signout() {
  try { await api.signout() } catch {}
  session.clear()
  openId = null
  showSignin()
}

function showApp() {
  $('#signin').hidden = true
  $('#app').hidden = false
  $('#signout').hidden = false
  selectTab('orders')
  closeDetail()
  loadBoard()
}

function selectTab(name) {
  for (const t of document.querySelectorAll('[role="tab"]')) {
    const on = t.dataset.tab === name
    t.setAttribute('aria-selected', String(on))
    t.tabIndex = on ? 0 : -1
    $(`#${t.getAttribute('aria-controls')}`).hidden = !on
  }
}

function tabKeys(ev) {
  const tabs = [...document.querySelectorAll('[role="tab"]')]
  const i = tabs.indexOf(document.activeElement)
  if (i < 0) return
  const next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: tabs.length - 1 }[ev.key]
  if (next === undefined) return
  ev.preventDefault()
  const t = tabs[(next + tabs.length) % tabs.length]
  t.focus()
  selectTab(t.dataset.tab)
}

/* ---------- board ---------- */

async function loadBoard() {
  try {
    board = await api.board()
    $('#board-error').hidden = true
    renderBoard()
  } catch (e) {
    if (e.status === 401) return
    $('#board-error').textContent = e.message
    $('#board-error').hidden = false
  }
}

function renderBoard() {
  if (!board) return
  $('#stats').innerHTML = BUCKETS.map(([key, label, svg]) => `
    <button type="button" class="stat" data-bucket="${key}" aria-pressed="${key === bucket}">
      <span class="stat-icon">${svg}</span><span class="stat-count">${board.counts[key] ?? 0}</span><span class="stat-label">${label}</span>
    </button>`).join('')
  $('#list-title').textContent = BUCKETS.find(([k]) => k === bucket)[1]
  const list = board[bucket] || []
  $('#order-list').dataset.bucket = bucket
  $('#order-list').innerHTML = list.length ? list.map(card).join('') : `<p class="empty">${EMPTY[bucket]}</p>`
}

function whenText(o) {
  if (o.status === 'requested') return `Prefers: ${esc(o.preferred_label)}`
  if (o.status === 'scheduled' || o.status === 'out_for_delivery') return `On ${esc(o.delivery_label)}${o.route_pos ? `, stop ${o.route_pos}` : ''}`
  if (o.status === 'delivered') return esc(o.delivered_label || 'Delivered')
  return esc(o.status_label)
}

function owingPill(cents) {
  if (cents > 0) return `<span class="pill owing">Owing ${money(cents)}</span>`
  if (cents < 0) return `<span class="pill credit">Credit ${money(-cents)}</span>`
  return '<span class="pill paid">Paid in full</span>'
}

const canSchedule = (o) => o.status === 'requested' || o.status === 'scheduled'

function card(o) {
  return `<article class="order-card" data-order="${esc(o.id)}" data-status="${esc(o.status)}" data-source="${esc(o.source)}">
    <button type="button" class="card-open" aria-pressed="${openId === o.id}" aria-label="Open the order for ${esc(o.name)}">
      <span class="card-top"><span class="card-name">${esc(o.name)}</span><span class="pill status" data-status="${esc(o.status)}">${esc(o.status_label)}</span></span>
      <span class="card-what">${esc(o.qty_label)} of ${esc(o.product_label)}</span>
      <span class="chips">
        <span class="chip vol" data-kind="${esc(o.kind)}">${volumeText(o)}</span>
        ${o.stacking ? '<span class="chip">Stacked</span>' : ''}
        ${o.source === 'phone' ? '<span class="chip source">Phone order</span>' : ''}
        <span class="chip">${Number(o.distance_km).toFixed(1)} km</span>
      </span>
      <span class="card-when">${whenText(o)}</span>
      <span class="card-money"><span class="pill total">${money(o.total_cents)}</span>${owingPill(o.owing_cents)}</span>
    </button>
    ${canSchedule(o) ? `<div class="card-actions"><button type="button" class="btn btn-secondary schedule-btn" aria-expanded="false">${o.status === 'requested' ? 'Schedule' : 'Change day'}</button></div><div class="picker-slot"></div>` : ''}
  </article>`
}

function findOrder(id) {
  for (const [key] of BUCKETS) {
    const o = board?.[key]?.find((x) => x.id === id)
    if (o) return o
  }
  return null
}

function listClick(ev) {
  const b = ev.target.closest('button')
  const article = ev.target.closest('.order-card')
  if (!b || !article) return
  const o = findOrder(article.dataset.order)
  if (!o) return
  if (b.matches('.card-open')) openOrder(o.id)
  else if (b.matches('.schedule-btn')) togglePicker(article.querySelector('.picker-slot'), o, b)
}

/* ---------- schedule picker ---------- */

function percent(used, cap) {
  if (!cap) return used ? 100 : 0
  return Math.min(100, Math.round((used * 100) / cap))
}

function dayButton(d, o) {
  const [wd, ...rest] = d.label.split(' ')
  if (!d.delivers) {
    return `<button type="button" class="day cap-day" data-date="${esc(d.date)}" disabled>
      <span class="day-head">${esc(wd)} ${esc(rest.join(' '))}</span><span class="reason">${esc(d.reason || 'No deliveries')}</span></button>`
  }
  return `<button type="button" class="day cap-day" data-date="${esc(d.date)}" data-over="${!!d.over}" aria-pressed="${o.delivery_date === d.date}">
    <span class="day-head">${esc(wd)} ${esc(rest.join(' '))}${d.orders ? ` <span class="day-orders">${d.orders} ${d.orders === 1 ? 'stop' : 'stops'}</span>` : ''}</span>
    <span class="cap wood"><span class="bar"><span style="width:${percent(d.wood.used_cu_in, d.wood.cap_cu_in)}%"></span></span>${cords(d.wood.used_cu_in)} of ${cords(d.wood.cap_cu_in)} cords</span>
    <span class="cap pellets"><span class="bar"><span style="width:${percent(d.pellets.used_bags, d.pellets.cap_bags)}%"></span></span>${d.pellets.used_bags} of ${d.pellets.cap_bags} bags</span>
    ${d.over ? '<span class="over">Over the truck\'s limit</span>' : ''}
  </button>`
}

function closePicker(slot, button) {
  slot.innerHTML = ''
  button?.setAttribute('aria-expanded', 'false')
}

async function togglePicker(slot, o, button) {
  if (slot.firstElementChild) { closePicker(slot, button); return }
  button.setAttribute('aria-expanded', 'true')
  slot.innerHTML = '<div class="picker"><p class="small">Loading the days…</p></div>'
  let days
  try {
    days = (await api.days()).days
  } catch (e) {
    slot.innerHTML = `<div class="picker"><p class="alert" role="alert">${esc(e.message)}</p></div>`
    return
  }
  slot.innerHTML = `<div class="picker" role="group" aria-label="Pick a delivery day">
    <p class="picker-head">Pick a day. This order needs <strong>${volumeText(o)}</strong>.</p>
    <div class="days-grid">${days.map((d) => dayButton(d, o)).join('')}</div>
    <p class="alert" role="alert" hidden></p>
    <button type="button" class="btn btn-ghost picker-cancel">Cancel</button>
  </div>`
  const picker = slot.firstElementChild
  picker.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button')
    if (!b) return
    if (b.matches('.picker-cancel')) { closePicker(slot, button); button.focus(); return }
    if (!b.matches('.day') || b.disabled || picker.dataset.busy) return
    const alert = picker.querySelector('.alert')
    alert.hidden = true
    alert.textContent = ''
    picker.dataset.busy = '1'
    b.setAttribute('aria-busy', 'true')
    try {
      const r = await api.schedule(o.id, b.dataset.date)
      closePicker(slot, button)
      toast(`Scheduled for ${r.order.delivery_label}`)
      await refresh()
    } catch (e) {
      alert.textContent = e.message
      alert.hidden = false
    } finally {
      delete picker.dataset.busy
      b.removeAttribute('aria-busy')
    }
  })
}

/* ---------- order detail ---------- */

const detailEl = () => $('#detail')

function closeDetail() {
  openId = null
  phoneForm = null
  delete $('#panel-orders').dataset.open
  detailEl().innerHTML = '<p class="detail-empty">Pick an order to see it here.</p>'
  renderBoard()
}

async function openOrder(id, { scroll = true } = {}) {
  openId = id
  phoneForm = null
  $('#panel-orders').dataset.open = 'order'
  for (const b of document.querySelectorAll('.card-open')) b.setAttribute('aria-pressed', String(b.closest('.order-card').dataset.order === id))
  if (scroll) {
    detailEl().innerHTML = '<p class="detail-empty">Loading the order…</p>'
    if (matchMedia('(max-width: 899px)').matches) window.scrollTo(0, 0)
  }
  try {
    const r = await api.order(id)
    if (openId !== id) return
    renderDetail(r)
  } catch (e) {
    if (e.status === 401) return
    detailEl().innerHTML = `<p class="alert" role="alert">${esc(e.message)}</p>`
  }
}

function balanceKind(cents) {
  return cents > 0 ? 'owing' : cents < 0 ? 'credit' : 'paid'
}

function renderDetail({ order: o, customer: c, payments, messages }) {
  const statusLink = `${location.origin}/o/?t=${o.token}`
  const row = (k, v) => (v ? `<div><dt>${k}</dt><dd>${v}</dd></div>` : '')
  const line = (k, cents, cls = '') => `<div class="row ${cls}"><span>${k}</span><span>${money(cents)}</span></div>`
  const methodOptions = Object.entries(METHODS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')

  detailEl().innerHTML = `
  <div class="detail-head">
    <button type="button" class="btn btn-ghost back" data-action="back">${icon.back}<span>Back to orders</span></button>
    <div class="detail-title"><h2 tabindex="-1" id="detail-title">${esc(o.name)}</h2><span class="pill status" data-status="${esc(o.status)}">${esc(o.status_label)}</span></div>
  </div>

  <section class="detail-sec">
    <h3>Customer</h3>
    <p class="detail-line"><a class="tel" href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${icon.phone}<span>${esc(c.phone)}</span></a></p>
    <p class="balance" id="customer-balance" data-kind="${balanceKind(c.balance_cents)}">${balanceLabel(c.balance_cents)}</p>
    <span class="field-label">Their order link</span>
    <div class="link-row"><input class="input" readonly value="${esc(statusLink)}" aria-label="The customer's order link"><button type="button" class="btn btn-secondary" data-action="copy-link">Copy link</button></div>
  </section>

  <section class="detail-sec">
    <h3>Order</h3>
    <dl class="kv">
      ${row('What', esc(o.product_label))}
      ${row('How much', `${esc(o.qty_label)} <span class="chip vol" data-kind="${esc(o.kind)}">${volumeText(o)}</span>`)}
      ${o.kind === 'wood' ? row('Stacking', o.stacking ? 'Yes' : 'No') : ''}
      ${row('Where', `${esc(o.address)}<span class="explain-inline">${Number(o.distance_km).toFixed(1)} km from the yard, as the crow flies</span>`)}
      ${row('Dump spot notes', esc(o.dump_notes))}
      ${row('Days that suit', esc(o.preferred_label))}
      ${row('Delivery day', o.delivery_date ? `${esc(o.delivery_label)}${o.route_pos ? `, stop ${o.route_pos}` : ''}` : '')}
      ${row('Delivered', esc(o.delivered_label))}
      ${row('At the door', o.door_payment ? esc(o.door_payment === 'owes' ? 'Owes' : METHODS[o.door_payment] || o.door_payment) : '')}
      ${row('Note', esc(o.note))}
      ${row('Came in', `${o.source === 'phone' ? 'Phone order' : 'Online'}, ${esc(o.created_label)}`)}
    </dl>
    ${canSchedule(o) ? `<div class="detail-actions">
      <button type="button" class="btn btn-secondary schedule-btn" data-action="schedule" aria-expanded="false">${o.status === 'requested' ? 'Schedule' : 'Change day'}</button>
      ${o.status === 'scheduled' ? '<button type="button" class="btn btn-ghost" data-action="unschedule">Take off the schedule</button>' : ''}
    </div>
    <p class="alert" data-error-for="unschedule" role="alert" hidden></p>
    <div class="picker-slot detail-picker"></div>` : ''}
  </section>

  <section class="detail-sec">
    <h3>Money</h3>
    <div class="money-rows">
      ${line('Goods', o.goods_cents)}
      ${o.stacking_cents ? line('Stacking', o.stacking_cents) : ''}
      ${line('Delivery', o.delivery_cents)}
      ${line('Subtotal', o.subtotal_cents)}
      ${line('HST', o.hst_cents)}
      ${line('Total', o.total_cents, 'total')}
      ${line('Paid', o.paid_cents)}
    </div>
    <p class="owing-big" id="detail-owing" data-kind="${balanceKind(o.owing_cents)}">${o.owing_cents > 0 ? `Owing ${money(o.owing_cents)}` : o.owing_cents < 0 ? `Credit ${money(-o.owing_cents)}` : 'Paid in full'}</p>
  </section>

  <section class="detail-sec">
    <h3>Payments</h3>
    ${payments.length ? `<ul class="payments">${payments.map((p) => `<li data-voided="${!!p.voided}">
        <span>${esc(p.date)} · ${esc(METHODS[p.method] || p.method)}${p.source === 'door' ? ' at the door' : ''}${p.note ? ` · ${esc(p.note)}` : ''}${p.voided ? ' · Voided' : ''}</span>
        <strong>${money(p.amount_cents)}</strong></li>`).join('')}</ul>` : '<p class="small">No payments on this order yet.</p>'}
    <form class="pay-form" id="pay-form" novalidate>
      <h4>Record a payment</h4>
      <p class="small">For money you already have. This page takes no payments.</p>
      <div class="pay-grid">
        <label class="field"><span class="field-label">Amount</span>
          <span class="money-input"><span aria-hidden="true">$</span><input id="pay-amount" class="input" inputmode="decimal" autocomplete="off" data-field="amount_cents" placeholder="${o.owing_cents > 0 ? esc(money(o.owing_cents).slice(1)) : '0.00'}"></span>
          <p class="error" data-error-for="amount_cents" role="alert" hidden></p></label>
        <label class="field"><span class="field-label">How they paid</span>
          <select id="pay-method" class="input" data-field="method">${methodOptions}</select>
          <p class="error" data-error-for="method" role="alert" hidden></p></label>
        <label class="field"><span class="field-label">Date</span>
          <input id="pay-date" class="input" type="date" data-field="date" ${info?.today ? `value="${esc(info.today)}" max="${esc(info.today)}"` : ''}>
          <p class="error" data-error-for="date" role="alert" hidden></p></label>
        <label class="field"><span class="field-label">Note (optional)</span>
          <input id="pay-note" class="input" data-field="note" maxlength="200">
          <p class="error" data-error-for="note" role="alert" hidden></p></label>
      </div>
      <p class="alert" data-error-for="form" role="alert" hidden></p>
      <button type="submit" class="btn btn-primary" id="pay-submit">Record a payment</button>
    </form>
  </section>

  <section class="detail-sec">
    <h3>Messages</h3>
    <p class="small">Nothing is sent from here. Copy the text and send it from your own phone.</p>
    ${messages.length ? messages.map((m, i) => `<div class="message" data-kind="${esc(m.kind)}">
        <p class="message-label">${esc(m.label)}</p>
        <p class="message-text">${esc(m.text)}</p>
        <button type="button" class="btn btn-secondary" data-action="copy-text" data-i="${i}">Copy text</button>
      </div>`).join('') : '<p class="small">No message for this order right now.</p>'}
  </section>`

  const root = detailEl()
  root.onclick = async (ev) => {
    const b = ev.target.closest('button[data-action]')
    if (!b) return
    const action = b.dataset.action
    if (action === 'back') closeDetail()
    else if (action === 'copy-link') copyButton(b, statusLink)
    else if (action === 'copy-text') copyButton(b, messages[Number(b.dataset.i)].text)
    else if (action === 'schedule') togglePicker(root.querySelector('.detail-picker'), o, b)
    else if (action === 'unschedule') {
      clearErrors(root)
      b.disabled = true
      try {
        await api.unschedule(o.id)
        toast('Taken off the schedule')
        await refresh()
      } catch (e) {
        showError(root, 'unschedule', e.message)
      } finally {
        b.disabled = false
      }
    }
  }
  root.querySelector('#pay-form').addEventListener('submit', (ev) => recordPayment(ev, o, c))
}

async function recordPayment(ev, o, c) {
  ev.preventDefault()
  const form = ev.currentTarget
  clearErrors(form)
  const cents = dollarsToCents(form.querySelector('#pay-amount').value)
  if (cents === null || cents < 1) {
    showError(form, 'amount_cents', 'Enter the amount in dollars, like 100.00.')
    return
  }
  const body = { customer_id: c.id, order_id: o.id, amount_cents: cents, method: form.querySelector('#pay-method').value }
  const date = form.querySelector('#pay-date').value
  const note = form.querySelector('#pay-note').value.trim()
  if (date) body.date = date
  if (note) body.note = note
  const button = form.querySelector('#pay-submit')
  button.disabled = true
  try {
    await api.recordPayment(body)
    toast(`Payment of ${money(cents)} recorded`)
    await refresh()
  } catch (e) {
    if (!showError(form, e.field, e.message)) showError(form, 'form', e.message)
  } finally {
    button.disabled = false
  }
}

async function refresh() {
  await loadBoard()
  if (openId) await openOrder(openId, { scroll: false })
}

/* ---------- phone order ---------- */

function openPhoneOrder() {
  openId = null
  $('#panel-orders').dataset.open = 'phone'
  for (const b of document.querySelectorAll('.card-open')) b.setAttribute('aria-pressed', 'false')
  if (!info) {
    detailEl().innerHTML = '<p class="alert" role="alert">The order form needs the dealer settings. Reload the page and try again.</p>'
    return
  }
  const root = detailEl()
  root.onclick = null
  root.innerHTML = `
    <div class="detail-head">
      <button type="button" class="btn btn-ghost back" id="phone-back">${icon.back}<span>Back to orders</span></button>
      <div class="detail-title"><h2 tabindex="-1" id="phone-title">Add a phone order</h2></div>
      <p class="small">What the customer tells you on the phone. It goes under New, marked as a phone order.</p>
    </div>
    <div id="phone-form" class="phone-form"></div>
    <div class="phone-footer">
      <div id="phone-price" class="price"></div>
      <p class="alert" data-error-for="form" role="alert" hidden></p>
      <button type="button" id="save-phone-order" class="btn btn-primary wide">Save phone order</button>
    </div>`
  const override = () => {
    const text = root.querySelector('#delivery-fee')?.value.trim()
    const cents = text ? dollarsToCents(text) : null
    return cents
  }
  const renderPrice = () => phoneForm && phoneForm.renderPrice(root.querySelector('#phone-price'), { deliveryOverride: override() })
  phoneForm = createOrderForm(root.querySelector('#phone-form'), { info, mode: 'dealer', onChange: renderPrice })
  phoneForm.mountMap()
  renderPrice()
  root.querySelector('#delivery-fee')?.addEventListener('input', renderPrice)
  root.querySelector('#phone-back').addEventListener('click', closeDetail)
  root.querySelector('#save-phone-order').addEventListener('click', savePhoneOrder)
  if (matchMedia('(max-width: 899px)').matches) window.scrollTo(0, 0)
  root.querySelector('#phone-title').focus({ preventScroll: true })
}

async function savePhoneOrder() {
  const root = detailEl()
  const form = phoneForm
  clearErrors(root)
  const body = form.body()
  const feeText = root.querySelector('#delivery-fee')?.value.trim()
  if (feeText) {
    const cents = dollarsToCents(feeText)
    if (cents === null) {
      showError(root, 'delivery_cents', 'Enter the fee in dollars, like 25.00, or leave it blank.')
      root.querySelector('[data-error-for="delivery_cents"]').scrollIntoView({ block: 'center' })
      return
    }
    body.delivery_cents = cents
  }
  const button = root.querySelector('#save-phone-order')
  button.disabled = true
  try {
    const r = await api.phoneOrder(body)
    toast('Phone order saved')
    bucket = 'new'
    await loadBoard()
    await openOrder(r.id)
  } catch (e) {
    const slot = e.field && FIELD_STEP[e.field] ? showError(root, e.field, e.message) : null
    if (slot) slot.scrollIntoView({ block: 'center' })
    else showError(root, 'form', e.message)
  } finally {
    button.disabled = false
  }
}

/* ---------- toast ---------- */

let toastTimer = null
function toast(text) {
  const el = $('#toast')
  el.textContent = text
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.hidden = true }, 3000)
}

start()
