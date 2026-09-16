// The driver page against the real Worker: sign-in, the day in route order, Start, Delivered with each way to pay, Undo.
import { test, expect } from '@playwright/test'
import { api, assertNoThirdParty, bearer, DEALER, DRIVER_PIN, driverToken, fresh, samplePhotoPng, shot, tap, type } from '../helpers.mjs'
import { CORD, deliver, detailOf, orderView, planDay, signIn, stockOf, TODAY } from './driver-helpers.mjs'

test("sign-in: a wrong PIN says so and the API answered 401; the right PIN shows today's stops in route order", async ({
  page,
  context,
  request,
}, testInfo) => {
  await fresh(context, request)
  const { orders } = await planDay(request)
  await page.goto('/driver/')
  await expect(page.getByText(DEALER)).toBeVisible()
  await expect(page.locator('.sample-badge')).toBeVisible()
  await shot(page, testInfo, 'driver', 'signin')

  await type(page, page.locator('#pin'), '0000')
  const answer = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/signin')
  await tap(page, page.locator('#signin-btn'), 'Sign in')
  expect((await answer).status()).toBe(401)
  await expect(page.locator('#pin-error')).toHaveText('That PIN is not right.')

  await type(page, page.locator('#pin'), DRIVER_PIN, { clear: true })
  await tap(page, page.locator('#signin-btn'), 'Sign in')
  await expect(page.locator('#stops [data-stop]')).toHaveCount(3)
  const day = await api(request, 'GET', `/api/driver/day?date=${TODAY}`, undefined, bearer(await driverToken(request)))
  const shown = await page.locator('#stops [data-stop]').evaluateAll((els) => els.map((e) => e.dataset.stop))
  expect(shown).toEqual(day.body.stops.map((s) => s.order_id))
  expect(shown).toEqual(orders.map((o) => o.id))
  await expect(page.locator('#day-title')).toHaveText("Today's deliveries")
  await expect(page.locator('#day-label')).toHaveText('Monday, September 14')
  await expect(page.locator('#stop-count')).toHaveText('Stop 1 of 3')
  await expect(page.locator('#next-name')).toHaveText('Alma P. (SAMPLE)')
  await expect(page.locator('#next-owing')).toHaveText('Balance owing $373.75')
  await expect(page.locator('#open-maps')).toHaveAttribute('href', day.body.stops[0].maps_url)
  await expect(page.locator('#open-maps')).toHaveAttribute('target', '_blank')
  await shot(page, testInfo, 'driver', 'day')

  await tap(page, page.locator('#show-tomorrow'), 'Tomorrow')
  await expect(page.locator('#day-title')).toHaveText("Tomorrow's deliveries")
  await expect(page.locator('#empty')).toHaveText('No stops on this day.')
  await tap(page, page.locator('#show-today'), 'Today')
  await expect(page.locator('#stop-count')).toHaveText('Stop 1 of 3')
  assertNoThirdParty(context)
})

test('Start → the status page says Out for delivery; Delivered + Cash → the next stop, and the office has the payment and Paid in full', async ({
  page,
  context,
  request,
}, testInfo) => {
  await fresh(context, request)
  const { dealer, orders } = await planDay(request)
  await signIn(page)
  await tap(page, page.locator('#start-route'), 'Start the route')
  // All sent is already showing before the Start is saved; the button hides once it is saved
  await expect(page.locator('#start-route')).toBeHidden()
  await expect(page.locator('#sync-strip')).toHaveText('All sent')
  const status = await context.newPage()
  await status.goto(`/o/?t=${orders[0].token}`)
  await expect(status.locator('#status')).toHaveText('Out for delivery')
  await status.close()

  await tap(page, page.locator('#delivered'), 'Delivered')
  await expect(page.getByRole('heading', { name: 'How did they pay?' })).toBeVisible()
  await tap(page, page.locator('button.pay[data-method="cash"]'), 'Cash')
  await expect(page.locator('#amount')).toHaveValue('373.75')
  await shot(page, testInfo, 'driver', 'pay-sheet')
  await tap(page, page.locator('#save-delivery'), 'Save')
  await expect(page.locator('#stop-count')).toHaveText('Stop 2 of 3')
  await expect(page.locator('#next-name')).toHaveText('Bert K. (SAMPLE)')
  await expect(page.locator('#sync-strip')).toHaveText('All sent')
  await expect(page.locator(`#stops [data-stop="${orders[0].id}"]`)).toContainText('Delivered · Cash')

  const o = await orderView(request, orders[0].token)
  expect([o.status, o.owing_label]).toEqual(['delivered', 'Paid in full'])
  const d = await detailOf(request, dealer, orders[0].id)
  expect(d.payments.map((p) => [p.amount_cents, p.method, p.source, p.voided])).toEqual([[37375, 'cash', 'door', false]])
  assertNoThirdParty(context)
})

test('Delivered + e-Transfer of part with a photo from the file chooser → owing to the cent, photo stored', async ({
  page,
  context,
  request,
}) => {
  await fresh(context, request)
  const { orders } = await planDay(request)
  await signIn(page)
  await deliver(page, 'etransfer', { amount: '120.50', photo: samplePhotoPng() })
  await expect(page.locator('#sync-strip')).toHaveText('All sent')
  const o = await orderView(request, orders[0].token)
  // 373.75 − 120.50 = 253.25
  expect([o.status, o.paid_cents, o.owing_cents, o.owing_label]).toEqual(['delivered', 12050, 25325, 'Balance owing $253.25'])
  expect(o.photo_url).toBe(`/api/photos/${orders[0].token}`)
  const img = await request.get(o.photo_url)
  expect(img.status()).toBe(200)
  expect(img.headers()['content-type']).toBe('image/jpeg')
  expect([...(await img.body()).subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
  assertNoThirdParty(context)
})

test('Owes → the status page shows the balance owing', async ({ page, context, request }) => {
  await fresh(context, request)
  const { orders } = await planDay(request)
  await signIn(page)
  await deliver(page, 'owes')
  await expect(page.locator('#sync-strip')).toHaveText('All sent')
  await expect(page.locator(`#stops [data-stop="${orders[0].id}"]`)).toContainText('Delivered · Owes')
  const status = await context.newPage()
  await status.goto(`/o/?t=${orders[0].token}`)
  await expect(status.locator('#status')).toHaveText('Delivered')
  await expect(status.locator('#owing')).toHaveText('Balance owing $373.75')
  await status.close()
  assertNoThirdParty(context)
})

test('Undo on a sent delivery → the stop is back and the stock is restored', async ({ page, context, request }) => {
  await fresh(context, request)
  const { dealer, orders } = await planDay(request)
  const before = (await stockOf(request, dealer, 'p_softwood_dry')).stock_cu_in
  await signIn(page)
  await deliver(page, 'cash')
  await expect(page.locator('#sync-strip')).toHaveText('All sent')
  await expect(page.locator('#stop-count')).toHaveText('Stop 2 of 3')
  expect((await stockOf(request, dealer, 'p_softwood_dry')).stock_cu_in).toBe(before - CORD)

  await tap(page, page.locator('#undo'), 'Undo')
  await expect(page.locator('#undo-bar')).toBeHidden()
  await expect(page.locator('#stop-count')).toHaveText('Stop 1 of 3')
  await expect(page.locator('#next-name')).toHaveText('Alma P. (SAMPLE)')
  await expect.poll(async () => (await stockOf(request, dealer, 'p_softwood_dry')).stock_cu_in).toBe(before)
  const o = await orderView(request, orders[0].token)
  expect([o.status, o.owing_label]).toEqual(['scheduled', 'Balance owing $373.75'])
  expect((await detailOf(request, dealer, orders[0].id)).payments.map((p) => p.voided)).toEqual([true])
  assertNoThirdParty(context)
})
