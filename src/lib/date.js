// Bangkok-aware date helpers. Pure functions, easy to test.
//
// Why not just use Date.toISOString()? That returns UTC. A POS sale at
// 06:30 Bangkok time = 23:30 UTC the previous day, which would land on the
// wrong row in a daily report. Anchor everything to Asia/Bangkok (UTC+7).

export const BANGKOK_TZ = 'Asia/Bangkok';

const LOCALE_OPTS = { timeZone: BANGKOK_TZ };

/** YYYY-MM-DD in Bangkok local time. Defaults to "today". */
export const dateISOBangkok = (d) =>
  (d || new Date()).toLocaleDateString('en-CA', LOCALE_OPTS);

export const todayISO = (ref) => dateISOBangkok(ref);

/**
 * Stamp a Bangkok-local YYYY-MM-DD as the start-of-day in tz-aware ISO 8601.
 * Use when filtering Supabase `timestamptz` columns by "Thai date".
 *
 *   startOfDayBangkok('2026-05-04') === '2026-05-04T00:00:00+07:00'
 */
export const startOfDayBangkok = (yyyymmdd) => `${yyyymmdd}T00:00:00+07:00`;

/** End-of-day partner of startOfDayBangkok (millisecond precision). */
export const endOfDayBangkok = (yyyymmdd) => `${yyyymmdd}T23:59:59.999+07:00`;

/** Bangkok-local YYYY-MM-DD key from a timestamptz — never use UTC .slice(0,10). */
export const bangkokDateKey = (ts) => {
  if (!ts) return '';
  return dateISOBangkok(new Date(ts));
};

/** Alias for bangkokDateKey — read a calendar date from stored timestamptz. */
export const isoFromTimestamptz = bangkokDateKey;

/** Parse YYYY-MM-DD (or full ISO) as Bangkok midnight for calendar math. */
export const dateOfIsoBangkok = (iso) => {
  if (!iso) return null;
  const clean = typeof iso === 'string' ? iso.trim() : String(iso);
  const str = clean.length === 10 ? `${clean}T00:00:00+07:00` : clean;
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Shift a Bangkok calendar date by N days (negative = past). */
export const addDaysBangkok = (iso, n) => {
  if (!iso) return '';
  const base = new Date(`${iso.slice(0, 10)}T12:00:00+07:00`);
  base.setTime(base.getTime() + n * 86400000);
  return dateISOBangkok(base);
};

/** First day of the month containing `iso` (YYYY-MM-DD). */
export const monthStartBangkok = (iso) => `${iso.slice(0, 7)}-01`;

/** Previous calendar month as { from, to } Bangkok YYYY-MM-DD strings. */
export const prevMonthRangeBangkok = (refIso) => {
  const [y, m] = refIso.slice(0, 7).split('-').map(Number);
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  const from = `${py}-${String(pm).padStart(2, '0')}-01`;
  const to = addDaysBangkok(`${y}-${String(m).padStart(2, '0')}-01`, -1);
  return { from, to };
};

/** Bangkok-local hour-of-day (0–23) for intraday bucketing. */
export const hourBangkok = (ts) => {
  if (!ts) return null;
  const h = parseInt(
    new Date(ts).toLocaleString('en-GB', { ...LOCALE_OPTS, hour: '2-digit', hour12: false }),
    10,
  );
  return Number.isFinite(h) ? h % 24 : null;
};

const TH_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** "5 พ.ค. 2569" — accepts YYYY-MM-DD or timestamptz. */
export const fmtThaiDateShort = (iso) => {
  if (!iso) return '';
  const key = iso.length > 10 ? bangkokDateKey(iso) : iso.slice(0, 10);
  const [y, m, day] = key.split('-').map(Number);
  if (!y || !m || !day) return '';
  return `${day} ${TH_MONTHS_SHORT[m - 1]} ${y + 543}`;
};

/** Range label for DatePicker — both args are YYYY-MM-DD Bangkok strings. */
export const fmtThaiRange = (from, to) => {
  if (!from && !to) return '';
  if (from === to) return fmtThaiDateShort(from);
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if (fy === ty && fm === tm)
    return `${fd} – ${td} ${TH_MONTHS_SHORT[tm - 1]} ${ty + 543}`;
  if (fy === ty)
    return `${fd} ${TH_MONTHS_SHORT[fm - 1]} – ${td} ${TH_MONTHS_SHORT[tm - 1]} ${ty + 543}`;
  return `${fmtThaiDateShort(from)} – ${fmtThaiDateShort(to)}`;
};

/** Locale-formatted Thai short date "4 พ.ค. 2026" — for display only. */
export const fmtDate = (s) =>
  s ? new Date(s).toLocaleDateString('th-TH', {
    ...LOCALE_OPTS,
    year: 'numeric', month: 'short', day: 'numeric',
  }) : '-';

/** "13:42" — Bangkok wall clock from timestamptz. */
export const fmtTimeBangkok = (s) => {
  if (!s) return '-';
  try {
    return new Date(s).toLocaleTimeString('th-TH', {
      ...LOCALE_OPTS,
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return '-'; }
};

/** "4 พ.ค. 2026 13:42" — for display only. */
export const fmtDateTime = (s) =>
  s ? new Date(s).toLocaleString('th-TH', {
    ...LOCALE_OPTS,
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) : '-';

/** Alias kept for call sites that prefer the explicit name. */
export const fmtDateTimeBangkok = fmtDateTime;
