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
//  COST HELPER — mirrors the frontend ProfitLossView logic so Telegram and
//  the in-app P&L view always agree on the cost of goods sold.
//
//  Why this exists: `sale_order_items` does NOT carry a per-line cost
//  (the schema deliberately keeps inventory cost in receive history). To
//  cost a sale we look up the most-recent `receive_order_items.unit_price`
//  for the product whose `receive_orders.receive_date` is on/before the
//  sale, falling back to `products.cost_price` if no receive history
//  exists. Without this the daily/monthly summary would be 100% revenue
//  and the message preview would crash on a Postgres "column does not
//  exist" because the legacy code referenced `cost_price` directly on
//  sale_order_items.
// ─────────────────────────────────────────────────────────────────────────

interface OrderForCost { id: number | string; sale_date: string }
interface ItemRow { sale_order_id: number; product_id: number | null; product_name: string | null; quantity: number }

export interface OrderItemsCost {
  totalCost: number;
  /** qty aggregated by product_name — used by daily/monthly top-products list. */
  qtyByName: Map<string, number>;
}

export async function computeOrderItemsCost(
  supa: any,
  orders: OrderForCost[],
): Promise<OrderItemsCost> {
  const qtyByName = new Map<string, number>();
  if (!orders.length) return { totalCost: 0, qtyByName };

  const ids = orders.map(o => o.id);
  const orderTsById = new Map<number | string, number>();
  for (const o of orders) orderTsById.set(o.id, new Date(o.sale_date).getTime());

  // 1) sale items in scope — chunked for big months
  const items = await fetchAll<ItemRow>(
    (from, to) => supa.from('sale_order_items')
      .select('sale_order_id, product_id, product_name, quantity')
      .in('sale_order_id', ids).range(from, to),
  );

  // 2) receive history for those products — sorted DESC so we can take the
  //    first row whose receive_date <= saleTs as the cost
  const productIds = Array.from(new Set(
    items.map(it => it.product_id).filter((x): x is number => typeof x === 'number' && x > 0),
  ));
  const recvByProduct = new Map<number, Array<{ ts: number; price: number }>>();
  if (productIds.length) {
    const recvs = await fetchAll<any>(
      (from, to) => supa.from('receive_order_items')
        .select('product_id, unit_price, receive_orders!inner(receive_date)')
        .in('product_id', productIds).range(from, to),
    );
    for (const r of recvs) {
      const date = r.receive_orders?.receive_date;
      if (!date || !r.product_id) continue;
      const arr = recvByProduct.get(r.product_id) || [];
      arr.push({ ts: new Date(date).getTime(), price: Number(r.unit_price) || 0 });
      recvByProduct.set(r.product_id, arr);
    }
    for (const arr of recvByProduct.values()) arr.sort((a, b) => b.ts - a.ts);
  }

  // 3) products.cost_price fallback — used when the product never had a
  //    matching receive (legacy / manually-created products)
  const productCostFallback = new Map<number, number>();
  if (productIds.length) {
    const prods = await fetchAll<{ id: number; cost_price: number | null }>(
      (from, to) => supa.from('products').select('id, cost_price').in('id', productIds).range(from, to),
    );
    for (const p of prods) productCostFallback.set(p.id, Number(p.cost_price) || 0);
  }

  // 4) sum
  let totalCost = 0;
  for (const it of items) {
    const qty = Number(it.quantity) || 0;
    const name = it.product_name || '?';
    qtyByName.set(name, (qtyByName.get(name) || 0) + qty);
    if (!it.product_id) continue;
    const saleTs = orderTsById.get(it.sale_order_id) ?? 0;
    let unitCost = productCostFallback.get(it.product_id) ?? 0;
    const list = recvByProduct.get(it.product_id);
    if (list && list.length) {
      const found = list.find(r => r.ts <= saleTs);
      if (found) unitCost = found.price;
    }
    totalCost += unitCost * qty;
  }
  return { totalCost, qtyByName };
}

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
  byChannel: Array<{ channel: string; total: number; count: number; pct: number }>;
}

export async function computeDailySummary(supa: any, dateBkk: string): Promise<DailySummary> {
  // Today's orders — `sale_date` included so the cost helper can resolve
  // historical receive prices accurately when a product was received
  // multiple times across price changes.
  const { data: orders, error: ordErr } = await supa
    .from('sale_orders')
    .select('id, channel, grand_total, net_received, sale_date')
    .eq('status', 'active')
    .gte('sale_date', startOfDayBkk(dateBkk))
    .lte('sale_date', endOfDayBkk(dateBkk));
  if (ordErr) throw ordErr;
  const ords = (orders || []) as Array<OrderLike & { id: number; sale_date: string }>;
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

  // By-channel breakdown — amount + bill count (user-facing report shows both)
  const channelMap = new Map<string, { total: number; count: number }>();
  for (const r of ords) {
    const k = r.channel || 'store';
    const cur = channelMap.get(k) || { total: 0, count: 0 };
    cur.total += revenueOf(r);
    cur.count += 1;
    channelMap.set(k, cur);
  }

  // Items → cost only (top products dropped from the minimal daily template).
  const { totalCost: cost } = await computeOrderItemsCost(supa, ords);

  // Shop expense — month total ÷ days-in-month gives "per day"
  const shopExpense = await computeAvgShopExpensePerDay(supa, dateBkk);

  const grossProfit = revenue - cost;
  const netProfit = grossProfit - shopExpense;
  const margin = revenue > 0 ? grossProfit / revenue : 0;
  const aov = ords.length ? revenue / ords.length : 0;

  const totalChannelRevenue = Array.from(channelMap.values()).reduce((s, v) => s + v.total, 0);
  const byChannel = Array.from(channelMap.entries())
    .map(([channel, v]) => ({
      channel, total: v.total, count: v.count,
      pct: totalChannelRevenue > 0 ? v.total / totalChannelRevenue : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    date: dateBkk, revenue, cost, grossProfit, shopExpense, netProfit,
    orderCount: ords.length, aov, margin, prevRevenue, byChannel,
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
  lines.push(`📊 <b>${fmtThaiDate(s.date)}</b>`);
  lines.push('');
  if (s.orderCount === 0) {
    lines.push('🌙 วันนี้ไม่มีบิลขาย');
    return lines.join('\n');
  }
  const change = s.prevRevenue > 0 ? (s.revenue - s.prevRevenue) / s.prevRevenue : 0;
  const compare = s.prevRevenue > 0 ? ` <i>${fmtPct(change)}</i>` : '';
  lines.push(`ยอดขาย <b>${fmtTHB(s.revenue)}</b>${compare}`);
  lines.push(`บิล ${s.orderCount} · AOV ${fmtTHB(s.aov)}`);
  lines.push(`กำไรขั้นต้น ${fmtTHB(s.grossProfit)} <i>(${(s.margin * 100).toFixed(1)}%)</i>`);
  if (s.shopExpense > 0) lines.push(`ค่าใช้จ่าย -${fmtTHB(s.shopExpense)}`);
  lines.push(`✨ <b>กำไรสุทธิ ${fmtTHB(s.netProfit)}</b>`);

  if (s.byChannel.length) {
    lines.push('');
    lines.push('🛒 <b>ช่องทาง</b>');
    s.byChannel.forEach(c => {
      const label = CHANNEL_LABEL[c.channel] || c.channel;
      lines.push(`  ${label} — ${fmtTHB(c.total)} · ${c.count} บิล`);
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
  byChannel: Array<{ channel: string; total: number; count: number; pct: number }>;
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
    .select('id, channel, grand_total, net_received, sale_date')
    .eq('status', 'active')
    .gte('sale_date', prevMonthStart)
    .lt('sale_date', monthStart);
  const prevOrds = (prevOrders || []) as Array<OrderLike & { id: number; sale_date: string }>;
  const prevRevenue = prevOrds.reduce((s, r) => s + revenueOf(r), 0);

  // By channel
  const channelMap = new Map<string, { total: number; count: number }>();
  for (const r of ords) {
    const k = r.channel || 'store';
    const cur = channelMap.get(k) || { total: 0, count: 0 };
    cur.total += revenueOf(r);
    cur.count += 1;
    channelMap.set(k, cur);
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

  // Items → cost + top products. Cost is resolved against historical
  // receive prices via the shared helper so the monthly card matches the
  // in-app P&L view.
  const { totalCost: cost, qtyByName: productMap } = await computeOrderItemsCost(supa, ords);
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

  // Prev gross — same cost helper so the MoM compare arrow is honest.
  let prevGross = 0;
  if (prevOrds.length) {
    const { totalCost: prevCost } = await computeOrderItemsCost(supa, prevOrds);
    prevGross = prevRevenue - prevCost;
  }

  const totalChannelRevenue = Array.from(channelMap.values()).reduce((s, v) => s + v.total, 0);
  const byChannel = Array.from(channelMap.entries())
    .map(([channel, v]) => ({
      channel, total: v.total, count: v.count,
      pct: totalChannelRevenue > 0 ? v.total / totalChannelRevenue : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    yyyymm, revenue, cost, grossProfit, shopExpense, netProfit, margin,
    orderCount: ords.length, prevRevenue, prevGross, topProducts, byChannel, bestDay,
  };
}

export function formatMonthly(m: MonthlySummary): string {
  const lines: string[] = [];
  lines.push(`🗓 <b>${fmtThaiMonth(m.yyyymm)}</b>`);
  lines.push('');
  if (m.orderCount === 0) {
    lines.push('🌙 ไม่มีบิลขายในเดือนนี้');
    return lines.join('\n');
  }
  lines.push(`ยอดขาย <b>${fmtTHB(m.revenue)}</b>`);
  lines.push(`บิล ${m.orderCount.toLocaleString('th-TH')}`);
  lines.push(`กำไรขั้นต้น ${fmtTHB(m.grossProfit)} <i>(${(m.margin * 100).toFixed(1)}%)</i>`);
  if (m.shopExpense > 0) lines.push(`ค่าใช้จ่ายร้าน -${fmtTHB(m.shopExpense)}`);
  lines.push(`✨ <b>กำไรสุทธิ ${fmtTHB(m.netProfit)}</b>`);

  if (m.prevRevenue > 0) {
    const revChange = (m.revenue - m.prevRevenue) / m.prevRevenue;
    const grossChange = m.prevGross > 0 ? (m.grossProfit - m.prevGross) / m.prevGross : 0;
    lines.push('');
    lines.push(`📈 เทียบเดือนก่อน · ยอด ${fmtPct(revChange)} · กำไร ${fmtPct(grossChange)}`);
  }

  if (m.topProducts.length) {
    lines.push('');
    lines.push('📦 <b>ขายดี</b>');
    m.topProducts.forEach((p, i) => {
      lines.push(`  ${i + 1}. ${truncate(p.name, 26)} ×${p.qty}`);
    });
  }

  if (m.byChannel.length) {
    lines.push('');
    lines.push('🛒 <b>ช่องทาง</b>');
    m.byChannel.forEach(c => {
      const label = CHANNEL_LABEL[c.channel] || c.channel;
      lines.push(`  ${label} — ${fmtTHB(c.total)} · ${c.count} บิล`);
    });
  }

  if (m.bestDay) {
    const [, mm, dd] = m.bestDay.date.split('-');
    lines.push('');
    lines.push(`📅 ขายดีสุด ${Number(dd)}/${Number(mm)} (${fmtTHB(m.bestDay.revenue)})`);
  }

  return lines.join('\n');
}

// Morning brief was intentionally removed — only Daily and Monthly summaries
// (plus on-demand /sales and /lowstock) remain. The `last_brief_sent_at` and
// `morning_*` columns are still in `shop_secrets` to keep the migration
// history clean, but they are no longer written or read by any code path.

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
  byChannel: Array<{ channel: string; total: number; count: number; pct: number }>;
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

  const channelMap = new Map<string, { total: number; count: number }>();
  for (const r of ords) {
    const k = r.channel || 'store';
    const cur = channelMap.get(k) || { total: 0, count: 0 };
    cur.total += revenueOf(r);
    cur.count += 1;
    channelMap.set(k, cur);
  }
  const total = Array.from(channelMap.values()).reduce((s, v) => s + v.total, 0);
  const byChannel = Array.from(channelMap.entries())
    .map(([channel, v]) => ({
      channel, total: v.total, count: v.count,
      pct: total > 0 ? v.total / total : 0,
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
  lines.push(`📈 <b>${r.days} วันล่าสุด</b>`);
  lines.push(`<i>${fmtThaiDate(r.fromDate, false)} – ${fmtThaiDate(r.toDate, false)}</i>`);
  lines.push('');
  if (r.orderCount === 0) {
    lines.push('🌙 ไม่มีบิลในช่วงนี้');
    return lines.join('\n');
  }
  lines.push(`ยอดขายรวม <b>${fmtTHB(r.revenue)}</b>`);
  lines.push(`บิล ${r.orderCount.toLocaleString('th-TH')} · เฉลี่ย/วัน ${fmtTHB(r.avgPerDay)}`);
  if (r.byChannel.length) {
    lines.push('');
    lines.push('🛒 <b>ช่องทาง</b>');
    r.byChannel.forEach(c => {
      const label = CHANNEL_LABEL[c.channel] || c.channel;
      lines.push(`  ${label} — ${fmtTHB(c.total)} · ${c.count} บิล`);
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
