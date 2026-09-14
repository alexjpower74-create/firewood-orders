// The pages' only door to the Worker: same-origin fetch('/api/…') per docs/API.md. A failed call throws ApiError whose
// message is the API's own `error` text, shown to people as is, with `field` naming the input it belongs under.
// Dealer routes carry the session token from localStorage (`firewood-orders:dealer-token`); a 401 on them clears it and
// fires SIGNED_OUT, except the PIN change's own refusal of a wrong current PIN (`field: "current_dealer_pin"`).
// `?mock=1` swaps in api.mock.js for development (remembered for the tab; `?mock=0` turns it off). Playwright never
// uses the mock.

const MOCK_KEY = 'firewood-orders:mock'
const TOKEN_KEY = 'firewood-orders:dealer-token'
export const SIGNED_OUT = 'firewood-orders:signed-out'

const mode = new URLSearchParams(location.search).get('mock')
let mocked = false
try {
  if (mode === '1') sessionStorage.setItem(MOCK_KEY, '1')
  if (mode === '0') sessionStorage.removeItem(MOCK_KEY)
  mocked = sessionStorage.getItem(MOCK_KEY) === '1'
} catch { mocked = mode === '1' }
const mock = mocked ? await import('/api.mock.js') : null

export const session = {
  get() { try { return localStorage.getItem(TOKEN_KEY) || '' } catch { return '' } },
  set(token) { try { localStorage.setItem(TOKEN_KEY, token) } catch {} },
  clear() { try { localStorage.removeItem(TOKEN_KEY) } catch {} },
}

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Something went wrong (error ${status}). Please try again.`)
    this.status = status
    this.code = body?.code || 'error'
    this.field = body?.field || null
    this.body = body || {}
  }
}

const NETWORK = { error: "We couldn't reach the server. Check your signal and try again.", code: 'network' }
const isDealer = (path) => path.startsWith('/api/dealer/') || path === '/api/signout'

function authHeaders(path) {
  const token = session.get()
  return token && isDealer(path) ? { authorization: `Bearer ${token}` } : {}
}

function signedOut(detail) {
  session.clear()
  window.dispatchEvent(new CustomEvent(SIGNED_OUT, { detail: detail || '' }))
}

async function send(method, path, body) {
  const headers = authHeaders(path)
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (mock) {
    const r = await mock.handle(method, path, body, headers)
    return { status: r.status, data: r.body }
  }
  let res
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' })
  } catch {
    throw new ApiError(0, NETWORK)
  }
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch {}
  return { status: res.status, data }
}

async function call(method, path, body) {
  const r = await send(method, path, body)
  if (r.status >= 200 && r.status < 300) return r.data
  // A wrong current PIN on the PIN form is that form's own answer, not a session that ended.
  const pinRefusal = path === '/api/dealer/pin' && r.data?.field === 'current_dealer_pin'
  if (r.status === 401 && isDealer(path) && !pinRefusal) signedOut(r.data?.error)
  throw new ApiError(r.status, r.data)
}

/** A file from the API, byte for byte, with the name the API gives it (Content-Disposition). */
async function download(path) {
  if (mock) throw new ApiError(404, { error: 'The mock has no downloads. Use the real Worker.', code: 'not_found' })
  let res
  try {
    res = await fetch(path, { headers: authHeaders(path), cache: 'no-store' })
  } catch {
    throw new ApiError(0, NETWORK)
  }
  if (res.ok) {
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'firewood-orders.csv'
    return { blob: await res.blob(), filename: name }
  }
  let data = null
  try { data = await res.json() } catch {}
  if (res.status === 401) signedOut(data?.error)
  throw new ApiError(res.status, data)
}

const q = encodeURIComponent
const order = (id) => `/api/dealer/orders/${q(id)}`

export const api = {
  mocked,
  // public
  info: () => call('GET', '/api/info'),
  quote: (body) => call('POST', '/api/quote', body),
  placeOrder: (body) => call('POST', '/api/orders', body),
  status: (token) => call('GET', `/api/o/${q(token)}`),
  cancelMyOrder: (token) => call('POST', `/api/o/${q(token)}/cancel`, {}),
  // sign-in
  signin: (pin) => call('POST', '/api/signin', { pin }),
  signout: () => call('POST', '/api/signout', {}),
  // dealer: orders
  board: () => call('GET', '/api/dealer/board'),
  order: (id) => call('GET', order(id)),
  phoneOrder: (body) => call('POST', '/api/dealer/orders', body),
  editOrder: (id, body) => call('PUT', order(id), body),
  schedule: (id, date) => call('POST', `${order(id)}/schedule`, { date }),
  unschedule: (id) => call('POST', `${order(id)}/unschedule`, {}),
  cancelOrder: (id) => call('POST', `${order(id)}/cancel`, {}),
  undeliver: (id) => call('POST', `${order(id)}/undeliver`, {}),
  // dealer: the truck and the route
  days: () => call('GET', '/api/dealer/days'),
  route: (date) => call('GET', `/api/dealer/days/${q(date)}/route`),
  optimize: (date) => call('POST', `/api/dealer/days/${q(date)}/route/optimize`, {}),
  putRoute: (date, ids) => call('PUT', `/api/dealer/days/${q(date)}/route`, { order_ids: ids }),
  // dealer: customers and money
  customers: () => call('GET', '/api/dealer/customers'),
  ledger: (id) => call('GET', `/api/dealer/customers/${q(id)}/ledger`),
  recordPayment: (body) => call('POST', '/api/dealer/payments', body),
  voidPayment: (id) => call('DELETE', `/api/dealer/payments/${q(id)}`),
  totals: (season) => call('GET', `/api/dealer/totals${season ? `?season=${q(season)}` : ''}`),
  exportCsv: (kind, season) => download(`/api/dealer/export/${kind === 'payments' ? 'payments' : 'orders'}.csv?season=${q(season)}`),
  // dealer: settings
  settings: () => call('GET', '/api/dealer/settings'),
  saveSettings: (body) => call('PUT', '/api/dealer/settings', body),
  addProduct: (body) => call('POST', '/api/dealer/products', body),
  saveProduct: (id, body) => call('PUT', `/api/dealer/products/${q(id)}`, body),
  countStock: (id, body) => call('POST', `/api/dealer/products/${q(id)}/stock`, body),
  changePin: (body) => call('PUT', '/api/dealer/pin', body),
}
