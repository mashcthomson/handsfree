import { Announcer } from './Announcer'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',')

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return false
  const style = getComputedStyle(el)
  if (style.visibility === 'hidden' || style.display === 'none') return false
  if (style.opacity === '0') return false
  return true
}

function labelFor(el: Element): string {
  const aria = el.getAttribute('aria-label')
  if (aria) return aria
  const text = (el.textContent || '').trim()
  if (text) return text.slice(0, 60)
  const placeholder = el.getAttribute('placeholder')
  if (placeholder) return placeholder
  return el.tagName.toLowerCase()
}

/**
 * Everything gesture actions actually drive: real DOM focus (not a
 * synthetic mouse position pretending to be one), real tab order, a
 * visible focus indicator that works on top of whatever the host page
 * already styles, and an aria-live announcer so the state changes are not
 * silent for screen reader users. This is the accessibility contract the
 * whole product exists to satisfy — every gesture in GestureRecognizer
 * ultimately calls into one of these methods, never `dispatchEvent(new
 * MouseEvent(...))` at raw coordinates.
 */
export class FocusController {
  private announcer: Announcer
  private cursorEl: HTMLElement
  private dwellRingEl: HTMLElement
  private styleEl: HTMLStyleElement
  private reducedMotion: boolean
  private currentIndex = -1
  private lastAnnouncedLabel = ''
  private zoomScale = 1
  private root: HTMLElement

  constructor(root: HTMLElement = document.body) {
    this.root = root
    this.announcer = new Announcer()
    this.reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

    this.styleEl = document.createElement('style')
    this.styleEl.id = 'handsfree-style'
    this.styleEl.textContent = `
      .handsfree-focus-ring {
        outline: 3px solid #22d3ee !important;
        outline-offset: 3px !important;
        border-radius: 4px;
      }
      #handsfree-cursor {
        position: fixed;
        top: 0; left: 0;
        width: 28px; height: 28px;
        margin: -14px 0 0 -14px;
        border-radius: 50%;
        border: 2px solid #22d3ee;
        background: rgba(34, 211, 238, 0.18);
        pointer-events: none;
        z-index: 2147483646;
        display: none;
        ${this.reducedMotion ? '' : 'transition: transform 60ms linear;'}
      }
      #handsfree-cursor.active { display: block; }
      #handsfree-dwell-ring {
        position: fixed;
        top: 0; left: 0;
        width: 40px; height: 40px;
        margin: -20px 0 0 -20px;
        border-radius: 50%;
        pointer-events: none;
        z-index: 2147483647;
        display: none;
        background: conic-gradient(#f59e0b calc(var(--ratio, 0) * 360deg), rgba(245,158,11,0.12) 0deg);
        ${this.reducedMotion ? '' : 'transition: transform 60ms linear;'}
      }
      #handsfree-dwell-ring.active { display: block; }
    `
    document.head.appendChild(this.styleEl)

    this.cursorEl = document.createElement('div')
    this.cursorEl.id = 'handsfree-cursor'
    document.body.appendChild(this.cursorEl)

    this.dwellRingEl = document.createElement('div')
    this.dwellRingEl.id = 'handsfree-dwell-ring'
    document.body.appendChild(this.dwellRingEl)
  }

  destroy(): void {
    this.clearFocusRing()
    this.styleEl.remove()
    this.cursorEl.remove()
    this.dwellRingEl.remove()
    this.announcer.destroy()
  }

  // --- focusable element list / tab-order navigation -------------------

  getFocusableElements(): HTMLElement[] {
    const nodes = Array.from(this.root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    return nodes.filter(isVisible)
  }

  private clearFocusRing(): void {
    document.querySelectorAll('.handsfree-focus-ring').forEach((el) => el.classList.remove('handsfree-focus-ring'))
  }

  private applyFocusRing(el: HTMLElement): void {
    this.clearFocusRing()
    el.classList.add('handsfree-focus-ring')
    el.focus({ preventScroll: false })
  }

  focusNext(): void {
    const els = this.getFocusableElements()
    if (els.length === 0) return
    this.currentIndex = (this.currentIndex + 1 + els.length) % els.length
    const el = els[this.currentIndex]
    this.applyFocusRing(el)
    this.announcer.say(`Focused: ${labelFor(el)}`)
  }

  focusPrevious(): void {
    const els = this.getFocusableElements()
    if (els.length === 0) return
    this.currentIndex = (this.currentIndex - 1 + els.length) % els.length
    const el = els[this.currentIndex]
    this.applyFocusRing(el)
    this.announcer.say(`Focused: ${labelFor(el)}`)
  }

  /** Activates whatever currently has real DOM focus — used by the pinch gesture. */
  /** Moves real DOM focus (+ visible ring + announcement) to a specific
   * element, keeping the internal tab-order index in sync so a subsequent
   * swipe continues from the right place. Used by host pages that want a
   * gesture to jump focus somewhere specific (e.g. "swipe = next recipe
   * step" jumping straight to that step's heading) while still going
   * through the same real-focus code path as generic tab-order swiping. */
  focusElement(el: HTMLElement): void {
    const els = this.getFocusableElements()
    const idx = els.indexOf(el)
    if (idx >= 0) this.currentIndex = idx
    this.applyFocusRing(el)
    this.announcer.say(labelFor(el))
  }

  activateFocused(): void {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) {
      this.announcer.say('Nothing focused to activate')
      return
    }
    this.announcer.say(`Activated: ${labelFor(el)}`)
    el.click()
  }

  // --- pointing cursor mode (still focus-driven, not synthetic clicks) --

  showCursor(): void {
    this.cursorEl.classList.add('active')
  }

  hideCursor(): void {
    this.cursorEl.classList.remove('active')
    this.hideDwellRing()
  }

  /** x,y normalized [0,1] hand-tracking image space. Moves the visible
   * cursor and, if it's now over a focusable element, moves real DOM
   * focus onto it (with the visible ring) — pointing is a way of
   * *choosing what to focus*, not an independent input channel. */
  moveCursorTo(xNorm: number, yNorm: number): { x: number; y: number } {
    // Mirror x: front-facing camera image is naturally mirrored relative
    // to how a user standing in front of the screen experiences "my hand
    // moved right", so un-mirror for a page-space cursor that matches
    // felt hand motion.
    const x = (1 - xNorm) * window.innerWidth
    const y = yNorm * window.innerHeight
    this.cursorEl.style.transform = `translate(${x}px, ${y}px)`
    this.dwellRingEl.style.transform = `translate(${x}px, ${y}px)`

    const under = document.elementFromPoint(x, y) as HTMLElement | null
    const target = under?.closest<HTMLElement>(FOCUSABLE_SELECTOR)
    if (target && target !== document.activeElement) {
      const els = this.getFocusableElements()
      const idx = els.indexOf(target)
      if (idx >= 0) this.currentIndex = idx
      this.applyFocusRing(target)
      const label = labelFor(target)
      if (label !== this.lastAnnouncedLabel) {
        this.announcer.say(`Pointing at: ${label}`)
        this.lastAnnouncedLabel = label
      }
    }
    return { x, y }
  }

  // --- dwell-to-click fallback ------------------------------------------

  showDwellProgress(ratio: number): void {
    this.dwellRingEl.classList.add('active')
    this.dwellRingEl.style.setProperty('--ratio', String(Math.min(1, Math.max(0, ratio))))
  }

  hideDwellRing(): void {
    this.dwellRingEl.classList.remove('active')
    this.dwellRingEl.style.setProperty('--ratio', '0')
  }

  triggerDwellClick(): void {
    const el = document.activeElement as HTMLElement | null
    this.hideDwellRing()
    if (!el || el === document.body) return
    this.announcer.say(`Dwell-activated: ${labelFor(el)}`)
    el.click()
  }

  // --- scroll (fist-drag) -------------------------------------------------

  scrollBy(dxNorm: number, dyNorm: number): void {
    // dyNorm is in normalized image-space units; scale to a comfortable
    // pixel range. Positive dy (hand moving down in image space) scrolls
    // the page down, matching a physical "grab and pull" mental model.
    const scrollScale = window.innerHeight * 2.2
    window.scrollBy({
      top: dyNorm * scrollScale,
      left: -dxNorm * (window.innerWidth * 2.2),
      behavior: this.reducedMotion ? 'auto' : 'auto',
    })
  }

  announceScrollStart(): void {
    this.announcer.say('Scrolling')
  }

  announceScrollEnd(): void {
    this.announcer.say('Scroll released')
  }

  // --- two-hand zoom --------------------------------------------------

  setZoomScale(scale: number): void {
    this.zoomScale = Math.min(2.2, Math.max(0.6, scale))
    ;(document.body.style as unknown as { zoom: string }).zoom = String(this.zoomScale)
  }

  resetZoom(): void {
    this.zoomScale = 1
    ;(document.body.style as unknown as { zoom: string }).zoom = '1'
  }

  announce(message: string): void {
    this.announcer.say(message)
  }

  get isReducedMotion(): boolean {
    return this.reducedMotion
  }
}
