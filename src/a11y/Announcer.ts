/**
 * A single `aria-live="polite"` region, injected once, reused for every
 * status announcement (focus changes, gesture recognized, scrolling,
 * dwell countdown). Screen reader users get the same state changes a
 * sighted user sees in the visible focus ring / gesture HUD.
 *
 * Implementation note: some screen readers don't reliably re-announce
 * identical consecutive text. We work around it the standard way — clear
 * the region on a microtask, then set the new text — without spamming
 * announcements for every single frame of continuous gestures (callers
 * are expected to throttle high-frequency events themselves; this class
 * only ever holds the latest message).
 */
export class Announcer {
  private el: HTMLElement

  constructor(hostDocument: Document = document) {
    let el = hostDocument.getElementById('handsfree-announcer')
    if (!el) {
      el = hostDocument.createElement('div')
      el.id = 'handsfree-announcer'
      el.setAttribute('aria-live', 'polite')
      el.setAttribute('aria-atomic', 'true')
      el.setAttribute('role', 'status')
      Object.assign(el.style, {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: '0',
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0,0,0,0)',
        whiteSpace: 'nowrap',
        border: '0',
      })
      hostDocument.body.appendChild(el)
    }
    this.el = el
  }

  say(message: string): void {
    this.el.textContent = ''
    // Force layout so the DOM mutation is observed as a real change even
    // if the new text is identical to what was there two messages ago.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    void this.el.offsetWidth
    this.el.textContent = message
  }

  destroy(): void {
    this.el.remove()
  }
}
