// Small shared pieces for the customer and dealer pages: escaping, money from cents (the one place it is formatted),
// cords from cubic inches, status labels, icons, the dealer header, copy to clipboard and inline field errors.
// No clock in here: every date and label comes from the API.

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** Integer cents → "$1,234.56" ("-$20.00" below zero). Integer arithmetic only. */
export function money(cents) {
  const n = Math.trunc(Number(cents) || 0)
  const a = Math.abs(n)
  const dollars = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${n < 0 ? '-' : ''}$${dollars}.${String(a % 100).padStart(2, '0')}`
}

/** "12.50", "$1,234.5", "100" → integer cents, or null when it isn't an amount of money. No floats. */
export function dollarsToCents(text) {
  const m = /^\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d{0,2}))?\s*$/.exec(String(text ?? ''))
  if (!m || (m[1] === undefined && !m[2])) return null
  const whole = Number((m[1] || '0').replace(/,/g, ''))
  const frac = Number((m[2] || '').padEnd(2, '0'))
  return whole * 100 + frac
}

export const CU_IN_PER_CORD = 221184

/** Cubic inches → "1.00" cords (rounded half-up to 2 decimals, integer arithmetic). */
export function cords(cuIn) {
  const hundredths = Math.floor((Number(cuIn) * 100 + CU_IN_PER_CORD / 2) / CU_IN_PER_CORD)
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`
}

/** The volume chip for an order summary: "1.00 cord" / "2.50 cords" / "70 bags". */
export function volumeText(o) {
  if (o.kind === 'pellets') return `${o.pellet_bags} ${o.pellet_bags === 1 ? 'bag' : 'bags'}`
  const c = cords(o.wood_cu_in)
  return `${c} ${c === '1.00' ? 'cord' : 'cords'}`
}

export function balanceLabel(cents) {
  if (cents > 0) return `Balance owing ${money(cents)}`
  if (cents < 0) return `Credit ${money(-cents)}`
  return 'Paid in full'
}

export const STATUS = {
  requested: 'Requested',
  scheduled: 'Scheduled',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

export const METHODS = { cash: 'Cash', etransfer: 'e-Transfer', cheque: 'Cheque', card: 'Card', other: 'Other' }

const svg = (d, size = 20) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`
export const icon = {
  back: svg('<path d="m15 6-6 6 6 6"/>', 18),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 16),
  checkBig: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 40),
  minus: svg('<path d="M5 12h14"/>', 22),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 22),
  inbox: svg('<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 5h14l2 8v6H3v-6z"/>'),
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  truck: svg('<path d="M2 6h11v10H2zM13 10h5l3 3v3h-8z"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>'),
  done: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>'),
  dollar: svg('<circle cx="12" cy="12" r="9"/><path d="M14.8 9.2c-.5-.9-1.5-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2.1 0 2.9 5.8 1.5 5.8 4.3 0 1.3-1.2 2.2-3 2.2-1.4 0-2.5-.6-3-1.6M12 6v1.8M12 16.4V18"/>'),
  phone: svg('<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>', 18),
  pin: svg('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>', 18),
  wood: svg('<ellipse cx="7" cy="12" rx="4" ry="5"/><path d="M7 7h11a4 5 0 0 1 0 10H7"/><ellipse cx="7" cy="12" rx="1.5" ry="2"/>'),
  pellets: svg('<path d="M6 4h12l1 4v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8z"/><path d="M5 8h14M9 13h6"/>'),
  signout: svg('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/>', 18),
}

/** Every screen names the dealer and carries the SAMPLE badge while the API says it is the sample dealer. */
export function showDealer(dealer) {
  if (!dealer) return
  for (const el of document.querySelectorAll('[data-dealer-name]')) el.textContent = dealer.name
  for (const el of document.querySelectorAll('[data-sample]')) el.hidden = !dealer.sample
  if (dealer.name) document.title = `${document.title.split(' · ')[0]} · ${dealer.short_name || dealer.name}`
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;'
    document.body.append(ta)
    ta.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch {}
    ta.remove()
    return ok
  }
}

/** Copy, then let the button say "Copied" for a moment (its own label comes back after). */
export async function copyButton(button, text) {
  const label = button.dataset.label || button.textContent
  button.dataset.label = label
  const ok = await copyText(text)
  button.textContent = ok ? 'Copied' : 'Could not copy. Select the text and copy it.'
  clearTimeout(button._copyTimer)
  button._copyTimer = setTimeout(() => { button.textContent = label }, 2500)
}

/** Remove every inline error inside root. */
export function clearErrors(root) {
  for (const el of root.querySelectorAll('[data-error-for]')) { el.textContent = ''; el.hidden = true }
  for (const el of root.querySelectorAll('[aria-invalid="true"]')) el.removeAttribute('aria-invalid')
}

/** Put a message under the input named by field (the API's `field`); falls back to the form-level slot. */
export function showError(root, field, message) {
  const slot = (field && root.querySelector(`[data-error-for="${CSS.escape(field)}"]`)) || root.querySelector('[data-error-for="form"]')
  if (!slot) return null
  slot.textContent = message
  slot.hidden = false
  const input = field && root.querySelector(`[data-field="${CSS.escape(field)}"]`)
  if (input) input.setAttribute('aria-invalid', 'true')
  return slot
}

export function debounce(fn, ms) {
  let t
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms) }
}
