import type { LandmarkFrame, LandmarkSource } from '../types'

/**
 * Plays back a bundled JSON trace of LandmarkFrame objects on a loop,
 * re-timed to the trace's own recorded intervals (using
 * requestAnimationFrame, not setInterval, so it stays in step with the
 * render loop). This runs through the exact same downstream pipeline
 * (filter -> geometry -> gesture state machine -> focus/a11y actions) as
 * the live camera source.
 *
 * ReplaySource is not a demo-only shim: it is also the mandatory graceful
 * degradation path when getUserMedia is denied, unavailable, or simply not
 * present (a judge with no webcam, or a machine with the camera in use by
 * another app) — see HandsFreeEngine, which falls back to it automatically.
 */
export class ReplaySource implements LandmarkSource {
  readonly label: string
  private frames: LandmarkFrame[]
  private rafHandle: number | null = null
  private startWallClock = 0
  private cursor = 0

  constructor(label: string, frames: LandmarkFrame[]) {
    this.label = label
    this.frames = frames
  }

  async start(onFrame: (frame: LandmarkFrame) => void): Promise<void> {
    if (this.frames.length === 0) return
    this.startWallClock = performance.now()
    this.cursor = 0
    const traceDuration = this.frames[this.frames.length - 1].t

    const tick = () => {
      const elapsed = (performance.now() - this.startWallClock) % (traceDuration + 1)
      if (elapsed < this.frames[this.cursor]?.t) {
        this.cursor = 0
      }
      while (
        this.cursor < this.frames.length - 1 &&
        this.frames[this.cursor + 1].t <= elapsed
      ) {
        this.cursor++
      }
      const frame = this.frames[this.cursor]
      // Re-timestamp to "now" so downstream velocity/One-Euro math sees a
      // continuous, monotonic clock regardless of trace looping.
      onFrame({ ...frame, t: performance.now() })
      this.rafHandle = requestAnimationFrame(tick)
    }
    this.rafHandle = requestAnimationFrame(tick)
  }

  stop(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle)
      this.rafHandle = null
    }
  }
}
