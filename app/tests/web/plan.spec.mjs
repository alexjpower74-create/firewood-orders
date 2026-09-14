// The dealer's Plan tab against the real Worker: the day bars, a day's route, "Put in best order" against the API's own
// optimized order, a real mouse drag at 1280 and Move up / Move down at 390, each saved and still there after a reload.
import { test, expect } from '@playwright/test'
import { api, assertNoThirdParty, bearer, dealerToken, expectTapTarget, fresh, shot, tap } from '../helpers.mjs'
import { fillDay, signInDealer, watch } from './web-helpers.mjs'

const DAY = '2026-09-15'
// Four one-cord stops = 4.00 of 4.50 cords. Scheduled in this order, which is not the best one: optimizing takes the route
// from 104.5 km to 79.9 km in a different order (checked below, so the optimize check cannot pass by doing nothing).
const PLACES = ['Little Bay', 'South Brook', "King's Point", "Robert's Arm"]

const stopIds = (page) => page.locator('#stops .stop').evaluateAll((els) => els.map((el) => el.dataset.stop))
const apiStopIds = async (request, token) => (await api(request, 'GET', `/api/dealer/days/${DAY}/route`, undefined, bearer(token))).body.stops.map((s) => s.id)

async function openDay(page) {
  await tap(page, page.getByRole('tab', { name: 'Plan' }))
  await tap(page, page.locator(`button.plan-day[data-date="${DAY}"]`))
  await expect(page.locator('#stops .stop')).toHaveCount(PLACES.length)
}

test('day bars, the route, and Put in best order matches the API', async ({ page, context, request }, testInfo) => {
  await fresh(context, request)
  const w = watch(page)
  const token = await dealerToken(request)
  const ids = await fillDay(request, token, DAY, PLACES)

  await signInDealer(page)
  await tap(page, page.getByRole('tab', { name: 'Plan' }))
  const day = page.locator(`button.plan-day[data-date="${DAY}"]`)
  await expect(day).toContainText('4.00 of 4.50 cords')
  await expect(day).toContainText('0 of 210 bags')
  await expect(page.locator('button.plan-day[data-date="2026-09-16"]')).toContainText('0.00 of 4.50 cords')
  await expect(page.locator('.plan-day.off[data-date="2026-09-20"]')).toContainText('No deliveries on Sundays')
  await shot(page, testInfo, 'web', 'plan-days')

  await tap(page, day)
  await expect(page.locator('#stops .stop')).toHaveCount(4)
  expect(await stopIds(page)).toEqual(ids)
  await expect(page.getByText('Order is by distance, not road time.')).toBeVisible()
  await expect(page.locator('.stop-marker')).toHaveCount(4)
  const before = (await api(request, 'GET', `/api/dealer/days/${DAY}/route`, undefined, bearer(token))).body
  await expect(page.locator('#route-km')).toHaveText(`${before.total_km.toFixed(1)} km`)

  const optimized = page.waitForResponse((r) => r.url().endsWith(`/api/dealer/days/${DAY}/route/optimize`) && r.request().method() === 'POST')
  await tap(page, page.getByRole('button', { name: 'Put in best order' }))
  const answer = await (await optimized).json()
  const best = answer.stops.map((s) => s.id)
  expect(best, 'optimizing must change this order, or the check below proves nothing').not.toEqual(ids)
  await expect.poll(() => stopIds(page), 'the list is in the API\'s optimized order').toEqual(best)
  expect(await apiStopIds(request, token), 'and the API kept it').toEqual(best)
  await expect(page.locator('#route-km')).toHaveText(`${answer.total_km.toFixed(1)} km`)
  expect(answer.total_km).toBeLessThan(before.total_km)
  await shot(page, testInfo, 'web', 'plan-route')

  w.expectClean()
  assertNoThirdParty(context)
})

test('1280: a mouse drag of stop 3 above stop 1 is saved and still there after a reload', async ({ page, context, request }, testInfo) => {
  test.skip(testInfo.project.name.endsWith('-390'), 'At phone width the stops move with Move up / Move down (next test); the drag is checked at 1280.')
  await fresh(context, request)
  const w = watch(page)
  const token = await dealerToken(request)
  const ids = await fillDay(request, token, DAY, PLACES)
  await signInDealer(page)
  await openDay(page)

  const handle = page.locator('#stops .stop').nth(2).locator('.drag-handle')
  await expectTapTarget(page, handle, 44, 'drag handle of stop 3')
  const first = page.locator('#stops .stop').nth(0)
  const hb = await handle.boundingBox()
  const fb = await first.boundingBox()
  const saved = page.waitForResponse((r) => r.url().endsWith(`/api/dealer/days/${DAY}/route`) && r.request().method() === 'PUT')
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(hb.x + hb.width / 2, fb.y + fb.height * 0.2, { steps: 16 })
  await page.mouse.up()
  expect((await saved).status()).toBe(200)

  const expected = [ids[2], ids[0], ids[1], ids[3]]
  await expect.poll(() => stopIds(page)).toEqual(expected)
  expect(await apiStopIds(request, token)).toEqual(expected)
  await page.reload()
  await expect(page.locator('#stops .stop')).toHaveCount(4)
  expect(await stopIds(page), 'the dragged order after a reload').toEqual(expected)
  await expect(page.locator('#stops .stop').nth(0).locator('.stop-num')).toHaveText('1')

  w.expectClean()
  assertNoThirdParty(context)
})

test('390: Move up and Move down are saved and still there after a reload', async ({ page, context, request }, testInfo) => {
  test.skip(!testInfo.project.name.endsWith('-390'), 'At 1280 the stops are dragged (previous test); Move up / Move down are checked at phone width.')
  await fresh(context, request)
  const w = watch(page)
  const token = await dealerToken(request)
  const [a, b, c, d] = await fillDay(request, token, DAY, PLACES)
  await signInDealer(page)
  await openDay(page)

  await tap(page, page.locator('#stops .stop').nth(3).getByRole('button', { name: 'Move up' }))
  await expect.poll(() => stopIds(page)).toEqual([a, b, d, c])
  await tap(page, page.locator('#stops .stop').nth(0).getByRole('button', { name: 'Move down' }))
  await expect.poll(() => stopIds(page)).toEqual([b, a, d, c])
  expect(await apiStopIds(request, token)).toEqual([b, a, d, c])
  await expect(page.locator('#stops .stop').nth(0).getByRole('button', { name: 'Move up' })).toBeDisabled()

  await page.reload()
  await expect(page.locator('#stops .stop')).toHaveCount(4)
  expect(await stopIds(page), 'the moved order after a reload').toEqual([b, a, d, c])
  await expect(page.getByText('Order is by distance, not road time.')).toBeVisible()

  w.expectClean()
  assertNoThirdParty(context)
})
