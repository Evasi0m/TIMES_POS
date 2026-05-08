// Weekly trend bucketing + month-over-month comparison helpers.
//
// Kept framework-agnostic: input = raw rows from Supabase, output = plain
// JS data that recharts / sparklines can render directly.

const MS_PER_DAY = 86400000;
const BANGKOK_OFFSET_MIN = 7 * 60;

/** Start of the Bangkok-local day that contains `ts` (returned as Date). */
function bangkokDayStart(ts) {
  const d = new Date(ts);
  const local = d.getTimezoneOffset();
  // Shift to Bangkok wall clock, zero the hour/min/sec, shift back.
  const bangkokTs = d.getTime() + (BANGKOK_OFFSET_MIN + local) * 60000;
  const startOfDay = new Date(bangkokTs);
  startOfDay.setUTCHours(0, 0, 0, 0);
  return new Date(startOfDay.getTime() - (BANGKOK_OFFSET_MIN + local) * 60000);
}

/**
 * Bucket rows into N weekly windows ending at `now`. Each bucket covers a
 * rolling 7-day window (Mon..Sun in Bangkok time) so the final bucket is
 * "this week so far" and the prior are complete weeks.
 *
 * @param {Array<{sale_date: string|Date, revenue: number, cost?: number}>} rows
 * @returns {Array<{ weekStart: string, weekEnd: string, revenue: number, cost: number, profit: number, count: number }>}
 */
export function weeklyBuckets(rows, { weeks = 13, now = Date.now() } = {}) {
  const todayStart = bangkokDayStart(now).getTime();
  // Align to Monday: JS getDay(): 0=Sun..6=Sat. Bangkok biz week starts Mon.
  const dow = new Date(todayStart).getDay();
  const offsetToMon = dow === 0 ? 6 : dow - 1;
  const thisMonday = todayStart - offsetToMon * MS_PER_DAY;
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = thisMonday - i * 7 * MS_PER_DAY;
    const end = start + 7 * MS_PER_DAY - 1;
    buckets.push({
      weekStart: new Date(start).toISOString().slice(0, 10),
      weekEnd:   new Date(end).toISOString().slice(0, 10),
      _startTs:  start,
      _endTs:    end,
      revenue: 0, cost: 0, profit: 0, count: 0,
    });
  }

  for (const r of rows || []) {
    const t = r.sale_date ? new Date(r.sale_date).getTime() : NaN;
    if (!Number.isFinite(t)) continue;
    // Linear search — weeks is tiny (<=13).
    for (const b of buckets) {
      if (t >= b._startTs && t <= b._endTs) {
        const rev = Number(r.revenue) || 0;
        const cost = Number(r.cost) || 0;
        b.revenue += rev;
        b.cost += cost;
        b.profit += rev - cost;
        b.count += 1;
        break;
      }
    }
  }

  return buckets.map(({ _startTs, _endTs, ...rest }) => rest);
}

/**
 * Month-over-month compare. Pass two objects:
 *   current  = { revenue, cost, count }
 *   previous = { revenue, cost, count }
 *
 * Returns deltas + %Δ (null when previous was 0 so the UI shows "—").
 */
export function momCompare(current, previous) {
  const cur = {
    revenue: Number(current?.revenue) || 0,
    cost:    Number(current?.cost) || 0,
    count:   Number(current?.count) || 0,
  };
  const prev = {
    revenue: Number(previous?.revenue) || 0,
    cost:    Number(previous?.cost) || 0,
    count:   Number(previous?.count) || 0,
  };
  const pct = (a, b) => (b === 0 ? null : ((a - b) / b) * 100);
  return {
    current:  cur,
    previous: prev,
    delta: {
      revenue: cur.revenue - prev.revenue,
      cost:    cur.cost - prev.cost,
      profit:  (cur.revenue - cur.cost) - (prev.revenue - prev.cost),
      count:   cur.count - prev.count,
      aov:     (cur.count ? cur.revenue / cur.count : 0) -
               (prev.count ? prev.revenue / prev.count : 0),
    },
    pct: {
      revenue: pct(cur.revenue, prev.revenue),
      profit:  pct(cur.revenue - cur.cost, prev.revenue - prev.cost),
      count:   pct(cur.count, prev.count),
    },
    aov: {
      current: cur.count ? cur.revenue / cur.count : 0,
      previous: prev.count ? prev.revenue / prev.count : 0,
    },
    margin: {
      current:  cur.revenue ? (cur.revenue - cur.cost) / cur.revenue : 0,
      previous: prev.revenue ? (prev.revenue - prev.cost) / prev.revenue : 0,
    },
  };
}
