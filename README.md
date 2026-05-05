# TIMES POS

Single-page React + Supabase POS for a Thai watch shop. Bundled to a
self-contained `dist/index.html` via Vite + `vite-plugin-singlefile`.

## Quick start

```bash
npm install
npm run dev          # local dev server with HMR (http://localhost:5173)
npm test             # run unit tests (Vitest)
npm run build        # produce dist/index.html — deploy this anywhere
npm run preview      # preview the built bundle locally
```

## Layout

```
.
├── index.html                  Vite source (thin shell, loads src/main.jsx)
├── legacy-index.html           Pre-Vite single-file version (kept for diff)
├── src/
│   ├── main.jsx                ES-module entry — imports React/ReactDOM/supabase,
│   │                           shims them as the legacy globals, then runs the
│   │                           full app body inline. Will be split into views/,
│   │                           components/, hooks/ in Phase 4.
│   ├── styles.css              Imports legacy CSS + Tailwind layers
│   ├── styles.legacy.css       All custom CSS (lifted from <style> block)
│   └── lib/
│       ├── money.js            roundMoney / fmtTHB / vatBreakdown / applyDiscounts
│       └── date.js             dateISOBangkok / startOfDayBangkok / endOfDayBangkok
├── tests/                      Vitest unit tests (money + date helpers)
├── supabase-migrations/        SQL: atomic RPCs, RLS audit, role policies
├── icons/, manifest.json       PWA assets (copied to dist/ at build time)
├── tailwind.config.js          Brand tokens (cream + coral)
├── postcss.config.js
├── vite.config.js
└── package.json
```

## Phases (from `/root/.claude/plans/delightful-watching-gray.md`)

- **Phase 1 ✅** — POS correctness fixes: double-submit guard, currency
  rounding, Bangkok timezone, stable list keys, in-app confirm/prompt,
  atomic Postgres RPCs, RLS, admin/cashier roles.
- **Phase 2 ✅** — Vite build pipeline, Tailwind CLI (no more JIT runtime
  shipped to clients), Vitest unit tests for money + date helpers.
- **Phase 3** — PWA service worker + offline POS queue.
- **Phase 4** — Refactor: split `src/main.jsx` into `views/`,
  `components/`, `hooks/`; modal focus trap; loading skeletons; a11y.

## Deploy

`dist/index.html` + `dist/*.png` + `dist/manifest.json` is everything you
need. Drop into any static host (Cloudflare Pages, Vercel, S3, an SD card
on a POS terminal). No server, no bundler at runtime.
