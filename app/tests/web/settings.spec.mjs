// The dealer's Settings tab against the real Worker: each change is made on the page and shows up where customers see it,
// and a refusal lands under the field the API names.
import { test, expect } from '@playwright/test'
import { api, assertNoThirdParty, bearer, dealerToken, fresh, shot, tap, type } from '../helpers.mjs'
import { hstOf, pinAt, signInDealer, watch } from './web-helpers.mjs'

async function openSettings(page) {
  await signInDealer(page)
  await tap(page, page.getByRole('tab', { name: 'Settings' }))
  await expect(page.locator('form[data-group="pin"]')).toBeVisible()
}

async function save(page, form, label = 'Save', saved = 'Saved.') {
  const answer = page.waitForResponse((r) => r.url().includes('/api/dealer/') && ['PUT', 'POST'].includes(r.request().method()))
  await tap(page, form.getByRole('button', { name: label }))
  const res = await answer
  if (saved) await expect(form.locator('.saved')).toHaveText(saved)
  return res
}

test('a new load description shows in the order page\'s load explanation', async ({ page, context, request }, testInfo) => {
  await fresh(context, request)
  const w = watch(page)
  await openSettings(page)
  await shot(page, testInfo, 'web', 'dealer-settings')
  const form = page.locator('form[data-group="load"]')
  const description = 'A load is one full box of our dump truck, tipped in a pile (SAMPLE).'
  await type(page, form.locator('#set-load-description'), description, { clear: true })
  expect((await save(page, form)).status()).toBe(200)

  await page.goto('/')
  await tap(page, page.locator('button.product[data-product="p_softwood_dry"]'))
  await tap(page, page.locator('#next'))
  await tap(page, page.locator('button.unit[data-unit="load"]'))
  await expect(page.locator('#unit-explain')).toHaveText(`${description} We count a load as 1.5 cords.`)
  w.expectClean()
  assertNoThirdParty(context)
})

test('closing the season puts the dealer\'s message on the order page', async ({ page, context, request }, testInfo) => {
  await fresh(context, request)
  const w = watch(page)
  await openSettings(page)
  const form = page.locator('form[data-group="season"]')
  const message = "We're closed until the fall. Call 709-555-0100 and we'll take your name (SAMPLE)."
  await tap(page, form.locator('#set-season-open'), 'Taking orders switch')
  await expect(form.locator('#set-season-open')).not.toBeChecked()
  await type(page, form.locator('#set-season-message'), message, { clear: true })
  expect((await save(page, form)).status()).toBe(200)
  expect((await api(request, 'GET', '/api/info')).body.season_open).toBe(false)

  await page.goto('/')
  await expect(page.getByText(message)).toBeVisible()
  await expect(page.locator('#closed-phone')).toHaveText('Call 709-555-0100')
  await expect(page.locator('#next')).toBeHidden()
  await shot(page, testInfo, 'web', 'order-season-closed')
  w.expectClean()
  assertNoThirdParty(context)
})

test('a new price changes the quote on the order page', async ({ page, context, request }) => {
  await fresh(context, request)
  const w = watch(page)
  const { yard } = (await api(request, 'GET', '/api/info')).body
  await openSettings(page)
  const form = page.locator('form[data-product="p_softwood_dry"][data-group="product"]')
  await type(page, form.locator('[data-field="price_cents.cord"]'), '320.00', { clear: true })
  expect((await save(page, form, 'Save product')).status()).toBe(200)

  await page.goto('/')
  await tap(page, page.locator('button.product[data-product="p_softwood_dry"]'))
  await tap(page, page.locator('#next'))
  await expect(page.locator('#quote-goods')).toContainText('$320.00')
  await tap(page, page.locator('#next'))
  await pinAt(page, page.locator('#map'), yard, "King's Point")
  // By hand: 32 000 + 2 500 = 34 500, HST 5 175 → $396.75 (it was $373.75 at $300.00).
  expect(34500 + hstOf(34500)).toBe(39675)
  await expect(page.locator('#quote-total')).toHaveText('$396.75')
  w.expectClean()
  assertNoThirdParty(context)
})

test('a band list that isn\'t farther each time gets the API\'s message under the bands, and nothing is saved', async ({ page, context, request }) => {
  await fresh(context, request)
  const w = watch(page)
  const token = await dealerToken(request)
  const before = (await api(request, 'GET', '/api/dealer/settings', undefined, bearer(token))).body.settings.delivery
  await openSettings(page)
  const form = page.locator('form[data-group="delivery"]')
  await type(page, form.locator('.band-row').nth(1).locator('.band-km'), '5', { clear: true })
  const res = await save(page, form, 'Save', null)
  expect(res.status()).toBe(400)
  const body = await res.json()
  expect(body.field).toBe('delivery.bands')
  const slot = form.locator('[data-error-for="delivery.bands"]')
  await expect(slot).toBeVisible()
  await expect(slot).toHaveText(body.error)
  await expect(form.locator('.saved')).toHaveText('')
  const after = (await api(request, 'GET', '/api/dealer/settings', undefined, bearer(token))).body.settings.delivery
  expect(after).toEqual(before)
  w.expectClean()
  assertNoThirdParty(context)
})
