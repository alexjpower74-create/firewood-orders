// Rate guards per client IP: wrong PINs (sign-in and PIN change) and public order requests.
import { ApiError } from './errors.js'
import { clientIp } from './clock.js'

export const SIGNIN_WRONG_MAX = 5
export const SIGNIN_WINDOW_MS = 15 * 60e3
export const ORDERS_MAX = 10
export const ORDERS_WINDOW_MS = 60 * 60e3

const since = (c, ms) => new Date(c.now.getTime() - ms).toISOString()
const ip = (c) => clientIp(c.request, c.env)

// 5 wrong PINs in 15 minutes locks that IP out, even for the right PIN, until the oldest try is 15 minutes old.
export async function assertSigninAllowed(c) {
  const r = await c.db
    .prepare('SELECT COUNT(*) AS n FROM signin_attempts WHERE ip = ? AND ok = 0 AND at > ?')
    .bind(ip(c), since(c, SIGNIN_WINDOW_MS))
    .first()
  if (r.n >= SIGNIN_WRONG_MAX) throw new ApiError(429, 'rate_limited', 'Too many tries. Wait 15 minutes and try again.')
}

export function signinAttempt(c, ok) {
  return c.db.prepare('INSERT INTO signin_attempts (ip, ok, at) VALUES (?, ?, ?)').bind(ip(c), ok ? 1 : 0, c.nowIso)
}

// 10 accepted public orders an hour per IP. Refused (invalid) requests do not count.
export async function assertOrderAllowed(c) {
  const r = await c.db
    .prepare('SELECT COUNT(*) AS n FROM order_attempts WHERE ip = ? AND at > ?')
    .bind(ip(c), since(c, ORDERS_WINDOW_MS))
    .first()
  if (r.n >= ORDERS_MAX) {
    throw new ApiError(429, 'rate_limited', 'Too many order requests from here. Wait an hour, or call us.')
  }
}

export function orderAttempt(c) {
  return c.db.prepare('INSERT INTO order_attempts (ip, at) VALUES (?, ?)').bind(ip(c), c.nowIso)
}
