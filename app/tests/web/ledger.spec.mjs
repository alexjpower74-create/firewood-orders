// The dealer's Customers tab against the real Worker: payments and a void move the customer's balance to the cent, each
// order's owing follows, and the ledger's running balance column equals the API's.
import { test, expect } from '@playwright/test'
import { api, assertNoThirdParty, bearer, dealerToken, fresh, orderViaApi, shot, tap } from '../helpers.mjs'
import { hstOf, signInDealer, typeIn, watch } from './web-helpers.mjs'
import { money } from '../../public/ui.js'

test('payments and a void move the balance to the cent, and the running balance column equals the API', async ({ page, context, request }, testInfo) => {
  await fresh(context, request)
  const w = watch(page)
  const token = await dealerToken(request)
  // Two orders for one customer (same phone), worked out by hand from docs/API.md:
  // 1 cord to King's Point (12.9 km, $25.00 band): 30 000 + 2 500 = 32 500, HST 4 875 → 37 375.
  // A half cord to Little Bay (12.7 km, $25.00 band): 17 000 + 2 500 = 19 500, HST 2 925 → 22 425.
  const first = await orderViaApi(request)
  const second = await orderViaApi(request, { place: 'Little Bay', unit: 'half_cord' })
  const firstTotal = 32500 + hstOf(32500)
  const secondTotal = 19500 + hstOf(19500)
  expect([firstTotal, secondTotal]).toEqual([37375, 22425])
  const customerId = (await api(request, 'GET', `/api/dealer/orders/${first.id}`, undefined, bearer(token))).body.customer.id
  const ledger = async () => (await api(request, 'GET', `/api/dealer/customers/${customerId}/ledger`, undefined, bearer(token))).body
  const runningCells = () => page.locator('#ledger tbody td.running').allTextContents()

  await signInDealer(page)
  await tap(page, page.getByRole('tab', { name: 'Customers' }))
  const row = page.locator(`button.customer[data-customer="${customerId}"]`)
  await expect(row).toContainText('Wade R. (SAMPLE)')
  await expect(row.locator('.balance-pill')).toHaveText('Balance owing $598.00')
  await shot(page, testInfo, 'web', 'dealer-customers')

  await tap(page, row)
  const balance = page.locator('#ledger-balance')
  await expect(balance).toHaveText('Balance owing $598.00')
  expect(await runningCells()).toEqual(['$373.75', '$598.00'])

  // $50.00 on account: the balance drops, no order's owing does.
  await typeIn(page, page.locator('#cust-pay-amount'), '50.00')
  await tap(page, page.locator('#cust-pay-submit'))
  await expect(balance).toHaveText('Balance owing $548.00')
  await expect(page.locator(`.cust-order[data-order="${first.id}"] .order-owing`)).toHaveText('Owing $373.75')

  // $100.00 on the first order: the balance and that order's owing both drop by exactly 10 000 cents.
  await page.locator('#cust-pay-order').selectOption(first.id)
  await typeIn(page, page.locator('#cust-pay-amount'), '100.00')
  await tap(page, page.locator('#cust-pay-submit'))
  await expect(balance).toHaveText('Balance owing $448.00')
  await expect(page.locator(`.cust-order[data-order="${first.id}"] .order-owing`)).toHaveText('Owing $273.75')
  await expect(page.locator(`.cust-order[data-order="${second.id}"] .order-owing`)).toHaveText('Owing $224.25')
  let api1 = await ledger()
  expect(api1.balance_cents).toBe(firstTotal + secondTotal - 5000 - 10000)
  expect(await runningCells(), 'running column = the API').toEqual(api1.entries.map((e) => money(e.balance_cents)))
  expect(api1.entries.map((e) => e.balance_cents), 'and = by hand').toEqual([37375, 59800, 54800, 44800])
  await shot(page, testInfo, 'web', 'dealer-ledger')

  // Void the $100.00 from the order's detail (where payments have their ids): back up by exactly 10 000.
  await tap(page, page.locator(`.cust-order[data-order="${first.id}"]`).getByRole('button', { name: 'Open' }))
  const payment = page.locator('#detail .payments li', { hasText: '$100.00' })
  await tap(page, payment.getByRole('button', { name: 'Void' }))
  await tap(page, payment.getByRole('button', { name: 'Void payment' }))
  await expect(page.locator('#detail-owing')).toHaveText('Owing $373.75')
  await expect(page.locator('#detail .payments li', { hasText: '$100.00' })).toContainText('Voided')

  await tap(page, page.getByRole('tab', { name: 'Customers' }))
  await tap(page, page.locator(`button.customer[data-customer="${customerId}"]`))
  await expect(balance).toHaveText('Balance owing $548.00')
  await expect(page.locator(`.cust-order[data-order="${first.id}"] .order-owing`)).toHaveText('Owing $373.75')
  api1 = await ledger()
  expect(api1.balance_cents).toBe(54800)
  expect(await runningCells()).toEqual(api1.entries.map((e) => money(e.balance_cents)))
  expect(api1.entries.map((e) => e.balance_cents)).toEqual([37375, 59800, 54800])

  w.expectClean()
  assertNoThirdParty(context)
})
