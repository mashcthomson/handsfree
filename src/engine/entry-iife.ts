// IIFE entry point: exposes `window.HandsFree` for a plain
// `<script src="handsfree.iife.js"></script>` drop-in — no bundler, no
// module system, no build step required on the host site. This is the
// entry point vite.lib.config.ts builds for the `iife` format.
import { init, HandsFreeEngine } from './public-api'

declare global {
  interface Window {
    HandsFree: {
      init: typeof init
      HandsFreeEngine: typeof HandsFreeEngine
    }
  }
}

if (typeof window !== 'undefined') {
  window.HandsFree = { init, HandsFreeEngine }
}

export { init, HandsFreeEngine }
