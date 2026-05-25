// Bangkok-aware date helpers. Pure functions, easy to test.
//
// Why not just use Date.toISOString()? That returns UTC. A POS sale at
// 06:30 Bangkok time = 23:30 UTC the previous day, which would land on the
// wrong row in a daily report. Anchor everything to Asia/Bangkok (UTC+7).

/** YYYY-MM-DD in Bangkok local time. Defaults to "today". */
export const dateISOBangkok = (d) =>
  (d || new Date()).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

export const todayISO = () => dateISOBangkok();

/**
 * Stamp a Bangkok-local YYYY-MM-DD as the start-of-day in tz-aware ISO 8601.
 * Use when filtering Supabase `timestamptz` columns by "Thai date".
 *
 *   startOfDayBangkok('2026-05-04') === '2026-05-04T00:00:00+07:00'
 */
export const startOfDayBangkok = (yyyymmdd) => `${yyyymmdd}T00:00:00+07:00`;

/** End-of-day partner of startOfDayBangkok (millisecond precision). */
export const endOfDayBangkok = (yyyymmdd) => `${yyyymmdd}T23:59:59.999+07:00`;

/** Locale-formatted Thai short date "4 พ.ค. 2026" — for display only. */
export const fmtDate = (s) =>
  s ? new Date(s).toLocaleDateString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric',
  }) : '-';

/** "4 พ.ค. 2026 13:42" — for display only. */
export const fmtDateTime = (s) =>
  s ? new Date(s).toLocaleString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) : '-';
