// The customer's status page (/o/?t=<token>): the status pill and timeline, the order, the money and balance owing,
// the dealer's deposit text, the delivery photo. Polls every 30 s and whenever the page comes back into view.

import { api } from '/api.js'
import { esc, money, icon, showDealer } from '/ui.js'

const $ = (sel) => document.querySelector(sel)
const token = new URLSearchParams(location.search).get('t') || ''
const STEPS = [
  ['requested', 'Requested'],
  ['scheduled', 'Scheduled'],
  ['out_for_delivery', 'Out for delivery'],
  ['delivered', 'Delivered'],
]
const NO_PAYMENTS = 'This page takes no payments.'
let shown = false
let loading = false

function tel(el, phone, text) {
  if (!phone) { el.hidden = true; return }
  el.href = `tel:${phone.replace(/[^\d+]/g, '')}`
  el.innerHTML = `${icon.phone}<span>${esc(text)}</span>`
  el.hidden = false
}

function showMissing(dealer) {
  $('#loading').hidden = true
  $('#view').hidden = true
  $('#missing').hidden = false
  if (dealer) tel($('#missing-call'), dealer.phone, `Call ${dealer.phone}`)
}

function render({ dealer, deposit_text: depositText, order: o }) {
  showDealer(dealer)
  tel($('#call'), dealer.phone, 'Call')
  $('#loading').hidden = true
  $('#missing').hidden = true
  $('#view').hidden = false

  const pill = $('#status')
  pill.textContent = o.status_label
  pill.dataset.status = o.status
  $('#delivered-label').textContent = o.delivered_label || ''
  $('#delivered-label').hidden = !o.delivered_label

  const at = STEPS.findIndex(([s]) => s === o.status)
  $('#timeline').hidden = o.status === 'cancelled'
  $('#timeline').innerHTML = STEPS.map(([s, label], i) => {
    const state = i < at || o.status === 'delivered' ? 'done' : i === at ? 'current' : 'todo'
    return `<li data-state="${state}"${i === at ? ' aria-current="step"' : ''}><span class="dot" aria-hidden="true">${state === 'done' ? icon.check : ''}</span><span>${label}</span></li>`
  }).join('')

  $('#photo-card').hidden = !o.photo_url
  if (o.photo_url && $('#photo').getAttribute('src') !== o.photo_url) $('#photo').src = o.photo_url

  const row = (k, v) => (v ? `<div><dt>${k}</dt><dd>${v}</dd></div>` : '')
  $('#details').innerHTML = [
    row('What', esc(o.product_label)),
    row('How much', `${esc(o.qty_label)}<span class="explain-inline">${esc(o.explain)}</span>`),
    row('Stacking', o.stacking ? 'Yes, stacked for you' : 'No, dumped in a pile'),
    row('Where', esc(o.address)),
    row('Dump spot notes', esc(o.dump_notes)),
    row('Days that suit you', esc(o.preferred_label)),
    row('Ordered', esc(o.created_label)),
  ].join('')

  const line = (k, c, cls = '') => `<div class="row ${cls}"><span>${k}</span><span>${money(c)}</span></div>`
  $('#money').innerHTML = [
    line('Goods', o.goods_cents),
    o.stacking_cents ? line('Stacking', o.stacking_cents) : '',
    line('Delivery', o.delivery_cents),
    line('HST', o.hst_cents),
    line('Total', o.total_cents, 'total'),
    line('Paid', o.paid_cents),
  ].join('')
  const owing = $('#owing')
  owing.textContent = o.owing_label
  owing.dataset.kind = o.owing_cents > 0 ? 'owing' : o.owing_cents < 0 ? 'credit' : 'paid'

  const text = depositText || ''
  $('#deposit').innerHTML = `<h2 class="card-title">Paying</h2>
    ${text.includes(NO_PAYMENTS) ? '' : `<p><strong>${NO_PAYMENTS}</strong></p>`}
    ${text ? `<p>${esc(text)}</p>` : ''}`
  shown = true
}

async function load() {
  if (loading) return
  loading = true
  try {
    if (!token) {
      let dealer = null
      try { dealer = await api.info() } catch {}
      showDealer(dealer)
      return showMissing(dealer)
    }
    const r = await api.status(token)
    render(r)
    $('#refreshed').textContent = ''
  } catch (e) {
    if (e.status === 404) {
      let dealer = null
      try { dealer = await api.info() } catch {}
      showDealer(dealer)
      showMissing(dealer)
    } else if (shown) {
      $('#refreshed').textContent = "Couldn't refresh just now. We'll try again."
    } else {
      $('#loading').textContent = e.message
    }
  } finally {
    loading = false
  }
}

load()
setInterval(load, 30_000)
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load() })
