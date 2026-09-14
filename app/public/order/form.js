// The order form, shared by the customer's five-step page (/) and the dealer's "Add a phone order". It renders the five
// sections (What · How much · Where · When · You), keeps the choices, asks POST /api/quote (debounced 300 ms) whenever a
// priced choice changes, and puts API errors under the input the API names. Every number shown comes from the quote:
// before the map is tapped the quote is asked with no pin, and the API answers goods and stacking with no delivery, HST or
// total (docs/API.md). A dealer's fee override goes on the quote too, so the total shown is the one that will be saved.
// Leaflet is the vendored global `L`.

import { api } from '/api.js'
import { esc, money, icon, clearErrors, showError } from '/ui.js'

/** Which step holds the input each API `field` names. */
export const FIELD_STEP = {
  product_id: 1, unit: 2, qty: 2, stacking: 2, pin: 3, zone_id: 3, address: 3, dump_notes: 3, delivery_cents: 3,
  preferred: 4, name: 5, phone: 5, note: 5,
}
const QUOTE_FIELDS = ['product_id', 'unit', 'qty', 'stacking', 'pin', 'zone_id', 'delivery_cents']
const UNIT_TITLE = { cord: 'Cord', half_cord: 'Half cord', face_cord: 'Face cord', load: 'Load', bag: 'Bag', ton: 'Ton', skid: 'Skid' }
const UNIT_EACH = { cord: 'a cord', half_cord: 'a half cord', face_cord: 'a face cord', load: 'a load', bag: 'a bag', ton: 'a ton', skid: 'a skid' }

const errorSlot = (field, alert = false) => `<p class="error" data-error-for="${field}"${alert ? ' role="alert"' : ''} hidden></p>`

function productButton(p) {
  // The cheapest unit on offer, named: "from $120.00 a face cord" and "from $220.00 a cord" are different units, and without
  // the unit green wood looked dearer than dry.
  const from = p.units.reduce((a, b) => (b.price_cents < a.price_cents ? b : a))
  const chips = p.kind === 'wood'
    ? [p.dryness === 'green' ? 'Green' : 'Dry', `${p.cut_in} in`, p.split ? 'Split' : 'Not split']
    : [`${p.bag_lb} lb bags`]
  return `<button type="button" class="product" data-product="${esc(p.id)}" data-kind="${esc(p.kind)}" aria-pressed="false">
    <span class="product-icon">${icon[p.kind] || ''}</span>
    <span class="product-body">
      <span class="product-name">${esc(p.name)}</span>
      <span class="product-sub">${esc(p.kind === 'wood' ? p.species : p.brand)}</span>
      <span class="chips">${chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</span>
    </span>
    <span class="product-price">from <strong>${money(from.price_cents)}</strong> ${esc(UNIT_EACH[from.unit] || '')}</span>
  </button>`
}

export function createOrderForm(root, { info, mode = 'customer', onChange = () => {}, deliveryOverride = () => null }) {
  const dealer = mode === 'dealer'
  const zones = info.delivery?.mode === 'zones'
  const state = {
    product: null, unit: null, qty: 1, stacking: false, pin: null, zone_id: null, any: false, dates: [],
    quote: null, quoteError: null, provisional: true,
  }

  root.innerHTML = `
  <section class="step" data-step="1" aria-labelledby="h-step1">
    <h2 id="h-step1" class="step-title" tabindex="-1">${dealer ? 'What would they like?' : 'What would you like?'}</h2>
    <div class="products">${info.products.map(productButton).join('')}</div>
    ${errorSlot('product_id', true)}
  </section>

  <section class="step" data-step="2" aria-labelledby="h-step2">
    <h2 id="h-step2" class="step-title" tabindex="-1">How much?</h2>
    <p class="step-note" id="units-none">Pick what you would like first.</p>
    <div class="units" role="radiogroup" aria-label="Amount" data-field="unit"></div>
    <p class="explain" id="unit-explain" aria-live="polite" hidden></p>
    ${errorSlot('unit', true)}
    <div class="qty-row" hidden>
      <span class="field-label" id="qty-label">How many</span>
      <div class="stepper" role="group" aria-labelledby="qty-label">
        <button type="button" id="qty-minus" class="step-btn" aria-label="One less">${icon.minus}</button>
        <output id="qty" class="qty-value" data-field="qty" aria-live="polite">1</output>
        <button type="button" id="qty-plus" class="step-btn" aria-label="One more">${icon.plus}</button>
      </div>
    </div>
    ${errorSlot('qty', true)}
    <button type="button" id="stacking" class="toggle-row" role="switch" aria-checked="false" data-field="stacking" hidden>
      <span class="toggle-text"><span class="toggle-title">Stack it for you</span><span class="toggle-sub" id="stacking-price"></span></span>
      <span class="switch" aria-hidden="true"><span></span></span>
    </button>
    ${errorSlot('stacking', true)}
  </section>

  <section class="step" data-step="3" aria-labelledby="h-step3">
    <h2 id="h-step3" class="step-title" tabindex="-1">Where should we drop it?</h2>
    <p class="map-hint" id="map-hint">Tap the map where the truck should dump it</p>
    <div class="map-wrap"><div id="map" data-field="pin" role="application" aria-label="Map. Tap where the truck should dump it."></div></div>
    <p class="distance" id="distance" hidden></p>
    ${errorSlot('pin', true)}
    ${zones ? `<label class="field"><span class="field-label">Delivery zone</span>
      <select id="zone" class="input" data-field="zone_id"><option value="">Pick your area</option>${info.delivery.zones.map((z) => `<option value="${esc(z.id)}">${esc(z.name)} (${money(z.fee_cents)})</option>`).join('')}</select>
      ${errorSlot('zone_id', true)}</label>` : ''}
    <label class="field"><span class="field-label">Address or directions</span>
      <input id="address" class="input" data-field="address" maxlength="120" autocomplete="street-address" placeholder="The road, and what it's near">
      ${errorSlot('address', true)}</label>
    <label class="field"><span class="field-label">Dump spot notes</span>
      <textarea id="dump-notes" class="input" data-field="dump_notes" maxlength="200" rows="2" placeholder="By the shed, not on the lawn"></textarea>
      ${errorSlot('dump_notes', true)}</label>
    ${dealer ? `<label class="field"><span class="field-label">Delivery fee (optional)</span>
      <input id="delivery-fee" class="input" data-field="delivery_cents" inputmode="decimal" placeholder="Leave blank for the usual fee">
      <span class="field-help">Only if you're charging something different from the distance fee.</span>
      ${errorSlot('delivery_cents', true)}</label>` : ''}
  </section>

  <section class="step" data-step="4" aria-labelledby="h-step4">
    <h2 id="h-step4" class="step-title" tabindex="-1">Which days suit you?</h2>
    <p class="step-note">Pick as many as you like, up to 7. We'll let you know the day we can come.</p>
    <button type="button" id="any-day" class="any-day" aria-pressed="false" data-field="preferred">Any day</button>
    <div class="days">${info.delivery_dates.map((d) => {
      const [wd, ...rest] = d.label.split(' ')
      return `<button type="button" class="day" data-date="${esc(d.date)}" aria-pressed="false" aria-label="${esc(d.long_label)}"><span class="day-wd">${esc(wd)}</span><span class="day-dm">${esc(rest.join(' '))}</span></button>`
    }).join('')}</div>
    ${errorSlot('preferred', true)}
  </section>

  <section class="step" data-step="5" aria-labelledby="h-step5">
    <h2 id="h-step5" class="step-title" tabindex="-1">${dealer ? 'Who is it for?' : 'About you'}</h2>
    <label class="field"><span class="field-label">${dealer ? 'Customer name' : 'Your name'}</span>
      <input id="name" class="input" data-field="name" maxlength="80" autocomplete="${dealer ? 'off' : 'name'}">
      ${errorSlot('name', true)}</label>
    <label class="field"><span class="field-label">Phone number</span>
      <input id="phone" class="input" data-field="phone" type="tel" maxlength="32" autocomplete="${dealer ? 'off' : 'tel'}" placeholder="709-555-0142">
      ${errorSlot('phone', true)}</label>
    <label class="field"><span class="field-label">Anything else? (optional)</span>
      <textarea id="note" class="input" data-field="note" maxlength="280" rows="2"></textarea>
      ${errorSlot('note', true)}</label>
  </section>`

  const $ = (sel) => root.querySelector(sel)
  const product = () => info.products.find((p) => p.id === state.product) || null
  const unitOf = () => product()?.units.find((u) => u.unit === state.unit) || null

  /* ---- quote --------------------------------------------------------- */
  let timer = null
  let dirty = false
  let seq = 0
  let inflight = Promise.resolve()

  function clearQuoteErrors() {
    for (const f of QUOTE_FIELDS) {
      const slot = root.querySelector(`[data-error-for="${f}"]`)
      if (slot) { slot.textContent = ''; slot.hidden = true }
      root.querySelector(`[data-field="${f}"]`)?.removeAttribute('aria-invalid')
    }
  }

  async function runQuote() {
    clearTimeout(timer)
    dirty = false
    const mine = ++seq
    const p = product()
    if (!p || !unitOf()) { state.quote = null; state.quoteError = null; onChange(state); return }
    const body = { product_id: p.id, unit: state.unit, qty: state.qty, stacking: state.stacking, zone_id: state.zone_id }
    if (state.pin) {
      body.lat = state.pin.lat
      body.lng = state.pin.lng
    }
    const fee = deliveryOverride()
    if (fee !== null && fee !== undefined) body.delivery_cents = fee
    try {
      const q = await api.quote(body)
      if (mine !== seq) return
      state.quote = q
      state.quoteError = null
      state.provisional = q.total_cents === null
      clearQuoteErrors()
    } catch (e) {
      if (mine !== seq) return
      state.quote = null
      state.quoteError = e
      clearQuoteErrors()
      if (e.field && !(e.field === 'pin' && !state.pin)) showError(root, e.field, e.message)
    }
    const d = $('#distance')
    if (state.pin && state.quote) {
      d.textContent = `${state.quote.distance_km.toFixed(1)} km from our yard, as the crow flies`
      d.hidden = false
    } else d.hidden = true
    onChange(state)
  }

  function requote() {
    dirty = true
    clearTimeout(timer)
    timer = setTimeout(() => { inflight = runQuote() }, 300)
    onChange(state)
  }

  /** Wait for the latest quote (sends a pending one now). */
  function settle() {
    if (dirty) inflight = runQuote()
    return inflight
  }

  /* ---- choices ------------------------------------------------------- */
  function renderUnits() {
    const p = product()
    $('#units-none').hidden = !!p
    $('.qty-row').hidden = !p
    $('.units').innerHTML = p
      ? p.units.map((u) => `<button type="button" class="unit" role="radio" data-unit="${esc(u.unit)}" aria-checked="${u.unit === state.unit}">
          <span class="unit-name">${esc(UNIT_TITLE[u.unit] || u.unit)}</span><span class="unit-price">${money(u.price_cents)} <span>${esc(UNIT_EACH[u.unit] || '')}</span></span></button>`).join('')
      : ''
    const u = unitOf()
    $('#unit-explain').textContent = u ? u.explain : ''
    $('#unit-explain').hidden = !u
    const stack = p && p.kind === 'wood' && p.stacking_cents_per_cord !== null && p.stacking_cents_per_cord !== undefined
    $('#stacking').hidden = !stack
    if (!stack) state.stacking = false
    $('#stacking').setAttribute('aria-checked', String(state.stacking))
    renderStackingPrice()
  }

  function renderStackingPrice() {
    const p = product()
    if (!p || p.kind !== 'wood' || p.stacking_cents_per_cord == null) return
    const q = state.quote
    $('#stacking-price').textContent = state.stacking && q
      ? `${money(q.stacking_cents)} for this order`
      : `${money(p.stacking_cents_per_cord)} a cord, in neat rows where you want it`
  }

  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('button')
    if (!b || !root.contains(b)) return
    if (b.matches('.product')) {
      const changed = state.product !== b.dataset.product
      state.product = b.dataset.product
      for (const x of root.querySelectorAll('.product')) x.setAttribute('aria-pressed', String(x === b))
      if (changed) { state.unit = product().units[0]?.unit || null; state.qty = 1; $('#qty').textContent = '1' }
      clearErrors(root.querySelector('[data-step="1"]'))
      renderUnits()
      requote()
    } else if (b.matches('.unit')) {
      state.unit = b.dataset.unit
      renderUnits()
      requote()
    } else if (b.id === 'qty-minus' || b.id === 'qty-plus') {
      state.qty = Math.min(20, Math.max(1, state.qty + (b.id === 'qty-plus' ? 1 : -1)))
      $('#qty').textContent = String(state.qty)
      $('#qty-minus').disabled = state.qty <= 1
      $('#qty-plus').disabled = state.qty >= 20
      requote()
    } else if (b.id === 'stacking') {
      state.stacking = !state.stacking
      b.setAttribute('aria-checked', String(state.stacking))
      renderStackingPrice()
      requote()
    } else if (b.id === 'any-day') {
      state.any = !state.any
      if (state.any) state.dates = []
      renderDays()
    } else if (b.matches('.day')) {
      const d = b.dataset.date
      if (state.dates.includes(d)) state.dates = state.dates.filter((x) => x !== d)
      else if (state.dates.length < 7) state.dates = [...state.dates, d]
      if (state.dates.length) state.any = false
      renderDays()
    }
  })
  $('#qty-minus').disabled = true

  function renderDays() {
    $('#any-day').setAttribute('aria-pressed', String(state.any))
    for (const x of root.querySelectorAll('.day')) x.setAttribute('aria-pressed', String(state.dates.includes(x.dataset.date)))
    if (state.any || state.dates.length) clearErrors(root.querySelector('[data-step="4"]'))
    onChange(state)
  }

  $('#zone')?.addEventListener('change', (ev) => { state.zone_id = ev.target.value || null; requote() })
  for (const input of root.querySelectorAll('.input')) {
    input.addEventListener('input', () => {
      const slot = input.closest('.field')?.querySelector('[data-error-for]')
      if (slot && !QUOTE_FIELDS.includes(slot.dataset.errorFor)) { slot.hidden = true; slot.textContent = ''; input.removeAttribute('aria-invalid') }
    })
  }

  /* ---- map ----------------------------------------------------------- */
  let map = null
  let marker = null

  function setPin(latlng) {
    state.pin = { lat: Math.round(latlng.lat * 1e6) / 1e6, lng: Math.round(latlng.lng * 1e6) / 1e6 }
    if (!marker) {
      marker = L.marker([state.pin.lat, state.pin.lng], { draggable: true, autoPan: true, keyboard: true, title: 'Dump spot' }).addTo(map)
      marker.on('dragend', () => setPin(marker.getLatLng()))
    } else marker.setLatLng([state.pin.lat, state.pin.lng])
    $('#map-hint').textContent = "Drag the pin if it isn't quite right."
    $('#map-hint').classList.add('done')
    requote()
  }

  function mountMap() {
    if (map) { map.invalidateSize(); return }
    L.Icon.Default.imagePath = '/vendor/leaflet/images/'
    // Zoom buttons go bottom-left, out of the upper corner: on a phone, WebKit moves a tap that lands a few pixels
    // beside a control onto the control (touch adjustment), so a pin dropped near them zoomed the map instead.
    map = L.map($('#map'), { center: [info.yard.lat, info.yard.lng], zoom: 10, scrollWheelZoom: false, tapHold: false, zoomControl: false })
    L.control.zoom({ position: 'bottomleft' }).addTo(map)
    map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>')
    L.tileLayer(info.map.tiles, { attribution: info.map.attribution, maxZoom: 18 }).addTo(map)
    L.circleMarker([info.yard.lat, info.yard.lng], { radius: 8, color: '#1a0e02', weight: 2, fillColor: '#fb923c', fillOpacity: 1 })
      .addTo(map).bindTooltip(esc(info.yard.label))
    map.on('click', (ev) => setPin(ev.latlng))
  }

  /* ---- the outside ---------------------------------------------------- */
  function body() {
    const val = (sel) => ($(sel)?.value ?? '').trim()
    return {
      product_id: state.product, unit: state.unit, qty: state.qty, stacking: state.stacking,
      lat: state.pin?.lat ?? null, lng: state.pin?.lng ?? null,
      address: val('#address'), dump_notes: val('#dump-notes'), zone_id: state.zone_id,
      preferred: state.any ? { any: true } : { any: false, dates: [...state.dates].sort() },
      name: val('#name'), phone: val('#phone'), note: val('#note'),
    }
  }

  /** Checks that need no server before moving on; the quote's own errors stop the step too. */
  async function validateStep(n) {
    const section = root.querySelector(`[data-step="${n}"]`)
    if (n === 1) {
      if (!state.product) { showError(section, 'product_id', 'Choose what you would like.'); return false }
      return true
    }
    if (n === 2) {
      await settle()
      return !(state.quoteError && ['unit', 'qty', 'stacking', 'product_id'].includes(state.quoteError.field))
    }
    if (n === 3) {
      if (!state.pin) { showError(section, 'pin', 'Tap the map where the truck should dump it.'); return false }
      await settle()
      if (state.quoteError) {
        if (state.quoteError.field && FIELD_STEP[state.quoteError.field] === 3) return false
      }
      if (zones && !state.zone_id) { showError(section, 'zone_id', 'Pick your area.'); return false }
      if (!body().address) { showError(section, 'address', 'Tell us where to find the place, like the road and what it is near.'); return false }
      return true
    }
    if (n === 4) {
      if (!state.any && !state.dates.length) { showError(section, 'preferred', 'Pick the days that suit you, or Any day.'); return false }
      return true
    }
    return true
  }

  /** Put an API error under its input. Returns the step that holds it (null when it belongs to no input). */
  function showApiError(e) {
    const step = e.field ? FIELD_STEP[e.field] ?? null : null
    if (step) showError(root, e.field, e.message)
    return step
  }

  /** Price lines from the latest quote into container: goods, stacking, delivery, HST and #quote-total. */
  function renderPrice(container) {
    const q = state.quote
    const p = product()
    let lines = ''
    let total = '—'
    if (!p) {
      lines = '<span class="price-empty">Pick what you would like to see the price.</span>'
    } else if (!q) {
      lines = `<span class="price-empty">${dirty ? 'Working out the price…' : state.quoteError ? 'Fix the note above to see the price.' : 'Working out the price…'}</span>`
    } else {
      const item = (label, value, id) => `<span class="price-item"${id ? ` id="${id}"` : ''}><span>${label}</span> <strong>${value}</strong></span>`
      const pinned = !state.provisional
      lines = [
        item('Goods', money(q.goods_cents), 'quote-goods'),
        state.stacking ? item('Stacking', money(q.stacking_cents), 'quote-stacking') : '',
        pinned ? item('Delivery', q.delivery_cents === 0 ? 'Free' : money(q.delivery_cents), 'quote-delivery') : item('Delivery', 'after the map pin', 'quote-delivery'),
        pinned ? item('HST', money(q.hst_cents), 'quote-hst') : '',
      ].join('')
      if (pinned) total = money(q.total_cents)
    }
    container.innerHTML = `<div class="price-lines">${lines}</div><div class="price-total"><span>Total</span><strong id="quote-total" aria-live="polite">${total}</strong></div>`
    container.classList.toggle('stale', dirty)
  }

  function showStep(n) {
    for (const s of root.querySelectorAll('.step')) s.hidden = Number(s.dataset.step) !== n
  }

  return { state, root, body, settle, validateStep, showApiError, renderPrice, showStep, mountMap, product, requote }
}
