// Shared formatting helpers. `fmtTHB` + date helpers live in main.jsx for
// historical reasons; this module re-exposes the subset needed by
// non-main.jsx views (InsightsView, settings panels).

import { roundMoney } from './money.js';
export { fmtThaiDateShort, fmtThaiRange, bangkokDateKey } from './date.js';

/** "฿1,234" / "฿1,234.56" — Thai baht with mixed decimal precision. */
export const fmtTHB = (n) =>
  '฿' +
  roundMoney(n).toLocaleString('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

/** "+12.3%" / "-4.1%" / "—" (for null). Used in MoM/WoW deltas. */
export const fmtPct = (pct, digits = 1) => {
  if (pct == null || !Number.isFinite(pct)) return '—';
  const s = pct >= 0 ? '+' : '';
  return s + pct.toFixed(digits) + '%';
};

/** Compact integer with thousand separators: 12345 → "12,345" */
export const fmtNum = (n) =>
  (Number(n) || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 });
