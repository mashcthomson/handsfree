/**
 * One Euro Filter (Casiez, Roussel, Vogel, CHI 2012 — "1€ Filter: A Simple
 * Speed-based Low-pass Filter for Noisy Input in Interactive Systems").
 * Reference: https://gery.casiez.net/1euro/
 *
 * Raw MediaPipe landmarks jitter frame to frame even when a hand is
 * perfectly still. For a gesture-driven cursor that jitter is not cosmetic
 * noise — it is the difference between a focus ring that sits calmly on a
 * button and one that vibrates across three elements a second. A fixed
 * low-pass filter kills the jitter but adds lag proportional to how hard
 * you smooth it, which makes a real swipe feel late and mushy.
 *
 * The One Euro filter's cutoff frequency is not fixed — it rises with the
 * estimated speed of the signal. Hand still -> low cutoff -> heavy
 * smoothing. Hand moving fast -> high cutoff -> light smoothing, low lag.
 * Two tunable parameters: minCutoff (smoothing at rest) and beta (how fast
 * cutoff rises with speed).
 *
 * This implementation is shared in spirit with the sibling "instrument"
 * project built the same night by the same author — same filter, same
 * maths, reused deliberately per the brief (see README THIRD-PARTY /
 * PROVENANCE section). The two products use it for entirely different
 * ends: instrument maps filtered position to pitch/timbre, handsfree maps
 * it to cursor position and gesture-onset detection feeding a discrete
 * state machine.
 */
export class OneEuroFilter {
  private minCutoff: number
  private beta: number
  private dCutoff: number

  private xPrev: number | null = null
  private dxPrev = 0
  private tPrev: number | null = null

  constructor(minCutoff = 1.0, beta = 0.02, dCutoff = 1.0) {
    this.minCutoff = minCutoff
    this.beta = beta
    this.dCutoff = dCutoff
  }

  private alpha(cutoffHz: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoffHz)
    return 1 / (1 + tau / dt)
  }

  /**
   * Filter one new sample. `tMillis` must be monotonically increasing
   * (wall-clock or trace-clock milliseconds).
   */
  filter(x: number, tMillis: number): number {
    if (this.tPrev === null || this.xPrev === null) {
      this.tPrev = tMillis
      this.xPrev = x
      this.dxPrev = 0
      return x
    }

    const dt = Math.max((tMillis - this.tPrev) / 1000, 1 / 240) // seconds, floor to avoid div-by-~0
    this.tPrev = tMillis

    const dx = (x - this.xPrev) / dt
    const aD = this.alpha(this.dCutoff, dt)
    const dxHat = aD * dx + (1 - aD) * this.dxPrev
    this.dxPrev = dxHat

    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat)

    const a = this.alpha(cutoff, dt)
    const xHat = a * x + (1 - a) * this.xPrev
    this.xPrev = xHat

    return xHat
  }

  reset(): void {
    this.xPrev = null
    this.dxPrev = 0
    this.tPrev = null
  }
}

/** Convenience wrapper: filters an {x,y,z} point with one OneEuroFilter per axis. */
export class OneEuroFilter3D {
  private fx: OneEuroFilter
  private fy: OneEuroFilter
  private fz: OneEuroFilter

  constructor(minCutoff = 1.0, beta = 0.02, dCutoff = 1.0) {
    this.fx = new OneEuroFilter(minCutoff, beta, dCutoff)
    this.fy = new OneEuroFilter(minCutoff, beta, dCutoff)
    this.fz = new OneEuroFilter(minCutoff, beta, dCutoff)
  }

  filter(p: { x: number; y: number; z: number }, tMillis: number) {
    return {
      x: this.fx.filter(p.x, tMillis),
      y: this.fy.filter(p.y, tMillis),
      z: this.fz.filter(p.z, tMillis),
    }
  }

  reset(): void {
    this.fx.reset()
    this.fy.reset()
    this.fz.reset()
  }
}
