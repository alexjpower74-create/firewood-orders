// PINs (PBKDF2-SHA256, 100 000 iterations) and session tokens (stored as SHA-256). WebCrypto only.
export const PBKDF2_ITERATIONS = 100000
export const DEALER_HOURS = 12
export const DRIVER_DAYS = 14

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)))

export async function hashPin(pin, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: PBKDF2_ITERATIONS }, key, 256)
  return hex(bits)
}

// Constant-time compare of two hex strings of equal length.
export function sameHex(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function sha256Hex(text) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

// 24 random bytes → 32 url-safe characters.
export function randomToken(bytes = 24) {
  const b = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomId(prefix) {
  return `${prefix}_${hex(crypto.getRandomValues(new Uint8Array(8)))}`
}

export function randomSaltHex() {
  return hex(crypto.getRandomValues(new Uint8Array(16)))
}
