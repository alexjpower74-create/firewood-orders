// Tap targets, SAMPLE, contrast and layout on fo2's pages against the real Worker. Hit-tests use elementFromPoint
// (through the lead's helpers), never rectangles alone.
import { test, expect } from '@playwright/test'
import { api, assertNoThirdParty, contrastOf, dealerToken, expectTapTarget, fresh, orderViaApi, tap } from '../helpers.mjs'
import { fillDay, pinAt, signInDealer, typeIn, watch } from './web-helpers.mjs'

const phone = (testInfo) => testInfo.project.name.endsWith('-390')

/** At this moment of the page: no sideways scroll, and every visible button and tab ≥ 44 px and hit-testing to itself. */
async function checkScreen(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, `${label}: the page scrolls sideways by ${overflow} px`).toBeLessThanOrEqual(0)
  const targets = page.locator('button:visible, [role="tab"]:visible')
  const count = await targets.count()
  expect(count, `${label}: buttons found`).toBeGreaterThan(0)
  for (let i = 0; i < count; i++) {
    const target = targets.nth(i)
    const name = ((await target.getAttribute('aria-label')) || (await target.innerText())).trim().replace(/\s+/g, ' ').slice(0, 40)
    // Staging only: bring it to the middle of the screen (and of a sideways-scrolling tab bar) before the hit-test.
    await target.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }))
    await expectTapTarget(page, target, 44, `${label}: "${name}"`)
  }
  return count
}

test('the SAMPLE badge is on /, the status page and /dealer/', async ({ page, context, request }) => {
  await fresh(context, request)
  const w = watch(page)
  const o = await orderViaApi(request)
  for (const url of ['/', o.status_url, '/dealer/']) {
    await page.goto(url)
    const badge = page.locator('.sample-badge')
    await expect(badge, url).toBeVisible()
    await expect(badge, url).toHaveText('SAMPLE')
    await expect(page.locator('.dealer-name'), url).toHaveText('SAMPLE Wood & Pellets — Springdale (demo)')
  }
  w.expectClean()
  assertNoThirdParty(context)
})

test('the primary buttons have contrast of at least 4.5', async ({ page, context, request }) => {
  await fresh(context, request)
  await page.goto('/')
  await expect(page.locator('#next')).toBeVisible()
  expect(await contrastOf(page.locator('#next')), 'Next').toBeGreaterThanOrEqual(4.5)
  await page.goto('/dealer/')
  await expect(page.locator('#signin-btn')).toBeVisible()
  expect(await contrastOf(page.locator('#signin-btn')), 'Sign in').toBeGreaterThanOrEqual(4.5)
  assertNoThirdParty(context)
})

test('390: every button and tab on every screen is at least 44 px and hit-tests to itself, with no sideways scroll', async ({ page, context, request }, testInfo) => {
  test.skip(!phone(testInfo), 'Tap targets and sideways scroll are checked at phone width (390).')
  test.setTimeout(240_000)
  await fresh(context, request)
  const w = watch(page)
  const info = (await api(request, 'GET', '/api/info')).body
  const token = await dealerToken(request)
  const o = await orderViaApi(request)
  await fillDay(request, token, '2026-09-15', ['Little Bay', 'South Brook'])

  // Order page, step by step. The product cards come from /api/info: wait for them, or step 1 has no buttons yet.
  await page.goto('/')
  await expect(page.locator('button.product').first()).toBeVisible()
  await checkScreen(page, '/ step 1')
  await tap(page, page.locator('button.product[data-product="p_softwood_dry"]'))
  await tap(page, page.locator('#next'))
  await expect(page.locator('button.unit').first()).toBeVisible()
  await checkScreen(page, '/ step 2')
  await tap(page, page.locator('#next'))
  await pinAt(page, page.locator('#map'), info.yard, "King's Point")
  await typeIn(page, page.locator('#address'), 'Near the church (SAMPLE)')
  await checkScreen(page, '/ step 3')
  await tap(page, page.locator('#next'))
  await expect(page.locator('#any-day')).toBeVisible()
  await checkScreen(page, '/ step 4')
  await tap(page, page.locator('#any-day'))
  await tap(page, page.locator('#next'))
  await expect(page.locator('#send')).toBeVisible()
  await checkScreen(page, '/ step 5')

  // Status page.
  await page.goto(o.status_url)
  await expect(page.locator('#status')).toHaveText('Requested')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, '/o/: sideways scroll').toBeLessThanOrEqual(0)
  const call = page.locator('#call')
  await expectTapTarget(page, call, 44, '/o/: Call')

  // Dealer page.
  await page.goto('/dealer/')
  await expect(page.locator('#signin-btn')).toBeVisible()
  await checkScreen(page, '/dealer/ sign-in')
  await signInDealer(page)
  await expect(page.locator(`.order-card[data-order="${o.id}"]`)).toBeVisible()
  await checkScreen(page, '/dealer/ Orders')
  await tap(page, page.locator(`.order-card[data-order="${o.id}"]`).getByRole('button', { name: 'Schedule' }))
  await expect(page.locator(`.order-card[data-order="${o.id}"] button.day`).first()).toBeVisible()
  await checkScreen(page, '/dealer/ schedule picker')
  await tap(page, page.locator(`.order-card[data-order="${o.id}"] .card-open`))
  await expect(page.locator('#detail-owing')).toBeVisible()
  await checkScreen(page, '/dealer/ order detail')
  await tap(page, page.locator('#detail .back'))
  await tap(page, page.locator('#add-phone-order'))
  await expect(page.locator('#save-phone-order')).toBeVisible()
  await checkScreen(page, '/dealer/ phone order')
  await tap(page, page.locator('#detail .back'))
  await tap(page, page.getByRole('tab', { name: 'Plan' }))
  await expect(page.locator('button.plan-day').first()).toBeVisible()
  await checkScreen(page, '/dealer/ Plan days')
  await tap(page, page.locator('button.plan-day[data-date="2026-09-15"]'))
  await expect(page.locator('#stops .stop')).toHaveCount(2)
  await checkScreen(page, '/dealer/ Plan route')

  w.expectClean()
  assertNoThirdParty(context)
})

test('the sticky price bar never covers the field being typed in, or Send request', async ({ page, context, request }) => {
  await fresh(context, request)
  const w = watch(page)
  const info = (await api(request, 'GET', '/api/info')).body
  await page.goto('/')
  await tap(page, page.locator('button.product[data-product="p_softwood_dry"]'))
  await tap(page, page.locator('#next'))
  await tap(page, page.locator('#next'))
  await pinAt(page, page.locator('#map'), info.yard, "King's Point")
  await typeIn(page, page.locator('#address'), 'Near the church (SAMPLE)')
  await tap(page, page.locator('#next'))
  await tap(page, page.locator('#any-day'))
  await tap(page, page.locator('#next'))
  await typeIn(page, page.locator('#name'), 'Joan T. (SAMPLE)')
  await typeIn(page, page.locator('#phone'), '709-555-0107')
  await typeIn(page, page.locator('#note'), 'The gate is on the left.')

  // Straight after typing, with nothing scrolled for the check: the focused field's middle and its lower edge are the
  // field itself, not the bar.
  const note = page.locator('#note')
  await expect(note).toBeFocused()
  const covered = await note.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return [r.top + r.height / 2, r.bottom - 3].map((y) => {
      const t = document.elementFromPoint(r.left + r.width / 2, y)
      return t === el || el.contains(t) ? '' : t ? t.outerHTML.slice(0, 120) : 'nothing (off screen)'
    })
  })
  expect(covered, 'what is on top of the focused note field').toEqual(['', ''])
  await expectTapTarget(page, page.locator('#send'), 44, 'Send request')
  w.expectClean()
  assertNoThirdParty(context)
})
