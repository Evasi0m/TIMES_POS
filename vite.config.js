// Vite config — bundles the entire React app + Tailwind CSS into ONE
// self-contained dist/index.html via vite-plugin-singlefile, AND emits a
// service worker (sw.js) alongside it via vite-plugin-pwa so the POS can
// boot even when the WiFi flickers (a real risk at the front counter).
//
// The single HTML file is deploy-ready: copy to any static host
// (Cloudflare Pages, Vercel, S3, an SD card on a POS terminal). The SW
// file goes next to it.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Use RELATIVE asset URLs so the same dist/ works whether the app is
  // hosted at the domain root (Cloudflare Pages, S3, custom domain) OR
  // under a subpath (GitHub Pages project site at /<repo>/, Netlify
  // preview URLs). Don't hardcode '/times_pos/'.
  base: './',
  plugins: [
    react(),

    // PWA service worker. `injectManifest` strategy lets us write our own
    // sw.js (in src/sw.js) and Workbox just injects the precache list at
    // build time. We control the runtime caching — the auto strategies
    // are too aggressive for a POS where stale data = wrong stock counts.
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        // Don't precache the app-shell file twice (singlefile already
        // inlined everything; the icons + manifest are the precache list).
        // Include `html` so Workbox precaches index.html itself with the
        // correct relative URL (matches `base: './'`) and a real revision
        // hash. Without this, the SW would install fine but the app shell
        // wouldn't be cached for true offline boot.
        globPatterns: ['**/*.{html,png,ico,json}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: false, // we already ship a hand-written manifest.json
      injectRegister: 'inline',
      devOptions: { enabled: false },
    }),

    // Inline JS + CSS into one index.html. Must run AFTER PWA so the SW
    // file stays separate.
    viteSingleFile({ removeViteModuleLoader: false }),
  ],
  build: {
    target: 'es2020',
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    assetsInlineLimit: 100_000_000, // inline EVERYTHING the bundler sees
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.{js,jsx,ts,tsx}', 'src/**/*.test.{js,jsx,ts,tsx}'],
  },
});
