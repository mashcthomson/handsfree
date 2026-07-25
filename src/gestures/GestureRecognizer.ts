import type { HandObservation, LandmarkFrame, Point3D } from '../types'
import { OneEuroFilter, OneEuroFilter3D } from '../filters/OneEuroFilter'
import {
  allFingerCurls,
  meanFingerCurl,
  palmCentroid,
  pinchDistance,
  twoHandSpread,
} from '../geometry/HandGeometry'
import {
  DEFAULT_GESTURE_OPTIONS,
  type GestureEvent,
  type GestureRecognizerOptions,
  type HandPose,
} from './types'

type PinchState = 'idle' | 'pinched'
type FistState = 'idle' | 'active'
type CursorState = 'idle' | 'active'
type SwipeArmState = 'armed' | 'cooldown'
type SpreadState = 'idle' | 'active'

/**
 * Discrete gesture classification with hysteresis, onset debouncing, and
 * cooldowns — the part of this project that turns "here are some noisy
 * landmark coordinates" into "the user just clicked, once." Consumes raw
 * LandmarkFrame objects (from either CameraSource or ReplaySource — it
 * cannot tell the difference and doesn't try to) and emits a small array of
 * GestureEvent per frame, almost always empty.
 *
 * Design notes on the "hard parts" this handles explicitly:
 *
 * - Onset debouncing: FIST and OPEN_PALM only "start" after the qualifying
 *   pose has held for `*OnsetMs`, so a hand passing briefly through a fist
 *   shape on its way to a pinch doesn't fire a spurious grab-scroll.
 * - Hysteresis: every enter/exit pair (pinch enter/exit, fist enter/exit,
 *   swipe arm/rearm) uses two different thresholds, not one, so a value
 *   sitting right at the boundary can't chatter back and forth every frame.
 * - Cooldowns: pinch and swipe both additionally enforce a minimum time
 *   since the last accepted event, independent of the hysteresis gap, so a
 *   held pinch can only ever produce ONE 'pinch' event no matter how long
 *   it's held, and a fast release-and-repinch can't be misread as a
 *   double-click.
 */
export class GestureRecognizer {
  private opts: GestureRecognizerOptions

  private palmFilter = new OneEuroFilter3D(1.4, 0.5, 1.0)
  private spreadFilter = new OneEuroFilter(1.2, 0.3, 1.0)

  private prevPalm: Point3D | null = null
  private prevT: number | null = null
  private vx = 0
  private vy = 0

  private handPresent = false

  private pinchState: PinchState = 'idle'
  private lastPinchEventT = -Infinity

  private fistState: FistState = 'idle'
  private fistCandidateStartT: number | null = null
  private lastFistCentroid: Point3D | null = null

  private cursorState: CursorState = 'idle'
  private cursorCandidateStartT: number | null = null

  private swipeArm: SwipeArmState = 'armed'
  private lastSwipeT = -Infinity

  private dwellStillStartT: number | null = null
  private dwellTriggered = false
  private lastDwellRatio = 0

  private spreadState: SpreadState = 'idle'
  private spreadBaseline = 0
  private lastEmittedSpreadScale = 1

  private debugPose: HandPose = 'UNKNOWN'

  constructor(options: Partial<GestureRecognizerOptions> = {}) {
    this.opts = { ...DEFAULT_GESTURE_OPTIONS, ...options }
  }

  /** Debug/HUD only — not used by any control-flow decision. */
  getDebugPose(): HandPose {
    return this.debugPose
  }

  reset(): void {
    this.palmFilter.reset()
    this.spreadFilter.reset()
    this.prevPalm = null
    this.prevT = null
    this.vx = 0
    this.vy = 0
    this.handPresent = false
    this.pinchState = 'idle'
    this.fistState = 'idle'
    this.fistCandidateStartT = null
    this.lastFistCentroid = null
    this.cursorState = 'idle'
    this.cursorCandidateStartT = null
    this.swipeArm = 'armed'
    this.dwellStillStartT = null
    this.dwellTriggered = false
    this.spreadState = 'idle'
  }

  update(frame: LandmarkFrame): GestureEvent[] {
    const events: GestureEvent[] = []
    const opts = this.opts
    const t = frame.t

    if (frame.hands.length === 0) {
      if (this.handPresent) {
        this.endAllEngagedGestures(events)
        events.push({ type: 'hand-lost' })
      }
      this.handPresent = false
      this.spreadHandling([], t, events)
      this.debugPose = 'UNKNOWN'
      return events
    }

    this.handPresent = true
    const primary = frame.hands[0]

    // --- velocity of the filtered palm centroid ---
    const rawCentroid = palmCentroid(primary.landmarks)
    const centroid = this.palmFilter.filter(rawCentroid, t)
    if (this.prevPalm && this.prevT !== null) {
      const dt = Math.max((t - this.prevT) / 1000, 1 / 240)
      const instVx = (centroid.x - this.prevPalm.x) / dt
      const instVy = (centroid.y - this.prevPalm.y) / dt
      // Light exponential smoothing on top of the already-filtered
      // centroid so velocity doesn't spike on single-frame outliers, while
      // staying responsive enough to catch a real swipe within ~100ms.
      this.vx = this.vx * 0.55 + instVx * 0.45
      this.vy = this.vy * 0.55 + instVy * 0.45
    }
    this.prevPalm = centroid
    this.prevT = t

    // --- pose geometry ---
    const curls = allFingerCurls(primary.landmarks)
    const meanCurl = meanFingerCurl(curls)
    const pinchDist = pinchDistance(primary.landmarks)

    this.debugPose = classifyPose(meanCurl, pinchDist, opts)

    this.updatePinch(pinchDist, t, events)
    this.updateFist(meanCurl, centroid, t, events)
    this.updateCursor(meanCurl, pinchDist, centroid, t, events)
    this.updateSwipe(t, events)
    this.spreadHandling(frame.hands, t, events)

    return events
  }

  private updatePinch(pinchDist: number, t: number, events: GestureEvent[]): void {
    const opts = this.opts
    if (this.pinchState === 'idle') {
      if (pinchDist < opts.pinchEnterThreshold && t - this.lastPinchEventT > opts.pinchCooldownMs) {
        this.pinchState = 'pinched'
        this.lastPinchEventT = t
        events.push({ type: 'pinch' })
      }
    } else if (pinchDist > opts.pinchExitThreshold) {
      this.pinchState = 'idle'
    }
  }

  private updateFist(meanCurl: number, centroid: Point3D, t: number, events: GestureEvent[]): void {
    const opts = this.opts
    const fistReleaseThreshold = opts.fistCurlThreshold - 0.35

    if (this.fistState === 'idle') {
      if (meanCurl > opts.fistCurlThreshold) {
        if (this.fistCandidateStartT === null) this.fistCandidateStartT = t
        if (t - this.fistCandidateStartT >= opts.fistOnsetMs) {
          this.fistState = 'active'
          this.fistCandidateStartT = null
          this.lastFistCentroid = centroid
          events.push({ type: 'fist-start' })
        }
      } else {
        this.fistCandidateStartT = null
      }
    } else {
      if (meanCurl < fistReleaseThreshold) {
        this.fistState = 'idle'
        this.lastFistCentroid = null
        events.push({ type: 'fist-end' })
      } else if (this.lastFistCentroid) {
        const dx = centroid.x - this.lastFistCentroid.x
        const dy = centroid.y - this.lastFistCentroid.y
        this.lastFistCentroid = centroid
        if (Math.abs(dx) > 0.0005 || Math.abs(dy) > 0.0005) {
          events.push({ type: 'fist-move', dx, dy })
        }
      }
    }
  }

  private updateCursor(
    meanCurl: number,
    pinchDist: number,
    centroid: Point3D,
    t: number,
    events: GestureEvent[],
  ): void {
    const opts = this.opts
    const openCriteria = meanCurl < opts.openCurlThreshold && pinchDist > opts.pinchExitThreshold

    if (this.cursorState === 'idle') {
      if (openCriteria) {
        if (this.cursorCandidateStartT === null) this.cursorCandidateStartT = t
        if (t - this.cursorCandidateStartT >= opts.openPalmOnsetMs) {
          this.cursorState = 'active'
          this.cursorCandidateStartT = null
          this.dwellStillStartT = null
          this.dwellTriggered = false
          events.push({ type: 'cursor-start' })
          events.push({ type: 'cursor-move', x: centroid.x, y: centroid.y })
        }
      } else {
        this.cursorCandidateStartT = null
      }
      return
    }

    // active
    if (!openCriteria) {
      this.cursorState = 'idle'
      if (this.dwellStillStartT !== null && !this.dwellTriggered) {
        events.push({ type: 'dwell-cancel' })
      }
      this.dwellStillStartT = null
      this.dwellTriggered = false
      events.push({ type: 'cursor-end' })
      return
    }

    events.push({ type: 'cursor-move', x: centroid.x, y: centroid.y })

    const speed = Math.hypot(this.vx, this.vy)
    if (speed < opts.dwellStillnessVelocity) {
      if (this.dwellStillStartT === null) this.dwellStillStartT = t
      const ratio = Math.min(1, (t - this.dwellStillStartT) / opts.dwellMs)
      this.lastDwellRatio = ratio
      if (!this.dwellTriggered) {
        events.push({ type: 'dwell-progress', ratio })
        if (ratio >= 1) {
          this.dwellTriggered = true
          events.push({ type: 'dwell-trigger' })
        }
      }
    } else if (this.dwellStillStartT !== null) {
      if (!this.dwellTriggered && this.lastDwellRatio > 0.03) {
        events.push({ type: 'dwell-cancel' })
      }
      this.dwellStillStartT = null
      this.dwellTriggered = false
      this.lastDwellRatio = 0
    }
  }

  private updateSwipe(t: number, events: GestureEvent[]): void {
    const opts = this.opts
    // A held fist is already claiming horizontal motion for scroll; don't
    // also read it as a swipe.
    if (this.fistState === 'active') return

    if (this.swipeArm === 'armed') {
      const horizontalEnough = Math.abs(this.vx) > opts.swipeHorizontalDominance * Math.abs(this.vy)
      if (
        Math.abs(this.vx) > opts.swipeVelocityThreshold &&
        horizontalEnough &&
        t - this.lastSwipeT > opts.swipeCooldownMs
      ) {
        this.lastSwipeT = t
        this.swipeArm = 'cooldown'
        events.push({ type: 'swipe', direction: this.vx > 0 ? 'right' : 'left' })
      }
    } else if (Math.abs(this.vx) < opts.swipeRearmVelocity) {
      this.swipeArm = 'armed'
    }
  }

  private spreadHandling(hands: HandObservation[], t: number, events: GestureEvent[]): void {
    if (hands.length >= 2) {
      const raw = twoHandSpread(hands[0], hands[1])
      const filtered = this.spreadFilter.filter(raw, t)
      if (this.spreadState === 'idle') {
        this.spreadState = 'active'
        this.spreadBaseline = Math.max(filtered, 1e-3)
        this.lastEmittedSpreadScale = 1
        events.push({ type: 'spread-start' })
      } else {
        const scale = filtered / this.spreadBaseline
        if (Math.abs(scale - this.lastEmittedSpreadScale) > 0.015) {
          this.lastEmittedSpreadScale = scale
          events.push({ type: 'spread-change', scale })
        }
      }
    } else if (this.spreadState === 'active') {
      this.spreadState = 'idle'
      events.push({ type: 'spread-end' })
    }
  }

  private endAllEngagedGestures(events: GestureEvent[]): void {
    if (this.cursorState === 'active') {
      events.push({ type: 'cursor-end' })
      this.cursorState = 'idle'
    }
    if (this.fistState === 'active') {
      events.push({ type: 'fist-end' })
      this.fistState = 'idle'
      this.lastFistCentroid = null
    }
    if (this.dwellStillStartT !== null && !this.dwellTriggered) {
      events.push({ type: 'dwell-cancel' })
    }
    this.dwellStillStartT = null
    this.dwellTriggered = false
    this.pinchState = 'idle'
    this.swipeArm = 'armed'
    this.vx = 0
    this.vy = 0
    this.prevPalm = null
    this.prevT = null
  }
}

function classifyPose(meanCurl: number, pinchDist: number, opts: GestureRecognizerOptions): HandPose {
  if (pinchDist < opts.pinchEnterThreshold) return 'PINCH'
  if (meanCurl > opts.fistCurlThreshold) return 'FIST'
  if (meanCurl < opts.openCurlThreshold) return 'OPEN_PALM'
  return 'UNKNOWN'
}
