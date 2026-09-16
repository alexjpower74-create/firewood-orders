// The whole trip, through the pages with real input, in every project (chromium + webkit, 390 + 1280):
// a customer orders firewood on the order page -> the dealer schedules it for today on the dealer page -> the driver starts
// the route and delivers it on the driver page (the customer owes) -> the customer's status page says Delivered, at the time
// the driver tapped, with the balance owing. Lead-owned; it crosses both slices on purpose.
import { test, expect } from '@playwright/test'
import {
  DEALER,
  DEALER_PIN,
  DRIVER_PIN,
  fresh,
  newContext,
  tap,
  type,
  tapMap,
  api,
  dealerToken,
  bearer,
  shot,
  assertNoThirdParty,
} from '../helpers.mjs'

const TODAY = '2026-09-14'
const TAPPED = '2026-09-14T11:40:00Z' // the driver's phone clock: Mon Sep 14, 9:10 AM NDT
const SERVER_AT_SYNC = '2026-09-14T11:55:00Z' // the server's clock when the check-in arrives

async function nextStep(page) {
  const next = page.locator('#next')
  if (await next.isVisible()) await tap(page, next, 'Next')
}

test('order -> schedule -> deliver -> status page says Delivered', async ({ page, context, request, browser }, testInfo) => {
  await fresh(context, request)

  // 1. The customer orders on the page.
  await page.goto('/')
  await expect(page.getByText(DEALER).first()).toBeVisible()
  await expect(page.locator('.sample-badge').first()).toBeVisible()
  await tap(page, page.locator('button.product[data-product="p_softwood_dry"]'), 'Mixed softwood, dry')
  await nextStep(page)
  await tap(page, page.locator('button.unit[data-unit="cord"]'), 'cord')
  await nextStep(page)
  // The map opens centred on the yard marker; pin a little up and left of it (still inside the free band, away from controls).
  await tapMap(page, page.locator('#map'), 0.38, 0.4)
  await type(page, page.locator('#address'), 'Up the lane past the church (SAMPLE)')
  await type(page, page.locator('#dump-notes'), 'By the shed, not on the lawn')
  await nextStep(page)
  await tap(page, page.locator('#any-day'), 'Any day')
  await nextStep(page)
  await type(page, page.locator('#name'), 'Journey Tester (SAMPLE)')
  await type(page, page.locator('#phone'), '709-555-0199')
  const shownTotal = (await page.locator('#quote-total').innerText()).trim()
  await tap(page, page.locator('#send'), 'Send request')
  await expect(page.getByRole('heading', { name: 'Request sent' })).toBeVisible()
  const statusUrl = await page.locator('#status-link').inputValue()
  const token = new URL(statusUrl, 'http://x').searchParams.get('t')
  const created = await api(request, 'GET', `/api/o/${token}`)
  expect(created.status).toBe(200)
  const total = created.body.order.total_cents
  expect(shownTotal, 'the price bar showed the total the order was saved with').toContain((total / 100).toFixed(2))
  await page.goto(statusUrl)
  await expect(page.locator('#status')).toHaveText('Requested')

  // 2. The dealer schedules it for today.
  const dealer = await newContext(browser, testInfo)
  const d = await dealer.newPage()
  await d.goto('/dealer/')
  await type(d, d.locator('#pin'), DEALER_PIN)
  await tap(d, d.locator('#signin-btn'), 'Sign in (dealer)')
  await expect(d.getByRole('tab', { name: 'Orders' })).toHaveAttribute('aria-selected', 'true')
  await tap(d, d.locator('button.stat[data-bucket="new"]'), 'New orders')
  const card = d.locator('[data-order]', { hasText: 'Journey Tester (SAMPLE)' })
  const orderId = await card.getAttribute('data-order')
  await tap(d, card.getByRole('button', { name: 'Schedule' }), 'Schedule')
  const scheduled = d.waitForResponse((res) => res.url().includes(`/api/dealer/orders/${orderId}/schedule`))
  await tap(d, card.locator(`button.day[data-date="${TODAY}"]`), 'today')
  expect((await scheduled).status(), 'the dealer page scheduled it').toBe(200)
  await page.reload()
  await expect(page.locator('#status')).toHaveText('Scheduled for Monday, September 14')

  // 3. The driver starts the route and delivers it; the customer will pay later.
  const driver = await newContext(browser, testInfo, { now: SERVER_AT_SYNC })
  const r = await driver.newPage()
  await r.clock.install({ time: new Date(TAPPED) })
  await r.goto('/driver/')
  await type(r, r.locator('#pin'), DRIVER_PIN)
  await tap(r, r.locator('#signin-btn'), 'Sign in (driver)')
  // The strip already reads "All sent" before a new item is saved, so it cannot say this item arrived. Wait for the office's
  // answer to this very request instead, then ask the status page.
  const started = r.waitForResponse((res) => res.url().includes(`/api/driver/day/${TODAY}/start`) && res.request().method() === 'POST')
  await tap(r, r.locator('#start-route'), 'Start the route')
  expect((await started).status(), 'the driver page started the route').toBe(200)
  await expect(r.locator('#start-route')).toBeHidden()
  await page.reload()
  await expect(page.locator('#status')).toHaveText('Out for delivery')
  await expect(r.locator(`[data-stop="${orderId}"]`).first()).toBeVisible()
  await tap(r, r.locator('#delivered'), 'Delivered')
  await tap(r, r.locator('button.pay[data-method="owes"]'), 'Owes')
  const checkedIn = r.waitForResponse((res) => res.url().endsWith('/api/driver/checkins') && res.request().method() === 'POST')
  await tap(r, r.locator('#save-delivery'), 'Save')
  expect((await checkedIn).status(), 'the office accepted the delivery').toBe(201)
  await expect(r.locator('#sync-strip')).toContainText('All sent')

  // 4. The customer's status page.
  await page.reload()
  await expect(page.locator('#status')).toHaveText('Delivered')
  await expect(page.getByText('Delivered Monday, September 14 at 9:10 AM')).toBeVisible()
  await expect(page.locator('#owing')).toHaveText(`Balance owing $${(total / 100).toLocaleString('en-CA', { minimumFractionDigits: 2 })}`)
  const after = await api(request, 'GET', `/api/o/${token}`)
  expect(after.body.order.status).toBe('delivered')
  expect(after.body.order.owing_cents).toBe(total)

  // The dealer's board agrees: the order is under Owing.
  const board = await api(request, 'GET', '/api/dealer/board', undefined, bearer(await dealerToken(request)))
  expect(board.body.owing.map((o) => o.id)).toContain(orderId)

  await shot(page, testInfo, 'journey', 'status-delivered')
  await shot(r, testInfo, 'journey', 'driver-after')
  for (const c of [context, dealer, driver]) assertNoThirdParty(c)
  await dealer.close()
  await driver.close()
})
