// Driver tap targets (56 px floor, hit-tested), contrast in dark and Daylight, SAMPLE, no sideways scroll at 390.
import { test, expect } from '@playwright/test'
import { assertNoThirdParty, contrastOf, expectTapTarget, fresh, shot, tap } from '../helpers.mjs'
import { planDay, signIn } from './driver-helpers.mjs'

async function noSideScroll(page, testInfo, where) {
  if (!testInfo.project.name.endsWith('390')) return
  const width = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(width, `${where}: page wider than the phone`).toBeLessThanOrEqual(page.viewportSize().width)
}

test('every driver button is at least 56 px and hit-tests to itself; SAMPLE visible; no sideways scroll at 390', async ({
  page,
  context,
  request,
}, testInfo) => {
  await fresh(context, request)
  await planDay(request)
  await page.goto('/driver/')
  await expect(page.locator('.sample-badge')).toBeVisible()
  for (const sel of ['#daylight', '#pin', '#signin-btn']) await expectTapTarget(page, page.locator(sel), 56, sel)
  await noSideScroll(page, testInfo, 'sign-in')

  await signIn(page)
  await expect(page.locator('.sample-badge')).toBeVisible()
  for (const sel of ['#daylight', '#show-today', '#show-tomorrow', '#start-route', '#open-maps', '#delivered', '#sign-out']) {
    await expectTapTarget(page, page.locator(sel), 56, sel)
  }
  await noSideScroll(page, testInfo, 'day')

  await tap(page, page.locator('#delivered'), 'Delivered')
  await tap(page, page.locator('button.pay[data-method="cash"]'), 'Cash')
  for (const sel of [
    'button.pay[data-method="cash"]',
    'button.pay[data-method="etransfer"]',
    'button.pay[data-method="owes"]',
    '#amount',
    '#take-photo',
    '#save-delivery',
    '#sheet-cancel',
  ]) {
    await expectTapTarget(page, page.locator(sel), 56, sel)
  }
  await noSideScroll(page, testInfo, 'pay sheet')
  await tap(page, page.locator('#save-delivery'), 'Save')
  await expectTapTarget(page, page.locator('#undo'), 56, '#undo')
  await noSideScroll(page, testInfo, 'after save')
  assertNoThirdParty(context)
})

test('action buttons keep a contrast of at least 4.5 in dark and in Daylight; Daylight is remembered', async ({
  page,
  context,
  request,
}, testInfo) => {
  await fresh(context, request)
  await planDay(request)
  await signIn(page)
  const check = async (theme) => {
    for (const sel of ['#start-route', '#open-maps', '#delivered', '#daylight']) {
      expect(await contrastOf(page.locator(sel)), `${theme} ${sel}`).toBeGreaterThanOrEqual(4.5)
    }
    await tap(page, page.locator('#delivered'), 'Delivered')
    await tap(page, page.locator('button.pay[data-method="cash"]'), 'Cash')
    for (const sel of [
      'button.pay[data-method="cash"]',
      'button.pay[data-method="etransfer"]',
      'button.pay[data-method="owes"]',
      '#take-photo',
      '#save-delivery',
      '#sheet-cancel',
    ]) {
      expect(await contrastOf(page.locator(sel)), `${theme} ${sel}`).toBeGreaterThanOrEqual(4.5)
    }
    await tap(page, page.locator('#sheet-cancel'), 'Cancel')
    await expect(page.locator('#sheet')).toBeHidden()
  }
  await check('dark')
  await tap(page, page.locator('#daylight'), 'Daylight')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'daylight')
  await expect(page.locator('#daylight')).toHaveAttribute('aria-pressed', 'true')
  await check('daylight')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'daylight')
  await expect(page.locator('#stop-count')).toHaveText('Stop 1 of 3')
  await shot(page, testInfo, 'driver', 'daylight')
  assertNoThirdParty(context)
})
