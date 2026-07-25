import { chromium } from '/tmp/pw-final/node_modules/playwright/index.mjs'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:4321'
const shotDir = new URL('./screenshots/', import.meta.url).pathname
mkdirSync(shotDir, { recursive: true })

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})

async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', (err) => console.log('[pageerror]', err.message))
  page.on('requestfailed', (r) => console.log('[requestfailed]', r.url(), r.failure()?.errorText))
  return page
}

async function shot(page, name) {
  await page.screenshot({ path: `${shotDir}${name}.png` })
  console.log('screenshot ->', name)
}

async function selectAndWaitReady(page, value, settleMs = 400) {
  await page.selectOption('#source-select', value)
  await page.waitForTimeout(settleMs)
}

function countType(events, type) {
  return events.filter((e) => e.type === type).length
}

// ---------- 1. Landing page: camera denied (no permission granted) --------
{
  const page = await newPage()
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  await shot(page, '01-landing-camera-denied-fallback')
  const status = await page.textContent('#status')
  console.log('landing status pill:', status)
  await page.close()
}

// ---------- 2. Recipe demo, open-palm-move: cursor + dwell-to-click -------
{
  const page = await newPage()
  await page.goto(`${BASE}/recipe.html`, { waitUntil: 'networkidle' })
  await selectAndWaitReady(page, 'replay:open-palm-move', 600)
  await shot(page, '02-recipe-open-palm-start')
  await page.waitForTimeout(6500) // covers the trace's still-hold phase (dwellMs=900ms) with margin
  await shot(page, '03-recipe-open-palm-after-dwell-window')
  const events = await page.evaluate(() => window.__hfEvents)
  console.log(
    `open-palm-move: cursor-start=${countType(events, 'cursor-start')} dwell-progress=${countType(events, 'dwell-progress')} dwell-trigger=${countType(events, 'dwell-trigger')} cursor-move=${countType(events, 'cursor-move')} swipe(expect 0)=${countType(events, 'swipe')}`,
  )
  await page.close()
}

// ---------- 3. Recipe demo, pinch-click trace: debounce check -------------
{
  const page = await newPage()
  await page.goto(`${BASE}/recipe.html`, { waitUntil: 'networkidle' })
  await selectAndWaitReady(page, 'replay:pinch-click', 600)
  await page.waitForTimeout(4000) // trace's two holds complete by ~4.34s; stay under the ~5.1s trace loop point
  await shot(page, '04-recipe-pinch-click')
  const events = await page.evaluate(() => window.__hfEvents)
  const pinchCount = countType(events, 'pinch')
  console.log(
    `pinch-click trace (one 1.4s hold + one 0.7s hold, separated by 900ms > 350ms cooldown) -> discrete 'pinch' events fired: ${pinchCount} (expect exactly 2 — held pinches must not repeat-fire)`,
  )
  await page.close()
}

// ---------- 4. Recipe demo, fist-scroll trace: scroll + start/end ---------
{
  const page = await newPage()
  await page.goto(`${BASE}/recipe.html`, { waitUntil: 'networkidle' })
  await selectAndWaitReady(page, 'replay:fist-scroll', 700)
  const scrollBefore = await page.evaluate(() => window.scrollY)
  await page.waitForTimeout(2100) // through the close + drag-down phase
  const scrollDuringDown = await page.evaluate(() => window.scrollY)
  await page.waitForTimeout(1900) // through drag back up
  const scrollAfterUp = await page.evaluate(() => window.scrollY)
  await page.waitForTimeout(900) // through the open/release
  const events = await page.evaluate(() => window.__hfEvents)
  console.log(
    `fist-scroll: fist-start=${countType(events, 'fist-start')} fist-end=${countType(events, 'fist-end')} fist-move(continuous)=${countType(events, 'fist-move')}`,
  )
  console.log(`scrollY: before=${scrollBefore} duringDown=${scrollDuringDown} afterUp=${scrollAfterUp}`)
  await shot(page, '05-recipe-fist-scroll')
  await page.close()
}

// ---------- 5. Recipe demo, swipe-right trace: step navigation + debounce -
{
  const page = await newPage()
  await page.goto(`${BASE}/recipe.html`, { waitUntil: 'networkidle' })
  const stepBefore = await page.textContent('#step-progress')
  await selectAndWaitReady(page, 'replay:swipe-right', 3200) // trace is ~2.68s, give margin for full playback
  const stepAfter = await page.textContent('#step-progress')
  const events = await page.evaluate(() => window.__hfEvents)
  const swipeCount = countType(events, 'swipe')
  console.log(
    `swipe-right trace (two whips, separated by 1.2s > 650ms cooldown): step before="${stepBefore}" after="${stepAfter}", discrete swipe events: ${swipeCount} (expect exactly 2)`,
  )
  await shot(page, '06-recipe-swipe-right')
  await page.close()
}

// ---------- 5b. swipe-left ------------------------------------------------
{
  const page = await newPage()
  await page.goto(`${BASE}/recipe.html`, { waitUntil: 'networkidle' })
  // Start on step 3 so left-swipes have somewhere to go.
  await page.click('#next-btn')
  await page.click('#next-btn')
  const stepBefore = await page.textContent('#step-progress')
  await selectAndWaitReady(page, 'replay:swipe-left', 3200)
  const stepAfter = await page.textContent('#step-progress')
  const events = await page.evaluate(() => window.__hfEvents)
  console.log(`swipe-left trace: step before="${stepBefore}" after="${stepAfter}", swipe events: ${countType(events, 'swipe')}`)
  await page.close()
}

// ---------- 6. Recipe demo, two-hand-spread trace: zoom -------------------
{
  const page = await newPage()
  await page.goto(`${BASE}/recipe.html`, { waitUntil: 'networkidle' })
  await selectAndWaitReady(page, 'replay:two-hand-spread', 600)
  const zoomBefore = await page.evaluate(() => document.body.style.zoom || '1')
  await page.waitForTimeout(2600)
  const zoomDuring = await page.evaluate(() => document.body.style.zoom || '1')
  const events = await page.evaluate(() => window.__hfEvents)
  console.log(
    `two-hand-spread: spread-start=${countType(events, 'spread-start')} spread-change=${countType(events, 'spread-change')} zoom before=${zoomBefore} during=${zoomDuring}`,
  )
  await shot(page, '07-recipe-two-hand-spread')
  await page.close()
}

// ---------- 7. Plain page: script-tag drop-in proof ------------------------
{
  const page = await newPage()
  await page.goto(`${BASE}/plain.html`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  await shot(page, '08-plain-page-dropin')
  const hasGlobal = await page.evaluate(() => typeof window.HandsFree)
  const hudText = await page.evaluate(() => document.getElementById('handsfree-hud')?.textContent ?? null)
  console.log('window.HandsFree typeof:', hasGlobal, '| HUD:', hudText)
  await page.close()
}

// ---------- 8. Reduced motion respected ------------------------------------
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.goto(`${BASE}/recipe.html`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  const cursorTransition = await page.evaluate(
    () => getComputedStyle(document.getElementById('handsfree-cursor')).transitionDuration,
  )
  console.log('prefers-reduced-motion cursor transition-duration (expect 0s):', cursorTransition)
  await page.close()
}

// ---------- 9. Camera permission explicitly denied -> graceful fallback ---
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: [] })
  const page = await context.newPage()
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)
  const status = await page.textContent('#status')
  const bodyOk = await page.evaluate(() => document.body.children.length > 0)
  console.log('camera-denied fallback status:', status, '| page intact:', bodyOk)
  await shot(page, '09-camera-denied-no-broken-screen')
  await page.close()
}

// ---------- 10. Keyboard/focus sanity: focus ring + aria-live present -----
{
  const page = await newPage()
  await page.goto(`${BASE}/recipe.html`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  const hasAnnouncer = await page.evaluate(() => !!document.getElementById('handsfree-announcer'))
  const announcerLive = await page.evaluate(() => document.getElementById('handsfree-announcer')?.getAttribute('aria-live'))
  console.log('aria-live announcer present:', hasAnnouncer, '| aria-live=', announcerLive)
  await page.close()
}

await browser.close()
console.log('DONE')
