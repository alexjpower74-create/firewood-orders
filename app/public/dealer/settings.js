// The dealer's Settings tab: one form per group of settings (each saves only its own group; the API merges), products with
// a price per unit or "not sold", stock counts, and PIN changes. Numbers go to the API as typed when they aren't clean
// numbers, so the API's own message lands under the field it names (dotted for groups: delivery.bands, load.cords, …).

import { api } from '/api.js'
import { esc, money, cords, clearErrors, showError, dollarsToCents } from '/ui.js'
import { addBaseLayer } from '/map.js'

const $ = (sel, root = document) => root.querySelector(sel)
const WEEKDAYS = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [7, 'Sun'],
]
const UNITS = {
  wood: [
    ['cord', 'Cord'],
    ['half_cord', 'Half cord'],
    ['face_cord', 'Face cord'],
    ['load', 'Load'],
  ],
  pellets: [
    ['bag', 'Bag'],
    ['ton', 'Ton'],
    ['skid', 'Skid'],
  ],
}

let root = null
let info = null
let onSaved = () => {}
let data = null
let yardMap = null
let yardPoint = null

export function initSettings(el, { dealerInfo, onSaved: saved }) {
  root = el
  info = dealerInfo
  onSaved = saved || (() => {})
  root.addEventListener('submit', submit)
  root.addEventListener('click', click)
}

export async function showSettings() {
  root.innerHTML = '<p class="small">Loading the settings…</p>'
  try {
    data = await api.settings()
  } catch (e) {
    if (e.status !== 401) root.innerHTML = `<p class="alert" role="alert">${esc(e.message)}</p>`
    return
  }
  render()
}

/* ---------- small pieces ---------- */

/** A clean number becomes a number; anything else goes to the API as typed, and the API says what is wrong. */
const number = (text) => {
  const t = String(text ?? '').trim()
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t
}
/** Dollars as typed → integer cents, or the text as typed when it isn't an amount. */
const cents = (text) => {
  const t = String(text ?? '').trim()
  const c = dollarsToCents(t)
  return c === null ? t : c
}
const dollars = (c) => (c === null || c === undefined ? '' : money(c).slice(1).replace(/,/g, ''))
const err = (field) => `<p class="error" data-error-for="${esc(field)}" role="alert" hidden></p>`

const textField = (id, field, label, value, extra = '') =>
  `<label class="field"><span class="field-label">${label}</span><input id="${id}" class="input" data-field="${esc(field)}" value="${esc(value ?? '')}" ${extra}>${err(field)}</label>`
const areaField = (id, field, label, value, max) =>
  `<label class="field"><span class="field-label">${label}</span><textarea id="${id}" class="input" data-field="${esc(field)}" rows="3" maxlength="${max}">${esc(value ?? '')}</textarea>${err(field)}</label>`
const checkField = (id, field, label, checked, help = '') =>
  `<label class="check-row"><input type="checkbox" id="${id}" data-field="${esc(field)}"${checked ? ' checked' : ''}><span class="check-text"><strong>${label}</strong>${help ? `<span class="small">${help}</span>` : ''}</span></label>${err(field)}`
const moneyField = (id, field, label, value, placeholder = '0.00') =>
  `<label class="field"><span class="field-label">${label}</span><span class="money-input"><span aria-hidden="true">$</span><input id="${id}" class="input" inputmode="decimal" autocomplete="off" data-field="${esc(field)}" value="${dollars(value)}" placeholder="${esc(placeholder)}"></span>${err(field)}</label>`
const saveRow = (label = 'Save') =>
  `<p class="alert" data-error-for="form" role="alert" hidden></p><div class="save-row"><button type="submit" class="btn btn-primary">${label}</button><p class="small saved" role="status"></p></div>`

function bandRow(b = { up_to_km: '', fee_cents: null }) {
  return `<div class="band-row">
    <label class="field"><span class="field-label">Up to (km)</span><input class="input band-km" inputmode="decimal" autocomplete="off" value="${esc(b.up_to_km)}"></label>
    <label class="field"><span class="field-label">Fee</span><span class="money-input"><span aria-hidden="true">$</span><input class="input band-fee" inputmode="decimal" autocomplete="off" value="${dollars(b.fee_cents)}" placeholder="0.00"></span></label>
    <button type="button" class="btn btn-ghost" data-action="remove-row" aria-label="Remove this band">Remove</button>
  </div>`
}

function zoneRow(z = { id: '', name: '', fee_cents: null }) {
  return `<div class="band-row zone-row" data-id="${esc(z.id)}">
    <label class="field"><span class="field-label">Zone name</span><input class="input zone-name" maxlength="40" value="${esc(z.name)}"></label>
    <label class="field"><span class="field-label">Fee</span><span class="money-input"><span aria-hidden="true">$</span><input class="input zone-fee" inputmode="decimal" autocomplete="off" value="${dollars(z.fee_cents)}" placeholder="0.00"></span></label>
    <button type="button" class="btn btn-ghost" data-action="remove-row" aria-label="Remove this zone">Remove</button>
  </div>`
}

function productBlock(p) {
  const id = esc(p.id)
  const kindFields =
    p.kind === 'wood'
      ? `${textField(`p-${id}-species`, 'species', 'Species or mix', p.species, 'maxlength="80"')}
       <label class="field"><span class="field-label">Dry or green</span><select id="p-${id}-dryness" class="input" data-field="dryness">
         <option value="dry"${p.dryness === 'dry' ? ' selected' : ''}>Dry</option><option value="green"${p.dryness === 'green' ? ' selected' : ''}>Green</option></select>${err('dryness')}</label>
       ${textField(`p-${id}-cut`, 'cut_in', 'Piece length (inches)', p.cut_in, 'inputmode="numeric"')}
       ${checkField(`p-${id}-split`, 'split', 'Split', p.split)}
       ${moneyField(`p-${id}-stacking`, 'stacking_cents_per_cord', 'Stacking, per cord', p.stacking_cents_per_cord, 'No stacking')}`
      : `${textField(`p-${id}-brand`, 'brand', 'Brand', p.brand, 'maxlength="80"')}
       ${textField(`p-${id}-bag-lb`, 'bag_lb', 'Bag weight (lb)', p.bag_lb, 'inputmode="numeric"')}
       ${textField(`p-${id}-per-ton`, 'bags_per_ton', 'Bags in a ton', p.bags_per_ton, 'inputmode="numeric"')}
       ${textField(`p-${id}-per-skid`, 'bags_per_skid', 'Bags on a skid', p.bags_per_skid, 'inputmode="numeric"')}`
  const stock = p.kind === 'wood' ? `${cords(p.stock_cu_in)} cords` : `${p.stock_bags} bags`
  return `<div class="product-block" data-product-block="${id}" data-kind="${esc(p.kind)}">
    <form class="settings-form product-form" data-group="product" data-product="${id}" novalidate>
      <h3 class="product-title">${esc(p.name)} <span class="chip">${p.kind === 'wood' ? 'Firewood' : 'Pellets'}</span>${p.active ? '' : ' <span class="chip">Not for sale</span>'}</h3>
      <div class="settings-grid">
        ${textField(`p-${id}-name`, 'name', 'Name', p.name, 'maxlength="80"')}
        ${kindFields}
      </div>
      ${checkField(`p-${id}-active`, 'active', 'For sale', p.active, 'Turn off to hide it from the order page.')}
      <p class="small">Prices: leave a unit blank if you don't sell it that way.</p>
      <div class="price-grid">${UNITS[p.kind].map(([u, label]) => moneyField(`p-${id}-price-${u}`, `price_cents.${u}`, `${label} price`, p.price_cents[u], 'not sold')).join('')}</div>
      ${err('price_cents')}
      ${saveRow('Save product')}
    </form>
    <form class="settings-form stock-form" data-group="stock" data-product="${id}" novalidate>
      <p class="stock-line">In the yard: <strong class="stock-now">${stock}</strong></p>
      <div class="settings-grid">
        <label class="field"><span class="field-label">Count</span><select class="input" data-field="mode">
          <option value="set">Set the count</option><option value="add">Add or take off</option></select>${err('mode')}</label>
        ${
          p.kind === 'wood'
            ? textField(`p-${id}-stock`, 'cords', 'Cords', '', 'inputmode="decimal" autocomplete="off" placeholder="40.00"')
            : textField(`p-${id}-stock`, 'bags', 'Bags', '', 'inputmode="numeric" autocomplete="off" placeholder="600"')
        }
        ${textField(`p-${id}-stock-note`, 'note', 'Note (optional)', '', 'maxlength="200"')}
      </div>
      ${saveRow('Save count')}
    </form>
  </div>`
}

/* ---------- render ---------- */

function render() {
  const s = data.settings
  root.innerHTML = `
  <p class="small plan-intro">Each part saves on its own. Changes show on the order page as soon as they are saved.</p>

  <form class="card settings-form" data-group="business" novalidate>
    <h2 class="card-title">Business</h2>
    <div class="settings-grid">
      ${textField('set-name', 'name', 'Business name', s.name, 'maxlength="80"')}
      ${textField('set-short-name', 'short_name', 'Short name (used in messages)', s.short_name, 'maxlength="40"')}
      ${textField('set-phone', 'phone', 'Phone number', s.phone, 'type="tel" maxlength="32"')}
    </div>
    ${areaField('set-deposit', 'deposit_text', 'Deposit instructions (shown to customers)', s.deposit_text, 400)}
    ${checkField('set-sample', 'sample', 'SAMPLE demo dealer', s.sample, 'Shows the SAMPLE badge on every page. Turn it off for a real business.')}
    ${saveRow()}
  </form>

  <form class="card settings-form" data-group="season" novalidate>
    <h2 class="card-title">Season and prices</h2>
    ${checkField('set-season-open', 'season_open', 'Taking orders (season open)', s.season_open, 'When it is off, the order page shows the message below instead.')}
    ${areaField('set-season-message', 'season_message', 'Message while closed', s.season_message, 200)}
    <div class="settings-grid">
      ${textField('set-season-start', 'season_start', 'First day of the season (MM-DD)', s.season_start, 'maxlength="5" placeholder="09-01"')}
      ${moneyField('set-min-order', 'min_order_cents', 'Smallest order, before delivery', s.min_order_cents)}
    </div>
    ${checkField('set-hst', 'hst_registered', 'Charge HST (15 %)', s.hst_registered, 'Turn it off if you are not registered for HST.')}
    ${saveRow()}
  </form>

  <form class="card settings-form" data-group="yard" novalidate>
    <h2 class="card-title">Yard</h2>
    <p class="small">Tap the map or drag the pin to where the truck leaves from. Distances are measured from here.</p>
    <div class="map-wrap"><div id="yard-map" role="application" aria-label="Map of the yard. Tap to move the yard pin."></div></div>
    <p class="small" id="yard-coords">${Number(s.yard.lat).toFixed(5)}, ${Number(s.yard.lng).toFixed(5)}</p>
    ${textField('set-yard-label', 'yard.label', 'Yard name', s.yard.label, 'maxlength="80"')}
    ${err('yard')}
    ${saveRow()}
  </form>

  <form class="card settings-form" data-group="delivery" novalidate>
    <h2 class="card-title">Delivery fees</h2>
    <fieldset class="radio-row"><legend class="field-label">Charge by</legend>
      <label class="check-row"><input type="radio" name="delivery-mode" value="bands"${s.delivery.mode === 'bands' ? ' checked' : ''}><span class="check-text"><strong>Distance bands</strong><span class="small">As the crow flies from the yard.</span></span></label>
      <label class="check-row"><input type="radio" name="delivery-mode" value="zones"${s.delivery.mode === 'zones' ? ' checked' : ''}><span class="check-text"><strong>Zones</strong><span class="small">The customer picks their area.</span></span></label>
    </fieldset>
    ${err('delivery.mode')}
    <h3 class="sub-title">Distance bands</h3>
    <div class="band-list">${s.delivery.bands.map(bandRow).join('')}</div>
    <button type="button" class="btn btn-secondary" data-action="add-band">Add a band</button>
    ${err('delivery.bands')}
    <h3 class="sub-title">Zones</h3>
    <div class="zone-list">${s.delivery.zones.map(zoneRow).join('')}</div>
    <button type="button" class="btn btn-secondary" data-action="add-zone">Add a zone</button>
    ${err('delivery.zones')}
    ${areaField('set-beyond', 'delivery.beyond_message', 'Message when a pin is too far', s.delivery.beyond_message, 200)}
    ${saveRow()}
  </form>

  <form class="card settings-form" data-group="load" novalidate>
    <h2 class="card-title">What a load is</h2>
    ${textField('set-load-cords', 'load.cords', 'A load is this many cords', s.load.cords, 'inputmode="decimal" autocomplete="off"')}
    ${areaField('set-load-description', 'load.description', 'Say what a load is (customers see this)', s.load.description, 200)}
    ${saveRow()}
  </form>

  <form class="card settings-form" data-group="truck" novalidate>
    <h2 class="card-title">The truck</h2>
    <div class="settings-grid">
      ${textField('set-truck-name', 'truck.name', 'Truck', s.truck.name, 'maxlength="80"')}
      ${textField('set-truck-cords', 'truck.wood_cords_per_day', 'Firewood it carries a day (cords)', s.truck.wood_cords_per_day, 'inputmode="decimal" autocomplete="off"')}
      ${textField('set-truck-skids', 'truck.pellet_skids_per_day', 'Pellets it carries a day (skids)', s.truck.pellet_skids_per_day, 'inputmode="numeric" autocomplete="off"')}
    </div>
    ${saveRow()}
  </form>

  <form class="card settings-form" data-group="days" novalidate>
    <h2 class="card-title">Delivery days</h2>
    <div class="weekdays" role="group" aria-label="Days of the week you deliver">
      ${WEEKDAYS.map(([n, label]) => `<button type="button" class="weekday" data-day="${n}" aria-pressed="${s.delivery_weekdays.includes(n)}">${label}</button>`).join('')}
    </div>
    ${err('delivery_weekdays')}
    ${textField('set-window', 'window_days', 'Days ahead you plan (7 to 42)', s.window_days, 'inputmode="numeric" autocomplete="off"')}
    ${saveRow()}
  </form>

  <section class="card">
    <h2 class="card-title">Products and stock</h2>
    <div id="product-list">${data.products.map(productBlock).join('')}</div>
    <form class="settings-form new-product" data-group="new-product" novalidate>
      <h3 class="sub-title">Add a product</h3>
      <div class="settings-grid">
        <label class="field"><span class="field-label">Kind</span><select id="new-product-kind" class="input" data-field="kind">
          <option value="wood">Firewood</option><option value="pellets">Pellets</option></select>${err('kind')}</label>
        ${textField('new-product-name', 'name', 'Name', '', 'maxlength="80"')}
      </div>
      ${saveRow('Add product')}
    </form>
  </section>

  <form class="card settings-form" data-group="pin" novalidate>
    <h2 class="card-title">PINs</h2>
    <p class="small">Whoever is signed in with the old PIN has to sign in again.</p>
    <div class="settings-grid">
      <label class="field"><span class="field-label">Change</span><select id="pin-which" class="input" data-field="which">
        <option value="dealer">The dealer PIN</option><option value="driver">The driver PIN</option></select>${err('which')}</label>
      ${textField('pin-current', 'current_dealer_pin', 'Your dealer PIN now', '', 'type="password" inputmode="numeric" autocomplete="current-password" maxlength="8"')}
      ${textField('pin-new', 'new_pin', 'New PIN (4 to 8 digits)', '', 'type="password" inputmode="numeric" autocomplete="new-password" maxlength="8"')}
    </div>
    ${saveRow('Change PIN')}
  </form>`
  mountYardMap()
}

function mountYardMap() {
  const el = $('#yard-map', root)
  if (yardMap) {
    yardMap.remove()
    yardMap = null
  }
  const y = data.settings.yard
  yardPoint = { lat: y.lat, lng: y.lng }
  if (!el || typeof L === 'undefined') return
  L.Icon.Default.imagePath = '/vendor/leaflet/images/'
  yardMap = L.map(el, { center: [y.lat, y.lng], zoom: 11, scrollWheelZoom: false, zoomControl: false })
  L.control.zoom({ position: 'bottomleft' }).addTo(yardMap)
  addBaseLayer(yardMap, info?.map)
  const marker = L.marker([y.lat, y.lng], { draggable: true, title: 'Yard' }).addTo(yardMap)
  const move = (ll) => {
    yardPoint = { lat: Math.round(ll.lat * 1e6) / 1e6, lng: Math.round(ll.lng * 1e6) / 1e6 }
    marker.setLatLng([yardPoint.lat, yardPoint.lng])
    $('#yard-coords', root).textContent = `${yardPoint.lat.toFixed(5)}, ${yardPoint.lng.toFixed(5)}`
  }
  marker.on('dragend', () => move(marker.getLatLng()))
  yardMap.on('click', (ev) => move(ev.latlng))
}

/* ---------- saving ---------- */

function zonesFrom(form) {
  const used = new Set()
  return [...form.querySelectorAll('.zone-row')].map((row, i) => {
    const name = row.querySelector('.zone-name').value
    let id =
      row.dataset.id ||
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) ||
      `zone-${i + 1}`
    while (used.has(id)) id = `${id.slice(0, 36)}-${i + 1}`
    used.add(id)
    return { id, name, fee_cents: cents(row.querySelector('.zone-fee').value) }
  })
}

function groupBody(group, f) {
  const val = (sel) => $(sel, f).value
  const on = (sel) => $(sel, f).checked
  switch (group) {
    case 'business':
      return {
        name: val('#set-name'),
        short_name: val('#set-short-name'),
        phone: val('#set-phone'),
        deposit_text: val('#set-deposit'),
        sample: on('#set-sample'),
      }
    case 'season':
      return {
        season_open: on('#set-season-open'),
        season_message: val('#set-season-message'),
        season_start: val('#set-season-start').trim(),
        min_order_cents: cents(val('#set-min-order')),
        hst_registered: on('#set-hst'),
      }
    case 'yard':
      return { yard: { lat: yardPoint.lat, lng: yardPoint.lng, label: val('#set-yard-label') } }
    case 'delivery':
      return {
        delivery: {
          mode: $('input[name="delivery-mode"]:checked', f)?.value ?? '',
          bands: [...f.querySelectorAll('.band-list .band-row')].map((r) => ({
            up_to_km: number($('.band-km', r).value),
            fee_cents: cents($('.band-fee', r).value),
          })),
          zones: zonesFrom(f),
          beyond_message: val('#set-beyond'),
        },
      }
    case 'load':
      return { load: { cords: number(val('#set-load-cords')), description: val('#set-load-description') } }
    case 'truck':
      return {
        truck: {
          name: val('#set-truck-name'),
          wood_cords_per_day: number(val('#set-truck-cords')),
          pellet_skids_per_day: number(val('#set-truck-skids')),
        },
      }
    case 'days':
      return {
        delivery_weekdays: [...f.querySelectorAll('.weekday[aria-pressed="true"]')].map((b) => Number(b.dataset.day)),
        window_days: number(val('#set-window')),
      }
  }
  return {}
}

function productBody(f) {
  const p = data.products.find((x) => x.id === f.dataset.product)
  const field = (name) => f.querySelector(`[data-field="${name}"]`)
  const body = { name: field('name').value, active: field('active').checked, price_cents: {} }
  for (const [u] of UNITS[p.kind]) {
    const t = field(`price_cents.${u}`).value.trim()
    body.price_cents[u] = t === '' ? null : cents(t)
  }
  if (p.kind === 'wood') {
    const stacking = field('stacking_cents_per_cord').value.trim()
    Object.assign(body, {
      species: field('species').value,
      dryness: field('dryness').value,
      cut_in: number(field('cut_in').value),
      split: field('split').checked,
      stacking_cents_per_cord: stacking === '' ? null : cents(stacking),
    })
  } else {
    Object.assign(body, {
      brand: field('brand').value,
      bag_lb: number(field('bag_lb').value),
      bags_per_ton: number(field('bags_per_ton').value),
      bags_per_skid: number(field('bags_per_skid').value),
    })
  }
  return body
}

function replaceProduct(product) {
  const i = data.products.findIndex((x) => x.id === product.id)
  if (i >= 0) data.products[i] = product
  else data.products.push(product)
  const block = root.querySelector(`[data-product-block="${CSS.escape(product.id)}"]`)
  const html = productBlock(product)
  if (block) block.outerHTML = html
  else $('#product-list', root).insertAdjacentHTML('beforeend', html)
  return root.querySelector(`[data-product-block="${CSS.escape(product.id)}"]`)
}

const savedNote = (el, text) => {
  const n = el?.querySelector('.saved')
  if (n) n.textContent = text
}

async function submit(ev) {
  const form = ev.target.closest('form')
  if (!form || !root.contains(form)) return
  ev.preventDefault()
  clearErrors(form)
  savedNote(form, '')
  const group = form.dataset.group
  const button = form.querySelector('button[type="submit"]')
  button.disabled = true
  try {
    if (group === 'product') {
      const r = await api.saveProduct(form.dataset.product, productBody(form))
      savedNote(replaceProduct(r.product).querySelector('.product-form'), 'Saved.')
      onSaved()
    } else if (group === 'stock') {
      const p = data.products.find((x) => x.id === form.dataset.product)
      const amount = form.querySelector(p.kind === 'wood' ? '[data-field="cords"]' : '[data-field="bags"]').value
      const note = form.querySelector('[data-field="note"]').value.trim()
      const body = { mode: form.querySelector('[data-field="mode"]').value, [p.kind === 'wood' ? 'cords' : 'bags']: number(amount) }
      if (note) body.note = note
      const r = await api.countStock(p.id, body)
      savedNote(replaceProduct(r.product).querySelector('.stock-form'), 'Count saved.')
    } else if (group === 'new-product') {
      const r = await api.addProduct({ kind: $('#new-product-kind', form).value, name: $('#new-product-name', form).value })
      replaceProduct(r.product)
      $('#new-product-name', form).value = ''
      savedNote(form, `Added ${r.product.name}. Give it a price below to put it on the order page.`)
      onSaved()
    } else if (group === 'pin') {
      await api.changePin({
        which: $('#pin-which', form).value,
        current_dealer_pin: $('#pin-current', form).value,
        new_pin: $('#pin-new', form).value,
      })
      $('#pin-current', form).value = ''
      $('#pin-new', form).value = ''
      savedNote(form, `The ${$('#pin-which', form).value} PIN is changed.`)
    } else {
      data = await api.saveSettings(groupBody(group, form))
      savedNote(form, 'Saved.')
      onSaved()
    }
  } catch (e) {
    // A session that ended has already signed the page out; the PIN form's own "not right" stays here.
    if (e.status === 401 && e.field !== 'current_dealer_pin') return
    const field = e.field === 'yard.lat' || e.field === 'yard.lng' ? 'yard' : e.field
    if (!showError(form, field, e.message)) showError(form, 'form', e.message)
    form.querySelector('[data-error-for]:not([hidden])')?.scrollIntoView({ block: 'center' })
  } finally {
    button.disabled = false
  }
}

function click(ev) {
  const b = ev.target.closest('button')
  if (!b || !root.contains(b) || b.type === 'submit') return
  const form = b.closest('form')
  if (b.matches('.weekday')) {
    b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'))
  } else if (b.dataset.action === 'add-band') {
    $('.band-list', form).insertAdjacentHTML('beforeend', bandRow())
    $('.band-list .band-row:last-child .band-km', form).focus()
  } else if (b.dataset.action === 'add-zone') {
    $('.zone-list', form).insertAdjacentHTML('beforeend', zoneRow())
    $('.zone-list .zone-row:last-child .zone-name', form).focus()
  } else if (b.dataset.action === 'remove-row') {
    b.closest('.band-row').remove()
  }
}
