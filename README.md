# TIMES POS

Single-page React + Supabase POS for a Thai watch shop. Bundled to a
self-contained `dist/index.html` via Vite + `vite-plugin-singlefile`.

## Quick start

```bash
npm install
npm run dev          # local dev server with HMR (http://localhost:5173)
npm test             # run unit tests (Vitest, 127 tests)
npm run lint         # ESLint report (warnings tolerated, no errors)
npm run lint:fix     # auto-fix what ESLint can
npm run format       # Prettier write
npm run format:check # Prettier verify (used in CI)
npm run build        # produce dist/index.html — deploy this anywhere
npm run preview      # preview the built bundle locally
```

CI runs `lint`, `format:check`, `test`, `build` on every PR — see
`.github/workflows/ci.yml`.

## Layout

```
.
├── index.html                  Vite source (thin shell, loads src/main.jsx)
├── legacy-index.html           Pre-Vite single-file version (kept for diff)
├── src/
│   ├── main.jsx                ES-module entry — contexts, views, modals.
│   │                           Pure logic + standalone widgets are being
│   │                           progressively extracted to lib/ + components/.
│   ├── styles.css              Imports legacy CSS + Tailwind layers
│   ├── styles.legacy.css       All custom CSS (lifted from <style> block)
│   ├── components/
│   │   ├── ui/
│   │   │   ├── Icon.jsx        SVG icon set (Lucide-inspired, currentColor)
│   │   │   └── Popover.jsx     Floating panel via portal, with edge-flip
│   │   └── movement/           Receive/Return/Claim form pieces
│   └── lib/
│       ├── money.js            roundMoney / fmtTHB / vatBreakdown / applyDiscounts
│       ├── date.js             dateISOBangkok / startOfDayBangkok / endOfDayBangkok
│       ├── error-map.js        Supabase → Thai error message mapper
│       ├── sb-paginate.js      fetchAll() — walks past PostgREST 1000-row cap
│       ├── product-classify.js BRAND_RULES, classifyBrand, enrichProduct,
│       │                       filterProducts, sortProducts (pure)
│       ├── nav-config.js       NAV + role-based visibility filter
│       ├── expense-calc.js     Shop expense formula (staff base+commission)
│       ├── offline-queue.js    IndexedDB queue + drain for offline POS
│       ├── online-status.js    navigator.onLine subscription helper
│       └── use-*.js            barcode-scanner / number-tween hooks
├── tests/                      Vitest unit tests — money, date, paginate,
│                               product-classify, expense-calc
├── supabase-migrations/        SQL: atomic RPCs, RLS audit, role policies
├── icons/, manifest.json       PWA assets (copied to dist/ at build time)
├── tailwind.config.js          Brand tokens (cream + coral)
├── postcss.config.js
├── vite.config.js
└── package.json
```

## Phases

- **Phase 1 ✅** — POS correctness: double-submit guard, currency rounding,
  Bangkok timezone, stable list keys, in-app confirm/prompt, atomic
  Postgres RPCs, RLS, admin/cashier roles.
- **Phase 2 ✅** — Vite build, Tailwind CLI, Vitest, modal focus trap.
- **Phase 3 ✅** — PWA service worker + offline POS queue.
- **Phase 4 ✅** — Refactor + tooling: lib/ extractions, ESLint + Prettier
  + CI, `fetchAll()` audit (5 paginated paths fixed), product classify,
  shop expense, debounced search.
- **Phase 5 ✅** — Owner analytics + automation:
  - Realtime sync across devices (Products / Dashboard / Sales)
  - `InsightsView` admin-only: MoM, weekly trend, hour×day heatmap,
    channel mix, top/bottom movers, dead stock (60d), reorder forecast
  - Telegram daily summary (Edge Function + pg_cron) — see
    `docs/TELEGRAM_SETUP.md`

## Conventions

- **Pagination.** Any list query that can grow unbounded MUST use
  `fetchAll()` from `src/lib/sb-paginate.js`. PostgREST silently caps at
  1000 rows otherwise. Audit list: products, sale_orders, sale_order_items,
  receive_order_items, stock_movements (see Phase 4 commit history for the
  comment markers explaining why each call sites uses it).
- **Realtime invalidation.** Subscribing views use
  `useRealtimeInvalidate(sb, [tables], reload)` from
  `src/lib/use-realtime-invalidate.js` instead of patching state by hand
  — the loader is the source of truth, debounced 300 ms.
- **Sensitive settings.** Bot tokens / future webhook secrets live in
  `public.shop_secrets` (admin-only RLS) — not in `shop_settings`, which
  every authenticated user reads.
- **Bangkok timezone.** Date filters always pass through
  `startOfDayBangkok` / `endOfDayBangkok`. Never compare ISO strings
  directly to a naive `Date.now()` value.
- **Pure logic in `lib/`.** Anything that can be tested without a DOM goes
  there. `tests/<module>.test.js` mirrors the file name.
- **Client filter logic is intentional.** Re-importing the products CSV
  must NOT wipe filter behavior, so brand/series/material/color are
  derived in JS at load time, not stored in DB columns. See
  `src/lib/product-classify.js`.

## Deploy

`dist/index.html` + `dist/*.png` + `dist/manifest.json` is everything you
need. Drop into any static host (Cloudflare Pages, Vercel, S3, an SD card
on a POS terminal). No server, no bundler at runtime.
