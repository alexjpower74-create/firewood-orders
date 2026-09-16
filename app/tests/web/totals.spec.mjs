// The dealer's Totals tab against the real Worker: after deliveries set up through driver check-ins, the September row
// matches the API and HST worked out by hand, and each "Download CSV" saves exactly the bytes the API serves.
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { api, assertNoThirdParty, bearer, dealerToken, driverToken, fresh, NOW, orderViaApi, shot, tap } from '../helpers.mjs'
import { hstOf, scheduleViaApi, signInDealer, watch } from './web-helpers.mjs'
import { money } from '../../public/ui.js'

test('September matches the API and a hand-worked HST, and the CSV downloads equal the API files byte for byte', async ({
  page,
  context,
  request,
}, testInfo) => {
  await fresh(context, request)
  const w = watch(page)
  const dealer = await dealerToken(request)
  const driver = await driverToken(request)

  // By hand: A = 1 cord to King's Point: 30 000 + 2 500, HST 4 875. B = 14 bags to King's Point: 11 186 + 2 500,
  // HST 2 052.9 → 2 053 (half-up, per order). A is paid cash at the door; B owes, less a $20.00 payment.
  const a = await orderViaApi(request)
  const b = await orderViaApi(request, {
    product_id: 'p_pellets',
    unit: 'bag',
    qty: 14,
    name: 'Maureen B. (SAMPLE)',
    phone: '709-555-0117',
  })
  for (const o of [a, b]) await scheduleViaApi(request, dealer, o.id, '2026-09-15')
  const deliver = async (o, payment, op) => {
    const r = await api(request, 'POST', '/api/driver/checkins', { op_id: op, order_id: o.id, at: NOW, payment, note: '' }, bearer(driver))
    expect(r.status, JSON.stringify(r.body)).toBe(201)
  }
  const aTotal = 32500 + hstOf(32500)
  await deliver(a, { method: 'cash', amount_cents: aTotal }, `totals-a-${testInfo.project.name}`)
  await deliver(b, { method: 'owes' }, `totals-b-${testInfo.project.name}`)
  const bCustomer = (await api(request, 'GET', `/api/dealer/orders/${b.id}`, undefined, bearer(dealer))).body.customer.id
  const paid = await api(
    request,
    'POST',
    '/api/dealer/payments',
    { customer_id: bCustomer, order_id: b.id, amount_cents: 2000, method: 'etransfer' },
    bearer(dealer),
  )
  expect(paid.status).toBe(201)

  const hand = {
    delivered: 2,
    goods_cents: 30000 + 14 * 799,
    stacking_cents: 0,
    delivery_cents: 5000,
    subtotal_cents: 32500 + 13686,
    hst_cents: hstOf(32500) + hstOf(13686),
    payments_cents: aTotal + 2000,
  }
  hand.total_cents = hand.subtotal_cents + hand.hst_cents
  expect(hand.hst_cents).toBe(6928)
  const owingByHand = 13686 + hstOf(13686) - 2000

  const totals = (await api(request, 'GET', '/api/dealer/totals?season=2026', undefined, bearer(dealer))).body
  const september = totals.months.find((m) => m.month === '2026-09')
  for (const [k, v] of Object.entries(hand)) expect(september[k], `API September ${k}`).toBe(v)
  expect(totals.totals.owing_cents).toBe(owingByHand)

  await signInDealer(page)
  await tap(page, page.getByRole('tab', { name: 'Totals' }))
  const row = page.locator('#totals-table tr[data-month="2026-09"]')
  await expect(row).toContainText('September 2026')
  await expect(row.locator('[data-col="delivered"]')).toHaveText('2')
  for (const k of ['goods_cents', 'stacking_cents', 'delivery_cents', 'subtotal_cents', 'hst_cents', 'total_cents', 'payments_cents']) {
    await expect(row.locator(`[data-col="${k}"]`), `September ${k} on the page`).toHaveText(money(september[k]))
  }
  await expect(row.locator('[data-col="hst_cents"]')).toHaveText('$69.28')
  await expect(page.locator('#season-owing')).toHaveText(money(owingByHand))
  await shot(page, testInfo, 'web', 'dealer-totals')

  for (const kind of ['orders', 'payments']) {
    const saved = page.waitForEvent('download')
    await tap(page, page.locator(`button[data-csv="${kind}"]`))
    const download = await saved
    expect(download.suggestedFilename()).toBe(`firewood-orders-2026-${kind}.csv`)
    const onDisk = readFileSync(await download.path())
    const fromApi = await request.fetch(`/api/dealer/export/${kind}.csv?season=2026`, { headers: { ...bearer(dealer), 'X-Test-Now': NOW } })
    expect(fromApi.status()).toBe(200)
    const bytes = await fromApi.body()
    expect(bytes.length, `${kind}.csv is not empty`).toBeGreaterThan(80)
    expect(onDisk.equals(bytes), `${kind}.csv downloaded byte for byte`).toBe(true)
  }

  w.expectClean()
  assertNoThirdParty(context)
})
