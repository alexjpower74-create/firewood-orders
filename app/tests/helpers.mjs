// Shared e2e helpers. Lead-owned: slices import them and ask the lead for changes in their report.
// REAL input only: tap() hit-tests the target's centre with elementFromPoint before a real touch or click, typing is
// page.keyboard, and evaluate is only ever used to read. Setting up data through the API is fine; the thing under test is
// always driven through the page.
import { expect } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

export const NOW = '2026-09-14T11:30:00Z' // Mon Sep 14 2026, 9:00 AM NDT
export const DEALER_PIN = '1357'
export const DRIVER_PIN = '2580'
export const DEALER = 'SAMPLE Wood & Pellets — Springdale (demo)'
export const PORT = Number(process.env.E2E_PORT || 7703)
export const BASE = `http://127.0.0.1:${PORT}`

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const PLACES = JSON.parse(readFileSync(path.join(HERE, '..', '..', 'data', 'sample-places.json'), 'utf8')).places
export const place = (name) => {
  const p = PLACES.find((x) => x.name === name)
  if (!p) throw new Error(`no SAMPLE place named ${name}`)
  return p
}

// ---------- tiny PNG encoder (placeholder tiles and generated photos; no files, no third-party images) ----------
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0)
  return Buffer.concat([len, td, crc])
}
export function solidPng(width, height, [r, g, b]) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const row = Buffer.alloc(1 + width * 3)
  for (let x = 0; x < width; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b }
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
export const TILE_PNG = solidPng(256, 256, [30, 41, 59])
/** A generated stand-in for a delivery photo (never a real picture). */
export const samplePhotoPng = () => ({ name: 'delivery.png', mimeType: 'image/png', buffer: solidPng(320, 240, [120, 84, 50]) })

// ---------- context setup ----------
const LOCAL = new Set(['127.0.0.1', 'localhost'])
const isThirdParty = (url) => /^https?:$/.test(url.protocol) && !LOCAL.has(url.hostname)

/** Pinned server clock, OSM tiles from a local placeholder, and a record of anything that tried to leave this computer. */
export async function guardContext(context, { now = NOW } = {}) {
  await context.setExtraHTTPHeaders({ 'X-Test-Now': now })
  const offenders = []
  context.__offenders = offenders
  await context.route(isThirdParty, (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'tile.openstreetmap.org' || url.hostname.endsWith('.tile.openstreetmap.org')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG })
    }
    offenders.push(route.request().url())
    return route.abort()
  })
}

/** Fail when any request tried to reach a host other than 127.0.0.1 (tiles excepted: they never leave, see above). */
export function assertNoThirdParty(context) {
  expect(context.__offenders ?? [], 'requests that tried to leave 127.0.0.1').toEqual([])
}

/** Every test starts here: a clean SAMPLE database and a guarded context. */
export async function fresh(context, request, { now = NOW } = {}) {
  await guardContext(context, { now })
  const r = await request.post('/api/test/reset', { headers: { 'X-Test-Now': now } })
  expect(r.status(), 'POST /api/test/reset').toBe(200)
}

/** A second person (dealer, driver, another customer) on the same device type as the project. */
export async function newContext(browser, testInfo, { now = NOW } = {}) {
  const { browserName, defaultBrowserType, ...device } = testInfo.project.use
  const context = await browser.newContext({ ...device, baseURL: BASE })
  await guardContext(context, { now })
  return context
}

// ---------- real input ----------
/** Hit-test the centre with elementFromPoint, then a real touch (coarse pointer) or mouse click. */
export async function tap(page, locator, label = String(locator)) {
  await expect(locator).toBeVisible()
  await locator.scrollIntoViewIfNeeded()
  let box = await locator.boundingBox()
  expect(box, `tap(${label}): no box`).not.toBeNull()
  // "In view" to Playwright includes under a sticky header, where a person could not tap it. Pages mark sticky headers
  // with data-sticky-header; only in that case scroll the target to the middle first. Anything else on top still fails.
  const headerBottom = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('[data-sticky-header]')].map((h) => h.getBoundingClientRect().bottom)))
  if (box.y + box.height / 2 < headerBottom) {
    await locator.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    box = await locator.boundingBox()
  }
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const hit = await locator.evaluate((el, [px, py]) => {
    const t = document.elementFromPoint(px, py)
    return t === el || el.contains(t) ? '' : t ? t.outerHTML.slice(0, 160) : 'nothing'
  }, [x, y])
  expect(hit, `tap(${label}) hit-test at ${Math.round(x)},${Math.round(y)}: something else is on top`).toBe('')
  if (await isCoarse(page)) await page.touchscreen.tap(x, y)
  else await page.mouse.click(x, y)
}

export const isCoarse = (page) => page.evaluate(() => matchMedia('(pointer: coarse)').matches)

/** Tap into a field and type with the real keyboard. clear: select what is there first so typing replaces it. */
export async function type(page, locator, text, { clear = false } = {}) {
  await tap(page, locator)
  if (clear) { await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.press('Backspace') }
  await page.keyboard.type(String(text))
}

/** Tap a Leaflet map at a fraction of its box (0..1), after checking the point hits the map and not a control on top. */
export async function tapMap(page, mapLocator, fx = 0.5, fy = 0.5) {
  await expect(mapLocator).toBeVisible()
  await mapLocator.scrollIntoViewIfNeeded()
  const box = await mapLocator.boundingBox()
  const x = box.x + box.width * fx
  const y = box.y + box.height * fy
  const hit = await mapLocator.evaluate((el, [px, py]) => {
    const t = document.elementFromPoint(px, py)
    return t && el.contains(t) && !t.closest('.leaflet-control') ? '' : t ? t.outerHTML.slice(0, 160) : 'nothing'
  }, [x, y])
  expect(hit, `tapMap at ${Math.round(x)},${Math.round(y)}: not the map`).toBe('')
  if (await isCoarse(page)) await page.touchscreen.tap(x, y)
  else await page.mouse.click(x, y)
}

/** Size + hit-test for a tap target (size from the box is fine; occlusion only from elementFromPoint). */
export async function expectTapTarget(page, locator, min = 44, label = String(locator)) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  expect(box, `${label}: no box`).not.toBeNull()
  expect(box.height, `${label} height`).toBeGreaterThanOrEqual(min)
  expect(box.width, `${label} width`).toBeGreaterThanOrEqual(min)
  const hit = await locator.evaluate((el, [px, py]) => {
    const t = document.elementFromPoint(px, py)
    return t === el || el.contains(t) ? '' : t ? t.outerHTML.slice(0, 160) : 'nothing'
  }, [box.x + box.width / 2, box.y + box.height / 2])
  expect(hit, `${label}: something else is on top`).toBe('')
}

/** WCAG contrast of an element's computed text colour on its first opaque background up the tree. */
export async function contrastOf(locator) {
  return locator.evaluate((el) => {
    const parse = (s) => (s.match(/[\d.]+/g) || []).map(Number)
    const lum = ([r, g, b]) => {
      const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const fg = parse(getComputedStyle(el).color)
    let n = el; let bg = null
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n)
      const c = parse(cs.backgroundColor)
      if (c.length >= 3 && (c.length === 3 || c[3] > 0.99)) { bg = c; break }
      if (cs.backgroundImage && cs.backgroundImage.includes('gradient')) {
        const stops = cs.backgroundImage.match(/rgba?\([^)]*\)/g) || []
        const ratios = stops.map((s) => { const b = parse(s); const [a, d] = [lum(fg), lum(b)].sort((x, y) => y - x); return (a + 0.05) / (d + 0.05) })
        if (ratios.length) return Math.min(...ratios)
      }
      n = n.parentElement
    }
    bg = bg || [255, 255, 255]
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
    return (a + 0.05) / (b + 0.05)
  })
}

// ---------- API setup helpers (setup only; never for the thing under test) ----------
export async function api(request, method, url, data, headers = {}) {
  const r = await request.fetch(url, { method, data, headers: { 'X-Test-Now': NOW, ...headers } })
  let body = null
  const text = await r.text()
  try { body = JSON.parse(text) } catch { body = text }
  return { status: r.status(), body, type: r.headers()['content-type'] || '' }
}

export async function tokenFor(request, pin) {
  const r = await api(request, 'POST', '/api/signin', { pin })
  expect(r.status, `sign in with SAMPLE PIN ${pin}`).toBe(200)
  return r.body.token
}
export const dealerToken = (request) => tokenFor(request, DEALER_PIN)
export const driverToken = (request) => tokenFor(request, DRIVER_PIN)
export const bearer = (token) => ({ Authorization: `Bearer ${token}` })

/** Place an order through the public API (setup). Defaults: 1 cord of dry softwood near King's Point. */
export async function orderViaApi(request, overrides = {}) {
  const p = place(overrides.place || "King's Point")
  const body = {
    product_id: 'p_softwood_dry', unit: 'cord', qty: 1, stacking: false,
    lat: p.lat, lng: p.lng, address: `Near ${p.name} (SAMPLE)`, dump_notes: 'By the shed, not on the lawn',
    zone_id: null, preferred: { any: true }, name: 'Wade R. (SAMPLE)', phone: '709-555-0142', note: '',
    ...overrides,
  }
  delete body.place
  const r = await api(request, 'POST', '/api/orders', body, { 'X-Test-IP': `setup-${Math.random()}` })
  expect(r.status, `orderViaApi: ${JSON.stringify(r.body)}`).toBe(201)
  return r.body
}

// ---------- screenshots ----------
/** Full-page screenshot into app/tests/<dir>/shots/<project>-<name>.png (dir: web | driver | journey). */
export async function shot(page, testInfo, dir, name) {
  const out = path.join(HERE, dir, 'shots')
  mkdirSync(out, { recursive: true })
  if (!(await isCoarse(page))) {
    await page.mouse.move(200, 200)
    for (let i = 0; i < 6 && (await page.evaluate(() => window.scrollY)) > 0; i++) {
      await page.mouse.wheel(0, -4000)
      await page.waitForTimeout(120)
    }
  } else {
    // Touch projects have no wheel in Playwright; screenshot staging only, after every check.
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(120)
  }
  await page.screenshot({ path: path.join(out, `${testInfo.project.name}-${name}.png`), fullPage: true, animations: 'disabled' })
}
