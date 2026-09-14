// The dealer's Plan tab: the delivery days with the truck's two capacity bars, and a day's route — the map with the yard,
// numbered stops and the route line, the stop list reordered by dragging a handle (pointer events) or Move up / Move down,
// and "Put in best order". Every change is saved through the route API and the page shows what the API answers.

import { api } from '/api.js'
import { esc, cords, icon } from '/ui.js'

const $ = (sel, root = document) => root.querySelector(sel)
const grip = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg>'

let root = null
let info = null
let onPath = () => {}
let route = null
let map = null
let layers = null
let busy = false

const percent = (used, cap) => (cap ? Math.min(100, Math.round((used * 100) / cap)) : used ? 100 : 0)

/** Mount once into the Plan panel. onPathChange(date|null) lets the page remember the open day in the URL. */
export function initPlan(el, { dealerInfo, onPathChange }) {
  root = el
  info = dealerInfo
  onPath = onPathChange || (() => {})
  root.addEventListener('click', click)
}

export function setPlanInfo(dealerInfo) {
  info = dealerInfo
}

/** Show the day list (date null) or one day's route. */
export async function showPlan(date = null) {
  if (date) return openDay(date)
  return showDays()
}

async function showDays() {
  route = null
  onPath(null)
  root.innerHTML = '<p class="small">Loading the days…</p>'
  let days
  try {
    days = (await api.days()).days
  } catch (e) {
    if (e.status === 401) return
    root.innerHTML = `<p class="alert" role="alert">${esc(e.message)}</p>`
    return
  }
  root.innerHTML = `
    <p class="small plan-intro">The next ${days.length} days, with what the truck can carry each day.</p>
    <ol class="plan-days" aria-label="Delivery days">${days.map(dayRow).join('')}</ol>`
}

function dayRow(d) {
  if (!d.delivers) {
    return `<li class="plan-day off" data-date="${esc(d.date)}"><span class="plan-day-head"><strong>${esc(d.label)}</strong><span class="small">${esc(d.reason || 'No deliveries')}</span></span></li>`
  }
  const stops = `${d.orders} ${d.orders === 1 ? 'stop' : 'stops'}${d.started ? ', started' : ''}`
  return `<li class="plan-day-item">
    <button type="button" class="plan-day" data-date="${esc(d.date)}" data-over="${!!d.over}" aria-label="${esc(d.long_label)}: ${stops}">
      <span class="plan-day-head"><strong>${esc(d.label)}</strong><span class="small">${stops}</span></span>
      <span class="cap wood"><span class="cap-text">${cords(d.wood.used_cu_in)} of ${cords(d.wood.cap_cu_in)} cords</span><span class="bar"><span style="width:${percent(d.wood.used_cu_in, d.wood.cap_cu_in)}%"></span></span></span>
      <span class="cap pellets"><span class="cap-text">${d.pellets.used_bags} of ${d.pellets.cap_bags} bags</span><span class="bar"><span style="width:${percent(d.pellets.used_bags, d.pellets.cap_bags)}%"></span></span></span>
      ${d.over ? '<span class="over">Over the truck\'s limit</span>' : ''}
    </button></li>`
}

async function openDay(date) {
  onPath(date)
  root.innerHTML = '<p class="small">Loading the route…</p>'
  try {
    renderRoute(await api.route(date))
  } catch (e) {
    if (e.status === 401) return
    root.innerHTML = `<button type="button" class="btn btn-ghost" data-action="days">${icon.back}<span>Back to days</span></button>
      <p class="alert" role="alert">${esc(e.message)}</p>`
  }
}

function renderRoute(r) {
  route = r
  const fresh = !$('#route-map', root)
  if (fresh) {
    if (map) { map.remove(); map = null }
    root.innerHTML = `
      <div class="route-head">
        <button type="button" class="btn btn-ghost" data-action="days">${icon.back}<span>Back to days</span></button>
        <h2 id="route-title" class="route-title" tabindex="-1"></h2>
        <p class="route-meta"><strong id="route-km"></strong> <span class="small" id="route-note"></span></p>
        <button type="button" id="optimize" class="btn btn-primary" data-action="optimize">Put in best order</button>
      </div>
      <p id="route-error" class="alert" role="alert" hidden></p>
      <div class="route-layout">
        <div class="route-map-wrap"><div id="route-map" role="img" aria-label="Map of the route"></div></div>
        <div class="route-list">
          <p class="small" id="route-empty" hidden>Nothing is scheduled for this day yet.</p>
          <ol id="stops" class="stops" aria-label="Stops in route order"></ol>
        </div>
      </div>`
  }
  $('#route-title', root).textContent = r.long_label || r.label
  $('#route-km', root).textContent = `${Number(r.total_km).toFixed(1)} km`
  $('#route-note', root).textContent = r.note
  $('#route-empty', root).hidden = r.stops.length > 0
  $('#optimize', root).hidden = r.stops.length < 2
  const locked = r.stops.filter((s) => s.status === 'delivered').length
  $('#stops', root).innerHTML = r.stops.map((s, i) => stopItem(s, i, locked, r.stops.length)).join('')
  for (const h of root.querySelectorAll('.drag-handle')) h.addEventListener('pointerdown', startDrag)
  drawMap(r)
}

function stopItem(s, i, locked, count) {
  const isLocked = s.status === 'delivered'
  return `<li class="stop" data-stop="${esc(s.id)}" data-status="${esc(s.status)}"${isLocked ? ' data-locked="true"' : ''}>
    ${isLocked ? '<span class="drag-space" aria-hidden="true"></span>' : `<button type="button" class="drag-handle" aria-label="Drag ${esc(s.name)} to a new place">${grip}</button>`}
    <span class="stop-num" aria-hidden="true">${i + 1}</span>
    <span class="stop-body">
      <strong class="stop-name">${esc(s.name)}</strong>
      <span>${esc(s.qty_label)} of ${esc(s.product_label)}</span>
      <span class="small">${esc(s.address)}</span>
      ${s.status !== 'scheduled' ? `<span class="pill status" data-status="${esc(s.status)}">${esc(s.status_label)}</span>` : ''}
    </span>
    ${isLocked ? '' : `<span class="stop-moves">
      <button type="button" class="btn btn-secondary" data-action="up" ${i <= locked ? 'disabled' : ''}>Move up</button>
      <button type="button" class="btn btn-secondary" data-action="down" ${i >= count - 1 ? 'disabled' : ''}>Move down</button>
    </span>`}
  </li>`
}

function drawMap(r) {
  const el = $('#route-map', root)
  if (!el || typeof L === 'undefined') return
  if (!map) {
    L.Icon.Default.imagePath = '/vendor/leaflet/images/'
    map = L.map(el, { scrollWheelZoom: false, zoomControl: false })
    L.control.zoom({ position: 'bottomleft' }).addTo(map)
    map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>')
    if (info?.map) L.tileLayer(info.map.tiles, { attribution: info.map.attribution, maxZoom: 18 }).addTo(map)
    layers = L.layerGroup().addTo(map)
  }
  layers.clearLayers()
  const yard = [r.yard.lat, r.yard.lng]
  const points = r.stops.map((s) => [s.lat, s.lng])
  L.polyline([yard, ...points, yard], { color: '#fb923c', weight: 3, opacity: 0.85 }).addTo(layers)
  L.circleMarker(yard, { radius: 9, color: '#1a0e02', weight: 2, fillColor: '#fb923c', fillOpacity: 1 })
    .addTo(layers).bindTooltip(esc(r.yard.label))
  r.stops.forEach((s, i) => {
    L.marker([s.lat, s.lng], {
      icon: L.divIcon({ className: 'stop-marker', html: `<span data-status="${esc(s.status)}">${i + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
      title: `${i + 1}. ${s.name}`, keyboard: false,
    }).addTo(layers)
  })
  map.invalidateSize()
  map.fitBounds(L.latLngBounds([yard, ...points]).pad(0.15), { maxZoom: 12 })
}

/* ---------- reorder ---------- */

const currentIds = () => [...root.querySelectorAll('#stops .stop')].map((li) => li.dataset.stop)

async function save(ids) {
  if (!route) return
  if (ids.join() === route.stops.map((s) => s.id).join()) return
  busy = true
  $('#route-error', root).hidden = true
  try {
    renderRoute(await api.putRoute(route.date, ids))
  } catch (e) {
    if (e.status === 401) return
    renderRoute(route)
    $('#route-error', root).textContent = e.message
    $('#route-error', root).hidden = false
  } finally {
    busy = false
  }
}

function mid(el) {
  const r = el.getBoundingClientRect()
  return r.top + r.height / 2
}

function startDrag(ev) {
  if (busy || (ev.pointerType === 'mouse' && ev.button !== 0)) return
  const handle = ev.currentTarget
  const li = handle.closest('.stop')
  const list = li.parentElement
  ev.preventDefault()
  handle.setPointerCapture(ev.pointerId)
  const grab = ev.clientY - li.getBoundingClientRect().top
  const before = currentIds().join()
  li.classList.add('dragging')

  const move = (e) => {
    li.style.transform = ''
    for (let i = 0; i < 50; i++) {
      const prev = li.previousElementSibling
      const next = li.nextElementSibling
      if (prev && !prev.dataset.locked && e.clientY < mid(prev)) list.insertBefore(li, prev)
      else if (next && e.clientY > mid(next)) list.insertBefore(next, li)
      else break
    }
    li.style.transform = `translateY(${e.clientY - grab - li.getBoundingClientRect().top}px)`
  }
  const end = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
    li.classList.remove('dragging')
    li.style.transform = ''
    const ids = currentIds()
    if (ids.join() !== before) save(ids)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
}

async function click(ev) {
  const b = ev.target.closest('button')
  if (!b || !root.contains(b) || b.disabled) return
  if (b.matches('.plan-day')) return openDay(b.dataset.date)
  const action = b.dataset.action
  if (action === 'days') return showDays()
  if (!route || busy) return
  if (action === 'optimize') {
    busy = true
    b.disabled = true
    $('#route-error', root).hidden = true
    try {
      renderRoute(await api.optimize(route.date))
    } catch (e) {
      if (e.status !== 401) {
        $('#route-error', root).textContent = e.message
        $('#route-error', root).hidden = false
      }
    } finally {
      busy = false
      b.disabled = false
    }
    return
  }
  if (action === 'up' || action === 'down') {
    const ids = currentIds()
    const i = ids.indexOf(b.closest('.stop').dataset.stop)
    const j = action === 'up' ? i - 1 : i + 1
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    await save(ids)
    // Keep the keyboard where it was: on the same stop's button.
    root.querySelector(`.stop[data-stop="${CSS.escape(ids[j])}"] [data-action="${action}"]:not([disabled])`)?.focus()
  }
}
