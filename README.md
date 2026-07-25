# Handsfree

A hands-free navigation and control engine for ordinary web pages. Client-side hand tracking (MediaPipe Tasks Vision, WASM, vendored — nothing loaded from a CDN) drives a discrete gesture classifier, which drives real DOM focus, tab order, and semantics — not a synthetic mouse cursor. One `<script>` tag adds it to any site.

Built for **Code Carnage** and **QuantumHacks** (overnight build, 26 Jul 2026).

Who it's for: people who find a mouse or trackpad difficult (motor accessibility), and people whose hands are occupied, wet, gloved, or dirty mid-task — cooking, workshop, clinical, lab — where touching a keyboard isn't practical.

## What it actually does

- Tracks hands via [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) (`HandLandmarker`), running entirely as WASM in the browser — vendored into this repo, not loaded from a CDN, no API key, nothing ever leaves the tab.
- Smooths raw landmark noise with a hand-rolled **One Euro filter** (`src/filters/OneEuroFilter.ts`) — adaptive low-pass, heavy smoothing at rest, low lag on fast motion.
- Turns landmarks into **real per-finger geometry** (`src/geometry/HandGeometry.ts`): orientation-invariant finger-curl angles (angle between the MCP→PIP and PIP→TIP vectors — robust to hand rotation, unlike a naive "is the tip above the knuckle" image-y test), normalized pinch distance, palm centroid/scale, two-hand spread.
- Classifies that geometry into **discrete gestures** with a real state machine (`src/gestures/GestureRecognizer.ts`): open-palm (cursor), pinch (click), fist+drag (scroll), swipe left/right (focus previous/next), two-hand spread (zoom). Every discrete action uses **hysteresis** (separate enter/exit thresholds), **onset debouncing** (a pose must hold for N ms before it "starts"), and **cooldowns** (a minimum time since the last accepted event) — so a held pinch fires exactly one click, not a stream, and a hand passing briefly through a fist shape on its way to a pinch doesn't trigger a spurious grab-scroll. See the file for the reasoning in full; it's the part of this project the hackathon's technical-implementation score is actually about.
- Drives **real accessibility primitives** (`src/a11y/FocusController.ts`), not synthetic mouse events: gesture actions move actual DOM focus through the page's real tab order, apply a visible focus ring that layers on top of whatever the host page already styles, announce every state change through an `aria-live="polite"` region, and honor `prefers-reduced-motion` (disables cursor/dwell-ring easing). A **dwell-to-click** fallback activates whatever's focused after ~900ms of near-stillness, with a visible radial countdown, for anyone who can't reliably pinch.
- Ships as both an **ES module** (`handsfree.mjs`) and an **IIFE** (`handsfree.iife.js`, exposes `window.HandsFree`) — see "Integration" below.
- Ships with **six bundled replay traces** (`src/traces/*.json`, procedurally generated — see `scripts/generate-traces.mjs`), one per discrete gesture. The exact same pipeline (filter → geometry → recognizer → focus/a11y) runs on these as on the live camera; there is no separate demo-mode code path. If the camera is denied, missing, or simply not present (a judge with no webcam), the app falls back to replay automatically, with a visible status pill and an aria-live announcement — never a broken screen.

## Try it

```bash
npm install
npm run dev        # local dev server (index.html, recipe.html, plain.html)
```

or build and serve the static output exactly as it ships:

```bash
npm run build       # tsc + app build + IIFE lib build + ESM lib build
npx vite preview    # or `npx serve dist`
```

Three pages:
- **`index.html`** — landing page, running the engine on itself.
- **`recipe.html`** — the polished demo: a hands-free cooking walkthrough (swipe between steps, pinch or dwell-click to start a per-step timer, fist-drag to scroll the ingredient list, two-hand spread to zoom, an on-screen gesture-event log, and a source picker to force any of the six replay traces without a camera).
- **`plain.html`** — a deliberately bare, unstyled page (no custom CSS, no framework) proving the actual drop-in integration path: one `<script src="handsfree.iife.js">` and a few lines of vanilla JS.

Click **Start**/grant camera access, or just leave it — with no camera it falls back to a replay trace automatically. Wave an open hand to point, pinch to click, make a fist and drag to scroll, swipe left/right to move focus, or bring up a second hand and spread to zoom.

## Integration

```html
<script src="handsfree.iife.js"></script>
<script>
  HandsFree.init(); // camera with automatic replay fallback, zero config
</script>
```

or as an ES module:

```js
import { init } from './handsfree.mjs'
await init({ source: 'auto', hud: false })
```

`init(options)` returns `{ stop(), setSource(mode, trace?) }`. Options (all optional):

| Option | Default | Meaning |
|---|---|---|
| `source` | `'auto'` | `'auto'` tries the camera, falls back to replay on denial/error/no-webcam. `'camera'` forces it (throws on failure). `'replay'` forces a bundled trace. |
| `replayTrace` | `'open-palm-move'` | Which bundled trace (`open-palm-move`, `pinch-click`, `fist-scroll`, `swipe-left`, `swipe-right`, `two-hand-spread`) to use for replay / auto-fallback. |
| `root` | `document.body` | Root element whose focusable descendants gesture navigation cycles through. |
| `hud` | `true` | Small on-screen debug overlay (source, current pose, last event). |
| `gestureOptions` | `{}` | Tuning overrides passed to `GestureRecognizer` (thresholds, cooldowns, dwell timing — see `src/gestures/types.ts`). |
| `onGestureEvent` | no-op | Called for every discrete gesture event. Return `true` to skip the engine's own default handling for that event — e.g. give `'swipe'` page-specific meaning (see `demo/recipe.ts`, where swipe becomes "next/previous recipe step" instead of generic tab-order focus). |
| `onSourceChange` | no-op | Called with `(label, mode)` whenever the active source changes. |

## Gesture → action (default behavior)

| Gesture | Action |
|---|---|
| Open palm, moved | Cursor mode: a visible ring follows the hand; hovering over a focusable element moves real DOM focus onto it |
| Open palm, held still (~900ms) | Dwell-to-click: activates whatever's currently focused, with a visible countdown ring |
| Pinch (thumb tip ↔ index tip) | Activates whatever currently has DOM focus — fires once per physical pinch, regardless of hold duration |
| Fist, then drag | Scrolls the page, following the hand while the fist is held |
| Swipe left / right | Moves focus to the previous / next focusable element in tab order |
| Two hands, spread apart | Page zoom level tracks hand separation |

## Architecture

```
src/
  types.ts                     LandmarkFrame contract shared by camera + replay sources
  landmark-source/
    CameraSource.ts              live MediaPipe HandLandmarker over getUserMedia
    ReplaySource.ts               plays back a bundled JSON trace on the same clock
  filters/OneEuroFilter.ts      One Euro filter (scalar + 3D wrapper)
  geometry/HandGeometry.ts      landmarks -> finger curl, pinch distance, palm centroid/scale, spread
  gestures/
    GestureRecognizer.ts          the state machine: hysteresis, onset debounce, cooldowns
    types.ts                      GestureEvent union + tunable thresholds
  a11y/
    FocusController.ts            focus/tab-order navigation, visible focus ring, dwell ring, scroll, zoom
    Announcer.ts                  aria-live region
  engine/
    HandsFreeEngine.ts            wiring: source selection + fallback, recognizer -> focus actions
    public-api.ts                 the tiny init()/controller surface
    entry-module.ts               ES module entry point
    entry-iife.ts                 IIFE entry point (window.HandsFree)
  traces/*.json                 bundled replay traces (see scripts/generate-traces.mjs)
demo/
  landing.ts, recipe.ts         demo page wiring (plain.html uses the built IIFE directly, no TS)
verify/run.mjs                  headless Playwright verification (see below)
```

## Verification

```bash
npm run build
npx vite preview --port 4321 --strictPort &
node verify/run.mjs
```

Drives `dist/` headlessly with Playwright (`--use-gl=swiftshader --enable-unsafe-swiftshader`) through every replay trace, reads the full gesture-event history off `window.__hfEvents` (not the visibly-truncated on-screen log), and asserts on debounce behavior — e.g. two held pinches produce exactly two `'pinch'` events, two swipe whips produce exactly two `'swipe'` events and zero false swipes fire during ordinary cursor drift, fist-drag scrolls down then back to the origin, `prefers-reduced-motion` disables the cursor's CSS transition, and a context with no camera permission falls back to replay with the page still intact. Screenshots land in `verify/screenshots/`.

## Third-party attribution

- **[MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe)** (`@mediapipe/tasks-vision`, Apache-2.0) — the hand-landmark detection model and WASM runtime. Vendored into `public/mediapipe/` at build time; served same-origin, never from a CDN.
- **`hand_landmarker.task`** — Google's pretrained hand-landmark model, redistributed under MediaPipe's terms, vendored in `public/mediapipe/models/`.
- **One Euro Filter** — algorithm from Casiez, Roussel & Vogel, *"1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems"*, CHI 2012 ([https://gery.casiez.net/1euro/](https://gery.casiez.net/1euro/)). Implementation in `src/filters/OneEuroFilter.ts` is original code written from the published algorithm, shared in spirit with the sibling "instrument" project (same author, same build window — see that repo's README) but independently applied here to gesture-onset detection and cursor tracking rather than audio/visual mapping.
- No other third-party runtime code. No analytics, no telemetry, no network calls beyond loading the vendored same-origin assets above.

## Privacy / what leaves the browser

Nothing. The camera stream, every frame of hand-tracking inference, and all gesture classification run client-side in this browser tab. There is no backend, no account, no API key, and no network request beyond loading this site's own static files.

## License

MIT — see `LICENSE`.
