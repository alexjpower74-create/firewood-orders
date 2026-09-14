// The customer's status page against the real Worker: each status label as the API moves the order (the page's own
// 30-second poll brings the change, fast-forwarded with page.clock), the photo when delivered, and a bad link.
import { test, expect } from '@playwright/test'
import { api, assertNoThirdParty, bearer, dealerToken, driverToken, fresh, NOW, orderViaApi, samplePhotoPng, shot, tap } from '../helpers.mjs'
import { watch } from './web-helpers.mjs'

test('each status label as the API moves the order, with the photo once delivered', async ({ page, context, request }, testInfo) => {
  await fresh(context, request)
  const w = watch(page)
  const o = await orderViaApi(request)
  const dealer = await dealerToken(request)
  const driver = await driverToken(request)

  await page.clock.install({ time: new Date(NOW) })
  await page.goto(o.status_url)
  await expect(page.locator('#status')).toHaveText('Requested')
  await expect(page.locator('#timeline li[aria-current="step"]')).toHaveText('Requested')
  await expect(page.locator('#owing')).toHaveText('Balance owing $373.75')
  await expect(page.locator('#photo-card')).toBeHidden()
  await shot(page, testInfo, 'web', 'status-requested')

  const scheduled = await api(request, 'POST', `/api/dealer/orders/${o.id}/schedule`, { date: '2026-09-15' }, bearer(dealer))
  expect(scheduled.status).toBe(200)
  await page.clock.runFor(30_000)
  await expect(page.locator('#status')).toHaveText('Scheduled for Tuesday, September 15')
  await expect(page.locator('#timeline li[aria-current="step"]')).toHaveText('Scheduled')
  await shot(page, testInfo, 'web', 'status-scheduled')

  const started = await api(request, 'POST', '/api/driver/day/2026-09-15/start', {}, bearer(driver))
  expect(started.status).toBe(200)
  await page.clock.runFor(30_000)
  await expect(page.locator('#status')).toHaveText('Out for delivery')
  await shot(page, testInfo, 'web', 'status-out-for-delivery')

  const op = `status-spec-${testInfo.project.name}`
  const checkin = await api(request, 'POST', '/api/driver/checkins',
    { op_id: op, order_id: o.id, at: NOW, payment: { method: 'owes' }, note: '' }, bearer(driver))
  expect(checkin.status, JSON.stringify(checkin.body)).toBe(201)
  const photo = samplePhotoPng()
  const put = await request.fetch(`/api/driver/checkins/${op}/photo`, {
    method: 'PUT', data: photo.buffer, headers: { ...bearer(driver), 'Content-Type': photo.mimeType, 'X-Test-Now': NOW },
  })
  expect(put.status()).toBe(200)

  await page.clock.runFor(30_000)
  await expect(page.locator('#status')).toHaveText('Delivered')
  await expect(page.locator('#delivered-label')).toHaveText('Delivered Monday, September 14 at 9:00 AM')
  await expect(page.locator('#photo')).toBeVisible()
  await expect.poll(() => page.locator('#photo').evaluate((img) => img.complete && img.naturalWidth), 'the photo loaded').toBe(320)
  await expect(page.locator('#owing')).toHaveText('Balance owing $373.75')
  await shot(page, testInfo, 'web', 'status-delivered')

  w.expectClean()
  assertNoThirdParty(context)
})

test('Cancel my order while Requested cancels it; once it is scheduled the API\'s refusal shows', async ({ page, context, request }, testInfo) => {
  await fresh(context, request)
  const w = watch(page)
  const dealer = await dealerToken(request)
  const o = await orderViaApi(request)

  await page.goto(o.status_url)
  await expect(page.locator('#status')).toHaveText('Requested')
  await tap(page, page.getByRole('button', { name: 'Cancel my order' }))
  await expect(page.getByText('Cancel this order?')).toBeVisible()
  const cancelled = page.waitForResponse((r) => r.url().endsWith(`/api/o/${o.token}/cancel`) && r.request().method() === 'POST')
  await tap(page, page.getByRole('button', { name: 'Yes, cancel it' }))
  expect((await cancelled).status()).toBe(200)
  await expect(page.locator('#status')).toHaveText('Cancelled')
  await expect(page.locator('#timeline')).toBeHidden()
  await expect(page.locator('#cancel-card')).toBeHidden()
  await expect(page.locator('#owing')).toHaveText('Paid in full')
  const view = await api(request, 'GET', `/api/o/${o.token}`)
  expect(view.body.order.status).toBe('cancelled')
  await shot(page, testInfo, 'web', 'status-cancelled')

  // A second order is scheduled by the dealer while its page is still open as Requested.
  const second = await orderViaApi(request, { name: 'Glenda M. (SAMPLE)', phone: '709-555-0199' })
  await page.goto(second.status_url)
  await expect(page.locator('#status')).toHaveText('Requested')
  expect((await api(request, 'POST', `/api/dealer/orders/${second.id}/schedule`, { date: '2026-09-15' }, bearer(dealer))).status).toBe(200)
  await tap(page, page.getByRole('button', { name: 'Cancel my order' }))
  const refused = page.waitForResponse((r) => r.url().endsWith(`/api/o/${second.token}/cancel`))
  await tap(page, page.getByRole('button', { name: 'Yes, cancel it' }))
  const res = await refused
  expect(res.status()).toBe(409)
  const body = await res.json()
  expect(body.error).toBe('This order is already on the schedule. Call us to change it.')
  await expect(page.locator('#cancel-error')).toHaveText(body.error)
  await expect(page.locator('#cancel-error')).toBeVisible()
  await expect(page.locator('#status')).toHaveText('Scheduled for Tuesday, September 15')
  await expect(page.getByRole('button', { name: 'Cancel my order' })).toBeHidden()

  w.expectClean()
  assertNoThirdParty(context)
})

test('a bad link gets the plain message', async ({ page, context, request }, testInfo) => {
  await fresh(context, request)
  const w = watch(page)
  await page.goto('/o/?t=this-is-not-a-real-order-token-00')
  await expect(page.getByText("We couldn't find that order. Check the link or call us.")).toBeVisible()
  await expect(page.locator('#status')).toBeHidden()
  await expect(page.locator('.sample-badge')).toBeVisible()
  await shot(page, testInfo, 'web', 'status-not-found')
  w.expectClean()
  assertNoThirdParty(context)
})
