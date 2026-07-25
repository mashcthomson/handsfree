import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// Library build #1: the IIFE bundle — the actual "one <script> tag" drop-in.
// Exposes `window.HandsFree`. Emitted alongside the app build's dist/ output
// (emptyOutDir: false so it doesn't wipe the demo pages built first) so
// plain.html and recipe.html can both load /handsfree.iife.js as a
// same-origin static asset, exactly as an external site would.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/engine/entry-iife.ts'),
      name: 'HandsFree',
      formats: ['iife'],
      fileName: () => 'handsfree.iife.js',
    },
    rollupOptions: {
      output: { extend: true },
    },
  },
})
