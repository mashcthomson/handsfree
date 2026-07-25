import type { LandmarkFrame } from '../types'
import openPalmMove from './open-palm-move.json'
import pinchClick from './pinch-click.json'
import fistScroll from './fist-scroll.json'
import swipeLeft from './swipe-left.json'
import swipeRight from './swipe-right.json'
import twoHandSpread from './two-hand-spread.json'

/**
 * Bundled, procedurally-generated replay traces (see
 * scripts/generate-traces.mjs) — one per discrete gesture the recognizer
 * classifies. These exist for three reasons, all mandatory per the brief:
 * (1) a demo video can be captured with no human hand available, (2)
 * camera-denied / no-webcam degrades gracefully instead of a broken
 * screen, (3) headless verification (Playwright + SwiftShader) can drive
 * the exact same pipeline deterministically.
 */
export const TRACES = {
  'open-palm-move': openPalmMove as LandmarkFrame[],
  'pinch-click': pinchClick as LandmarkFrame[],
  'fist-scroll': fistScroll as LandmarkFrame[],
  'swipe-left': swipeLeft as LandmarkFrame[],
  'swipe-right': swipeRight as LandmarkFrame[],
  'two-hand-spread': twoHandSpread as LandmarkFrame[],
} as const

export type TraceName = keyof typeof TRACES
