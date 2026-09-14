// fo2's shared pieces for the web specs (on top of the lead's tests/helpers.mjs). Setup through the API only; the thing
// under test is always driven through the page.
import { expect } from '@playwright/test'
import { api, bearer, isCoarse, orderViaApi, place, tap, type, DEALER_PIN } from '../helpers.mjs'

/** HST exactly as docs/API.md writes it: 15 %, half-up, per order, on integer cents. */
export const hstOf = (subtotalCents) => Math.floor((subtotalCents * 15 + 50) / 100)

/** Page errors and console errors fail the test. A failed resource load is not one: the browser logs every API 4xx
 *  that a test provokes on purpose (a wrong PIN, a 409), and the page shows those to the person. */
export function watch(page) {
  const problems = []
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console error: ${m.text()}`)
  })
  return { expectClean: () => expect(problems, 'page errors and console errors').toEqual([]) }
}

/** Where a lat/lng sits on a Leaflet map box, as fractions for tapMap, from the map's centre and zoom (Web Mercator). */
export function mapFraction(box, center, target, zoom) {
  const project = (lat, lng) => {
    const size = 256 * 2 ** zoom
    const s = Math.sin((lat * Math.PI) / 180)
    return { x: ((lng + 180) / 360) * size, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size }
  }
  const c = project(center.lat, center.lng)
  const t = project(target.lat, target.lng)
  return [0.5 + (t.x - c.x) / box.width, 0.5 + (t.y - c.y) / box.height]
}

/** Tap the order map at a SAMPLE place, with the map still at the yard and zoom it opened with. */
export async function pinAt(page, map, yard, name, zoom = 10) {
  await expect(map).toBeVisible()
  await map.scrollIntoViewIfNeeded()
  const box = await map.boundingBox()
  const { tapMap } = await import('../helpers.mjs')
  await tapMap(page, map, ...mapFraction(box, yard, place(name), zoom))
}

/** A hit-tested tap into the field, then text the way that device sends it, then a check that it really landed.
 *  Mouse projects: the lead's type() (real key presses). Touch projects: page.keyboard.insertText, which is what a phone's
 *  on-screen keyboard sends. Why: in Chromium's emulated touch, key presses typed straight after a touch tap were dropped
 *  in one field of the dealer's phone-order form (keydown fired, no input event, no preventDefault anywhere). The same
 *  tap followed by insertText, a mouse click followed by key presses, WebKit touch and every 1280 project all typed
 *  fine (bisected on the real Worker, see docs/build-report-fo2.md). The value check makes any lost text fail here. */
export async function typeIn(page, locator, text, { clear = false } = {}) {
  const before = clear ? '' : await locator.inputValue()
  if (await isCoarse(page)) {
    await tap(page, locator)
    if (clear) {
      await page.keyboard.press('ControlOrMeta+a')
      await page.keyboard.press('Backspace')
    }
    await page.keyboard.insertText(String(text))
  } else {
    await type(page, locator, text, { clear })
  }
  await expect(locator, `typed ${JSON.stringify(text)} into ${locator}`).toHaveValue(before + String(text))
}

export async function signInDealer(page) {
  await page.goto('/dealer/')
  await type(page, page.locator('#pin'), DEALER_PIN)
  await tap(page, page.locator('#signin-btn'))
  await expect(page.getByRole('tab', { name: 'Orders' })).toHaveAttribute('aria-selected', 'true')
}

export async function scheduleViaApi(request, token, id, date) {
  const r = await api(request, 'POST', `/api/dealer/orders/${id}/schedule`, { date }, bearer(token))
  expect(r.status, `schedule ${id} into ${date}: ${JSON.stringify(r.body)}`).toBe(200)
  return r.body.order
}

/** Put `count` one-cord orders on a day through the API (setup), each at its own SAMPLE place and phone. */
export async function fillDay(request, token, date, places) {
  const ids = []
  for (const [i, name] of places.entries()) {
    const o = await orderViaApi(request, { place: name, name: `Filler ${i + 1} (SAMPLE)`, phone: `709-555-03${String(10 + i)}` })
    await scheduleViaApi(request, token, o.id, date)
    ids.push(o.id)
  }
  return ids
}
