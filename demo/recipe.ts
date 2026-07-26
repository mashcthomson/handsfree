import { HandsFreeEngine } from '../src/engine/HandsFreeEngine'
import type { TraceName } from '../src/traces'

interface Step {
  title: string
  body: string
  timerSec?: number
}

const STEPS: Step[] = [
  {
    title: '1. Pat the salmon dry',
    body: 'Take the fillets out of the fridge, pat both sides dry with paper towel, and season generously with salt and pepper. Dry skin is the whole secret to a crisp sear.',
  },
  {
    title: '2. Heat the pan',
    body: 'Put a heavy skillet over medium-high heat with a tablespoon of neutral oil. Wait until the oil just starts to shimmer before the fish goes anywhere near it.',
    timerSec: 90,
  },
  {
    title: '3. Sear, skin-side down',
    body: 'Lay the fillets skin-side down and press gently for the first few seconds so the skin doesn’t curl. Leave it alone — no peeking, no moving it.',
    timerSec: 240,
  },
  {
    title: '4. Flip and finish',
    body: 'Flip once the skin releases easily and is deep golden. Add a knob of butter, a squeeze of lemon, and a smashed garlic clove; spoon the foaming butter over the top.',
    timerSec: 120,
  },
  {
    title: '5. Rest',
    body: 'Move the salmon to a plate and let it rest — it keeps cooking for another minute or two off the heat, and resting keeps it juicy instead of dry.',
    timerSec: 90,
  },
  {
    title: '6. Plate and serve',
    body: 'Spoon the lemon butter over the top, finish with flaky salt and a few turns of pepper. Serve immediately, while the skin is still crisp.',
  },
]

const INGREDIENTS = [
  'Two 180g salmon fillets, skin on',
  '1 tbsp neutral oil',
  '2 tbsp unsalted butter',
  '1 clove garlic, smashed',
  'Half a lemon',
  'Flaky salt & black pepper',
]

// --- DOM refs ---
const statusEl = document.getElementById('status')!
const sourceSelect = document.getElementById('source-select') as HTMLSelectElement
const prevBtn = document.getElementById('prev-btn') as HTMLButtonElement
const nextBtn = document.getElementById('next-btn') as HTMLButtonElement
const stepPanel = document.getElementById('step-panel') as HTMLElement
const stepTitle = document.getElementById('step-title')!
const stepBody = document.getElementById('step-body')!
const stepProgress = document.getElementById('step-progress')!
const timerRow = document.getElementById('timer-row') as HTMLElement
const timerClock = document.getElementById('timer-clock')!
const timerStart = document.getElementById('timer-start') as HTMLButtonElement
const timerReset = document.getElementById('timer-reset') as HTMLButtonElement
const ingredientsList = document.getElementById('ingredients')!
const eventLog = document.getElementById('event-log')!

let currentStep = 0
let timerRemaining = 0
let timerHandle: ReturnType<typeof setInterval> | null = null

function renderIngredients(): void {
  ingredientsList.innerHTML = ''
  INGREDIENTS.forEach((text, i) => {
    const li = document.createElement('li')
    const id = `ingredient-${i}`
    li.innerHTML = `<input type="checkbox" id="${id}" /><label for="${id}"></label>`
    li.querySelector('label')!.textContent = text
    ingredientsList.appendChild(li)
  })
}

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function stopTimer(): void {
  if (timerHandle) clearInterval(timerHandle)
  timerHandle = null
}

function renderStep(announce: boolean): void {
  stopTimer()
  const step = STEPS[currentStep]
  stepTitle.textContent = step.title
  stepBody.textContent = step.body
  stepProgress.textContent = `Step ${currentStep + 1} of ${STEPS.length}`
  prevBtn.disabled = currentStep === 0
  nextBtn.disabled = currentStep === STEPS.length - 1

  if (step.timerSec) {
    timerRow.hidden = false
    timerRemaining = step.timerSec
    timerClock.textContent = formatClock(timerRemaining)
    timerStart.textContent = 'Start timer'
    timerStart.disabled = false
  } else {
    timerRow.hidden = true
  }

  if (announce) {
    engine.announce(`Step ${currentStep + 1} of ${STEPS.length}: ${step.title.replace(/^\d+\.\s*/, '')}`)
    engine.focusElement(stepPanel)
  }
}

function goToStep(index: number, announce = true): void {
  currentStep = Math.min(STEPS.length - 1, Math.max(0, index))
  renderStep(announce)
}

function startTimer(): void {
  stopTimer()
  timerStart.textContent = 'Pause'
  timerHandle = setInterval(() => {
    timerRemaining -= 1
    timerClock.textContent = formatClock(Math.max(0, timerRemaining))
    if (timerRemaining <= 0) {
      stopTimer()
      timerStart.textContent = 'Done'
      timerStart.disabled = true
      engine.announce(`Timer done for ${STEPS[currentStep].title}`)
    }
  }, 1000)
  engine.announce('Timer started')
}

timerStart.addEventListener('click', () => {
  if (timerHandle) {
    stopTimer()
    timerStart.textContent = 'Resume'
    engine.announce('Timer paused')
  } else if (timerRemaining > 0) {
    startTimer()
  }
})
timerReset.addEventListener('click', () => {
  stopTimer()
  timerRemaining = STEPS[currentStep].timerSec ?? 0
  timerClock.textContent = formatClock(timerRemaining)
  timerStart.textContent = 'Start timer'
  timerStart.disabled = false
})

prevBtn.addEventListener('click', () => goToStep(currentStep - 1))
nextBtn.addEventListener('click', () => goToStep(currentStep + 1))

renderIngredients()

// --- engine wiring ---
// Full, uncapped event history exposed on window for automated/headless
// verification (Playwright reads this directly rather than scraping the
// visible, intentionally-capped-at-80-rows on-screen log). Not used by any
// production behavior.
declare global {
  interface Window {
    __hfEvents: unknown[]
  }
}
window.__hfEvents = []

// Human-readable line for the visible log — the raw event object still goes
// into window.__hfEvents in full for headless verification (see below), so
// this formatting is purely presentational and never affects what's tested.
function describeEvent(event: { type: string; [k: string]: unknown }): string {
  switch (event.type) {
    case 'swipe':
      return `Swipe ${event.direction}`
    case 'spread-change':
      return `Zoom ${(event.scale as number).toFixed(2)}x`
    case 'dwell-progress':
      return `Dwell ${Math.round((event.ratio as number) * 100)}%`
    case 'dwell-trigger':
      return 'Dwell → click'
    case 'dwell-cancel':
      return 'Dwell cancelled'
    case 'cursor-move':
      return `Cursor ${(event.x as number).toFixed(2)}, ${(event.y as number).toFixed(2)}`
    case 'cursor-start':
      return 'Pointing started'
    case 'cursor-end':
      return 'Pointing stopped'
    case 'pinch':
      return 'Pinch → click'
    case 'fist-start':
      return 'Grab-scroll started'
    case 'fist-move':
      return `Grab-scroll drag (${(event.dx as number).toFixed(2)}, ${(event.dy as number).toFixed(2)})`
    case 'fist-end':
      return 'Grab-scroll ended'
    case 'spread-start':
      return 'Zoom gesture started'
    case 'spread-end':
      return 'Zoom gesture ended'
    case 'hand-lost':
      return 'Hand lost'
    default:
      return event.type
  }
}

function logEvent(line: string, raw: unknown): void {
  window.__hfEvents.push(raw)
  const row = document.createElement('div')
  row.textContent = `${new Date().toLocaleTimeString()}  ${line}`
  eventLog.appendChild(row)
  eventLog.scrollTop = eventLog.scrollHeight
  while (eventLog.childElementCount > 80) eventLog.removeChild(eventLog.firstChild!)
}

const engine = new HandsFreeEngine({
  source: 'auto',
  replayTrace: 'open-palm-move',
  hud: true,
  onSourceChange: (label, mode) => {
    statusEl.textContent = label
    statusEl.className = `status-pill ${mode === 'camera' ? 'live' : 'replay'}`
  },
  onGestureEvent: (event) => {
    logEvent(describeEvent(event), event)
    // Give 'swipe' page-specific meaning — advance the recipe step —
    // instead of the engine's generic tab-order focus cycling. Every
    // other gesture (pinch, fist-scroll, dwell, two-hand zoom, cursor
    // pointing) keeps the engine's default focus/a11y-driven behavior,
    // which is exactly what we want for the timer buttons and ingredient
    // checkboxes.
    if (event.type === 'swipe') {
      if (event.direction === 'right') goToStep(currentStep + 1)
      else goToStep(currentStep - 1)
      return true // skip default focusNext/focusPrevious
    }
    return false
  },
})

engine.start().catch((err) => {
  statusEl.textContent = `error: ${(err as Error).message}`
  logEvent(`error: ${(err as Error).message}`, { type: 'init-error' })
})

sourceSelect.addEventListener('change', () => {
  window.__hfEvents.length = 0
  const value = sourceSelect.value
  if (value === 'auto' || value === 'camera') {
    engine.setSource(value)
  } else {
    const trace = value.split(':')[1] as TraceName
    engine.setSource('replay', trace)
  }
})

window.addEventListener('beforeunload', () => {
  stopTimer()
  engine.stop()
})

goToStep(0, false)
