// Procedurally generates the bundled replay traces used by ReplaySource.
// Run with: node scripts/generate-traces.mjs
//
// Output: src/traces/*.json — committed to the repo, not regenerated at
// build time. Re-run by hand to change them.
//
// Each trace is a synthetic recording of a hand performing exactly one of
// the discrete gestures GestureRecognizer classifies, built from explicit
// per-finger curl geometry (not just "the hand is somewhere in image
// space") so replay exercises the real classifier logic — finger curl
// angles, pinch distance, palm velocity — not a rough approximation of it.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'src', 'traces')
const FPS = 30

// --- finger geometry building blocks -------------------------------------
// MCP knuckle positions are fixed (a hand doesn't move its knuckles
// relative to the wrist just by curling fingers). PIP/DIP/TIP positions
// differ between "open" (straight, pointing away from palm) and "fist"
// (folded back toward the palm) — interpolated by `openness` in [0,1].

const MCP = {
  thumb: { x: 0.44, y: 0.58, z: -0.02 }, // thumb CMC, treated as its root here
  index: { x: 0.46, y: 0.46, z: -0.01 },
  middle: { x: 0.50, y: 0.45, z: -0.01 },
  ring: { x: 0.54, y: 0.46, z: -0.01 },
  pinky: { x: 0.58, y: 0.48, z: -0.01 },
}

// [pip, dip, tip] when fully open (straight)
const OPEN_CHAIN = {
  index: [
    { x: 0.46, y: 0.34, z: -0.02 },
    { x: 0.46, y: 0.25, z: -0.03 },
    { x: 0.46, y: 0.17, z: -0.04 },
  ],
  middle: [
    { x: 0.5, y: 0.31, z: -0.02 },
    { x: 0.5, y: 0.2, z: -0.03 },
    { x: 0.5, y: 0.11, z: -0.04 },
  ],
  ring: [
    { x: 0.55, y: 0.33, z: -0.02 },
    { x: 0.55, y: 0.23, z: -0.03 },
    { x: 0.55, y: 0.15, z: -0.04 },
  ],
  pinky: [
    { x: 0.59, y: 0.38, z: -0.02 },
    { x: 0.6, y: 0.3, z: -0.03 },
    { x: 0.61, y: 0.23, z: -0.04 },
  ],
}

// [pip, dip, tip] when fully curled (fist) — PIP stays near a half-bent
// position, DIP/TIP fold back down close to the MCP so the PIP->TIP vector
// points roughly opposite the MCP->PIP vector (curl angle near PI).
const FIST_CHAIN = {
  index: [
    { x: 0.46, y: 0.4, z: -0.015 },
    { x: 0.445, y: 0.455, z: -0.005 },
    { x: 0.435, y: 0.5, z: 0.0 },
  ],
  middle: [
    { x: 0.5, y: 0.39, z: -0.015 },
    { x: 0.485, y: 0.445, z: -0.005 },
    { x: 0.475, y: 0.49, z: 0.0 },
  ],
  ring: [
    { x: 0.55, y: 0.4, z: -0.015 },
    { x: 0.535, y: 0.455, z: -0.005 },
    { x: 0.525, y: 0.5, z: 0.0 },
  ],
  pinky: [
    { x: 0.59, y: 0.43, z: -0.015 },
    { x: 0.575, y: 0.48, z: -0.005 },
    { x: 0.565, y: 0.52, z: 0.0 },
  ],
}

const THUMB_OPEN = [
  { x: 0.4, y: 0.5, z: -0.03 }, // mcp
  { x: 0.37, y: 0.43, z: -0.04 }, // ip
  { x: 0.35, y: 0.37, z: -0.05 }, // tip
]

function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }
}

/**
 * Builds all 21 landmarks. `openness` in [0,1] interpolates every
 * non-thumb finger between fist (0) and open (1). `thumbTip` lets the
 * pinch trace move the thumb tip independently to approach the index tip.
 */
function buildHand({ openness = 1, thumbTip = THUMB_OPEN[2], dx = 0, dy = 0 } = {}) {
  const wrist = { x: 0.5, y: 0.62, z: 0.0 }
  const landmarks = new Array(21)
  landmarks[0] = wrist
  landmarks[1] = MCP.thumb
  landmarks[2] = THUMB_OPEN[0]
  landmarks[3] = THUMB_OPEN[1]
  landmarks[4] = thumbTip

  const order = ['index', 'middle', 'ring', 'pinky']
  const mcpIdx = { index: 5, middle: 9, ring: 13, pinky: 17 }
  for (const finger of order) {
    const base = mcpIdx[finger]
    landmarks[base] = MCP[finger]
    for (let j = 0; j < 3; j++) {
      landmarks[base + 1 + j] = lerp(FIST_CHAIN[finger][j], OPEN_CHAIN[finger][j], openness)
    }
  }

  return landmarks.map((p) => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy), z: p.z }))
}

function clamp01(v) {
  return Math.max(0.02, Math.min(0.98, v))
}

function frame(t, hands) {
  return { t, hands }
}

// --- trace 1: open-palm-move ---------------------------------------------
// Hand stays fully open throughout (drives cursor mode). Drifts gently for
// the first ~3.5s (exercising cursor-move + focus-following), then holds
// almost perfectly still for >1s in the middle to trigger the dwell-to-click
// fallback, then resumes drifting.
function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2
}

// Waypoint-based path: each segment eases between two explicit (dx, dy)
// targets, so position is continuous across the whole trace by
// construction — no formula-switch discontinuities at segment boundaries
// (an earlier version of this trace had exactly that bug: a position jump
// at the hold-phase boundary produced a one-frame velocity spike big
// enough to spuriously arm the swipe detector). The explicit HOLD segment
// (3.2s-4.6s, same target twice) is the trace's one deliberate, long
// stillness — long enough to clear dwellMs with margin and exercise the
// dwell-to-click fallback; the eased approach/departure around it will
// also pass through brief low-velocity moments, which is realistic (a
// real hand decelerates before stopping) and fine since dwell's own
// 900ms-of-continuous-stillness requirement already prevents those from
// being mistaken for the intentional hold.
const OPEN_PALM_WAYPOINTS = [
  { t: 0.0, dx: 0, dy: 0 },
  { t: 1.5, dx: 0.14, dy: 0.05 },
  { t: 2.5, dx: -0.06, dy: -0.04 },
  { t: 3.2, dx: 0.05, dy: -0.03 }, // arrive at hold position
  { t: 4.6, dx: 0.05, dy: -0.03 }, // HOLD — zero velocity for 1.4s
  { t: 5.8, dx: -0.12, dy: 0.04 },
  { t: 6.9, dx: 0.08, dy: -0.02 },
  { t: 8.0, dx: 0, dy: 0 }, // back to start so the loop is seamless
]

function waypointAt(tSec, waypoints) {
  let seg = waypoints[0]
  let next = waypoints[waypoints.length - 1]
  for (let i = 0; i < waypoints.length - 1; i++) {
    if (tSec >= waypoints[i].t && tSec <= waypoints[i + 1].t) {
      seg = waypoints[i]
      next = waypoints[i + 1]
      break
    }
  }
  const span = Math.max(next.t - seg.t, 1e-6)
  const local = easeInOutSine(Math.min(Math.max((tSec - seg.t) / span, 0), 1))
  return { dx: seg.dx + (next.dx - seg.dx) * local, dy: seg.dy + (next.dy - seg.dy) * local }
}

function genOpenPalmMove() {
  const durationSec = 8
  const n = durationSec * FPS
  const frames = []
  for (let i = 0; i < n; i++) {
    const t = (i / FPS) * 1000
    const tSec = i / FPS
    const { dx, dy } = waypointAt(tSec, OPEN_PALM_WAYPOINTS)
    const hand = buildHand({ openness: 1, dx, dy })
    frames.push(frame(t, [{ handedness: 'Right', landmarks: hand }]))
  }
  return frames
}

// --- trace 2: pinch-click --------------------------------------------------
// Two clean, fully-separated pinch-and-release cycles, spaced well beyond
// the pinch cooldown, so the trace demonstrates the debounced discrete
// 'pinch' event firing exactly once per physical pinch — including a long
// HOLD phase per pinch, proving a held pinch does not emit a stream.
function genPinchClick() {
  const segments = [
    { openMs: 700 },
    { closeMs: 220 },
    { holdMs: 1400 }, // held pinch — must yield exactly one 'pinch' event
    { openMs2: 400 },
    { restMs: 900 }, // > pinchCooldownMs before the next pinch is attempted
    { closeMs2: 220 },
    { holdMs2: 700 },
    { openMs3: 500 },
  ]
  void segments
  const frames = []
  let t = 0
  const push = (ms, thumbFn, steps = Math.max(2, Math.round((ms / 1000) * FPS))) => {
    for (let s = 0; s < steps; s++) {
      const localT = t + (s / steps) * ms
      const p = s / (steps - 1 || 1)
      const hand = buildHand({ openness: 1, thumbTip: thumbFn(p) })
      frames.push(frame(localT, [{ handedness: 'Right', landmarks: hand }]))
    }
    t += ms
  }
  const openTip = THUMB_OPEN[2]
  const pinchedTip = { x: 0.455, y: 0.175, z: -0.035 } // touching the actual index fingertip position

  push(600, () => openTip)
  push(220, (p) => lerp(openTip, pinchedTip, p))
  push(1400, () => pinchedTip)
  push(300, (p) => lerp(pinchedTip, openTip, p))
  push(900, () => openTip)
  push(220, (p) => lerp(openTip, pinchedTip, p))
  push(700, () => pinchedTip)
  push(400, (p) => lerp(pinchedTip, openTip, p))
  push(400, () => openTip)
  return frames
}

// --- trace 3: fist-scroll ---------------------------------------------------
// Hand closes into a fist (curl onset), holds the fist while dragging
// downward (scroll down), then drags back upward, then opens.
function genFistScroll() {
  const frames = []
  let t = 0
  const push = (ms, opennessFn, dyFn, steps = Math.max(2, Math.round((ms / 1000) * FPS))) => {
    for (let s = 0; s < steps; s++) {
      const localT = t + (s / steps) * ms
      const p = s / (steps - 1 || 1)
      const hand = buildHand({ openness: opennessFn(p), dy: dyFn(p) })
      frames.push(frame(localT, [{ handedness: 'Right', landmarks: hand }]))
    }
    t += ms
  }
  push(500, () => 1, () => 0) // open, at rest
  push(250, (p) => 1 - p, () => 0) // close into fist
  push(1800, () => 0, (p) => p * 0.35) // fist held, drag down (scroll down)
  push(1800, () => 0, (p) => 0.35 - p * 0.35) // drag back up
  push(300, (p) => p, () => 0) // open the fist
  push(500, () => 1, () => 0)
  return frames
}

// --- traces 4/5: swipe-left / swipe-right -----------------------------------
// Hand at rest, then two fast horizontal whips separated by well over the
// swipe cooldown, each returning to near-zero velocity between whips (the
// rearm condition) — proves two discrete swipes fire, not a continuous drag.
function genSwipe(direction) {
  const sign = direction === 'right' ? 1 : -1
  const frames = []
  let t = 0
  const push = (ms, dxFn, steps) => {
    const n = steps ?? Math.max(2, Math.round((ms / 1000) * FPS))
    for (let s = 0; s < n; s++) {
      const localT = t + (s / n) * ms
      const p = s / (n - 1 || 1)
      const hand = buildHand({ openness: 1, dx: dxFn(p) })
      frames.push(frame(localT, [{ handedness: 'Right', landmarks: hand }]))
    }
    t += ms
  }
  // A "whip" is a fast displacement over a short time — high sample rate
  // needed so instantaneous velocity actually exceeds the threshold.
  const whip = (from, to, ms) => push(ms, (p) => from + (to - from) * easeInOutQuad(p), Math.round((ms / 1000) * 90))

  // Two clean, same-direction whips (0 -> sign*0.34) separated by a slow
  // return to rest — the return is deliberately slow (well under the
  // swipe velocity threshold) so it doesn't itself register as a swipe in
  // the opposite direction, and the >650ms cooldown gap between whips
  // proves two discrete swipe events fire, not a continuous drag.
  push(500, () => 0) // rest
  whip(0, sign * 0.34, 130) // fast whip #1
  push(700, (p) => sign * 0.34 * (1 - easeInOutQuad(p))) // slow return to rest (not a swipe)
  push(500, () => 0) // hold at rest
  whip(0, sign * 0.34, 130) // fast whip #2, identical to #1
  push(700, (p) => sign * 0.34 * (1 - easeInOutQuad(p))) // slow return to rest
  push(400, () => 0)
  return frames
}

function easeInOutQuad(x) {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
}

// --- trace 6: two-hand-spread ------------------------------------------------
// Two open hands start close together and spread apart (zoom in), hold,
// then come back together (zoom out).
function genTwoHandSpread() {
  const frames = []
  let t = 0
  const centerL = { x: 0.42, y: 0.5 }
  const centerR = { x: 0.58, y: 0.5 }
  const push = (ms, sepFn, steps = Math.max(2, Math.round((ms / 1000) * FPS))) => {
    for (let s = 0; s < steps; s++) {
      const localT = t + (s / steps) * ms
      const p = s / (steps - 1 || 1)
      const sep = sepFn(p)
      const left = buildHand({ openness: 1, dx: -sep / 2, dy: 0 })
      const right = buildHand({ openness: 1, dx: sep / 2, dy: 0 })
      frames.push(
        frame(localT, [
          { handedness: 'Left', landmarks: left },
          { handedness: 'Right', landmarks: right },
        ]),
      )
    }
    t += ms
  }
  void centerL
  void centerR
  push(500, () => 0) // hands together-ish
  push(2200, (p) => p * 0.34) // spread apart -> zoom in
  push(800, () => 0.34) // hold
  push(2200, (p) => 0.34 - p * 0.3) // bring back together -> zoom out
  push(500, () => 0.04)
  return frames
}

const traces = {
  'open-palm-move': genOpenPalmMove(),
  'pinch-click': genPinchClick(),
  'fist-scroll': genFistScroll(),
  'swipe-right': genSwipe('right'),
  'swipe-left': genSwipe('left'),
  'two-hand-spread': genTwoHandSpread(),
}

for (const [name, frames] of Object.entries(traces)) {
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(frames))
  console.log(`Wrote ${frames.length} frames to src/traces/${name}.json`)
}
