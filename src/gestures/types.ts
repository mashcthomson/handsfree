/** Discrete pose a single hand is currently classified as. UNKNOWN covers
 * transitional frames (e.g. mid-close between OPEN and FIST) so downstream
 * logic never has to guess — it just doesn't act on UNKNOWN. */
export type HandPose = 'OPEN_PALM' | 'FIST' | 'PINCH' | 'POINT' | 'UNKNOWN'

/**
 * Discrete gesture events emitted by GestureRecognizer. These are the only
 * things the rest of the app (FocusController, demo pages) ever reacts to
 * — never raw landmarks, never a continuous stream re-firing the same
 * action every frame. Each *_START/END pair brackets a continuous action
 * (cursor move while OPEN_PALM is held, scroll while FIST is held, zoom
 * while two hands are spread); everything else is a single edge-triggered
 * event per physical gesture, produced by the hysteresis + cooldown logic
 * in GestureRecognizer.
 */
export type GestureEvent =
  | { type: 'hand-lost' }
  | { type: 'cursor-start' }
  | { type: 'cursor-move'; x: number; y: number }
  | { type: 'cursor-end' }
  | { type: 'pinch' } // fires exactly once per physical pinch, however long it's held
  | { type: 'fist-start' }
  | { type: 'fist-move'; dx: number; dy: number } // normalized [-1,1]-ish deltas, for scroll
  | { type: 'fist-end' }
  | { type: 'swipe'; direction: 'left' | 'right' }
  | { type: 'spread-start' }
  | { type: 'spread-change'; scale: number } // 1.0 = spread distance at gesture start
  | { type: 'spread-end' }
  | { type: 'dwell-progress'; ratio: number } // 0..1, for a visible countdown ring
  | { type: 'dwell-trigger' }
  | { type: 'dwell-cancel' }

export interface GestureRecognizerOptions {
  /** Curl (radians) below which a finger counts as "extended". Lower = stricter. */
  openCurlThreshold: number
  /** Curl (radians) above which a finger counts as "curled". Higher = stricter. */
  fistCurlThreshold: number
  /** Normalized pinch distance below which the pinch gesture engages. */
  pinchEnterThreshold: number
  /** Normalized pinch distance above which the pinch gesture releases (must be > enter, creates hysteresis). */
  pinchExitThreshold: number
  /** Minimum ms between two accepted pinch events, even after release. */
  pinchCooldownMs: number
  /** Minimum ms a hand must hold FIST pose before fist-start fires (avoids catching a transient mid-swipe fist). */
  fistOnsetMs: number
  /** Minimum palm horizontal velocity (normalized units/sec) to arm a swipe. */
  swipeVelocityThreshold: number
  /** Velocity must fall back below this before a new swipe can be armed (hysteresis). */
  swipeRearmVelocity: number
  /** How much bigger |vx| must be than |vy| to count as horizontal, not diagonal drift. */
  swipeHorizontalDominance: number
  /** Minimum ms between two swipe events. */
  swipeCooldownMs: number
  /** ms of near-stillness while OPEN_PALM cursor is active before dwell-trigger fires. */
  dwellMs: number
  /** Cursor speed (normalized units/sec) below which the hand counts as "still" for dwell purposes. */
  dwellStillnessVelocity: number
  /** Minimum ms a hand must hold OPEN_PALM before cursor-start fires. */
  openPalmOnsetMs: number
}

export const DEFAULT_GESTURE_OPTIONS: GestureRecognizerOptions = {
  openCurlThreshold: 0.55,
  fistCurlThreshold: 1.35,
  pinchEnterThreshold: 0.35,
  pinchExitThreshold: 0.55,
  pinchCooldownMs: 350,
  fistOnsetMs: 120,
  swipeVelocityThreshold: 2.3,
  swipeRearmVelocity: 0.5,
  swipeHorizontalDominance: 1.8,
  swipeCooldownMs: 650,
  dwellMs: 900,
  dwellStillnessVelocity: 0.35,
  openPalmOnsetMs: 100,
}
