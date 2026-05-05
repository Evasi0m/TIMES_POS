// Vite config — bundles the entire React app + Tailwind CSS into ONE
// self-contained dist/index.html via vite-plugin-singlefile. The single
// HTML file is deploy-ready: copy to any static host (Cloudflare Pages,
// Vercel, S3, an SD card on a POS terminal) and it just works.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [
    react(),
    viteSingleFile(),
  ],
  build: {
    target: 'es2020',
    outDir: 'dist',
    emptyOutDir: true,
    // Inlining requires the rollup output to be a single chunk; the plugin
    // handles most of this, but raise the warning limit so we don't get noise.
    chunkSizeWarningLimit: 4000,
    // Keep favicon.ico, apple-touch-icon.png, icons/, manifest.json next to
    // the bundle. They are referenced from index.html via /icons/... paths.
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
