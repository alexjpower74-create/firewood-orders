// The base map: OpenFreeMap's vector style drawn by MapLibre inside the Leaflet maps, from the one style URL in GET /api/info,
// with OpenFreeMap's required attribution visible, and taps still placing pins. The style request is intercepted by the helpers
// (a local stand-in style), so nothing reaches the internet.
import { test, expect } from '@playwright/test'
import { api, assertNoThirdParty, dealerToken, fresh, tap, tapMap } from '../helpers.mjs'
import { fillDay, signInDealer, watch } from './web-helpers.mjs'

const STYLE = 'https://tiles.openfreemap.org/styles/liberty'
const ATTRIBUTION_TEXT = 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap'
const LINKS = ['https://openfreemap.org', 'https://www.openmaptiles.org/', 'https://www.openstreetmap.org/copyright']

async function expectBaseMap(page, mapLocator, context) {
  // MapLibre's canvas sits inside the Leaflet map, and the page asked for exactly the style the API named.
  await expect(mapLocator.locator('canvas.maplibregl-canvas')).toBeVisible()
  expect(context.__styleRequests, 'the style URL the page asked for').toContain(STYLE)
  const attribution = mapLocator.locator('.leaflet-control-attribution')
  await expect(attribution).toBeVisible()
  await expect(attribution).toContainText(ATTRIBUTION_TEXT)
  for (const href of LINKS) await expect(attribution.locator(`a[href="${href}"]`)).toHaveCount(1)
  // Visible means a person can see it: scrolled to the middle of the screen the way a person would scroll to it (the same
  // allowance tap() makes), the attribution's own middle hit-tests to the attribution, not the price bar or anything else.
  await attribution.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(150)
  const hit = await attribution.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return t === el || el.contains(t) ? '' : t ? t.outerHTML.slice(0, 120) : 'nothing'
  })
  expect(hit, 'the attribution is not covered').toBe('')
}

test('order page: the pin step draws the OpenFreeMap style with its attribution, and a tap still places the pin', async ({
  page,
  context,
  request,
}) => {
  await fresh(context, request)
  const w = watch(page)
  const info = (await api(request, 'GET', '/api/info')).body
  expect(info.map).toEqual({ style: STYLE, attribution: expect.stringContaining('OpenFreeMap') })

  await page.goto('/')
  await tap(page, page.locator('button.product[data-product="p_softwood_dry"]'))
  await tap(page, page.locator('#next'))
  await tap(page, page.locator('button.unit[data-unit="cord"]'))
  await tap(page, page.locator('#next'))
  const map = page.locator('#map')
  await expectBaseMap(page, map, context)
  await expect(page.locator('#map-hint')).toHaveText('Tap the map where the truck should dump it')
  // The GL canvas must not swallow the tap: Leaflet still places the pin (tapMap also refuses points next to a map control).
  await tapMap(page, map, 0.38, 0.4)
  await expect(page.locator('#map-hint')).toHaveText("Drag the pin if it isn't quite right.")
  await expect(map.locator('.leaflet-marker-icon')).toHaveCount(1)
  w.expectClean()
  assertNoThirdParty(context)
})

test('dealer plan: the route map draws the OpenFreeMap style with its attribution and the stop markers', async ({
  page,
  context,
  request,
}) => {
  await fresh(context, request)
  const w = watch(page)
  const token = await dealerToken(request)
  await fillDay(request, token, '2026-09-15', ["King's Point", 'South Brook'])
  await signInDealer(page)
  await page.goto('/dealer/#plan/2026-09-15')
  await page.reload()
  const map = page.locator('#route-map')
  await expect(map).toBeVisible()
  await expectBaseMap(page, map, context)
  await expect(map.locator('.leaflet-marker-icon')).toHaveCount(2)
  w.expectClean()
  assertNoThirdParty(context)
})
