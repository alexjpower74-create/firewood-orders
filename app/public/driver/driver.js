// Driver page: the day's stops in route order, Start the route, Delivered + how they paid, and an offline queue that keeps
// the moment the driver tapped Save. The screen always shows the saved day plus what is waiting in the queue.
import { api, clearToken, getToken, NetworkError, setToken } from './driver-api.js'
import { addItem, allItems, createSender, removeItem } from './queue.js'

const $ = (id) => document.getElementById(id)
const KEY = { info: 'firewood-orders:info', day: (date) => `firewood-orders:day:${date}`, daylight: 'firewood-orders:daylight' }
const TZ = 'America/St_Johns'
const clock = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
const METHOD = { cash: 'Cash', etransfer: 'e-Transfer', owes: 'Owes' }
const STATUS = { scheduled: 'Scheduled', out_for_delivery: 'Out for delivery', delivered: 'Delivered' }
const UNDO_MS = 15000

const state = {
  info: read(KEY.info),
  viewDate: null,
  day: null,
  items: [],
  authNeeded: false,
  offline: false,
  sheet: null,
  method: null,
  photo: null,
  photoBusy: false,
  undo: null,
  undoTimer: null,
}

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)) } catch { return null }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

// $1,234.56 from integer cents.
function money(cents) {
  const a = Math.abs(cents)
  return `${cents < 0 ? '-' : ''}$${String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(a % 100).padStart(2, '0')}`
}

// "120", "120.5", "$120.50" → 12050 cents, from the text itself (no floating point). Anything else → null.
function parseAmount(text) {
  const m = /^\s*\$?\s*(\d{1,6})(?:\.(\d{1,2}))?\s*$/.exec(text)
  if (!m) return null
  const cents = Number(m[1]) * 100 + Number((m[2] || '0').padEnd(2, '0'))
  return cents >= 1 && cents <= 10000000 ? cents : null
}

function addDays(date, n) {
  const t = new Date(`${date}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

const today = () => state.info?.today || null

const sender = createSender({
  onAccepted: async (item, body) => patchDay(item.date, (day) => {
    const stop = day.stops.find((s) => s.order_id === item.order_id)
    const o = body?.order
    if (stop && o) {
      Object.assign(stop, { status: o.status, paid_cents: o.paid_cents, owing_cents: o.owing_cents,
        delivered_label: o.delivered_label, door_payment: o.door_payment })
    }
  }),
  onStarted: async (item) => patchDay(item.date, (day) => {
    day.started = true
    for (const s of day.stops) if (s.status === 'scheduled') s.status = 'out_for_delivery'
  }),
  onPhotoRefused: (item, r) => notice(r.status === 413 || r.status === 415
    ? "The delivery was saved; the photo couldn't be used."
    : `The delivery was saved; the photo didn't send: ${r.body?.error || `answer ${r.status}`}`),
  onChange: async () => {
    state.items = await allItems()
    render()
  },
  onAuthNeeded: () => {
    state.authNeeded = true
    render()
  },
})

// Change the saved copy of a day (and the screen, when it is that day).
function patchDay(date, change) {
  const day = read(KEY.day(date))
  if (!day) return
  change(day)
  day.counts = { done: day.stops.filter((s) => s.status === 'delivered').length, total: day.stops.length }
  write(KEY.day(date), day)
  if (state.viewDate === date) state.day = day
}

// ---------- data ----------

async function loadInfo() {
  try {
    const r = await api.info()
    if (r.status === 200) {
      state.info = { name: r.body.name, short_name: r.body.short_name, sample: r.body.sample, today: r.body.today }
      write(KEY.info, state.info)
    }
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e
    state.offline = true
  }
}

async function showDay(date) {
  state.viewDate = date
  state.day = date ? read(KEY.day(date)) : null
  render()
  await refreshDay(date)
}

async function refreshDay(date) {
  if (!date || !getToken()) return
  try {
    const r = await api.day(date)
    if (r.status === 401) {
      state.authNeeded = true
    } else if (r.status === 200) {
      write(KEY.day(date), r.body)
      if (state.viewDate === date) state.day = r.body
      state.offline = false
    }
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e
    state.offline = true
  }
  state.items = await allItems()
  render()
}

// The saved day with what is still waiting on the phone laid over it.
function merged() {
  const day = state.day
  if (!day) return null
  const stops = day.stops.map((s) => ({ ...s }))
  let started = day.started
  for (const it of state.items) {
    if (it.state === 'rejected' || it.date !== day.date) continue
    if (it.kind === 'start') started = true
    if (it.kind === 'checkin' && it.state === 'queued') {
      const stop = stops.find((s) => s.order_id === it.order_id)
      if (stop && stop.status !== 'delivered') {
        Object.assign(stop, { status: 'delivered', local: true, door_payment: it.payment.method,
          delivered_label: `Saved on this phone at ${clock.format(new Date(it.at))}` })
      }
    }
  }
  if (started) for (const s of stops) if (s.status === 'scheduled') s.status = 'out_for_delivery'
  return { ...day, started, stops }
}

// ---------- screen ----------

function render() {
  const info = state.info
  $('dealer-name').textContent = info?.name || 'Driver'
  $('sample').hidden = info?.sample === false
  const signedIn = !!getToken() && !state.authNeeded
  $('signin-view').hidden = signedIn
  $('day-view').hidden = !signedIn
  $('signin-lead').textContent = state.authNeeded
    ? 'Sign in again. Nothing saved on this phone is lost.'
    : 'Enter the driver PIN.'
  renderStrip()
  if (!signedIn) {
    $('day-label').textContent = ''
    return
  }
  renderDay()
  renderRejected()
}

function renderStrip() {
  const live = state.items.filter((i) => i.state !== 'rejected')
  const pending = live.filter((i) => i.kind === 'checkin' && i.state === 'queued').length
  const photos = live.filter((i) => i.kind === 'checkin' && i.state === 'photo').length
  const starts = live.filter((i) => i.kind === 'start').length
  const offline = !navigator.onLine || sender.status().offline
  const saved = pending
    ? `${pending} ${pending === 1 ? 'delivery' : 'deliveries'} saved on this phone`
    : photos ? `${photos} ${photos === 1 ? 'photo' : 'photos'} saved on this phone` : 'The route start is saved on this phone'
  let text
  let mode
  if (!live.length) {
    text = 'All sent'
    mode = 'sent'
  } else if (!getToken() || state.authNeeded) {
    text = `Sign in again to send them. ${saved}.`
    mode = 'signin'
  } else if (offline) {
    text = pending
      ? `No signal. ${saved}. They send when signal comes back and keep the time you tapped.`
      : `No signal. ${saved}. It sends when signal comes back.`
    mode = 'offline'
  } else {
    text = `Sending. ${saved}.`
    mode = 'sending'
  }
  void starts
  const strip = $('sync-strip')
  if (strip.textContent !== text) strip.textContent = text
  strip.dataset.state = mode
}

function renderDay() {
  const view = merged()
  const isToday = state.viewDate === today()
  $('day-title').textContent = isToday ? "Today's deliveries" : "Tomorrow's deliveries"
  $('show-today').setAttribute('aria-pressed', String(isToday))
  $('show-tomorrow').setAttribute('aria-pressed', String(!isToday))
  $('day-label').textContent = view?.long_label || ''

  const empty = $('empty')
  if (!view) {
    empty.hidden = false
    empty.textContent = today()
      ? (state.offline ? 'No signal, and this day is not saved on this phone yet.' : 'Getting the day…')
      : 'No signal. Open this page once with signal to save the day on this phone.'
    for (const id of ['start-route', 'next', 'all-done']) $(id).hidden = true
    $('stops').replaceChildren()
    return
  }
  const stops = view.stops
  empty.hidden = stops.length > 0
  empty.textContent = stops.length ? '' : 'No stops on this day.'

  $('start-route').hidden = !(isToday && !view.started && stops.some((s) => s.status === 'scheduled'))

  const next = isToday ? stops.find((s) => s.status !== 'delivered') : null
  $('next').hidden = !next
  $('all-done').hidden = !(isToday && stops.length && !next)
  if (next) {
    $('next').dataset.stop = next.order_id
    $('stop-count').textContent = `Stop ${next.pos} of ${stops.length}`
    $('next-name').textContent = next.name
    $('next-address').textContent = next.address
    $('next-dump').textContent = next.dump_notes
    $('next-dump').hidden = !next.dump_notes
    $('next-what').textContent = `${next.qty_label} of ${next.product_label}${next.stacking ? ', stacked' : ''}`
    const owing = $('next-owing')
    owing.textContent = next.owing_cents > 0 ? `Balance owing ${money(next.owing_cents)}`
      : next.owing_cents === 0 ? 'Paid in full' : `Credit ${money(-next.owing_cents)}`
    owing.className = `pill ${next.owing_cents > 0 ? 'owing' : next.owing_cents === 0 ? 'paid' : 'credit'}`
    $('open-maps').href = next.maps_url
  }

  const list = $('stops')
  list.replaceChildren(...stops.map((s) => {
    const li = document.createElement('li')
    li.dataset.stop = s.order_id
    li.className = `st-${s.status}${s.local ? ' local' : ''}`
    const pos = document.createElement('span')
    pos.className = 'pos'
    pos.textContent = String(s.pos)
    const body = document.createElement('div')
    const name = document.createElement('strong')
    name.textContent = s.name
    const addr = document.createElement('span')
    addr.className = 'addr'
    addr.textContent = `${s.address} · ${s.qty_label} of ${s.product_label}`
    const st = document.createElement('span')
    st.className = 'state'
    const pay = s.door_payment ? ` · ${METHOD[s.door_payment]}` : ''
    st.textContent = s.local ? `Saved on this phone${pay}` : `${STATUS[s.status] || s.status}${s.status === 'delivered' ? pay : ''}`
    body.append(name, addr, st)
    li.append(pos, body)
    return li
  }))
}

function renderRejected() {
  const bad = state.items.filter((i) => i.state === 'rejected')
  // An Undo for a delivery the office refused means nothing, and its bar would sit over Remove from this phone.
  if (state.undo && bad.some((i) => i.op_id === state.undo.op_id)) hideUndo()
  $('rejected').hidden = !bad.length
  $('rejected-list').replaceChildren(...bad.map((it) => {
    const li = document.createElement('li')
    const p = document.createElement('p')
    p.textContent = `${it.kind === 'start' ? 'Start the route' : it.name}: ${it.message}`
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'btn secondary'
    b.textContent = 'Remove from this phone'
    b.addEventListener('click', async () => {
      await removeItem(it.seq)
      state.items = await allItems()
      render()
    })
    li.append(p, b)
    return li
  }))
}

function notice(text) {
  $('notice').textContent = text
  $('notice').hidden = !text
}

// ---------- actions ----------

async function signIn(event) {
  event.preventDefault()
  const pin = $('pin').value.trim()
  const error = $('pin-error')
  error.hidden = true
  $('signin-btn').disabled = true
  try {
    const r = await api.signin(pin)
    if (r.status === 200) {
      setToken(r.body.token)
      state.authNeeded = false
      $('pin').value = ''
      await loadInfo()
      sender.kick(true)
      await showDay(today())
    } else {
      error.textContent = r.body?.error || 'That PIN is not right.'
      error.hidden = false
    }
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e
    error.textContent = 'No signal. Signing in needs signal.'
    error.hidden = false
  } finally {
    $('signin-btn').disabled = false
  }
}

async function startRoute() {
  const date = state.viewDate
  await addItem({ kind: 'start', state: 'queued', date, saved_at: new Date().toISOString() })
  state.items = await allItems()
  render()
  sender.kick(true)
}

function openSheet() {
  const view = merged()
  const next = view?.stops.find((s) => s.status !== 'delivered')
  if (!next) return
  state.sheet = { order_id: next.order_id, name: next.name, date: view.date, owing: Math.max(0, next.owing_cents) }
  state.method = null
  state.photo = null
  $('sheet-for').textContent = `${next.name} · ${next.qty_label} of ${next.product_label}`
  for (const b of document.querySelectorAll('button.pay')) b.setAttribute('aria-pressed', 'false')
  $('amount').value = ''
  $('amount-row').hidden = true
  $('amount-error').hidden = true
  $('photo-input').value = ''
  $('photo-note').hidden = true
  $('save-delivery').disabled = true
  $('sheet').hidden = false
  $('sheet-title').focus()
}

function closeSheet() {
  $('sheet').hidden = true
  state.sheet = null
}

function choose(method) {
  state.method = method
  for (const b of document.querySelectorAll('button.pay')) b.setAttribute('aria-pressed', String(b.dataset.method === method))
  const paying = method !== 'owes'
  $('amount-row').hidden = !paying
  if (paying && !$('amount').value) $('amount').value = money(state.sheet.owing).slice(1).replace(/,/g, '')
  $('save-delivery').disabled = state.photoBusy
}

// Downscale on a canvas to at most 1600 px, JPEG 0.7. If the phone cannot, keep the original when the API takes it.
async function downscale(file) {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.7))
    if (blob) return { type: 'image/jpeg', data: await blob.arrayBuffer() }
  } catch {}
  if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size <= 5000000) {
    return { type: file.type, data: await file.arrayBuffer() }
  }
  return null
}

async function photoChosen() {
  const file = $('photo-input').files?.[0]
  if (!file) return
  state.photoBusy = true
  $('save-delivery').disabled = true
  try {
    state.photo = await downscale(file)
  } catch {
    // A photo that cannot be read must never lock Save: the delivery matters more than its picture.
    state.photo = null
  } finally {
    state.photoBusy = false
    $('photo-note').textContent = state.photo ? 'Photo added. It sends with the delivery.' : "That photo can't be used. Try again, or save without it."
    $('photo-note').hidden = false
    $('save-delivery').disabled = !state.method
  }
}

async function save() {
  // The moment Save is tapped is the delivery time the customer and the dealer will see, however late it sends.
  const at = new Date().toISOString()
  if (!state.sheet || !state.method || state.photoBusy) return
  const payment = { method: state.method }
  if (state.method !== 'owes') {
    const cents = parseAmount($('amount').value)
    if (cents === null) {
      $('amount-error').textContent = 'Enter the amount they paid, like 120.00.'
      $('amount-error').hidden = false
      return
    }
    // Left as the owing shown: the office works out what is owing when it arrives.
    if (cents !== state.sheet.owing) payment.amount_cents = cents
  }
  const item = { kind: 'checkin', state: 'queued', op_id: crypto.randomUUID(), order_id: state.sheet.order_id,
    date: state.sheet.date, at, payment, note: '', photo: state.photo, name: state.sheet.name }
  await addItem(item)
  closeSheet()
  state.items = await allItems()
  render()
  showUndo(item)
  sender.kick(true)
}

function showUndo(item) {
  clearTimeout(state.undoTimer)
  state.undo = { op_id: item.op_id, order_id: item.order_id, date: item.date }
  $('undo-text').textContent = `Delivered: ${item.name}`
  $('undo-bar').hidden = false
  document.documentElement.classList.add('undo-open')
  state.undoTimer = setTimeout(hideUndo, UNDO_MS)
}

function hideUndo() {
  clearTimeout(state.undoTimer)
  $('undo-bar').hidden = true
  document.documentElement.classList.remove('undo-open')
  state.undo = null
}

async function undo() {
  const u = state.undo
  if (!u) return
  hideUndo()
  notice('')
  await sender.idle() // never decide while that delivery is on its way to the office
  const item = (await allItems()).find((i) => i.op_id === u.op_id)
  if (item && item.state === 'queued') {
    await removeItem(item.seq)
    state.items = await allItems()
    render()
    return
  }
  try {
    const r = await api.undo(u.op_id)
    if (r.status === 200) {
      if (item) await removeItem(item.seq)
      patchDay(u.date, (day) => {
        const stop = day.stops.find((s) => s.order_id === u.order_id)
        const o = r.body.order
        if (stop && o) {
          Object.assign(stop, { status: o.status, paid_cents: o.paid_cents, owing_cents: o.owing_cents,
            delivered_label: o.delivered_label, door_payment: o.door_payment })
        }
      })
      state.items = await allItems()
      render()
      refreshDay(state.viewDate)
    } else if (r.status === 401) {
      state.authNeeded = true
      render()
    } else {
      notice(r.body?.error || 'The office could not undo that. Ask the dealer.')
    }
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e
    notice('No signal. Undo needs signal once a delivery has been sent. Ask the dealer to change it.')
  }
}

function setDaylight(on, remember) {
  if (on) document.documentElement.dataset.theme = 'daylight'
  else delete document.documentElement.dataset.theme
  $('daylight').setAttribute('aria-pressed', String(on))
  if (remember) write(KEY.daylight, on)
}

function bind() {
  $('signin-form').addEventListener('submit', signIn)
  $('daylight').addEventListener('click', () => setDaylight(document.documentElement.dataset.theme !== 'daylight', true))
  $('show-today').addEventListener('click', () => showDay(today()))
  $('show-tomorrow').addEventListener('click', () => today() && showDay(addDays(today(), 1)))
  $('start-route').addEventListener('click', startRoute)
  $('delivered').addEventListener('click', openSheet)
  for (const b of document.querySelectorAll('button.pay')) b.addEventListener('click', () => choose(b.dataset.method))
  $('amount').addEventListener('input', () => { $('amount-error').hidden = true })
  $('photo-input').addEventListener('change', photoChosen)
  $('save-delivery').addEventListener('click', save)
  $('sheet-cancel').addEventListener('click', closeSheet)
  $('undo').addEventListener('click', undo)
  $('sign-out').addEventListener('click', () => {
    clearToken()
    hideUndo()
    render()
  })
  window.addEventListener('online', () => { state.offline = false; sender.kick(true); render() })
  window.addEventListener('offline', () => render())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    sender.kick(true)
    if (getToken()) refreshDay(state.viewDate)
  })
  setInterval(() => {
    if (state.items.some((i) => i.state !== 'rejected')) sender.kick(false)
  }, 20000)
}

async function init() {
  setDaylight(document.documentElement.dataset.theme === 'daylight', false)
  bind()
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/driver/sw.js', { scope: '/driver/' }).catch(() => {})
  state.items = await allItems()
  render()
  await loadInfo()
  if (getToken()) await showDay(today())
  else render()
  sender.kick(true)
}

init()
