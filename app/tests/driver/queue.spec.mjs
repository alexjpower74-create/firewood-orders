// The queue's harder paths through the page: a 401 while deliveries wait, Undo of a delivery still on the phone, a real 409
// under Not accepted, and a refused photo that must not look like a refused delivery.
import { test, expect } from '@playwright/test'
import { api, assertNoThirdParty, bearer, DEALER_PIN, fresh, samplePhotoPng, tap, type } from '../helpers.mjs'
import { deliver, detailOf, orderView, planDay, signIn } from './driver-helpers.mjs'

const TAPPED = '2026-09-14T11:20:00.000Z' // the phone's clock at Save: 8:50 AM, before the server's 9:00 AM

test('a 401 while deliveries wait: sign-in shows again, the queue is kept, and after signing in it sends with the tap time', async ({ page, context, request }) => {
  await fresh(context, request)
  const { dealer, orders } = await planDay(request, 2)
  await page.clock.install({ time: new Date(Date.parse(TAPPED) - 60_000) })
  await signIn(page)
  await page.clock.pauseAt(new Date(TAPPED))
  await context.setOffline(true)
  await deliver(page, 'cash')
  await expect(page.locator('#sync-strip')).toContainText('1 delivery saved on this phone')

  // Meanwhile the dealer changes the driver PIN, which ends the phone's session.
  const change = await api(request, 'PUT', '/api/dealer/pin', { which: 'driver', current_dealer_pin: DEALER_PIN, new_pin: '4680' }, bearer(dealer))
  expect(change.status).toBe(200)

  await context.setOffline(false)
  await expect(page.locator('#signin-view')).toBeVisible()
  await expect(page.locator('#signin-lead')).toHaveText('Sign in again. Nothing saved on this phone is lost.')
  await expect(page.locator('#sync-strip')).toHaveText('Sign in again to send them. 1 delivery saved on this phone.')
  expect((await orderView(request, orders[0].token)).status, 'not delivered while signed out').toBe('scheduled')

  await type(page, page.locator('#pin'), '4680')
  await tap(page, page.locator('#signin-btn'), 'Sign in')
  await expect(page.locator('#sync-strip')).toHaveText('All sent')
  const d = await detailOf(request, dealer, orders[0].id)
  expect([d.order.status, d.order.delivered_at]).toEqual(['delivered', TAPPED])
  expect(d.payments.map((p) => [p.amount_cents, p.method])).toEqual([[37375, 'cash']])
  await expect(page.locator('#stop-count')).toHaveText('Stop 2 of 2')
  assertNoThirdParty(context)
})

test('Undo of a delivery still on the phone: it is removed, never reaches the office, and the stop comes back', async ({ page, context, request }) => {
  await fresh(context, request)
  const { dealer, orders } = await planDay(request, 2)
  await signIn(page)
  await context.setOffline(true)
  await deliver(page, 'cash')
  await expect(page.locator('#stop-count')).toHaveText('Stop 2 of 2')
  await expect(page.locator('#sync-strip')).toContainText('1 delivery saved on this phone')

  await tap(page, page.locator('#undo'), 'Undo')
  await expect(page.locator('#undo-bar')).toBeHidden()
  await expect(page.locator('#stop-count')).toHaveText('Stop 1 of 2')
  await expect(page.locator('#next-name')).toHaveText('Alma P. (SAMPLE)')
  await expect(page.locator('#sync-strip')).toHaveText('All sent')

  await context.setOffline(false)
  await page.reload()
  await expect(page.locator('#stop-count')).toHaveText('Stop 1 of 2')
  await expect(page.locator('#sync-strip')).toHaveText('All sent')
  const d = await detailOf(request, dealer, orders[0].id)
  expect([d.order.status, d.order.delivered_at, d.payments.length], 'nothing reached the office').toEqual(['scheduled', null, 0])
  assertNoThirdParty(context)
})

test('Not accepted with a real 409: the dealer cancels while the driver has no signal; Remove from this phone clears it', async ({ page, context, request }) => {
  await fresh(context, request)
  const { dealer, orders } = await planDay(request, 2)
  await signIn(page)
  await context.setOffline(true)
  await deliver(page, 'owes')
  await expect(page.locator('#sync-strip')).toContainText('1 delivery saved on this phone')

  const cancel = await api(request, 'POST', `/api/dealer/orders/${orders[0].id}/cancel`, undefined, bearer(dealer))
  expect(cancel.status).toBe(200)

  await context.setOffline(false)
  const rejected = page.locator('#rejected')
  await expect(rejected).toBeVisible()
  await expect(rejected.getByRole('heading', { name: 'Not accepted' })).toBeVisible()
  await expect(page.locator('#rejected-list li')).toHaveCount(1)
  await expect(page.locator('#rejected-list li').first()).toContainText('Alma P. (SAMPLE): This order was cancelled.')
  expect((await orderView(request, orders[0].token)).status).toBe('cancelled')

  await tap(page, page.getByRole('button', { name: 'Remove from this phone' }), 'Remove from this phone')
  await expect(rejected).toBeHidden()
  await page.reload()
  await expect(page.locator('#stops [data-stop]').first()).toBeVisible()
  await expect(page.locator('#rejected')).toBeHidden()
  assertNoThirdParty(context)
})

test.describe('with the service worker blocked', () => {
  // Routes one request; see offline.spec.mjs for why the service worker is blocked when routing.
  test.use({ serviceWorkers: 'block' })

  test('a refused photo (415) is not a refused delivery: the delivery is saved and the page says the photo could not be used', async ({ page, context, request }) => {
    await fresh(context, request)
    const { dealer, orders } = await planDay(request, 2)
    await page.route('**/api/driver/checkins/*/photo', (route) => route.fulfill({ status: 415, contentType: 'application/json',
      body: JSON.stringify({ error: 'Send the photo as a JPEG, PNG or WebP picture.', code: 'unsupported_media' }) }))
    await signIn(page)
    await deliver(page, 'owes', { photo: samplePhotoPng() })
    await expect(page.locator('#sync-strip')).toHaveText('All sent')
    await expect(page.locator('#notice')).toHaveText("The delivery was saved; the photo couldn't be used.")
    await expect(page.locator('#rejected')).toBeHidden()
    const d = await detailOf(request, dealer, orders[0].id)
    expect([d.order.status, d.order.has_photo]).toEqual(['delivered', false])
    assertNoThirdParty(context)
  })
})
