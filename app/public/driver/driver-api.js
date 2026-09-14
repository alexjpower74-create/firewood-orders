// The driver page talks to docs/API.md only through this file. Same origin; the token lives on the phone.
const TOKEN_KEY = 'firewood-orders:driver-token'

export class NetworkError extends Error {}

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
export function setToken(token) {
  try { localStorage.setItem(TOKEN_KEY, token) } catch {}
}
export function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY) } catch {}
}

// Answers { status, body } for every HTTP answer; throws NetworkError only when nothing came back (no signal).
async function request(method, path, { json, raw, type } = {}) {
  const headers = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let body
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(json)
  } else if (raw !== undefined) {
    headers['Content-Type'] = type
    body = raw
  }
  let r
  try {
    r = await fetch(path, { method, headers, body, cache: 'no-store' })
  } catch (e) {
    throw new NetworkError(String(e))
  }
  let data = null
  try { data = await r.json() } catch {}
  return { status: r.status, body: data }
}

export const api = {
  info: () => request('GET', '/api/info'),
  signin: (pin) => request('POST', '/api/signin', { json: { pin } }),
  day: (date) => request('GET', `/api/driver/day?date=${encodeURIComponent(date)}`),
  start: (date) => request('POST', `/api/driver/day/${encodeURIComponent(date)}/start`),
  checkin: (body) => request('POST', '/api/driver/checkins', { json: body }),
  photo: (opId, photo) => request('PUT', `/api/driver/checkins/${encodeURIComponent(opId)}/photo`, { raw: photo.data, type: photo.type }),
  undo: (opId) => request('DELETE', `/api/driver/checkins/${encodeURIComponent(opId)}`),
}
