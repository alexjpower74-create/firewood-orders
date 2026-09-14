// Driver spec helpers (fo1). Setup goes through the API; everything under test goes through the page with real input.
import { expect } from '@playwright/test'
import { api, bearer, dealerToken, DRIVER_PIN, orderViaApi, tap, type } from '../helpers.mjs'

export const TODAY = '2026-09-14'
export const CORD = 221184

// Three SAMPLE stops, scheduled for today in this order (so this is the route order).
export const STOPS = [
  { place: "King's Point", name: 'Alma P. (SAMPLE)', phone: '709-555-0151' }, // 1 cord: 300.00 + 25.00 + HST 48.75 = 373.75
  { place: "St. Patrick's", name: 'Bert K. (SAMPLE)', phone: '709-555-0152' }, // 1 cord: 300.00 + HST 45.00 = 345.00
  { place: 'Little Bay', name: 'Cora D. (SAMPLE)', phone: '709-555-0153' }, // 1 cord: 373.75
]

export async function planDay(request, count = 3) {
  const dealer = await dealerToken(request)
  const orders = []
  for (const stop of STOPS.slice(0, count)) {
    const o = await orderViaApi(request, stop)
    const r = await api(request, 'POST', `/api/dealer/orders/${o.id}/schedule`, { date: TODAY }, bearer(dealer))
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    orders.push({ ...o, ...stop })
  }
  return { dealer, orders }
}

export async function signIn(page) {
  await page.goto('/driver/')
  await type(page, page.locator('#pin'), DRIVER_PIN)
  await tap(page, page.locator('#signin-btn'), 'Sign in')
  await expect(page.locator('#day-view')).toBeVisible()
  await expect(page.locator('#stops [data-stop]').first()).toBeVisible()
}

// Delivered → how they paid → (amount) → (photo through the real file chooser) → Save.
export async function deliver(page, method, { amount, photo } = {}) {
  await tap(page, page.locator('#delivered'), 'Delivered')
  await expect(page.locator('#sheet')).toBeVisible()
  await tap(page, page.locator(`button.pay[data-method="${method}"]`), method)
  if (amount !== undefined) await type(page, page.locator('#amount'), amount, { clear: true })
  if (photo) {
    const chooser = page.waitForEvent('filechooser')
    await tap(page, page.locator('#take-photo'), 'Take a photo')
    await (await chooser).setFiles(photo)
    await expect(page.locator('#photo-note')).toHaveText('Photo added. It sends with the delivery.')
  }
  await tap(page, page.locator('#save-delivery'), 'Save')
  await expect(page.locator('#sheet')).toBeHidden()
}

export const orderView = async (request, token) => (await api(request, 'GET', `/api/o/${token}`)).body.order
export const detailOf = async (request, dealer, id) =>
  (await api(request, 'GET', `/api/dealer/orders/${id}`, undefined, bearer(dealer))).body
export const stockOf = async (request, dealer, id) =>
  (await api(request, 'GET', '/api/dealer/settings', undefined, bearer(dealer))).body.products.find((p) => p.id === id)
