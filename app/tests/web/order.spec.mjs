// The customer's order page against the real Worker, with real taps and the real keyboard: all five steps, the live price
// bar against the API's quote and against numbers worked out by hand, the unit explanations, the API's refusals under
// their fields, and Request sent → the status link.
import { test, expect } from '@playwright/test'
import { api, assertNoThirdParty, fresh, shot, tap } from '../helpers.mjs'
import { hstOf, pinAt, typeIn, watch } from './web-helpers.mjs'

const EXPLAIN = {
  cord: 'A full cord: a stack 4 feet high, 4 feet wide and 8 feet long (128 cubic feet).',
  face_cord: 'A face cord: one row 4 feet high and 8 feet long, as deep as the pieces are long (16 inches). That is 0.33 of a full cord.',
  load: 'A load is what our dump truck carries in one trip, dumped in a pile, not stacked. We count a load as 1.5 cords.',
}

// The quote the page asks once the map has a pin (before that, the page quotes with no pin at all).
const quoteWithPin = (page) =>
  page.waitForResponse((r) => {
    if (!r.url().endsWith('/api/quote') || r.request().method() !== 'POST') return false
    const body = JSON.parse(r.request().postData() || '{}')
    return typeof body.lat === 'number' && typeof body.lng === 'number'
  })

test('five steps with real taps: the total is the API quote and the hand-worked $373.75, and Request sent opens Requested', async ({
  page,
  context,
  request,
}, testInfo) => {
  await fresh(context, request)
  const w = watch(page)
  const info = (await api(request, 'GET', '/api/info')).body

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Order firewood or pellets' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'What would you like?' })).toBeVisible()
  await shot(page, testInfo, 'web', 'order-1-what')
  await tap(page, page.locator('button.product[data-product="p_softwood_dry"]'))
  await tap(page, page.locator('#next'))

  await expect(page.getByRole('heading', { name: 'How much?' })).toBeVisible()
  const explain = page.locator('#unit-explain')
  await expect(explain).toHaveText(EXPLAIN.cord)
  await tap(page, page.locator('button.unit[data-unit="face_cord"]'))
  await expect(explain).toHaveText(EXPLAIN.face_cord)
  await tap(page, page.locator('button.unit[data-unit="load"]'))
  await expect(explain).toHaveText(EXPLAIN.load)
  await tap(page, page.locator('button.unit[data-unit="cord"]'))
  await expect(explain).toHaveText(EXPLAIN.cord)
  await expect(page.locator('#quote-goods')).toContainText('$300.00')

  // Before the pin the page asks the API with no pin at all, and the API answers goods and stacking with no delivery,
  // HST or total; the bar shows exactly that. Stacking is switched on here so both numbers show.
  const noPin = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/quote') && r.request().method() === 'POST' && JSON.parse(r.request().postData() || '{}').stacking === true,
  )
  await tap(page, page.locator('#stacking'))
  const noPinRes = await noPin
  const noPinBody = JSON.parse(noPinRes.request().postData())
  expect(Object.keys(noPinBody), 'a quote before the pin carries no lat/lng').not.toContain('lat')
  expect(Object.keys(noPinBody)).not.toContain('lng')
  expect(noPinRes.status()).toBe(200)
  const noPinQuote = await noPinRes.json()
  expect([
    noPinQuote.goods_cents,
    noPinQuote.stacking_cents,
    noPinQuote.distance_km,
    noPinQuote.delivery_cents,
    noPinQuote.hst_cents,
    noPinQuote.total_cents,
  ]).toEqual([30000, 6000, null, null, null, null])
  await expect(page.locator('#quote-goods')).toContainText('$300.00')
  await expect(page.locator('#quote-stacking')).toContainText('$60.00')
  await expect(page.locator('#quote-delivery')).toContainText('after the map pin')
  await expect(page.locator('#quote-hst')).toHaveCount(0)
  await expect(page.locator('#quote-total')).toHaveText('—')
  await shot(page, testInfo, 'web', 'order-2-how-much')
  await tap(page, page.locator('#stacking'))
  await expect(page.locator('#quote-stacking')).toHaveCount(0)
  await tap(page, page.locator('#next'))

  await expect(page.getByRole('heading', { name: 'Where should we drop it?' })).toBeVisible()
  await expect(page.getByText('Tap the map where the truck should dump it', { exact: true })).toBeVisible()
  const attribution = page.locator('.leaflet-control-attribution')
  await expect(attribution).toBeVisible()
  await expect(attribution).toContainText('OpenStreetMap')

  const quoted = quoteWithPin(page)
  await pinAt(page, page.locator('#map'), info.yard, "King's Point")
  const quoteRes = await quoted
  const sentBody = JSON.parse(quoteRes.request().postData())
  const quote = await quoteRes.json()
  // By hand from docs/API.md: 1 cord $300.00, King's Point is 12.9 km (the $25.00 band), HST 15 % half-up per order.
  const goods = 30000
  const delivery = 2500
  const hst = hstOf(goods + delivery)
  expect(hst).toBe(4875)
  expect(goods + delivery + hst).toBe(37375)
  expect(quote.total_cents).toBe(37375)
  const again = await api(request, 'POST', '/api/quote', sentBody)
  expect(again.body.total_cents, 'the same quote asked of the API directly').toBe(quote.total_cents)
  await expect(page.locator('#quote-total')).toHaveText('$373.75')
  await expect(page.locator('#quote-delivery')).toContainText('$25.00')
  await expect(page.locator('#quote-hst')).toContainText('$48.75')
  await expect(page.locator('#distance')).toHaveText(`${quote.distance_km.toFixed(1)} km from our yard, as the crow flies`)

  await typeIn(page, page.locator('#address'), 'Up the lane past the church (SAMPLE)')
  await typeIn(page, page.locator('#dump-notes'), 'By the shed, not on the lawn')
  await shot(page, testInfo, 'web', 'order-3-where')
  await tap(page, page.locator('#next'))

  await expect(page.getByRole('heading', { name: 'Which days suit you?' })).toBeVisible()
  await tap(page, page.locator('button.day[data-date="2026-09-16"]'))
  await tap(page, page.locator('button.day[data-date="2026-09-17"]'))
  await expect(page.locator('button.day[data-date="2026-09-16"]')).toHaveAttribute('aria-pressed', 'true')
  await shot(page, testInfo, 'web', 'order-4-when')
  await tap(page, page.locator('#next'))

  await typeIn(page, page.locator('#name'), 'Joan T. (SAMPLE)')
  await typeIn(page, page.locator('#phone'), '709-555-0107')
  await shot(page, testInfo, 'web', 'order-5-you')
  const placed = page.waitForResponse((r) => r.url().endsWith('/api/orders') && r.request().method() === 'POST')
  await tap(page, page.locator('#send'))
  const placedRes = await placed
  expect(placedRes.status()).toBe(201)
  const order = await placedRes.json()
  expect(order.quote.total_cents).toBe(37375)

  await expect(page.getByRole('heading', { name: 'Request sent' })).toBeVisible()
  await expect(page.getByText('Keep this link to check on your order.')).toBeVisible()
  const link = new URL(order.status_url, page.url()).href
  await expect(page.locator('#status-link')).toHaveValue(link)
  await tap(page, page.getByRole('button', { name: 'Copy link' }))
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible()
  await shot(page, testInfo, 'web', 'order-sent')

  await page.goto(link)
  await expect(page.locator('#status')).toHaveText('Requested')
  await expect(page.locator('#owing')).toHaveText('Balance owing $373.75')
  await expect(page.locator('#deposit')).toContainText(info.deposit_text)
  w.expectClean()
  assertNoThirdParty(context)
})

test("an HST that is not whole cents is rounded half-up per order: 14 bags to King's Point is $157.39", async ({
  page,
  context,
  request,
}) => {
  await fresh(context, request)
  const w = watch(page)
  const info = (await api(request, 'GET', '/api/info')).body
  await page.goto('/')
  await tap(page, page.locator('button.product[data-product="p_pellets"]'))
  await tap(page, page.locator('#next'))
  for (let i = 0; i < 13; i++) await tap(page, page.locator('#qty-plus'), 'One more')
  await expect(page.locator('#qty')).toHaveText('14')
  await tap(page, page.locator('#next'))
  const quoted = quoteWithPin(page)
  await pinAt(page, page.locator('#map'), info.yard, "King's Point")
  await quoted
  // 14 × $7.99 = $111.86, + $25.00 delivery = $136.86. 15 % of that is 2 052.9 cents: half-up per order is $20.53.
  const subtotal = 14 * 799 + 2500
  expect((subtotal * 15) % 100, 'this HST must not be whole cents').not.toBe(0)
  expect(hstOf(subtotal)).toBe(2053)
  await expect(page.locator('#quote-hst')).toContainText('$20.53')
  await expect(page.locator('#quote-total')).toHaveText('$157.39')
  w.expectClean()
  assertNoThirdParty(context)
})

test("below the minimum and outside the area: the API's messages appear under their fields", async ({
  page,
  context,
  request,
}, testInfo) => {
  await fresh(context, request)
  const w = watch(page)
  const info = (await api(request, 'GET', '/api/info')).body
  await page.goto('/')
  await tap(page, page.locator('button.product[data-product="p_pellets"]'))
  await tap(page, page.locator('#next'))
  const qtyError = page.locator('[data-error-for="qty"]')
  await expect(qtyError).toHaveText('The smallest order we deliver is $110.00 before delivery.')
  await tap(page, page.locator('#next'), 'Next while below the minimum')
  await expect(page.getByRole('heading', { name: 'How much?' })).toBeVisible()

  await tap(page, page.locator('button.unit[data-unit="skid"]'))
  await expect(qtyError).toBeHidden()
  await tap(page, page.locator('#next'))
  await expect(page.getByRole('heading', { name: 'Where should we drop it?' })).toBeVisible()
  for (let i = 0; i < 3; i++) {
    await tap(page, page.locator('.leaflet-control-zoom-out'), 'Zoom out')
    await expect(page.locator('.leaflet-zoom-anim')).toHaveCount(0)
    await page.waitForTimeout(300)
  }
  await pinAt(page, page.locator('#map'), info.yard, 'Buchans', 7)
  const pinError = page.locator('[data-error-for="pin"]')
  await expect(pinError).toHaveText(info.delivery.beyond_message)
  await expect(page.locator('#quote-total')).toHaveText('—')
  await typeIn(page, page.locator('#address'), 'Near Buchans (SAMPLE)')
  await tap(page, page.locator('#next'), 'Next outside the area')
  await expect(page.getByRole('heading', { name: 'Where should we drop it?' })).toBeVisible()
  await shot(page, testInfo, 'web', 'order-outside-area')
  w.expectClean()
  assertNoThirdParty(context)
})

test('each product card names the unit its "from" price is for, so green wood does not look dearer than dry', async ({
  page,
  context,
  request,
}) => {
  await fresh(context, request)
  const w = watch(page)
  const info = (await api(request, 'GET', '/api/info')).body
  const EACH = {
    cord: 'a cord',
    half_cord: 'a half cord',
    face_cord: 'a face cord',
    load: 'a load',
    bag: 'a bag',
    ton: 'a ton',
    skid: 'a skid',
  }
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'What would you like?' })).toBeVisible()
  // Worked out by hand from the SAMPLE price list: the cheapest unit of each product, with its unit.
  const byHand = {
    p_softwood_dry: 'from $120.00 a face cord',
    p_birch_dry: 'from $140.00 a face cord',
    p_softwood_green: 'from $220.00 a cord',
    p_pellets: 'from $7.99 a bag',
  }
  for (const p of info.products) {
    const cheapest = p.units.reduce((a, b) => (b.price_cents < a.price_cents ? b : a))
    const fromApi = `from $${(cheapest.price_cents / 100).toFixed(2)} ${EACH[cheapest.unit]}`
    expect(fromApi, `${p.id}: the API's cheapest unit matches the hand-worked label`).toBe(byHand[p.id])
    await expect(page.locator(`button.product[data-product="${p.id}"] .product-price`)).toHaveText(byHand[p.id])
  }
  w.expectClean()
  assertNoThirdParty(context)
})
