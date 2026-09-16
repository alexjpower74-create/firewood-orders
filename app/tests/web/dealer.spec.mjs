// The dealer page against the real Worker: sign-in, the board, scheduling with the truck's capacity, payments, Copy text
// and a phone order. Setup goes through the API; everything under test is tapped and typed on the page.
import { test, expect } from '@playwright/test'
import { api, assertNoThirdParty, bearer, dealerToken, driverToken, fresh, NOW, orderViaApi, shot, tap } from '../helpers.mjs'
import { fillDay, hstOf, pinAt, scheduleViaApi, signInDealer, typeIn, watch } from './web-helpers.mjs'

const DAY = '2026-09-15'
const newCard = (page, id) => page.locator(`#order-list[data-bucket="new"] .order-card[data-order="${id}"]`)

async function backToList(page) {
  const back = page.locator('#detail .back')
  if (await back.isVisible()) await tap(page, back, 'Back to orders')
}

test('a wrong PIN says so and the sign-in answers 401', async ({ page, context, request }, testInfo) => {
  await fresh(context, request)
  const w = watch(page)
  await page.goto('/dealer/')
  await expect(page.locator('#pin')).toBeVisible()
  await shot(page, testInfo, 'web', 'dealer-signin')
  await typeIn(page, page.locator('#pin'), '0000')
  const answer = page.waitForResponse((r) => r.url().endsWith('/api/signin') && r.request().method() === 'POST')
  await tap(page, page.locator('#signin-btn'))
  expect((await answer).status()).toBe(401)
  await expect(page.locator('[data-error-for="pin"][role="alert"]')).toHaveText('That PIN is not right.')
  await expect(page.locator('#app')).toBeHidden()
  w.expectClean()
  assertNoThirdParty(context)
})

test('a new online order shows under New; Schedule into Tue Sep 15 moves it and the status page says so', async ({
  page,
  context,
  request,
}, testInfo) => {
  await fresh(context, request)
  const w = watch(page)
  const o = await orderViaApi(request)
  await signInDealer(page)
  const card = newCard(page, o.id)
  await expect(card).toBeVisible()
  await expect(card).toContainText('Wade R. (SAMPLE)')
  await expect(card.locator('.pill.owing')).toHaveText('Owing $373.75')
  await shot(page, testInfo, 'web', 'dealer-orders')

  await tap(page, card.getByRole('button', { name: 'Schedule' }))
  const day = card.locator(`button.day[data-date="${DAY}"]`)
  await expect(day).toContainText('0.00 of 4.50 cords')
  await expect(card.locator('button.day[data-date="2026-09-20"]')).toBeDisabled()
  await shot(page, testInfo, 'web', 'dealer-schedule-picker')
  await tap(page, day)
  await expect(newCard(page, o.id)).toHaveCount(0)

  await tap(page, page.locator('.stat[data-bucket="scheduled"]'))
  const scheduled = page.locator(`#order-list[data-bucket="scheduled"] .order-card[data-order="${o.id}"]`)
  await expect(scheduled).toContainText('On Tue Sep 15')
  const status = await context.newPage()
  await status.goto(o.status_url)
  await expect(status.locator('#status')).toHaveText('Scheduled for Tuesday, September 15')
  await status.close()

  w.expectClean()
  assertNoThirdParty(context)
})

test('capacity: with the day at 4.00 cords a 1-cord order shows the API message in role=alert and stays under New', async ({
  page,
  context,
  request,
}, testInfo) => {
  await fresh(context, request)
  const w = watch(page)
  const token = await dealerToken(request)
  await fillDay(request, token, DAY, ['Little Bay', 'South Brook', "Robert's Arm", "St. Patrick's"])
  const o = await orderViaApi(request)
  await signInDealer(page)
  const card = newCard(page, o.id)
  await tap(page, card.getByRole('button', { name: 'Schedule' }))
  await expect(card.locator(`button.day[data-date="${DAY}"]`)).toContainText('4.00 of 4.50 cords')
  const refused = page.waitForResponse((r) => r.url().endsWith(`/api/dealer/orders/${o.id}/schedule`))
  await tap(page, card.locator(`button.day[data-date="${DAY}"]`))
  const res = await refused
  expect(res.status()).toBe(409)
  const body = await res.json()
  expect(body.code).toBe('over_capacity')
  // The page shows the API's own words, and those are the contract's words.
  expect(body.error).toBe("That's more than the truck can carry that day: 4.00 of 4.50 cords already planned, this order needs 1.00.")
  await expect(card.getByRole('alert')).toHaveText(body.error)
  await expect(card.getByRole('alert')).toBeVisible()
  await shot(page, testInfo, 'web', 'dealer-over-capacity')

  await page.reload()
  await expect(newCard(page, o.id)).toBeVisible()
  const board = await api(request, 'GET', '/api/dealer/board', undefined, bearer(token))
  expect(board.body.new.map((x) => x.id)).toContain(o.id)
  w.expectClean()
  assertNoThirdParty(context)
})

test('Record a payment of $100.00 drops what is owing by exactly 10 000 cents on the card and the status page', async ({
  page,
  context,
  request,
}, testInfo) => {
  await fresh(context, request)
  const w = watch(page)
  const token = await dealerToken(request)
  const o = await orderViaApi(request)
  const owingOf = async () => (await api(request, 'GET', `/api/dealer/orders/${o.id}`, undefined, bearer(token))).body.order.owing_cents
  const before = await owingOf()
  expect(before).toBe(37375)

  await signInDealer(page)
  await expect(newCard(page, o.id).locator('.pill.owing')).toHaveText('Owing $373.75')
  await tap(page, newCard(page, o.id).locator('.card-open'))
  await expect(page.locator('#detail-owing')).toHaveText('Owing $373.75')
  await typeIn(page, page.locator('#pay-amount'), '100.00')
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/dealer/payments') && r.request().method() === 'POST')
  await tap(page, page.locator('#pay-submit'))
  const payment = await (await saved).json()
  expect(payment.payment.amount_cents).toBe(10000)
  await expect(page.locator('#detail-owing')).toHaveText('Owing $273.75')
  await expect(page.locator('#detail .payments li')).toContainText('$100.00')
  await shot(page, testInfo, 'web', 'dealer-order-detail')
  expect(before - (await owingOf())).toBe(10000)

  await backToList(page)
  await expect(newCard(page, o.id).locator('.pill.owing')).toHaveText('Owing $273.75')
  const status = await context.newPage()
  await status.goto(o.status_url)
  await expect(status.locator('#owing')).toHaveText('Balance owing $273.75')
  await status.close()
  w.expectClean()
  assertNoThirdParty(context)
})

test("Copy text puts the API's exact scheduled message on the clipboard", async ({ page, context, request, browserName }, testInfo) => {
  await fresh(context, request)
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const w = watch(page)
  const token = await dealerToken(request)
  const o = await orderViaApi(request)
  await scheduleViaApi(request, token, o.id, DAY)
  const detail = await api(request, 'GET', `/api/dealer/orders/${o.id}`, undefined, bearer(token))
  const text = detail.body.messages.find((m) => m.kind === 'scheduled').text

  await signInDealer(page)
  await tap(page, page.locator('.stat[data-bucket="scheduled"]'))
  await tap(page, page.locator(`.order-card[data-order="${o.id}"] .card-open`))
  const message = page.locator('#detail .message[data-kind="scheduled"]')
  await expect(message.locator('.message-text')).toHaveText(text)
  await tap(page, message.getByRole('button', { name: 'Copy text' }))
  await expect(message.getByRole('button', { name: 'Copied' })).toBeVisible()
  if (browserName === 'chromium') {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text)
  } else {
    testInfo.annotations.push({
      type: 'clipboard read skipped',
      description:
        'Playwright cannot grant clipboard-read to WebKit, so the page\'s "Copied" is checked and the clipboard itself is read in chromium only.',
    })
  }
  w.expectClean()
  assertNoThirdParty(context)
})

test('Change order: 1 cord to 2 works the price out again, equal to the API and to the hand-worked total', async ({
  page,
  context,
  request,
}, testInfo) => {
  await fresh(context, request)
  const w = watch(page)
  const token = await dealerToken(request)
  const o = await orderViaApi(request)
  await signInDealer(page)
  await tap(page, newCard(page, o.id).locator('.card-open'))
  await tap(page, page.locator('#detail').getByRole('button', { name: 'Change order' }))
  await typeIn(page, page.locator('#edit-qty'), '2', { clear: true })
  await shot(page, testInfo, 'web', 'dealer-order-edit')
  const saved = page.waitForResponse((r) => r.url().endsWith(`/api/dealer/orders/${o.id}`) && r.request().method() === 'PUT')
  await tap(page, page.locator('#edit-save'))
  const res = await saved
  expect(res.status()).toBe(200)
  expect(JSON.parse(res.request().postData())).toEqual({ qty: 2 })
  // By hand: 2 × 30 000 + 2 500 = 62 500, HST 9 375 → 71 875.
  expect(62500 + hstOf(62500)).toBe(71875)
  await expect(page.locator('#detail .money-rows .row.total')).toContainText('$718.75')
  await expect(page.locator('#detail-owing')).toHaveText('Owing $718.75')
  await expect(page.locator('#detail')).toContainText('2 cords')
  const after = (await api(request, 'GET', `/api/dealer/orders/${o.id}`, undefined, bearer(token))).body.order
  expect([after.qty, after.total_cents, after.wood_cu_in]).toEqual([2, 71875, 442368])
  w.expectClean()
  assertNoThirdParty(context)
})

test('Cancel order takes it off New and shows Cancelled', async ({ page, context, request }) => {
  await fresh(context, request)
  const w = watch(page)
  const token = await dealerToken(request)
  const o = await orderViaApi(request)
  await signInDealer(page)
  await tap(page, newCard(page, o.id).locator('.card-open'))
  await tap(page, page.locator('#detail').getByRole('button', { name: 'Cancel order' }))
  await tap(page, page.locator('#detail').getByRole('button', { name: 'Yes, cancel it' }))
  await expect(page.locator('#detail .detail-title .pill')).toHaveText('Cancelled')
  await expect(page.locator('#detail').getByRole('button', { name: 'Cancel order' })).toHaveCount(0)
  await backToList(page)
  await expect(newCard(page, o.id)).toHaveCount(0)
  expect((await api(request, 'GET', `/api/dealer/orders/${o.id}`, undefined, bearer(token))).body.order.status).toBe('cancelled')
  w.expectClean()
  assertNoThirdParty(context)
})

test('Mark not delivered puts a delivered order back on its day and voids the door payment', async ({
  page,
  context,
  request,
}, testInfo) => {
  await fresh(context, request)
  const w = watch(page)
  const token = await dealerToken(request)
  const driver = await driverToken(request)
  const o = await orderViaApi(request)
  await scheduleViaApi(request, token, o.id, DAY)
  const checkin = await api(
    request,
    'POST',
    '/api/driver/checkins',
    { op_id: `undeliver-${testInfo.project.name}`, order_id: o.id, at: NOW, payment: { method: 'cash' }, note: '' },
    bearer(driver),
  )
  expect(checkin.status, JSON.stringify(checkin.body)).toBe(201)

  await signInDealer(page)
  await tap(page, page.locator('.stat[data-bucket="delivered"]'))
  await tap(page, page.locator(`.order-card[data-order="${o.id}"] .card-open`))
  await expect(page.locator('#detail-owing')).toHaveText('Paid in full')
  await tap(page, page.locator('#detail').getByRole('button', { name: 'Mark not delivered' }))
  const undone = page.waitForResponse((r) => r.url().endsWith(`/api/dealer/orders/${o.id}/undeliver`))
  await tap(page, page.locator('#detail').getByRole('button', { name: 'Yes, mark not delivered' }))
  expect((await undone).status()).toBe(200)
  await expect(page.locator('#detail .detail-title .pill')).toHaveText('Scheduled for Tuesday, September 15')
  await expect(page.locator('#detail-owing')).toHaveText('Owing $373.75')
  await expect(page.locator('#detail .payments li')).toContainText('Voided')
  const after = (await api(request, 'GET', `/api/dealer/orders/${o.id}`, undefined, bearer(token))).body.order
  expect([after.status, after.owing_cents]).toEqual(['scheduled', 37375])
  w.expectClean()
  assertNoThirdParty(context)
})

test('a phone order through the dealer form appears under New with source phone', async ({ page, context, request }, testInfo) => {
  await fresh(context, request)
  const w = watch(page)
  const token = await dealerToken(request)
  const { yard } = (await api(request, 'GET', '/api/info')).body

  await signInDealer(page)
  await tap(page, page.locator('#add-phone-order'))
  await tap(page, page.locator('#detail button.product[data-product="p_birch_dry"]'))
  await tap(page, page.locator('#detail button.unit[data-unit="half_cord"]'))
  await expect(page.locator('#unit-explain')).toHaveText('Half a cord: 64 cubic feet, half of a full cord.')
  await pinAt(page, page.locator('#map'), yard, "King's Point")
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(1)
  await typeIn(page, page.locator('#address'), "Near King's Point (SAMPLE)")
  await tap(page, page.locator('#any-day'))
  await typeIn(page, page.locator('#name'), 'Ches B. (SAMPLE)')
  await typeIn(page, page.locator('#phone'), '709-555-0111')
  // The quote now takes the dealer's fee: the total shown before saving already includes it.
  // By hand: birch half cord 20 000 + the $10.00 fee = 21 000, HST 3 150 → $241.50 (the distance fee would make $270.25).
  const feeQuote = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/quote') &&
      r.request().method() === 'POST' &&
      JSON.parse(r.request().postData() || '{}').delivery_cents === 1000,
  )
  await typeIn(page, page.locator('#delivery-fee'), '10.00')
  const feeRes = await feeQuote
  expect((await feeRes.json()).total_cents).toBe(21000 + hstOf(21000))
  await expect(page.locator('#detail #quote-total')).toHaveText('$241.50')
  await expect(page.locator('#detail #quote-delivery')).toContainText('$10.00')
  await shot(page, testInfo, 'web', 'dealer-phone-order')

  const created = page.waitForResponse((r) => r.url().endsWith('/api/dealer/orders') && r.request().method() === 'POST')
  await tap(page, page.locator('#save-phone-order'))
  const res = await created
  expect(res.status()).toBe(201)
  const { id } = await res.json()
  await expect(page.locator('#detail .detail-title h2')).toHaveText('Ches B. (SAMPLE)')
  await expect(page.locator('#detail')).toContainText('Phone order')
  // Birch half cord $200.00 + the dealer's $10.00 delivery = $210.00; HST worked out by hand.
  const hst = hstOf(21000)
  expect(hst).toBe(3150)
  await expect(page.locator('#detail .money-rows .row.total')).toContainText('$241.50')

  await backToList(page)
  const card = newCard(page, id)
  await expect(card).toHaveAttribute('data-source', 'phone')
  await expect(card.locator('.chip.source')).toHaveText('Phone order')
  const board = await api(request, 'GET', '/api/dealer/board', undefined, bearer(token))
  const summary = board.body.new.find((x) => x.id === id)
  expect(summary.source).toBe('phone')
  expect(summary.delivery_cents).toBe(1000)
  expect(summary.total_cents).toBe(21000 + hst)
  w.expectClean()
  assertNoThirdParty(context)
})
