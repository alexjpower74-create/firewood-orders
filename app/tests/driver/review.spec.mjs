// fo2's cross-review of the driver page (M3): one spec per finding. Each fails on the page before the fixes
// (tests/driver/negative-old-page.mjs runs them against commit 85beb53).
import { test, expect } from '@playwright/test'
import { api, assertNoThirdParty, bearer, expectTapTarget, fresh, tap, type } from '../helpers.mjs'
import { deliver, detailOf, planDay, signIn } from './driver-helpers.mjs'

const pay = (request, dealer, body) => api(request, 'POST', '/api/dealer/payments', body, bearer(dealer))

test("review #1: right after a Save, the next stop's Delivered hit-tests to itself while the Undo bar shows", async ({
  page,
  context,
  request,
}) => {
  await fresh(context, request)
  await planDay(request, 3)
  await signIn(page)
  await deliver(page, 'cash')
  await expect(page.locator('#undo-bar')).toBeVisible()
  await expect(page.locator('#stop-count')).toHaveText('Stop 2 of 3')
  await expectTapTarget(page, page.locator('#delivered'), 56, '#delivered right after Save')
  await expectTapTarget(page, page.locator('#undo'), 56, '#undo')
  assertNoThirdParty(context)
})

test('review #2: Cash with the prefilled amount records exactly that amount, even after the dealer took a payment', async ({
  page,
  context,
  request,
}) => {
  await fresh(context, request)
  const { dealer, orders } = await planDay(request, 2)
  await signIn(page)
  await expect(page.locator('#next-owing')).toHaveText('Balance owing $373.75')
  // While the day sits on the phone, the office records $100.00 on that order.
  const detail = await detailOf(request, dealer, orders[0].id)
  const office = await pay(request, dealer, {
    customer_id: detail.customer.id,
    order_id: orders[0].id,
    amount_cents: 10000,
    method: 'etransfer',
  })
  expect(office.status).toBe(201)

  await tap(page, page.locator('#delivered'), 'Delivered')
  await tap(page, page.locator('button.pay[data-method="cash"]'), 'Cash')
  await expect(page.locator('#amount')).toHaveValue('373.75')
  await tap(page, page.locator('#save-delivery'), 'Save')
  // the strip reads All sent before Save has stored the delivery: wait for the sheet to close (stored), then for the send
  await expect(page.locator('#sheet')).toBeHidden()
  await expect(page.locator('#stop-count')).toHaveText('Stop 2 of 2')
  await expect(page.locator('#sync-strip')).toHaveText('All sent')
  const d = await detailOf(request, dealer, orders[0].id)
  const door = d.payments.filter((p) => p.source === 'door')
  expect(
    door.map((p) => [p.amount_cents, p.method]),
    'the cash the driver collected, to the cent',
  ).toEqual([[37375, 'cash']])
  expect(d.order.owing_cents).toBe(37375 - 10000 - 37375)
  assertNoThirdParty(context)
})

test('review #3: a prepaid order is saved as Cash or e-Transfer with no amount: no payment row, and door_payment is the method', async ({
  page,
  context,
  request,
}) => {
  await fresh(context, request)
  const { dealer, orders } = await planDay(request, 2)
  const totals = [37375, 34500]
  for (const [i, o] of orders.entries()) {
    const c = (await detailOf(request, dealer, o.id)).customer.id
    expect((await pay(request, dealer, { customer_id: c, order_id: o.id, amount_cents: totals[i], method: 'etransfer' })).status).toBe(201)
  }
  await signIn(page)
  await expect(page.locator('#next-owing')).toHaveText('Paid in full')

  await tap(page, page.locator('#delivered'), 'Delivered')
  await tap(page, page.locator('button.pay[data-method="cash"]'), 'Cash')
  await expect(page.locator('#amount')).toHaveValue('')
  await expect(page.locator('#amount-hint')).toHaveText('Already paid. Leave the amount empty.')
  await tap(page, page.locator('#save-delivery'), 'Save')
  await expect(page.locator('#sheet')).toBeHidden()
  await expect(page.locator('#stop-count')).toHaveText('Stop 2 of 2')

  await tap(page, page.locator('#delivered'), 'Delivered')
  await tap(page, page.locator('button.pay[data-method="etransfer"]'), 'e-Transfer')
  await type(page, page.locator('#amount'), '0')
  await tap(page, page.locator('#save-delivery'), 'Save')
  await expect(page.locator('#sheet')).toBeHidden()
  await expect(page.locator('#sync-strip')).toHaveText('All sent')

  for (const [i, method] of [
    [0, 'cash'],
    [1, 'etransfer'],
  ]) {
    const d = await detailOf(request, dealer, orders[i].id)
    expect([d.order.status, d.order.door_payment, d.order.owing_cents]).toEqual(['delivered', method, 0])
    expect(
      d.payments.map((p) => p.source),
      'only the office payment, no door row',
    ).toEqual(['dealer'])
  }
  assertNoThirdParty(context)
})

test('review #4: data-stop is on the list row only; the next-stop card has data-next-stop', async ({ page, context, request }) => {
  await fresh(context, request)
  const { orders } = await planDay(request, 3)
  await signIn(page)
  await expect(page.locator('[data-stop]')).toHaveCount(3)
  await expect(page.locator(`[data-stop="${orders[0].id}"]`)).toHaveCount(1)
  await expect(page.locator(`#stops [data-stop="${orders[0].id}"]`)).toBeVisible()
  await expect(page.locator('#next')).toHaveAttribute('data-next-stop', orders[0].id)
  await expect(page.locator('#next')).not.toHaveAttribute('data-stop', /.*/)
  assertNoThirdParty(context)
})

test('review #5: Sign out ends the session on the server: the old token gets 401', async ({ page, context, request }) => {
  await fresh(context, request)
  await planDay(request, 1)
  await signIn(page)
  const token = await page.evaluate(() => localStorage.getItem('firewood-orders:driver-token'))
  expect((await api(request, 'GET', '/api/driver/day', undefined, bearer(token))).status).toBe(200)
  const answer = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/signout', { timeout: 8000 })
  await tap(page, page.locator('#sign-out'), 'Sign out')
  expect((await answer).status()).toBe(200)
  await expect(page.locator('#signin-view')).toBeVisible()
  expect((await api(request, 'GET', '/api/driver/day', undefined, bearer(token))).status).toBe(401)
  assertNoThirdParty(context)
})

test('review #7: opened with no signal the next day, the saved day is not called today and Start is hidden', async ({
  page,
  context,
  request,
  browserName,
}, testInfo) => {
  await fresh(context, request)
  await planDay(request, 3)
  await page.clock.install({ time: new Date('2026-09-14T12:00:00.000Z') })
  await signIn(page)
  await expect(page.locator('#day-title')).toHaveText("Today's deliveries")
  await expect(page.locator('#start-route')).toBeVisible()
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))

  if (browserName === 'webkit') {
    // Offline reload skipped on WebKit only, for the reason recorded in offline.spec.mjs: under context.setOffline(true)
    // WebKit's page.reload fails ("WebKit encountered an internal error") even with the service worker in control.
    testInfo.annotations.push({ type: 'skip-step', description: 'offline reload: WebKit page.reload fails under setOffline' })
    return
  }
  await context.setOffline(true)
  await page.clock.fastForward('24:00:00') // the next morning on the phone
  await page.reload()
  await expect(page.locator('#day-title')).toHaveText('Saved Monday, September 14 (no signal)')
  await expect(page.locator('#start-route')).toBeHidden()
  await expect(page.locator('#stops [data-stop]')).toHaveCount(3)

  // Signal back: the office says what today is (still the 14th on the test server), and Start returns.
  await context.setOffline(false)
  await expect(page.locator('#day-title')).toHaveText("Today's deliveries")
  await expect(page.locator('#start-route')).toBeVisible()
  assertNoThirdParty(context)
})
