// The pages' only door to the Worker: same-origin fetch('/api/…') per docs/API.md. A failed call throws ApiError whose
// message is the API's own `error` text, shown to people as is, with `field` naming the input it belongs under.
// Dealer routes carry the session token from localStorage (`firewood-orders:dealer-token`); a 401 on them clears it and
// fires SIGNED_OUT. `?mock=1` swaps in api.mock.js for development (remembered for the tab; `?mock=0` turns it off).
// Playwright never uses the mock.

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

const isDealer = (path) => path.startsWith('/api/dealer/') || path === '/api/signout'

async function send(method, path, body) {
  const headers = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  const token = session.get()
  if (token && isDealer(path)) headers.authorization = `Bearer ${token}`
  if (mock) {
    const r = await mock.handle(method, path, body, headers)
    return { status: r.status, data: r.body }
  }
  let res
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' })
  } catch {
    throw new ApiError(0, { error: "We couldn't reach the server. Check your signal and try again.", code: 'network' })
  }
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch {}
  return { status: res.status, data }
}

async function call(method, path, body) {
  const r = await send(method, path, body)
  if (r.status >= 200 && r.status < 300) return r.data
  if (r.status === 401 && isDealer(path)) {
    session.clear()
    window.dispatchEvent(new CustomEvent(SIGNED_OUT, { detail: r.data?.error || '' }))
  }
  throw new ApiError(r.status, r.data)
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
  // sign-in
  signin: (pin) => call('POST', '/api/signin', { pin }),
  signout: () => call('POST', '/api/signout', {}),
  // dealer
  board: () => call('GET', '/api/dealer/board'),
  order: (id) => call('GET', order(id)),
  phoneOrder: (body) => call('POST', '/api/dealer/orders', body),
  schedule: (id, date) => call('POST', `${order(id)}/schedule`, { date }),
  unschedule: (id) => call('POST', `${order(id)}/unschedule`, {}),
  days: () => call('GET', '/api/dealer/days'),
  route: (date) => call('GET', `/api/dealer/days/${q(date)}/route`),
  optimize: (date) => call('POST', `/api/dealer/days/${q(date)}/route/optimize`, {}),
  putRoute: (date, ids) => call('PUT', `/api/dealer/days/${q(date)}/route`, { order_ids: ids }),
  recordPayment: (body) => call('POST', '/api/dealer/payments', body),
}
