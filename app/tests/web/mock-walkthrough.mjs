// fo2 M1 walkthrough against the in-browser mock (?mock=1), before fo1's Worker exists. NOT a spec and not evidence
// against the real API: it drives every M1 screen with real input (the lead's tap/type/tapMap helpers), fails on any
// page error or console error, and takes the M1 screenshots into app/tests/web/shots/ as mock-<project>-<name>.png.
// The real-Worker specs (order/status/dealer/…) come in M2.
//   node tests/web/mock-walkthrough.mjs            (static server for app/public on 127.0.0.1:7701 first)
import { chromium, webkit, devices } from '@playwright/test'
import { expect } from '@playwright/test'
import { guardContext, assertNoThirdParty, tap, type, tapMap, shot, contrastOf } from '../helpers.mjs'

const BASE = `http://127.0.0.1:${process.env.MOCK_PORT || 7701}`
const PROJECTS = [
  {
    name: 'mock-chromium-390',
    engine: chromium,
    use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
    clipboard: true,
  },
  { name: 'mock-chromium-1280', engine: chromium, use: { viewport: { width: 1280, height: 800 } }, clipboard: true },
  { name: 'mock-webkit-390', engine: webkit, use: { ...devices['iPhone 14'] }, clipboard: false },
  { name: 'mock-webkit-1280', engine: webkit, use: { viewport: { width: 1280, height: 800 } }, clipboard: false },
]
const only = process.argv[2]

function fractionFor(box, center, target, zoom) {
  const project = (lat, lng) => {
    const size = 256 * 2 ** zoom
    const s = Math.sin((lat * Math.PI) / 180)
    return { x: ((lng + 180) / 360) * size, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size }
  }
  const c = project(center.lat, center.lng)
  const t = project(target.lat, target.lng)
  return [0.5 + (t.x - c.x) / box.width, 0.5 + (t.y - c.y) / box.height]
}

const YARD = { lat: 49.5119027, lng: -56.0642695 }
const KINGS_POINT = { lat: 49.5807861, lng: -56.208 }
const BUCHANS = { lat: 48.8238, lng: -56.8490694 }

async function run(p) {
  const state = {}
  try {
    await walk(p, state)
  } catch (e) {
    e.page = state.page
    e.problems = state.problems
    throw e
  }
}

async function walk(p, state) {
  const browser = await p.engine.launch()
  const context = await browser.newContext({
    ...p.use,
    baseURL: BASE,
    ...(p.clipboard ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}),
  })
  await guardContext(context)
  const page = await context.newPage()
  const problems = []
  state.page = page
  state.problems = problems
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`)
  })
  const info = { project: { name: p.name } }
  const S = (name) => shot(page, info, 'web', name)
  const log = (s) => console.log(`[${p.name}] ${s}`)

  // ---- order page, all five steps ----
  await page.goto('/?mock=1&reset=1&closed=0')
  await expect(page.getByRole('heading', { name: 'Order firewood or pellets' })).toBeVisible()
  await expect(page.locator('.sample-badge')).toBeVisible()
  await S('order-1-what')
  await tap(page, page.locator('#next'), 'Next without a product')
  await expect(page.locator('[data-error-for="product_id"]')).toHaveText('Choose what you would like.')
  await tap(page, page.locator('button.product[data-product="p_softwood_dry"]'))
  await tap(page, page.locator('#next'))
  await expect(page.getByRole('heading', { name: 'How much?' })).toBeVisible()
  await expect(page.locator('#unit-explain')).toContainText('A full cord: a stack 4 feet high')
  await tap(page, page.locator('button.unit[data-unit="face_cord"]'))
  await expect(page.locator('#unit-explain')).toContainText('(16 inches). That is 0.33 of a full cord.')
  await tap(page, page.locator('button.unit[data-unit="load"]'))
  await expect(page.locator('#unit-explain')).toHaveText(
    'A load is what our dump truck carries in one trip, dumped in a pile, not stacked. We count a load as 1.5 cords.',
  )
  await tap(page, page.locator('button.unit[data-unit="cord"]'))
  await expect(page.locator('#quote-goods')).toContainText('$300.00')
  await S('order-2-how-much')
  await tap(page, page.locator('#next'))
  await expect(page.getByText('Tap the map where the truck should dump it', { exact: true })).toBeVisible()
  await tap(page, page.locator('#next'), 'Next without a pin')
  await expect(page.locator('[data-error-for="pin"]')).toHaveText('Tap the map where the truck should dump it.')
  await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap')
  await page.waitForTimeout(400)
  let box = await page.locator('#map').boundingBox()
  await tapMap(page, page.locator('#map'), ...fractionFor(box, YARD, KINGS_POINT, 10))
  await expect(page.locator('#quote-total')).toHaveText('$373.75')
  await expect(page.locator('#quote-hst')).toContainText('$48.75')
  await expect(page.locator('#distance')).toContainText('km from our yard, as the crow flies')
  log(`distance: ${await page.locator('#distance').textContent()}`)
  await tap(page, page.locator('#next'), 'Next without address')
  await expect(page.locator('[data-error-for="address"]')).toBeVisible()
  await type(page, page.locator('#address'), 'Up the lane past the church (SAMPLE)')
  await type(page, page.locator('#dump-notes'), 'By the shed, not on the lawn')
  await S('order-3-where')
  await tap(page, page.locator('#next'))
  await expect(page.getByRole('heading', { name: 'Which days suit you?' })).toBeVisible()
  await tap(page, page.locator('button.day[data-date="2026-09-16"]'))
  await tap(page, page.locator('button.day[data-date="2026-09-17"]'))
  await S('order-4-when')
  await tap(page, page.locator('#next'))
  await type(page, page.locator('#name'), 'Joan T. (SAMPLE)')
  await type(page, page.locator('#phone'), '709-555-0107')
  // The sticky price bar must not cover the focused field or Send (hit-test, not rectangles).
  await tap(page, page.locator('#phone'), 'phone after typing')
  await tap(page, page.locator('#note'), 'note field')
  const primary = await contrastOf(page.locator('#send'))
  expect(primary, 'Send request contrast').toBeGreaterThanOrEqual(4.5)
  log(`Send request contrast ${primary.toFixed(2)}`)
  await S('order-5-you')
  await tap(page, page.locator('#send'))
  await expect(page.getByRole('heading', { name: 'Request sent' })).toBeVisible()
  await expect(page.getByText('Keep this link to check on your order.')).toBeVisible()
  const link = await page.locator('#status-link').inputValue()
  expect(link).toMatch(/\/o\/\?t=/)
  await tap(page, page.getByRole('button', { name: 'Copy link' }))
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible()
  if (p.clipboard) expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link)
  await S('order-sent')

  // ---- status page ----
  await page.goto(link)
  await expect(page.locator('#status')).toHaveText('Requested')
  await expect(page.locator('#owing')).toHaveText('Balance owing $373.75')
  await expect(page.locator('#deposit')).toContainText('This page takes no payments.')
  await S('status-requested')
  for (const [tok, label] of [
    ['demo-scheduled-sample', 'Scheduled for Tuesday, September 15'],
    ['demo-out-sample', 'Out for delivery'],
    ['demo-delivered-sample', 'Delivered'],
    ['demo-cancelled-sample', 'Cancelled'],
  ]) {
    await page.goto(`/o/?t=${tok}`)
    await expect(page.locator('#status')).toHaveText(label)
    await S(`status-${tok.split('-')[1]}`)
  }
  await page.goto('/o/?t=not-a-real-token-at-all')
  await expect(page.getByText("We couldn't find that order. Check the link or call us.")).toBeVisible()
  await S('status-not-found')

  // ---- order page errors: below minimum, outside the area ----
  await page.goto('/?reset=0')
  await tap(page, page.locator('button.product[data-product="p_pellets"]'))
  await tap(page, page.locator('#next'))
  await expect(page.locator('[data-error-for="qty"]')).toHaveText('The smallest order we deliver is $110.00 before delivery.')
  await tap(page, page.locator('#next'), 'Next below the minimum')
  await expect(page.getByRole('heading', { name: 'How much?' })).toBeVisible()
  await tap(page, page.locator('button.unit[data-unit="skid"]'))
  await expect(page.locator('[data-error-for="qty"]')).toBeHidden()
  await tap(page, page.locator('#next'))
  await page.waitForTimeout(400)
  for (let i = 0; i < 3; i++) {
    await tap(page, page.locator('.leaflet-control-zoom-out'), 'zoom out')
    await page.waitForTimeout(450)
  }
  box = await page.locator('#map').boundingBox()
  await tapMap(page, page.locator('#map'), ...fractionFor(box, YARD, BUCHANS, 7))
  await expect(page.locator('[data-error-for="pin"]')).toHaveText(
    "That's farther than we deliver. Call us at 709-555-0100 and we'll see what we can do.",
  )
  await expect(page.locator('#quote-total')).toHaveText('—')
  await S('order-outside-area')

  // ---- season closed ----
  await page.goto('/?closed=1')
  await expect(page.getByText("We're closed for the season. Call 709-555-0100 and we'll take your name for the fall.")).toBeVisible()
  await S('order-season-closed')
  await page.goto('/?closed=0')

  // ---- dealer ----
  await page.goto('/dealer/')
  await page.evaluate(() => localStorage.removeItem('firewood-orders:dealer-token'))
  await page.reload()
  await expect(page.locator('#pin')).toBeVisible()
  await S('dealer-signin')
  await type(page, page.locator('#pin'), '0000')
  await tap(page, page.locator('#signin-btn'))
  await expect(page.getByText('That PIN is not right.')).toBeVisible()
  await type(page, page.locator('#pin'), '1357', { clear: true })
  await tap(page, page.locator('#signin-btn'))
  await expect(page.getByRole('tab', { name: 'Orders' })).toHaveAttribute('aria-selected', 'true')
  const newCard = page.locator('.order-card', { hasText: 'Joan T. (SAMPLE)' })
  await expect(newCard).toBeVisible()
  await S('dealer-orders')

  // Schedule into Tue Sep 15 (3.50 cords planned; 1 cord fits to 4.50).
  await tap(page, newCard.getByRole('button', { name: 'Schedule' }))
  await expect(newCard.locator('button.day[data-date="2026-09-15"]')).toContainText('3.50 of 4.50 cords')
  await S('dealer-schedule-picker')
  await tap(page, newCard.locator('button.day[data-date="2026-09-15"]'))
  await expect(page.locator('.order-list .order-card', { hasText: 'Joan T. (SAMPLE)' })).toHaveCount(0)
  await tap(page, page.locator('.stat[data-bucket="scheduled"]'))
  await expect(page.locator('.order-card', { hasText: 'Joan T. (SAMPLE)' })).toContainText('On Tue Sep 15')

  // Capacity: the day is now full; Wade's 1 cord → the API's over-capacity message in role=alert, and it stays under New.
  await tap(page, page.locator('.stat[data-bucket="new"]'))
  const wade = page.locator('.order-card', { hasText: 'Wade R. (SAMPLE)' })
  await tap(page, wade.getByRole('button', { name: 'Schedule' }))
  await tap(page, wade.locator('button.day[data-date="2026-09-15"]'))
  await expect(wade.getByRole('alert')).toHaveText(
    "That's more than the truck can carry that day: 4.50 of 4.50 cords already planned, this order needs 1.00.",
  )
  await expect(page.locator('#order-list[data-bucket="new"] .order-card', { hasText: 'Wade R. (SAMPLE)' })).toBeVisible()
  await S('dealer-over-capacity')

  // Detail: record $100.00, owing drops by exactly 10 000 cents; Copy text.
  await tap(page, wade.locator('.card-open'))
  await expect(page.locator('#detail-owing')).toHaveText('Owing $373.75')
  await type(page, page.locator('#pay-amount'), '100.00')
  await tap(page, page.locator('#pay-submit'))
  await expect(page.locator('#detail-owing')).toHaveText('Owing $273.75')
  await S('dealer-order-detail')
  if (await page.locator('.back').isVisible()) await tap(page, page.locator('.back'))
  await tap(page, page.locator('.stat[data-bucket="scheduled"]'))
  await tap(page, page.locator('.order-card', { hasText: 'Joan T. (SAMPLE)' }).locator('.card-open'))
  const copy = page.getByRole('button', { name: 'Copy text' })
  await tap(page, copy)
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible()
  if (p.clipboard)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
      /^Hi Joan, this is SAMPLE Wood & Pellets\. Your order \(1 cord of Mixed softwood, dry\) is booked for delivery on Tuesday, September 15\. Amount owing: \$373\.75\. Check your order: http/,
    )
  await tap(page, page.getByRole('button', { name: 'Take off the schedule' }))
  await expect(page.locator('.detail .pill.status')).toHaveText('Requested')
  if (await page.locator('.back').isVisible()) await tap(page, page.locator('.back'))

  // Phone order.
  await tap(page, page.locator('#add-phone-order'))
  await tap(page, page.locator('#detail button.product[data-product="p_birch_dry"]'))
  await tap(page, page.locator('#detail button.unit[data-unit="half_cord"]'))
  await page.waitForTimeout(400)
  box = await page.locator('#map').boundingBox()
  await tapMap(page, page.locator('#map'), ...fractionFor(box, YARD, KINGS_POINT, 10))
  // The pin really landed (a tap WebKit moved onto a map control zooms instead and leaves no pin).
  await expect(page.locator('#map-hint')).toHaveText("Drag the pin if it isn't quite right.")
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(1)
  await type(page, page.locator('#address'), "Near King's Point (SAMPLE)")
  await tap(page, page.locator('#any-day'))
  await type(page, page.locator('#name'), 'Ches B. (SAMPLE)')
  await type(page, page.locator('#phone'), '709-555-0111')
  await type(page, page.locator('#delivery-fee'), '10.00')
  await S('dealer-phone-order')
  await tap(page, page.locator('#save-phone-order'))
  await expect(page.locator('.detail .detail-title h2')).toHaveText('Ches B. (SAMPLE)')
  await expect(page.locator('.detail')).toContainText('Phone order')
  if (await page.locator('.back').isVisible()) await tap(page, page.locator('.back'))
  await expect(page.locator('#order-list .order-card[data-source="phone"]', { hasText: 'Ches B. (SAMPLE)' })).toBeVisible()

  assertNoThirdParty(context)
  expect(problems, 'page errors / console errors').toEqual([])
  await browser.close()
  log('ok')
}

let failed = 0
for (const p of PROJECTS.filter((x) => !only || x.name.includes(only))) {
  try {
    await run(p)
  } catch (e) {
    failed++
    console.error(`[${p.name}] FAILED: ${e.message}`)
    const page = e.page
    if (page) {
      const visible = await page
        .locator('[data-error-for]:visible, [role="alert"]:visible')
        .allTextContents()
        .catch(() => [])
      console.error(`[${p.name}] visible errors: ${JSON.stringify(visible)}`)
      console.error(`[${p.name}] page problems: ${JSON.stringify(e.problems)}`)
      await page.screenshot({ path: `tests/results/walkthrough-failure-${p.name}.png`, fullPage: true }).catch(() => {})
      await page
        .context()
        .browser()
        .close()
        .catch(() => {})
    }
  }
}
process.exit(failed ? 1 : 0)
