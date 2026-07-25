import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// Library build #2: the ES module bundle, for sites that prefer
// `import { init } from './handsfree.mjs'` (or a bundler resolving it as a
// package) over a global-exposing IIFE.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/engine/entry-module.ts'),
      formats: ['es'],
      fileName: () => 'handsfree.mjs',
    },
  },
})
