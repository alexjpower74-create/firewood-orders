// The customer's order page (/): five steps, a sticky price bar with the live quote and the step's button, the
// season-closed screen, and "Request sent" with the status link.

import { api } from '/api.js'
import { esc, money, icon, showDealer, copyButton, clearErrors, showError } from '/ui.js'
import { createOrderForm } from '/order/form.js'

const $ = (sel) => document.querySelector(sel)
let info = null
let form = null
let step = 1

async function start() {
  try {
    info = await api.info()
  } catch (e) {
    $('#loading').textContent = e.message
    return
  }
  showDealer(info)
  $('#loading').hidden = true
  if (!info.season_open) return showClosed()

  $('#order').hidden = false
  $('#bar').hidden = false
  $('#progress').hidden = false
  form = createOrderForm($('#form'), { info, mode: 'customer', onChange: () => form && form.renderPrice($('#price')) })
  form.renderPrice($('#price'))
  $('#next').addEventListener('click', next)
  $('#back').addEventListener('click', () => go(step - 1))
  $('#send').addEventListener('click', send)
  keepBarClear()
  go(1)
}

function go(n, { focus = true } = {}) {
  step = Math.min(5, Math.max(1, n))
  form.showStep(step)
  for (const li of document.querySelectorAll('#progress li')) {
    const k = Number(li.dataset.step)
    li.dataset.state = k < step ? 'done' : k === step ? 'current' : 'todo'
    if (k === step) li.setAttribute('aria-current', 'step')
    else li.removeAttribute('aria-current')
  }
  $('#back').hidden = step === 1
  $('#next').hidden = step === 5
  $('#send').hidden = step !== 5
  if (step === 3) form.mountMap()
  if (focus) {
    window.scrollTo(0, 0)
    document.getElementById(`h-step${step}`)?.focus({ preventScroll: true })
  }
}

async function next() {
  const button = $('#next')
  button.disabled = true
  try {
    if (await form.validateStep(step)) go(step + 1)
  } finally {
    button.disabled = false
  }
}

async function send() {
  const button = $('#send')
  clearErrors(document)
  button.disabled = true
  button.textContent = 'Sending…'
  try {
    const r = await api.placeOrder(form.body())
    showSent(r)
  } catch (e) {
    const at = form.showApiError(e)
    if (at) {
      go(at, { focus: false })
      form.showApiError(e)
      document.querySelector(`[data-error-for="${e.field}"]`)?.scrollIntoView({ block: 'center' })
    } else {
      showError(document.querySelector('#bar'), 'form', e.message)
    }
  } finally {
    button.disabled = false
    button.textContent = 'Send request'
  }
}

function showSent(r) {
  $('#order').hidden = true
  $('#bar').hidden = true
  $('#progress').hidden = true
  const link = `${location.origin}${r.status_url}`
  const q = r.quote
  $('#sent').hidden = false
  $('#sent').innerHTML = `
    <div class="sent-check" aria-hidden="true">${icon.checkBig}</div>
    <h1 class="page-title" tabindex="-1" id="sent-title">Request sent</h1>
    <p class="lead">We have your order for ${esc(q.qty_label)} of ${esc(q.product_label)}. We'll be in touch to set the day.</p>
    <div class="card sent-total"><span>Total</span><strong>${money(q.total_cents)}</strong></div>
    <p class="field-label">Keep this link to check on your order.</p>
    <div class="link-row">
      <input id="status-link" class="input" readonly value="${esc(link)}" aria-label="Your order link">
      <button type="button" id="copy-link" class="btn btn-secondary">Copy link</button>
    </div>
    <a class="btn btn-primary wide" href="${esc(r.status_url)}">See my order</a>
    <p class="small">${esc(info.deposit_text)}</p>`
  $('#copy-link').addEventListener('click', (ev) => copyButton(ev.currentTarget, link))
  $('#status-link').addEventListener('focus', (ev) => ev.target.select())
  window.scrollTo(0, 0)
  $('#sent-title').focus({ preventScroll: true })
}

function showClosed() {
  $('#closed').hidden = false
  $('#closed-message').textContent = info.season_message
  const tel = $('#closed-phone')
  tel.hidden = !info.phone
  tel.href = `tel:${info.phone.replace(/[^\d+]/g, '')}`
  tel.textContent = `Call ${info.phone}`
}

// The sticky price bar must never sit over the field being typed in: the page scrolls focused inputs clear of it.
function keepBarClear() {
  const bar = $('#bar')
  const set = () => document.documentElement.style.setProperty('--bar-h', `${bar.offsetHeight}px`)
  new ResizeObserver(set).observe(bar)
  set()
  document.addEventListener('focusin', (ev) => {
    const el = ev.target
    if (!el.matches?.('input, textarea, select') || bar.contains(el)) return
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect()
      const limit = (window.visualViewport?.height ?? window.innerHeight) - bar.offsetHeight - 12
      if (r.bottom > limit) window.scrollBy(0, r.bottom - limit)
    })
  })
}

start()
