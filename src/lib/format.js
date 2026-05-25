// Shared formatting helpers. `fmtTHB` + date helpers live in main.jsx for
// historical reasons; this module re-exposes the subset needed by
// non-main.jsx views (InsightsView, settings panels).

import { roundMoney } from './money.js';

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

const TH_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** "5 พ.ค. 2569" — Thai Buddhist era short date, date-only ISO input. */
export const fmtThaiDateShort = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${TH_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear() + 543}`;
};
