// No signal: deliveries are saved on the phone with the time the driver tapped, survive a reload, and send when signal is back.
// The phone clock is page.clock; the server clock is the X-Test-Now header.
import { test, expect } from '@playwright/test'
import { api, assertNoThirdParty, fresh, samplePhotoPng, shot, tap } from '../helpers.mjs'
import { CORD, deliver, detailOf, planDay, signIn, stockOf } from './driver-helpers.mjs'

const T = '2026-09-14T13:00:00.000Z' // the phone's clock when both deliveries are saved: 10:30 AM in St. John's
const SERVER_LATER = '2026-09-14T13:45:00.000Z' // the server's clock when signal comes back

async function twoDeliveriesWithNoSignal(page, context, request, { photo, withServiceWorker = true }) {
  const plan = await planDay(request, 2)
  await page.clock.install({ time: new Date(Date.parse(T) - 5 * 60_000) })
  await signIn(page)
  await tap(page, page.locator('#start-route'), 'Start the route')
  // the strip already says All sent before the Start is saved: wait for the saved Start first, then for it to be sent
  await expect(page.locator('#start-route')).toBeHidden()
  await expect(page.locator('#sync-strip')).toHaveText('All sent')
  await expect.poll(async () => (await api(request, 'GET', `/api/o/${plan.orders[0].token}`)).body.order.status).toBe('out_for_delivery')
  // the page and its files are on the phone before the signal goes
  if (withServiceWorker) await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
  await page.clock.pauseAt(new Date(T))
  if (photo) {
    // The photo is chosen while there is still signal, then the signal goes and Save is tapped with none. Under Playwright,
    // WebKit cannot read a file chosen while context.setOffline(true) is on (NotReadableError); a real phone can.
    await tap(page, page.locator('#delivered'), 'Delivered')
    await tap(page, page.locator('button.pay[data-method="owes"]'), 'Owes')
    const chooser = page.waitForEvent('filechooser')
    await tap(page, page.locator('#take-photo'), 'Take a photo')
    await (await chooser).setFiles(samplePhotoPng())
    await expect(page.locator('#photo-note')).toHaveText('Photo added. It sends with the delivery.')
    await context.setOffline(true)
    await tap(page, page.locator('#save-delivery'), 'Save')
    await expect(page.locator('#sheet')).toBeHidden()
  } else {
    await context.setOffline(true)
    await deliver(page, 'owes')
  }
  await expect(page.locator('#stop-count')).toHaveText('Stop 2 of 2')
  await deliver(page, 'cash')
  await expect(page.locator('#all-done')).toBeVisible()
  await expect(page.locator('#sync-strip')).toHaveText(
    'No signal. 2 deliveries saved on this phone. They send when signal comes back and keep the time you tapped.')
  return plan
}

async function statuses(request, orders) {
  return Promise.all(orders.map(async (o) => (await api(request, 'GET', `/api/o/${o.token}`)).body.order.status))
}

test('no signal: two deliveries are saved with the tap time, survive a reload, and send once signal is back', async ({ page, context, request, browserName }, testInfo) => {
  await fresh(context, request)
  const { dealer, orders } = await twoDeliveriesWithNoSignal(page, context, request, { photo: true })
  const before = (await stockOf(request, dealer, 'p_softwood_dry')).stock_cu_in
  await shot(page, testInfo, 'driver', 'offline-strip')

  if (browserName === 'webkit') {
    // Reload step skipped on WebKit only. Checked with a probe (2026-09-14): the page IS controlled by the service worker,
    // but under Playwright's context.setOffline(true) WebKit's page.reload fails with "WebKit encountered an internal error"
    // instead of asking the service worker. Chromium serves the reload from the service worker, so the step runs there.
    testInfo.annotations.push({ type: 'skip-step', description: 'offline reload: WebKit page.reload fails under setOffline even with the service worker in control' })
  } else {
    await page.reload()
    await expect(page.locator('#sync-strip')).toContainText('2 deliveries saved on this phone')
    await expect(page.locator('#stops [data-stop]')).toHaveCount(2)
    await expect(page.locator('#all-done')).toBeVisible()
  }
  expect(await statuses(request, orders), 'nothing reached the office with no signal').toEqual(['out_for_delivery', 'out_for_delivery'])

  // Server clock first: the phone's 20 s timer fires during fastForward, and a request made then must not carry the old clock.
  await context.setExtraHTTPHeaders({ 'X-Test-Now': SERVER_LATER })
  await page.clock.fastForward('40:00')
  await context.setOffline(false)
  await expect(page.locator('#sync-strip')).toHaveText('All sent', { timeout: 20_000 })

  for (const o of orders) {
    const d = await detailOf(request, dealer, o.id)
    expect(d.order.status).toBe('delivered')
    expect(d.order.delivered_at, 'the time the driver tapped, not the time it arrived').toBe(T)
  }
  const withPhoto = await detailOf(request, dealer, orders[0].id)
  expect([withPhoto.order.has_photo, withPhoto.order.door_payment, withPhoto.payments.length]).toEqual([true, 'owes', 0])
  expect((await stockOf(request, dealer, 'p_softwood_dry')).stock_cu_in, 'stock moved once for each').toBe(before - 2 * CORD)
  const cash = await detailOf(request, dealer, orders[1].id)
  expect(cash.payments.map((p) => [p.amount_cents, p.method])).toEqual([[34500, 'cash']])
  assertNoThirdParty(context)
})

test.describe('with the service worker blocked', () => {
  // This test routes one request to a 500. Playwright cannot route requests that pass through a service worker in every
  // engine, so the service worker is blocked here (it is not what this test is about; the reload test above covers it).
  test.use({ serviceWorkers: 'block' })

test('a 500 from the office leaves both deliveries queued; they send on the next try', async ({ page, context, request }) => {
  await fresh(context, request)
  const { dealer, orders } = await twoDeliveriesWithNoSignal(page, context, request, { photo: false, withServiceWorker: false })
  let failed = 0
  await page.route('**/api/driver/checkins', (route) => {
    if (failed++ === 0) {
      return route.fulfill({ status: 500, contentType: 'application/json',
        body: JSON.stringify({ error: 'Something went wrong on our side. Try again.', code: 'server_error' }) })
    }
    return route.continue()
  })
  await context.setExtraHTTPHeaders({ 'X-Test-Now': SERVER_LATER })
  await context.setOffline(false)
  await expect.poll(() => failed, { message: 'the first check-in reached the route' }).toBeGreaterThan(0)
  await expect(page.locator('#sync-strip')).toContainText('2 deliveries saved on this phone')
  expect(await statuses(request, orders)).toEqual(['out_for_delivery', 'out_for_delivery'])

  await page.clock.fastForward('00:30') // the next try
  await expect(page.locator('#sync-strip')).toHaveText('All sent', { timeout: 20_000 })
  for (const o of orders) {
    const d = await detailOf(request, dealer, o.id)
    expect([d.order.status, d.order.delivered_at]).toEqual(['delivered', T])
  }
  assertNoThirdParty(context)
})
})
