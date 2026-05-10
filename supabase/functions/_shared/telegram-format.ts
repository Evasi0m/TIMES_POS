// Shared helpers for Telegram bot — message templates, summary computers,
// and the actual Telegram API caller. Imported by `telegram-send` (outbound
// scheduled + manual) and `telegram-webhook` (incoming /commands).
//
// Why a single file: keeping the formatters and the data fetchers together
// ensures the cron summary, manual preview, and `/today` command all
// produce IDENTICAL output. Splitting them would invite drift.

// ─────────────────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────────────────

export const ECOMMERCE_CHANNELS = new Set(['tiktok', 'shopee', 'lazada']);

export const CHANNEL_LABEL: Record<string, string> = {
  store: 'หน้าร้าน',
  tiktok: 'TikTok',
  shopee: 'Shopee',
  lazada: 'Lazada',
  facebook: 'Facebook',
};

const TH_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];
const TH_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const TH_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

// Bangkok = UTC+7 fixed (no DST).
export const BKK_OFFSET_MIN = 7 * 60;

// ─────────────────────────────────────────────────────────────────────────
//  FORMATTERS
// ─────────────────────────────────────────────────────────────────────────

export function fmtTHB(n: number, opts: { showDecimal?: boolean } = {}) {
  const r = Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
  return '฿' + r.toLocaleString('th-TH', {
    minimumFractionDigits: opts.showDecimal ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

export function fmtThaiDate(yyyymmdd: string, withDay = true) {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  const dow = TH_DAYS[dateObj.getUTCDay()];
  const dateStr = `${d} ${TH_MONTHS[m - 1]} ${y + 543}`;
  return withDay ? `วัน${dow} ${dateStr}` : dateStr;
}

export function fmtThaiMonth(yyyymm: string) {
  const [y, m] = yyyymm.split('-').map(Number);
  return `${TH_MONTHS_FULL[m - 1]} ${y + 543}`;
}

export function fmtPct(n: number, digits = 1) {
  if (!isFinite(n)) return '–';
  const sign = n > 0 ? '↑' : n < 0 ? '↓' : '→';
  return `${sign} ${Math.abs(n * 100).toFixed(digits)}%`;
}

/** Bangkok-local YYYY-MM-DD for "today" or for an offset (default = today). */
export function bangkokDate(offsetDays = 0) {
  const now = Date.now();
  const bkkMs = now + BKK_OFFSET_MIN * 60000;
  const d = new Date(bkkMs);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** Bangkok-local hour 0–23. */
export function bangkokHour(): number {
  return new Date(Date.now() + BKK_OFFSET_MIN * 60000).getUTCHours();
}

/** Bangkok-local day-of-month 1–31. */
export function bangkokDayOfMonth(): number {
  return new Date(Date.now() + BKK_OFFSET_MIN * 60000).getUTCDate();
}

export const startOfDayBkk = (yyyymmdd: string) => `${yyyymmdd}T00:00:00+07:00`;
export const endOfDayBkk   = (yyyymmdd: string) => `${yyyymmdd}T23:59:59.999+07:00`;

/** Build a small ASCII bar for embedding in messages. */
export function asciiBar(ratio: number, width = 8): string {
  const r = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(r * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** Walk past PostgREST 1000-row cap. */
export async function fetchAll<T>(
  build: (from: number, to: number) => Promise<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0; const PAGE = 1000;
  for (;;) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
//  REVENUE HELPER (matches the rest of the app — see useDashboardStats)
//  E-commerce channels honour `net_received` (after platform fees).
//  Store / facebook = grand_total IS the revenue.
// ─────────────────────────────────────────────────────────────────────────

interface OrderLike { channel: string | null; grand_total: number; net_received: number | null }
const revenueOf = (r: OrderLike) =>
  ECOMMERCE_CHANNELS.has(r.channel || '') && r.net_received != null
    ? Number(r.net_received) || 0
    : Number(r.grand_total) || 0;

// ─────────────────────────────────────────────────────────────────────────
//  DAILY SUMMARY — yesterday's totals (default), or any explicit date.
// ─────────────────────────────────────────────────────────────────────────

export interface DailySummary {
  date: string;
  revenue: number;
  cost: number;
  grossProfit: number;
  shopExpense: number;        // averaged from monthly expenses ÷ days-in-month
  netProfit: number;
  orderCount: number;
  aov: number;
  margin: number;
  prevRevenue: number;        // revenue of (date - 1) — for compare arrow
  topProducts: Array<{ name: string; qty: number; max: number }>;
  byChannel: Array<{ channel: string; total: number; pct: number }>;
}

export async function computeDailySummary(supa: any, dateBkk: string): Promise<DailySummary> {
  // Today's orders
  const { data: orders, error: ordErr } = await supa
    .from('sale_orders')
    .select('id, channel, grand_total, net_received')
    .eq('status', 'active')
    .gte('sale_date', startOfDayBkk(dateBkk))
    .lte('sale_date', endOfDayBkk(dateBkk));
  if (ordErr) throw ordErr;
  const ords = (orders || []) as Array<OrderLike & { id: number }>;
  const revenue = ords.reduce((s, r) => s + revenueOf(r), 0);

  // Previous-day revenue for the compare arrow
  const prevDate = (() => {
    const [y, m, d] = dateBkk.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 1);
    return dt.toISOString().slice(0, 10);
  })();
  const { data: prevOrders } = await supa
    .from('sale_orders')
    .select('channel, grand_total, net_received')
    .eq('status', 'active')
    .gte('sale_date', startOfDayBkk(prevDate))
    .lte('sale_date', endOfDayBkk(prevDate));
  const prevRevenue = (prevOrders || []).reduce((s: number, r: any) => s + revenueOf(r), 0);

  // By-channel breakdown
  const channelMap: Record<string, number> = {};
  for (const r of ords) {
    const k = r.channel || 'store';
    channelMap[k] = (channelMap[k] || 0) + revenueOf(r);
  }

  // Items → cost + top products
  let cost = 0;
  const productMap = new Map<string, number>();
  if (ords.length) {
    const ids = ords.map((o) => o.id);
    const items = await fetchAll<{ product_name: string; quantity: number; cost_price: number | null }>(
      (from, to) => supa.from('sale_order_items')
        .select('product_name, quantity, cost_price')
        .in('sale_order_id', ids).range(from, to),
    );
    for (const it of items) {
      const q = Number(it.quantity) || 0;
      cost += (Number(it.cost_price) || 0) * q;
      const name = it.product_name || '?';
      productMap.set(name, (productMap.get(name) || 0) + q);
    }
  }
  const topRaw = Array.from(productMap.entries())
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 3);
  const topMax = topRaw[0]?.qty || 1;
  const topProducts = topRaw.map(p => ({ ...p, max: topMax }));

  // Shop expense — month total ÷ days-in-month gives "per day"
  const shopExpense = await computeAvgShopExpensePerDay(supa, dateBkk);

  const grossProfit = revenue - cost;
  const netProfit = grossProfit - shopExpense;
  const margin = revenue > 0 ? grossProfit / revenue : 0;
  const aov = ords.length ? revenue / ords.length : 0;

  const totalChannelRevenue = Object.values(channelMap).reduce((s, v) => s + v, 0);
  const byChannel = Object.entries(channelMap)
    .map(([channel, total]) => ({
      channel, total,
      pct: totalChannelRevenue > 0 ? total / totalChannelRevenue : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    date: dateBkk, revenue, cost, grossProfit, shopExpense, netProfit,
    orderCount: ords.length, aov, margin, prevRevenue, topProducts, byChannel,
  };
}

/** Average daily shop expense for the month containing `dateBkk`. */
async function computeAvgShopExpensePerDay(supa: any, dateBkk: string): Promise<number> {
  const periodMonth = dateBkk.slice(0, 7) + '-01';
  const { data: expRows } = await supa
    .from('shop_expenses')
    .select('category, amount, base_salary, commission_pct')
    .eq('period_month', periodMonth);

  // Need monthSales for staff commission categories.
  const monthStart = `${dateBkk.slice(0, 7)}-01T00:00:00+07:00`;
  const [y, m] = dateBkk.split('-').map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const monthEnd = `${nextMonth}T00:00:00+07:00`;
  const { data: monthOrders } = await supa
    .from('sale_orders')
    .select('grand_total, channel, net_received')
    .eq('status', 'active')
    .gte('sale_date', monthStart)
    .lt('sale_date', monthEnd);
  const monthSales = (monthOrders || []).reduce(
    (s: number, o: any) => s + revenueOf(o), 0,
  );

  let monthlyExpense = 0;
  for (const e of expRows || []) {
    if (e.category === 'staff_1' || e.category === 'staff_2') {
      const base = Number(e.base_salary) || 0;
      const pct = Number(e.commission_pct) || 0;
      monthlyExpense += base + (pct / 100) * monthSales;
    } else {
      monthlyExpense += Number(e.amount) || 0;
    }
  }
  const daysInMonth = new Date(y, m, 0).getDate();
  return monthlyExpense / daysInMonth;
}

export function formatDaily(s: DailySummary): string {
  const lines: string[] = [];
  lines.push(`📊 <b>สรุปยอด${fmtThaiDate(s.date)}</b>`);
  lines.push('');
  if (s.orderCount === 0) {
    lines.push('🌙 วันนี้ไม่มีบิลขาย');
    return lines.join('\n');
  }
  // Revenue + compare arrow
  const change = s.prevRevenue > 0 ? (s.revenue - s.prevRevenue) / s.prevRevenue : 0;
  const compare = s.prevRevenue > 0 ? `   <i>${fmtPct(change)} vs เมื่อวาน</i>` : '';
  lines.push(`💰 ยอดขาย      <b>${fmtTHB(s.revenue)}</b>${compare}`);
  lines.push(`🧾 จำนวนบิล    ${s.orderCount} บิล   <i>AOV ${fmtTHB(s.aov)}</i>`);
  lines.push(`💵 กำไรเบื้องต้น ${fmtTHB(s.grossProfit)}   <i>(${(s.margin * 100).toFixed(1)}%)</i>`);
  lines.push(`💸 ค่าใช้จ่าย    -${fmtTHB(s.shopExpense)}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push(`✨ <b>กำไรสุทธิ    ${fmtTHB(s.netProfit)}</b>`);

  if (s.topProducts.length) {
    lines.push('');
    lines.push('📦 <b>ขายดี</b>');
    s.topProducts.forEach((p, i) => {
      const bar = asciiBar(p.qty / p.max, 5);
      lines.push(`  ${i + 1}. ${truncate(p.name, 24)} ${bar} ×${p.qty}`);
    });
  }

  if (s.byChannel.length) {
    lines.push('');
    lines.push('🛒 <b>ช่องทาง</b>');
    s.byChannel.forEach(c => {
      const label = (CHANNEL_LABEL[c.channel] || c.channel).padEnd(8, ' ');
      lines.push(`  ${label} ${fmtTHB(c.total).padStart(10, ' ')}  (${(c.pct * 100).toFixed(0)}%)`);
    });
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
//  MONTHLY SUMMARY — by default the month *before* `dateBkk`.
// ─────────────────────────────────────────────────────────────────────────

export interface MonthlySummary {
  yyyymm: string;             // e.g. "2025-04"
  revenue: number;
  cost: number;
  grossProfit: number;
  shopExpense: number;
  netProfit: number;
  margin: number;
  orderCount: number;
  prevRevenue: number;        // previous month
  prevGross: number;
  topProducts: Array<{ name: string; qty: number; max: number }>;
  byChannel: Array<{ channel: string; total: number; pct: number }>;
  bestDay: { date: string; revenue: number } | null;
}

export async function computeMonthlySummary(supa: any, yyyymm: string): Promise<MonthlySummary> {
  const [y, m] = yyyymm.split('-').map(Number);
  const monthStart = `${yyyymm}-01T00:00:00+07:00`;
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const monthEnd = `${nextY}-${String(nextM).padStart(2, '0')}-01T00:00:00+07:00`;

  const { data: orders, error: ordErr } = await supa
    .from('sale_orders')
    .select('id, channel, grand_total, net_received, sale_date')
    .eq('status', 'active')
    .gte('sale_date', monthStart)
    .lt('sale_date', monthEnd);
  if (ordErr) throw ordErr;
  const ords = (orders || []) as Array<OrderLike & { id: number; sale_date: string }>;
  const revenue = ords.reduce((s, r) => s + revenueOf(r), 0);

  // Previous month
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const prevYyyymm = `${prevY}-${String(prevM).padStart(2, '0')}`;
  const prevMonthStart = `${prevYyyymm}-01T00:00:00+07:00`;
  const { data: prevOrders } = await supa
    .from('sale_orders')
    .select('channel, grand_total, net_received')
    .eq('status', 'active')
    .gte('sale_date', prevMonthStart)
    .lt('sale_date', monthStart);
  const prevRevenue = (prevOrders || []).reduce((s: number, r: any) => s + revenueOf(r), 0);

  // By channel
  const channelMap: Record<string, number> = {};
  for (const r of ords) {
    const k = r.channel || 'store';
    channelMap[k] = (channelMap[k] || 0) + revenueOf(r);
  }

  // Best day
  const dayMap: Record<string, number> = {};
  for (const r of ords) {
    const d = r.sale_date.slice(0, 10);
    dayMap[d] = (dayMap[d] || 0) + revenueOf(r);
  }
  const bestDay = Object.entries(dayMap)
    .map(([date, revenue]) => ({ date, revenue }))
    .sort((a, b) => b.revenue - a.revenue)[0] || null;

  // Items → cost + top products
  let cost = 0;
  const productMap = new Map<string, number>();
  if (ords.length) {
    const ids = ords.map((o) => o.id);
    const items = await fetchAll<{ product_name: string; quantity: number; cost_price: number | null }>(
      (from, to) => supa.from('sale_order_items')
        .select('product_name, quantity, cost_price')
        .in('sale_order_id', ids).range(from, to),
    );
    for (const it of items) {
      const q = Number(it.quantity) || 0;
      cost += (Number(it.cost_price) || 0) * q;
      const name = it.product_name || '?';
      productMap.set(name, (productMap.get(name) || 0) + q);
    }
  }
  const topRaw = Array.from(productMap.entries())
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);
  const topMax = topRaw[0]?.qty || 1;
  const topProducts = topRaw.map(p => ({ ...p, max: topMax }));

  // Shop expense = monthly total (not per day)
  const periodMonth = `${yyyymm}-01`;
  const { data: expRows } = await supa
    .from('shop_expenses')
    .select('category, amount, base_salary, commission_pct')
    .eq('period_month', periodMonth);
  let shopExpense = 0;
  for (const e of expRows || []) {
    if (e.category === 'staff_1' || e.category === 'staff_2') {
      const base = Number(e.base_salary) || 0;
      const pct = Number(e.commission_pct) || 0;
      shopExpense += base + (pct / 100) * revenue;
    } else {
      shopExpense += Number(e.amount) || 0;
    }
  }

  const grossProfit = revenue - cost;
  const netProfit = grossProfit - shopExpense;
  const margin = revenue > 0 ? grossProfit / revenue : 0;

  // Prev gross — rough; we only have prev revenue + need its cost, fetch items
  let prevGross = 0;
  if (prevOrders && prevOrders.length) {
    const { data: prevItems } = await supa
      .from('sale_order_items')
      .select('quantity, cost_price, sale_order_id')
      .in('sale_order_id', (prevOrders as any).map((o: any) => o.id ?? -1).filter((x: number) => x >= 0));
    let prevCost = 0;
    for (const it of (prevItems || []) as any[]) {
      prevCost += (Number(it.cost_price) || 0) * (Number(it.quantity) || 0);
    }
    prevGross = prevRevenue - prevCost;
  }

  const totalChannelRevenue = Object.values(channelMap).reduce((s, v) => s + v, 0);
  const byChannel = Object.entries(channelMap)
    .map(([channel, total]) => ({
      channel, total,
      pct: totalChannelRevenue > 0 ? total / totalChannelRevenue : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    yyyymm, revenue, cost, grossProfit, shopExpense, netProfit, margin,
    orderCount: ords.length, prevRevenue, prevGross, topProducts, byChannel, bestDay,
  };
}

export function formatMonthly(m: MonthlySummary): string {
  const lines: string[] = [];
  lines.push(`🗓 <b>สรุปเดือน${fmtThaiMonth(m.yyyymm)}</b>`);
  lines.push('');
  if (m.orderCount === 0) {
    lines.push('🌙 ไม่มีบิลขายในเดือนนี้');
    return lines.join('\n');
  }
  lines.push(`💰 ยอดขายเดือน    <b>${fmtTHB(m.revenue)}</b>`);
  lines.push(`🧾 จำนวนบิล       ${m.orderCount.toLocaleString('th-TH')} บิล`);
  lines.push(`💵 กำไรเบื้องต้น   ${fmtTHB(m.grossProfit)}  <i>(${(m.margin * 100).toFixed(1)}%)</i>`);
  lines.push(`💸 ค่าใช้จ่ายร้าน  -${fmtTHB(m.shopExpense)}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push(`✨ <b>กำไรสุทธิ      ${fmtTHB(m.netProfit)}</b>`);

  if (m.prevRevenue > 0) {
    const revChange = (m.revenue - m.prevRevenue) / m.prevRevenue;
    const grossChange = m.prevGross > 0 ? (m.grossProfit - m.prevGross) / m.prevGross : 0;
    lines.push('');
    lines.push('📈 <b>เทียบเดือนก่อน</b>');
    lines.push(`   ยอดขาย ${fmtPct(revChange)}  ·  กำไร ${fmtPct(grossChange)}`);
  }

  if (m.topProducts.length) {
    lines.push('');
    lines.push('📦 <b>Top 5 ขายดี</b>');
    m.topProducts.forEach((p, i) => {
      const bar = asciiBar(p.qty / p.max, 6);
      lines.push(`  ${i + 1}. ${truncate(p.name, 22)} ${bar} ×${p.qty}`);
    });
  }

  if (m.byChannel.length) {
    lines.push('');
    lines.push('🛒 <b>ช่องทาง</b>');
    m.byChannel.forEach(c => {
      const label = (CHANNEL_LABEL[c.channel] || c.channel).padEnd(8, ' ');
      const pct = (c.pct * 100).toFixed(0).padStart(3, ' ');
      lines.push(`  ${label} ${pct}%  ${asciiBar(c.pct, 8)}`);
    });
  }

  if (m.bestDay) {
    const [, , dd] = m.bestDay.date.split('-');
    lines.push('');
    lines.push(`📅 ขายดีที่สุดวันที่ ${Number(dd)} (${fmtTHB(m.bestDay.revenue)})`);
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
//  MORNING BRIEF — month-to-date + low-stock list.
// ─────────────────────────────────────────────────────────────────────────

export interface MorningBrief {
  date: string;
  mtdRevenue: number;
  mtdDays: number;
  mtdAvg: number;
  lowStock: Array<{ name: string; stock: number }>;
  totalLowStock: number;
}

export async function computeMorningBrief(
  supa: any,
  dateBkk: string,
  threshold: number,
): Promise<MorningBrief> {
  const yyyymm = dateBkk.slice(0, 7);
  const monthStart = `${yyyymm}-01T00:00:00+07:00`;
  const dayBkkEnd = endOfDayBkk(dateBkk);

  // MTD revenue (this month, up to and including yesterday for clean numbers
  // since brief sends in the morning before the day's first sale).
  const yest = (() => {
    const [y, m, d] = dateBkk.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 1);
    return dt.toISOString().slice(0, 10);
  })();
  const mtdEnd = endOfDayBkk(yest);

  const { data: orders } = await supa
    .from('sale_orders')
    .select('channel, grand_total, net_received, sale_date')
    .eq('status', 'active')
    .gte('sale_date', monthStart)
    .lte('sale_date', mtdEnd);
  const ords = (orders || []) as Array<OrderLike & { sale_date: string }>;
  const mtdRevenue = ords.reduce((s, r) => s + revenueOf(r), 0);
  // Distinct days that had at least one order — gives a meaningful "avg/day"
  // even when the shop was closed on some weekdays.
  const days = new Set(ords.map(o => o.sale_date.slice(0, 10)));
  const mtdDays = days.size || 1;
  const mtdAvg = mtdRevenue / mtdDays;

  // Low stock — show top 10 lowest, plus a total-count line.
  const { data: lowAll } = await supa
    .from('products')
    .select('name, current_stock')
    .lte('current_stock', threshold)
    .gt('current_stock', -9999)
    .order('current_stock', { ascending: true })
    .limit(50);
  const lowStock = (lowAll || []).slice(0, 10).map((r: any) => ({
    name: r.name, stock: Number(r.current_stock) || 0,
  }));
  const totalLowStock = (lowAll || []).length;

  return { date: dateBkk, mtdRevenue, mtdDays, mtdAvg, lowStock, totalLowStock };
}

export function formatBrief(b: MorningBrief): string {
  const lines: string[] = [];
  lines.push(`☀️ <b>อรุณสวัสดิ์ · ${fmtThaiDate(b.date)}</b>`);
  lines.push('');
  lines.push('📅 <b>เดือนนี้ถึงเมื่อวาน</b>');
  if (b.mtdRevenue > 0) {
    lines.push(`   ยอดขาย    ${fmtTHB(b.mtdRevenue)}  <i>(${b.mtdDays} วัน)</i>`);
    lines.push(`   เฉลี่ย/วัน  ${fmtTHB(b.mtdAvg)}`);
  } else {
    lines.push('   ยังไม่มีบิลในเดือนนี้');
  }

  if (b.totalLowStock > 0) {
    lines.push('');
    lines.push(`⚠️ <b>สต็อกใกล้หมด</b>  <i>(${b.totalLowStock} รายการ)</i>`);
    b.lowStock.forEach(p => {
      const icon = p.stock <= 0 ? '🔴' : p.stock <= 1 ? '🟠' : '🟡';
      lines.push(`  ${icon} ${truncate(p.name, 28)} — เหลือ ${p.stock}`);
    });
    if (b.totalLowStock > b.lowStock.length) {
      lines.push(`  <i>… และอีก ${b.totalLowStock - b.lowStock.length} รายการ</i>`);
    }
  } else {
    lines.push('');
    lines.push('✅ <b>สต็อก OK</b> — ไม่มีรายการใกล้หมด');
  }

  lines.push('');
  lines.push('💼 ขอให้ขายดีวันนี้ครับ');
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
//  RANGE SUMMARY — used by `/sales 7d`, `/sales 30d`.
// ─────────────────────────────────────────────────────────────────────────

export interface RangeSummary {
  fromDate: string;
  toDate: string;
  days: number;
  revenue: number;
  orderCount: number;
  avgPerDay: number;
  byChannel: Array<{ channel: string; total: number; pct: number }>;
}

export async function computeRangeSummary(supa: any, days: number): Promise<RangeSummary> {
  const toDate = bangkokDate(0);     // today
  const fromDate = bangkokDate(-(days - 1));
  const { data: orders } = await supa
    .from('sale_orders')
    .select('channel, grand_total, net_received')
    .eq('status', 'active')
    .gte('sale_date', startOfDayBkk(fromDate))
    .lte('sale_date', endOfDayBkk(toDate));
  const ords = (orders || []) as OrderLike[];
  const revenue = ords.reduce((s, r) => s + revenueOf(r), 0);

  const channelMap: Record<string, number> = {};
  for (const r of ords) {
    const k = r.channel || 'store';
    channelMap[k] = (channelMap[k] || 0) + revenueOf(r);
  }
  const total = Object.values(channelMap).reduce((s, v) => s + v, 0);
  const byChannel = Object.entries(channelMap)
    .map(([channel, sum]) => ({
      channel, total: sum,
      pct: total > 0 ? sum / total : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    fromDate, toDate, days,
    revenue,
    orderCount: ords.length,
    avgPerDay: revenue / days,
    byChannel,
  };
}

export function formatRange(r: RangeSummary): string {
  const lines: string[] = [];
  lines.push(`📈 <b>สรุปยอด ${r.days} วันล่าสุด</b>`);
  lines.push(`   <i>${fmtThaiDate(r.fromDate, false)} – ${fmtThaiDate(r.toDate, false)}</i>`);
  lines.push('');
  if (r.orderCount === 0) {
    lines.push('🌙 ไม่มีบิลในช่วงนี้');
    return lines.join('\n');
  }
  lines.push(`💰 ยอดขายรวม   <b>${fmtTHB(r.revenue)}</b>`);
  lines.push(`🧾 จำนวนบิล    ${r.orderCount.toLocaleString('th-TH')} บิล`);
  lines.push(`📅 เฉลี่ย/วัน   ${fmtTHB(r.avgPerDay)}`);
  if (r.byChannel.length) {
    lines.push('');
    lines.push('🛒 <b>ช่องทาง</b>');
    r.byChannel.forEach(c => {
      const label = (CHANNEL_LABEL[c.channel] || c.channel).padEnd(8, ' ');
      const pct = (c.pct * 100).toFixed(0).padStart(3, ' ');
      lines.push(`  ${label} ${pct}%  ${asciiBar(c.pct, 8)}`);
    });
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
//  LOW STOCK (standalone, for /lowstock command)
// ─────────────────────────────────────────────────────────────────────────

export async function computeLowStock(supa: any, threshold: number) {
  const { data } = await supa
    .from('products')
    .select('name, current_stock, retail_price')
    .lte('current_stock', threshold)
    .order('current_stock', { ascending: true })
    .limit(50);
  return (data || []) as Array<{ name: string; current_stock: number; retail_price: number }>;
}

export function formatLowStock(items: Array<{ name: string; current_stock: number }>, threshold: number): string {
  const lines: string[] = [];
  lines.push(`📦 <b>สินค้าใกล้หมด</b> <i>(≤ ${threshold})</i>`);
  lines.push('');
  if (items.length === 0) {
    lines.push('✅ ไม่มีรายการใกล้หมด — สต็อก OK ทั้งหมด');
    return lines.join('\n');
  }
  items.slice(0, 30).forEach(p => {
    const icon = p.current_stock <= 0 ? '🔴' : p.current_stock <= 1 ? '🟠' : '🟡';
    lines.push(`${icon} ${truncate(p.name, 32)} — เหลือ ${p.current_stock}`);
  });
  if (items.length > 30) {
    lines.push(`<i>… และอีก ${items.length - 30} รายการ</i>`);
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
//  TELEGRAM API HELPERS
// ─────────────────────────────────────────────────────────────────────────

export interface TelegramSendOptions {
  parseMode?: 'HTML' | 'MarkdownV2';
  replyToMessageId?: number;
  disableNotification?: boolean;
}

/** Plain sendMessage. Throws on non-2xx with the Telegram body in the error. */
export async function sendTelegram(
  token: string,
  chatId: string | number,
  text: string,
  opts: TelegramSendOptions = {},
): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: opts.parseMode ?? 'HTML',
      disable_web_page_preview: true,
      disable_notification: opts.disableNotification ?? false,
      reply_to_message_id: opts.replyToMessageId,
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${body}`);
  try { return JSON.parse(body); } catch { return body; }
}

// ─────────────────────────────────────────────────────────────────────────
//  HELP / WELCOME
// ─────────────────────────────────────────────────────────────────────────

export function formatHelp(chatId: string | number): string {
  return [
    '🤖 <b>TIMES POS Bot</b>',
    '',
    'คำสั่งที่ใช้ได้:',
    '  /today       — สรุปวันนี้',
    '  /yesterday  — สรุปเมื่อวาน',
    '  /month       — สรุปเดือนนี้ (ถึงเมื่อวาน)',
    '  /lastmonth — สรุปเดือนก่อน',
    '  /sales 7   — สรุป 7 วันล่าสุด (เปลี่ยนเลขได้)',
    '  /lowstock — สินค้าใกล้หมด',
    '  /whoami    — แสดง Chat ID ของคุณ',
    '  /help          — เมนูนี้',
    '',
    `<i>Chat ID: <code>${chatId}</code></i>`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
//  UTIL
// ─────────────────────────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
