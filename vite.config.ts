import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// App build: the demo pages (landing, recipe, plain-integration). Multi-page
// static site, same as any Vite app — this is what "npm run build" +
// "serve dist/" ships as the judged demo. The embeddable engine bundle
// itself is built separately by vite.lib.config.ts (see package.json
// "build" script) so the plain-integration demo can load it via a single
// <script> tag exactly as an outside site would.
export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        recipe: resolve(__dirname, 'recipe.html'),
        plain: resolve(__dirname, 'plain.html'),
      },
    },
  },
})
