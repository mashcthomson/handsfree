import { HandsFreeEngine, type HandsFreeEngineOptions, type SourceMode } from './HandsFreeEngine'
import type { GestureEvent } from '../gestures/types'
import type { TraceName } from '../traces'

export type { GestureEvent, HandsFreeEngineOptions, SourceMode, TraceName }
export { HandsFreeEngine }

/**
 * The entire public integration surface, deliberately tiny:
 *
 *   HandsFree.init({ ...options }) -> Promise<controller>
 *
 * Drop `<script src="handsfree.iife.js"></script>` on any page and call
 * `HandsFree.init()` with no arguments for sane zero-config behavior:
 * camera with automatic replay fallback, swipe = next/previous focusable
 * element, pinch = activate, fist-drag = scroll, two-hand spread = zoom,
 * open palm = pointing cursor with dwell-to-click. See README "Integration"
 * for the full option list and the returned controller's `stop()` /
 * `setSource()` / `on()` methods.
 */
export interface HandsFreeController {
  /** Stops the active landmark source and tears down all injected DOM (cursor, focus ring, aria-live region, styles). */
  stop: () => void
  /** Switch source at runtime — e.g. a "no camera? try replay" button, or a demo's trace picker. */
  setSource: (mode: SourceMode, trace?: TraceName) => Promise<void>
}

export async function init(options: Partial<HandsFreeEngineOptions> = {}): Promise<HandsFreeController> {
  const engine = new HandsFreeEngine(options)
  await engine.start()
  return {
    stop: () => engine.stop(),
    setSource: (mode: SourceMode, trace?: TraceName) => engine.setSource(mode, trace),
  }
}
