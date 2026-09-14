// docs/shots/: screenshots of every main screen from a running `npm run demo`, phone (WebKit, iPhone 14) and desktop (Chromium,
// 1280). Viewport captures on purpose: full-page captures paint the sticky header (WebKit) or the fixed price bar (Chromium)
// halfway down the picture. Map tiles load from OpenStreetMap exactly as they would for a person opening the page.
// Usage: npm run demo   (in another terminal), then   node tools/docs-shots.mjs [base, default http://127.0.0.1:7701]
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../app/package.json', import.meta.url))
const { chromium, webkit, devices } = require('@playwright/test')
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'docs', 'shots')
const BASE = process.argv[2] || 'http://127.0.0.1:7701'
mkdirSync(OUT, { recursive: true })

async function json(url, opts = {}) {
  const r = await fetch(BASE + url, opts)
  if (!r.ok) throw new Error(`${url} answered ${r.status}`)
  return r.json()
}

// Pick real SAMPLE rows from the demo: a scheduled order for the status page, the busiest delivery day for the route.
const { token } = await json('/api/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: '1357' }) })
const auth = { Authorization: `Bearer ${token}` }
const board = await json('/api/dealer/board', { headers: auth })
const sample = board.scheduled[0] || board.new[0] || board.delivered[0]
const busy = (await json('/api/dealer/days', { headers: auth })).days.filter((d) => d.delivers).sort((a, b) => b.orders - a.orders)[0]
await json('/api/signout', { method: 'POST', headers: auth })

const PROFILES = [
  { name: 'phone', engine: webkit, use: { ...devices['iPhone 14'] } },
  { name: 'desktop', engine: chromium, use: { viewport: { width: 1280, height: 800 } } },
]

for (const profile of PROFILES) {
  const browser = await profile.engine.launch()
  const context = await browser.newContext(profile.use)
  const page = await context.newPage()
  const shot = async (name) => {
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(700)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: path.join(OUT, `${profile.name}-${name}.png`) })
    console.log(`docs/shots/${profile.name}-${name}.png`)
  }
  const signIn = async (url, pin) => {
    await page.goto(BASE + url)
    await page.locator('#pin').click()
    await page.keyboard.type(pin)
    await page.locator('#signin-btn').click()
  }

  await page.goto(BASE + '/')
  await shot('order')
  await page.goto(`${BASE}/o/?t=${sample.token}`)
  await shot('status')

  await signIn('/dealer/', '1357')
  await page.getByRole('tab', { name: 'Orders' }).waitFor()
  await shot('dealer-orders')
  await page.getByRole('tab', { name: 'Plan' }).click()
  await shot('dealer-plan')
  await page.goto(`${BASE}/dealer/#plan/${busy.date}`)
  await page.reload()
  await shot('dealer-route')
  await page.getByRole('tab', { name: 'Customers' }).click()
  await shot('dealer-customers')
  await page.getByRole('tab', { name: 'Totals' }).click()
  await shot('dealer-totals')

  await signIn('/driver/', '2580')
  await page.locator('#sync-strip').waitFor()
  await shot('driver-day')
  await page.locator('#daylight').click()
  await shot('driver-daylight')

  await browser.close()
}
