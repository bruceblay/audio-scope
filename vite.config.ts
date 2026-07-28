import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// A Chrome extension cannot load from Vite's dev server, so `npm run dev` is a
// watch build into dist/ which is loaded as an unpacked extension. Keeping the
// output filenames stable (no content hashes) matters: manifest.json references
// them literally, and Chrome's extension reload is much happier without churn.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '~': r('./src') },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The service worker is a module worker; the panel and popup are ES modules.
    target: 'chrome120',
    // Extensions have no network round trip, so inlining assets buys nothing and
    // makes the built output harder to inspect.
    assetsInlineLimit: 0,
    rollupOptions: {
      // The HTML entry lives at the project root so Rollup emits it as
      // dist/sidepanel.html, which is the path manifest.json references. A
      // nested source path would be mirrored into dist/src/sidepanel/.
      input: {
        sidepanel: r('sidepanel.html'),
        background: r('src/background/index.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
