import type { LandmarkFrame, LandmarkSource } from '../types'
import { CameraSource, CameraSourceError } from '../landmark-source/CameraSource'
import { ReplaySource } from '../landmark-source/ReplaySource'
import { GestureRecognizer } from '../gestures/GestureRecognizer'
import type { GestureEvent, GestureRecognizerOptions } from '../gestures/types'
import { FocusController } from '../a11y/FocusController'
import { TRACES, type TraceName } from '../traces'

export type SourceMode = 'auto' | 'camera' | 'replay'

export interface HandsFreeEngineOptions {
  /** 'auto' tries the camera first and silently falls back to replay if
   * denied/unavailable — this is the mandatory graceful-degradation path.
   * 'camera' / 'replay' force one or the other (replay is what the
   * headless demo-video capture uses). */
  source: SourceMode
  /** Which bundled trace to use when source is 'replay' or as the auto-fallback. */
  replayTrace: TraceName
  /** Root element whose focusable descendants gesture navigation cycles through. Defaults to document.body. */
  root: HTMLElement
  /** Show the small on-screen HUD (source, current pose, last event). */
  hud: boolean
  /** Tuning overrides passed straight to GestureRecognizer. */
  gestureOptions: Partial<GestureRecognizerOptions>
  /** Called for every raw gesture event, before the engine's own default
   * focus/scroll/zoom handling runs — lets a host page log or override.
   * Return `true` to tell the engine to skip its own default handling for
   * that event (e.g. a recipe page giving 'swipe' page-specific
   * "next/previous step" meaning instead of generic tab-order focus). */
  onGestureEvent: (event: GestureEvent) => boolean | void
  /** Called once the LandmarkSource actually starts (after camera
   * permission resolves, or immediately for replay). */
  onSourceChange: (label: string, mode: SourceMode) => void
}

const DEFAULT_OPTIONS: HandsFreeEngineOptions = {
  source: 'auto',
  replayTrace: 'open-palm-move',
  root: typeof document !== 'undefined' ? document.body : (undefined as unknown as HTMLElement),
  hud: true,
  gestureOptions: {},
  onGestureEvent: () => {},
  onSourceChange: () => {},
}

/**
 * The whole product in one class: pick a landmark source (camera, falling
 * back to replay on denial/error/no-webcam), run it through
 * GestureRecognizer, and translate the resulting discrete gesture events
 * into real DOM focus movement / activation / scroll / zoom via
 * FocusController. This is what the one-script-tag bundle exposes as
 * `window.HandsFree`.
 */
export class HandsFreeEngine {
  private opts: HandsFreeEngineOptions
  private recognizer: GestureRecognizer
  private focus: FocusController
  private source: LandmarkSource | null = null
  private activeMode: SourceMode = 'replay'
  private hudEl: HTMLElement | null = null
  private lastEventLabel = ''
  private stopped = false
  /** Bumped on every start()/setSource() call. An in-flight source
   * (camera permission prompt, replay startup) that resolves after a
   * newer call has superseded it checks this before touching engine
   * state or being assigned as `this.source` — otherwise a fast
   * setSource() call while an earlier start() is still awaiting camera
   * permission could leave two LandmarkSources both feeding frames into
   * the same GestureRecognizer, scrambling its hysteresis state. */
  private opSeq = 0

  constructor(options: Partial<HandsFreeEngineOptions> = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...options }
    this.recognizer = new GestureRecognizer(this.opts.gestureOptions)
    this.focus = new FocusController(this.opts.root ?? document.body)
    if (this.opts.hud) this.hudEl = this.buildHud()
  }

  async start(): Promise<void> {
    this.stopped = false
    const seq = ++this.opSeq
    const mode = this.opts.source

    if (mode === 'replay') {
      await this.startReplay(this.opts.replayTrace, seq)
      return
    }

    if (mode === 'camera') {
      await this.startCamera(/* fallbackOnError */ false, seq)
      return
    }

    // 'auto': try camera, fall back to replay on any failure. This is the
    // graceful-degradation path — camera denied, no webcam present, or a
    // headless test environment must never produce a broken screen.
    await this.startCamera(/* fallbackOnError */ true, seq)
  }

  private async startCamera(fallbackOnError: boolean, seq: number): Promise<void> {
    const cam = new CameraSource()
    try {
      await cam.start((frame) => this.onFrame(frame, seq))
      if (seq !== this.opSeq) {
        // Superseded by a later start()/setSource() while camera
        // permission was resolving — discard this source, don't touch
        // engine state.
        cam.stop()
        return
      }
      this.source = cam
      this.activeMode = 'camera'
      this.focus.announce('Camera hand tracking active')
      this.opts.onSourceChange(cam.label, 'camera')
      this.updateHud()
    } catch (err) {
      if (!(err instanceof CameraSourceError) && !fallbackOnError) throw err
      if (!fallbackOnError) throw err
      if (seq !== this.opSeq) return
      this.focus.announce('Camera unavailable — using recorded replay')
      await this.startReplay(this.opts.replayTrace, seq)
    }
  }

  private async startReplay(trace: TraceName, seq: number): Promise<void> {
    const frames = TRACES[trace]
    const replay = new ReplaySource(`Replay: ${trace}`, frames)
    await replay.start((frame) => this.onFrame(frame, seq))
    if (seq !== this.opSeq) {
      replay.stop()
      return
    }
    this.source = replay
    this.activeMode = 'replay'
    this.focus.announce(`Replay mode: ${trace}`)
    this.opts.onSourceChange(replay.label, 'replay')
    this.updateHud()
  }

  /** Switch source at runtime (used by the demo pages' source picker and
   * by tests exercising the replay path deterministically). Safe to call
   * while an earlier start() is still in flight (e.g. mid camera-permission
   * prompt) — the generation counter (`opSeq`) ensures the earlier call's
   * source gets discarded rather than running alongside the new one. */
  async setSource(mode: SourceMode, trace?: TraceName): Promise<void> {
    const seq = ++this.opSeq
    this.source?.stop()
    this.source = null
    this.recognizer.reset()
    if (trace) this.opts.replayTrace = trace
    if (mode === 'camera') {
      await this.startCamera(false, seq)
    } else {
      await this.startReplay(this.opts.replayTrace, seq)
    }
  }

  /** Passthrough for host pages that want to announce their own
   * page-specific state changes through the same aria-live region the
   * engine uses (e.g. "Step 3 of 6: ..."). */
  announce(message: string): void {
    this.focus.announce(message)
  }

  /** Passthrough for host pages implementing custom gesture handling (via
   * onGestureEvent returning true) that still want to move real DOM focus
   * through the engine's FocusController rather than reimplementing it. */
  focusElement(el: HTMLElement): void {
    this.focus.focusElement(el)
  }

  stop(): void {
    this.stopped = true
    this.opSeq++
    this.source?.stop()
    this.focus.destroy()
    this.hudEl?.remove()
  }

  private onFrame(frame: LandmarkFrame, seq: number): void {
    if (this.stopped || seq !== this.opSeq) return
    const events = this.recognizer.update(frame)
    for (const event of events) this.handleEvent(event)
    if (events.length > 0) this.updateHud(events[events.length - 1])
  }

  private handleEvent(event: GestureEvent): void {
    const skipDefault = this.opts.onGestureEvent(event) === true
    this.lastEventLabel = event.type
    if (skipDefault) return

    switch (event.type) {
      case 'hand-lost':
        this.focus.hideCursor()
        break
      case 'cursor-start':
        this.focus.showCursor()
        break
      case 'cursor-move':
        this.focus.moveCursorTo(event.x, event.y)
        break
      case 'cursor-end':
        this.focus.hideCursor()
        break
      case 'pinch':
        this.focus.activateFocused()
        break
      case 'fist-start':
        this.focus.announceScrollStart()
        break
      case 'fist-move':
        this.focus.scrollBy(event.dx, event.dy)
        break
      case 'fist-end':
        this.focus.announceScrollEnd()
        break
      case 'swipe':
        if (event.direction === 'right') this.focus.focusNext()
        else this.focus.focusPrevious()
        break
      case 'spread-start':
        this.focus.announce('Zoom gesture active')
        break
      case 'spread-change':
        this.focus.setZoomScale(event.scale)
        break
      case 'spread-end':
        // leave zoom where the user left it; don't snap back
        break
      case 'dwell-progress':
        this.focus.showDwellProgress(event.ratio)
        break
      case 'dwell-trigger':
        this.focus.triggerDwellClick()
        break
      case 'dwell-cancel':
        this.focus.hideDwellRing()
        break
    }
  }

  // --- HUD (visual debug overlay, optional) ------------------------------

  private buildHud(): HTMLElement {
    const el = document.createElement('div')
    el.id = 'handsfree-hud'
    Object.assign(el.style, {
      position: 'fixed',
      bottom: '12px',
      right: '12px',
      zIndex: '2147483647',
      font: '12px/1.4 ui-monospace, monospace',
      background: 'rgba(15,17,21,0.86)',
      color: '#e6f7fb',
      padding: '8px 10px',
      borderRadius: '8px',
      border: '1px solid rgba(34,211,238,0.4)',
      pointerEvents: 'none',
      whiteSpace: 'pre',
    })
    document.body.appendChild(el)
    return el
  }

  private updateHud(lastEvent?: GestureEvent): void {
    if (!this.hudEl) return
    const label = lastEvent ? summarizeEvent(lastEvent) : this.lastEventLabel || '—'
    this.hudEl.textContent =
      `handsfree · ${this.activeMode}\n` +
      `pose: ${this.recognizer.getDebugPose()}\n` +
      `event: ${label}`
  }
}

function summarizeEvent(event: GestureEvent): string {
  switch (event.type) {
    case 'swipe':
      return `swipe ${event.direction}`
    case 'spread-change':
      return `zoom ${event.scale.toFixed(2)}x`
    case 'dwell-progress':
      return `dwell ${Math.round(event.ratio * 100)}%`
    case 'cursor-move':
      return `cursor ${event.x.toFixed(2)},${event.y.toFixed(2)}`
    default:
      return event.type
  }
}
