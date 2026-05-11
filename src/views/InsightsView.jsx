// Advanced analytics dashboard for the shop owner (admin-only).
//
// Panels:
//   - MoM compare card (month-to-date vs previous month same days)
//   - Weekly trend line (13 weeks — revenue / profit / count)
//   - Hour-of-day × day-of-week heatmap
//   - Channel mix stacked area (last 12 months)
//   - Dead stock table (≥60 days since last sale, configurable)
//   - Reorder suggestions (low stock × 30-day velocity × 6-week target)
//   - Top/Bottom movers vs previous equal-length period
//
// All heavy math lives in src/lib/analytics/* and is unit-tested. This
// file is the query orchestrator + presentation layer.

import React, { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, CartesianGrid, Legend,
} from 'recharts';

import { sb } from '../lib/supabase-client.js';
import { fetchAll } from '../lib/sb-paginate.js';
import { fmtTHB, fmtPct, fmtNum } from '../lib/format.js';
import Icon from '../components/ui/Icon.jsx';

import { buildHeatmap, peakCell, WEEKDAY_LABELS_TH } from '../lib/analytics/heatmap.js';
import { velocityByProduct } from '../lib/analytics/velocity.js';
import { reorderSuggestion } from '../lib/analytics/forecast.js';
import { weeklyBuckets, momCompare } from '../lib/analytics/trend.js';
import { deadStockReport } from '../lib/analytics/dead-stock.js';

const ECOMMERCE_CHANNELS = new Set(['tiktok', 'shopee', 'lazada']);
const CHANNEL_LABEL = { store: 'หน้าร้าน', tiktok: 'TikTok', shopee: 'Shopee', lazada: 'Lazada', facebook: 'Facebook' };
const CHANNEL_COLOR = { store: '#111827', tiktok: '#EC4899', shopee: '#F97316', lazada: '#2563EB', facebook: '#4338CA' };
const MS_PER_DAY = 86400000;
const BKK_OFFSET_MIN = 7 * 60;

/** Bangkok-local YYYY-MM-DD from an epoch ms. */
function isoBangkok(ts) {
  return new Date(ts + BKK_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

/** Revenue per order: net_received for e-commerce, grand_total otherwise. */
const revenueOf = (r) =>
  ECOMMERCE_CHANNELS.has(r.channel) && r.net_received != null
    ? Number(r.net_received) || 0
    : Number(r.grand_total) || 0;

/* =========================================================
   Section wrapper
========================================================= */
function Section({ title, subtitle, right, children, className = '' }) {
  return (
    <section className={'card-cream rounded-lg p-4 lg:p-5 ' + className}>
      <header className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-display text-lg lg:text-xl leading-tight">{title}</h3>
          {subtitle && <div className="text-xs text-muted mt-0.5">{subtitle}</div>}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

function DeltaPill({ pct, positiveIsGood = true }) {
  if (pct == null) return <span className="text-muted-soft text-xs">—</span>;
  const isUp = pct >= 0;
  const good = positiveIsGood ? isUp : !isUp;
  const cls = good ? 'text-success bg-success/10' : 'text-error bg-error/10';
  return (
    <span className={'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium tabular-nums ' + cls}>
      <Icon name={isUp ? 'trend-up' : 'trend-up'} size={11} className={isUp ? '' : 'rotate-180'} />
      {fmtPct(pct)}
    </span>
  );
}

/* =========================================================
   MoM compare card
========================================================= */
function MomCard({ data }) {
  if (!data) return <div className="skeleton h-24 rounded" />;
  const { current, previous, pct, aov, margin } = data;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
      <MomStat label="ยอดขาย (MTD)"
        current={fmtTHB(current.revenue)}
        previous={`${fmtTHB(previous.revenue)} เดือนก่อน`}
        pct={pct.revenue} />
      <MomStat label="กำไรเบื้องต้น"
        current={fmtTHB(current.revenue - current.cost)}
        previous={`margin ${(margin.current * 100).toFixed(1)}% · เดิม ${(margin.previous * 100).toFixed(1)}%`}
        pct={pct.profit} />
      <MomStat label="จำนวนบิล"
        current={fmtNum(current.count)}
        previous={`${fmtNum(previous.count)} เดือนก่อน`}
        pct={pct.count} />
      <MomStat label="AOV"
        current={fmtTHB(aov.current)}
        previous={`${fmtTHB(aov.previous)} เดือนก่อน`}
        pct={aov.previous ? ((aov.current - aov.previous) / aov.previous) * 100 : null} />
    </div>
  );
}
function MomStat({ label, current, previous, pct }) {
  return (
    <div className="rounded-md bg-white/60 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className="flex items-baseline gap-2 mt-0.5">
        <div className="font-display text-xl lg:text-2xl tabular-nums">{current}</div>
        <DeltaPill pct={pct} />
      </div>
      <div className="text-[11px] text-muted-soft mt-0.5 truncate">{previous}</div>
    </div>
  );
}

/* =========================================================
   Weekly trend
========================================================= */
function TrendChart({ buckets }) {
  if (!buckets?.length) return <div className="skeleton h-40 rounded" />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={buckets} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid stroke="#00000010" vertical={false} />
        <XAxis dataKey="weekStart" tick={{ fontSize: 10, fill: '#6B7280' }}
          tickFormatter={(d) => d.slice(5)} /* MM-DD */ />
        <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} tickFormatter={(v) => (v / 1000).toFixed(0) + 'k'} />
        <Tooltip
          formatter={(v, k) => (k === 'count' ? fmtNum(v) : fmtTHB(v))}
          labelFormatter={(d) => 'สัปดาห์เริ่ม ' + d} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="revenue" name="ยอดขาย" stroke="#E25C4D" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="profit"  name="กำไรเบื้องต้น" stroke="#0EA5A1" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* =========================================================
   Heatmap
========================================================= */
function Heatmap({ result }) {
  if (!result) return <div className="skeleton h-64 rounded" />;
  const { matrix, maxCell } = result;
  const cellColor = (v) => {
    if (maxCell === 0 || v === 0) return '#F3F4F6';
    const t = v / maxCell;
    // Light → deep coral
    const r = Math.round(253 - 30 * t);
    const g = Math.round(237 - 160 * t);
    const b = Math.round(233 - 153 * t);
    return `rgb(${r},${g},${b})`;
  };
  const peak = peakCell(result);
  return (
    <div>
      <div className="overflow-x-auto -mx-4 lg:mx-0 px-4 lg:px-0">
        <table className="text-[10px] tabular-nums border-collapse min-w-[640px]">
          <thead>
            <tr>
              <th className="text-left pr-2 font-normal text-muted"></th>
              {Array.from({ length: 24 }).map((_, h) => (
                <th key={h} className={'font-normal text-muted px-1 text-center ' + (h % 3 === 0 ? '' : 'opacity-40')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, d) => (
              <tr key={d}>
                <th className="pr-2 text-right font-medium text-muted align-middle">{WEEKDAY_LABELS_TH[d]}</th>
                {row.map((v, h) => (
                  <td key={h}
                    title={`${WEEKDAY_LABELS_TH[d]} ${h}:00 · ${fmtTHB(v)}`}
                    style={{ background: cellColor(v) }}
                    className="w-6 h-6 border border-white"
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {peak && (
        <div className="text-xs text-muted mt-3">
          ช่วงขายดีสุด:&nbsp;
          <span className="font-medium text-ink">
            {WEEKDAY_LABELS_TH[peak.dow]} {String(peak.hour).padStart(2, '0')}:00 · {fmtTHB(peak.revenue)}
          </span>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   Channel mix (12 months)
========================================================= */
function ChannelMix({ data }) {
  if (!data?.length) return <div className="skeleton h-40 rounded" />;
  const channels = Object.keys(data[0]).filter((k) => k !== 'month');
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid stroke="#00000010" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#6B7280' }} />
        <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} tickFormatter={(v) => (v / 1000).toFixed(0) + 'k'} />
        <Tooltip formatter={(v) => fmtTHB(v)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {channels.map((c) => (
          <Area key={c} type="monotone" dataKey={c}
            stackId="1" name={CHANNEL_LABEL[c] || c}
            stroke={CHANNEL_COLOR[c] || '#6B7280'}
            fill={CHANNEL_COLOR[c] || '#6B7280'} fillOpacity={0.6} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* =========================================================
   Top/Bottom movers
========================================================= */
function MoversList({ title, rows, emptyText }) {
  return (
    <div>
      <div className="text-sm font-medium mb-2">{title}</div>
      {(!rows || !rows.length) ? (
        <div className="text-xs text-muted-soft py-4 text-center">{emptyText}</div>
      ) : (
        <ul className="space-y-1.5">
          {rows.slice(0, 6).map((r) => (
            <li key={r.name} className="flex items-center justify-between gap-2 bg-white/50 rounded px-2.5 py-1.5">
              <span className="text-sm truncate" title={r.name}>{r.name}</span>
              <span className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs text-muted tabular-nums">{fmtNum(r.current)} ตัว</span>
                <DeltaPill pct={r.pct} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* =========================================================
   Dead stock + Reorder tables
========================================================= */
function DeadStockTable({ rows, threshold, onChangeThreshold, onExport }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          {[60, 90, 180].map((d) => (
            <button key={d} type="button" onClick={() => onChangeThreshold(d)}
              className={'px-2.5 py-1 rounded-md text-xs font-medium border transition-all ' +
                (threshold === d
                  ? 'bg-primary text-on-primary border-primary shadow-sm'
                  : 'bg-white/70 text-ink border-hairline hover:border-muted hover:bg-white')}>
              ≥ {d} วัน
            </button>
          ))}
        </div>
        <button type="button" onClick={onExport}
          className="btn-secondary !py-1 !px-3 !text-xs">
          <Icon name="file" size={14} className="mr-1" /> Export CSV
        </button>
      </div>
      {rows === null ? <div className="skeleton h-20 rounded" /> :
       rows.length === 0 ? (
         <div className="text-sm text-muted py-6 text-center">ไม่มีสินค้าที่ค้างเกินเกณฑ์ 🎉</div>
       ) : (
        <div className="overflow-x-auto -mx-4 lg:mx-0">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="text-[11px] uppercase tracking-wider text-muted">
              <tr className="border-b hairline">
                <th className="text-left px-3 py-2">สินค้า</th>
                <th className="text-right px-3 py-2">สต็อก</th>
                <th className="text-right px-3 py-2">ไม่ขายมา</th>
                <th className="text-right px-3 py-2">มูลค่าจม</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 30).map((r) => (
                <tr key={r.id} className="border-b hairline last:border-0">
                  <td className="px-3 py-2 truncate max-w-[220px]" title={r.name}>{r.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.current_stock)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">
                    {r.days_since_sold === Infinity ? 'ไม่เคยขาย' : `${r.days_since_sold} วัน`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtTHB(r.locked_value)}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 30 && (
              <tfoot>
                <tr><td colSpan={4} className="text-[11px] text-muted-soft text-center py-2">
                  แสดง 30 จาก {rows.length} รายการ · export CSV ดูทั้งหมด
                </td></tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

function ReorderTable({ rows, onExport }) {
  return (
    <div>
      <div className="flex items-center justify-end mb-3">
        <button type="button" onClick={onExport} className="btn-secondary !py-1 !px-3 !text-xs">
          <Icon name="file" size={14} className="mr-1" /> Export CSV
        </button>
      </div>
      {rows === null ? <div className="skeleton h-20 rounded" /> :
       rows.length === 0 ? (
        <div className="text-sm text-muted py-6 text-center">ยังไม่มีสินค้าใกล้หมดที่ควรสั่งเพิ่ม</div>
       ) : (
        <div className="overflow-x-auto -mx-4 lg:mx-0">
          <table className="w-full text-sm min-w-[620px]">
            <thead className="text-[11px] uppercase tracking-wider text-muted">
              <tr className="border-b hairline">
                <th className="text-left px-3 py-2">สินค้า</th>
                <th className="text-right px-3 py-2">สต็อก</th>
                <th className="text-right px-3 py-2">ขาย/วัน</th>
                <th className="text-right px-3 py-2">พอ ~</th>
                <th className="text-right px-3 py-2">แนะนำสั่ง</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 30).map((r) => (
                <tr key={r.id} className="border-b hairline last:border-0">
                  <td className="px-3 py-2 truncate max-w-[240px]" title={r.name}>{r.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.current_stock)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.avgPerDay.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted">
                    {Number.isFinite(r.daysOfStockLeft) ? `${Math.floor(r.daysOfStockLeft)} วัน` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-primary">
                    +{fmtNum(r.suggestedReorder)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   CSV helper
========================================================= */
function downloadCsv(filename, rows) {
  if (!rows?.length) return;
  const cols = Object.keys(rows[0]);
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => escape(r[c])).join(','))].join('\n');
  // UTF-8 BOM so Excel opens Thai correctly.
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* =========================================================
   Main view
========================================================= */
export default function InsightsView({ embedded = false } = {}) {
  const [loading, setLoading] = useState(true);
  const [mom, setMom] = useState(null);
  const [weeklyTrend, setWeeklyTrend] = useState([]);
  const [heatmap, setHeatmap] = useState(null);
  const [channelMix, setChannelMix] = useState([]);
  const [deadStock, setDeadStock] = useState(null);
  const [reorder, setReorder] = useState(null);
  const [topMovers, setTopMovers] = useState([]);
  const [bottomMovers, setBottomMovers] = useState([]);
  const [deadStockThreshold, setDeadStockThreshold] = useState(60);

  // Re-run loader when threshold changes (client-side filter only — we
  // always fetch the full 365-day sale window and filter in-memory).
  const [allSalesForAnalytics, setAllSalesForAnalytics] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const now = Date.now();
      const start365 = now - 365 * MS_PER_DAY;

      // --- Orders (365 days) — revenue & channel & date ---
      const { data: orders } = await fetchAll((fromIdx, toIdx) =>
        sb.from('sale_orders')
          .select('id, sale_date, grand_total, channel, net_received')
          .eq('status', 'active')
          .gte('sale_date', new Date(start365).toISOString())
          .order('sale_date', { ascending: true })
          .range(fromIdx, toIdx)
      );
      const rows = (orders || []).map((o) => ({ ...o, _revenue: revenueOf(o) }));

      // --- Line items (last 90 days) — cost, velocity, top/bottom ---
      const start90 = now - 90 * MS_PER_DAY;
      const recentOrderIds = rows.filter((o) => new Date(o.sale_date).getTime() >= start90).map((o) => o.id);
      let items = [];
      if (recentOrderIds.length) {
        const { data } = await fetchAll((fromIdx, toIdx) =>
          sb.from('sale_order_items')
            .select('sale_order_id, product_id, product_name, quantity, unit_price, cost_price')
            .in('sale_order_id', recentOrderIds)
            .range(fromIdx, toIdx)
        );
        items = data || [];
      }

      // --- Products (all) for dead-stock + reorder ---
      const { data: products } = await fetchAll((fromIdx, toIdx) =>
        sb.from('products').select('id, name, current_stock, cost_price').range(fromIdx, toIdx)
      );

      if (cancelled) return;

      // === Weekly trend (13 weeks) ===
      // cost comes from joined items; order revenue carries its own cost sum.
      const itemsByOrder = new Map();
      for (const it of items) {
        const list = itemsByOrder.get(it.sale_order_id) || [];
        list.push(it);
        itemsByOrder.set(it.sale_order_id, list);
      }
      const tradeRows = rows.map((o) => {
        const cost = (itemsByOrder.get(o.id) || []).reduce(
          (s, it) => s + (Number(it.cost_price) || 0) * (Number(it.quantity) || 0), 0);
        return { sale_date: o.sale_date, revenue: o._revenue, cost };
      });
      setWeeklyTrend(weeklyBuckets(tradeRows, { weeks: 13, now }));

      // === Heatmap (90 days — enough signal, keeps grid bright) ===
      setHeatmap(buildHeatmap(tradeRows.filter((r) => new Date(r.sale_date).getTime() >= start90)));

      // === MoM compare (current month vs previous full month) ===
      const today = new Date();
      const bkkToday = new Date(today.getTime() + BKK_OFFSET_MIN * 60000);
      const yr = bkkToday.getUTCFullYear();
      const mo = bkkToday.getUTCMonth();
      const curMonthStart = Date.UTC(yr, mo, 1) - BKK_OFFSET_MIN * 60000;
      const nextMonthStart = Date.UTC(yr, mo + 1, 1) - BKK_OFFSET_MIN * 60000;
      const prevMonthStart = Date.UTC(yr, mo - 1, 1) - BKK_OFFSET_MIN * 60000;
      const daysIntoMonth = Math.max(1, Math.ceil((now - curMonthStart) / MS_PER_DAY));
      // Previous-month-to-same-day-N comparison keeps apples-to-apples.
      const prevMonthCutoff = prevMonthStart + daysIntoMonth * MS_PER_DAY;

      const agg = (filter) => {
        const r = tradeRows.filter(filter);
        return {
          revenue: r.reduce((s, x) => s + x.revenue, 0),
          cost:    r.reduce((s, x) => s + x.cost, 0),
          count:   r.length,
        };
      };
      const cur = agg((r) => {
        const t = new Date(r.sale_date).getTime();
        return t >= curMonthStart && t < nextMonthStart;
      });
      const prev = agg((r) => {
        const t = new Date(r.sale_date).getTime();
        return t >= prevMonthStart && t < prevMonthCutoff;
      });
      setMom(momCompare(cur, prev));

      // === Channel mix (12 months) ===
      const start12 = now - 365 * MS_PER_DAY;
      const channels = ['store', 'tiktok', 'shopee', 'lazada', 'facebook'];
      const monthly = new Map();
      for (const o of rows) {
        const t = new Date(o.sale_date).getTime();
        if (t < start12) continue;
        const d = new Date(t + BKK_OFFSET_MIN * 60000);
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        let entry = monthly.get(key);
        if (!entry) {
          entry = { month: key };
          channels.forEach((c) => (entry[c] = 0));
          monthly.set(key, entry);
        }
        entry[o.channel || 'store'] = (entry[o.channel || 'store'] || 0) + o._revenue;
      }
      const mixArr = Array.from(monthly.values()).sort((a, b) => a.month.localeCompare(b.month));
      setChannelMix(mixArr);

      // === Velocity + reorder ===
      const recentItems = items.filter((it) => {
        const order = rows.find((o) => o.id === it.sale_order_id);
        return order && new Date(order.sale_date).getTime() >= now - 30 * MS_PER_DAY;
      }).map((it) => ({
        product_id: it.product_id,
        quantity: it.quantity,
        sale_date: rows.find((o) => o.id === it.sale_order_id)?.sale_date,
      }));
      const velocity = velocityByProduct(recentItems, { now, windowDays: 30 });
      const reorderRows = (products || [])
        .filter((p) => Number(p.current_stock) <= 3)
        .map((p) => {
          const v = velocity.get(p.id);
          const sug = reorderSuggestion({
            avgPerDay: v?.avgPerDay || 0,
            currentStock: p.current_stock,
            targetWeeks: 6,
          });
          return {
            id: p.id, name: p.name, current_stock: p.current_stock,
            avgPerDay: sug.avgPerDay,
            daysOfStockLeft: sug.daysOfStockLeft,
            suggestedReorder: sug.suggestedReorder,
            targetStock: sug.targetStock,
          };
        })
        .filter((r) => r.suggestedReorder > 0)
        .sort((a, b) => b.suggestedReorder - a.suggestedReorder);
      setReorder(reorderRows);

      // === Dead stock ===
      const lastSoldMap = new Map();
      // We need lastSold across the WHOLE 365-day window, not just 90.
      // sale_order_items doesn't carry date directly, so join via orders.
      // Fetching a 365-day items payload is expensive → instead do a cheap
      // group-by via RPC-less trick: walk sale_order_items for the last
      // 365 days in a second pass.
      const allOrderIdsByDate = new Map(rows.map((o) => [o.id, o.sale_date]));
      const { data: itemsForDead } = await fetchAll((fromIdx, toIdx) =>
        sb.from('sale_order_items')
          .select('sale_order_id, product_id')
          .in('sale_order_id', Array.from(allOrderIdsByDate.keys()).slice(0, 100000))
          .range(fromIdx, toIdx)
      );
      for (const it of itemsForDead || []) {
        const d = allOrderIdsByDate.get(it.sale_order_id);
        if (!d) continue;
        const prevDate = lastSoldMap.get(it.product_id);
        if (!prevDate || new Date(d) > new Date(prevDate)) lastSoldMap.set(it.product_id, d);
      }
      setAllSalesForAnalytics({ products: products || [], lastSoldMap });

      // === Top/Bottom movers (current 30d vs previous 30d) ===
      const start30 = now - 30 * MS_PER_DAY;
      const start60 = now - 60 * MS_PER_DAY;
      const curItems = items.filter((it) => {
        const d = allOrderIdsByDate.get(it.sale_order_id);
        return d && new Date(d).getTime() >= start30;
      });
      const prevItems = items.filter((it) => {
        const d = allOrderIdsByDate.get(it.sale_order_id);
        if (!d) return false;
        const t = new Date(d).getTime();
        return t >= start60 && t < start30;
      });
      const tally = (list) => {
        const m = new Map();
        for (const it of list) {
          const k = it.product_name || `#${it.product_id}`;
          m.set(k, (m.get(k) || 0) + (Number(it.quantity) || 0));
        }
        return m;
      };
      const curMap = tally(curItems);
      const prevMap = tally(prevItems);
      const names = new Set([...curMap.keys(), ...prevMap.keys()]);
      const movers = [];
      for (const n of names) {
        const cQ = curMap.get(n) || 0;
        const pQ = prevMap.get(n) || 0;
        if (cQ + pQ < 3) continue; // noise filter
        movers.push({
          name: n,
          current: cQ,
          previous: pQ,
          delta: cQ - pQ,
          pct: pQ === 0 ? null : ((cQ - pQ) / pQ) * 100,
        });
      }
      setTopMovers([...movers].sort((a, b) => b.delta - a.delta).filter((m) => m.delta > 0));
      setBottomMovers([...movers].sort((a, b) => a.delta - b.delta).filter((m) => m.delta < 0));

      setLoading(false);
    })().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('InsightsView load failed:', err);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Re-filter dead stock whenever threshold changes (no refetch).
  useEffect(() => {
    if (!allSalesForAnalytics) { setDeadStock(null); return; }
    const r = deadStockReport(
      allSalesForAnalytics.products,
      allSalesForAnalytics.lastSoldMap,
      { thresholdDays: deadStockThreshold }
    );
    setDeadStock(r);
  }, [allSalesForAnalytics, deadStockThreshold]);

  const peak = useMemo(() => heatmap ? peakCell(heatmap) : null, [heatmap]);

  return (
    <div className={(embedded ? 'pt-2 pb-8 lg:pb-12 ' : 'py-4 pb-8 lg:py-6 lg:pb-12 ') + 'px-4 lg:px-10 space-y-4 lg:space-y-5'}>
      {!embedded && (
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display text-2xl lg:text-3xl leading-tight">Insights</h2>
            <div className="text-xs lg:text-sm text-muted mt-1">
              วิเคราะห์ย้อนหลัง 365 วัน · อัปเดตตามเวลาจริง
            </div>
          </div>
          {loading && (
            <span className="text-xs text-muted flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-full bg-primary/50 animate-pulse" />
              กำลังโหลด…
            </span>
          )}
        </header>
      )}
      {embedded && loading && (
        <div className="text-xs text-muted flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full bg-primary/50 animate-pulse" />
          กำลังโหลดข้อมูลย้อนหลัง 365 วัน…
        </div>
      )}

      {/* MoM card */}
      <Section title="เดือนนี้ เทียบกับเดือนก่อน"
        subtitle="MTD = ตั้งแต่วันที่ 1 ถึงวันนี้ · เทียบกับวันเดียวกันของเดือนก่อน">
        <MomCard data={mom} />
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-5">
        <Section title="แนวโน้มรายสัปดาห์" subtitle="13 สัปดาห์ล่าสุด">
          <TrendChart buckets={weeklyTrend} />
        </Section>
        <Section title="ชั่วโมง × วันที่ขายดี" subtitle="90 วันล่าสุด (เวลากรุงเทพ)">
          <Heatmap result={heatmap} />
        </Section>
      </div>

      <Section title="สัดส่วนช่องทางการขาย" subtitle="12 เดือนล่าสุด">
        <ChannelMix data={channelMix} />
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-5">
        <Section title="รุ่นมาแรง" subtitle="30 วันล่าสุด vs 30 วันก่อนหน้า">
          <MoversList title="" rows={topMovers} emptyText="ยังไม่พอจะตัดสินใจ (ต้องขาย ≥ 3 ตัว)" />
        </Section>
        <Section title="รุ่นแผ่ว" subtitle="เคยขายดี แต่เดือนนี้ตกลง">
          <MoversList title="" rows={bottomMovers} emptyText="ไม่มีรุ่นที่ตกลงชัดเจน" />
        </Section>
      </div>

      <Section title="สินค้าค้างสต็อก (Dead Stock)"
        subtitle={`ยังมีของ แต่ไม่ขายมา ≥ ${deadStockThreshold} วัน · sort ตามมูลค่าจม`}>
        <DeadStockTable
          rows={deadStock}
          threshold={deadStockThreshold}
          onChangeThreshold={setDeadStockThreshold}
          onExport={() => downloadCsv(`dead-stock-${deadStockThreshold}d.csv`, (deadStock || []).map((r) => ({
            id: r.id,
            name: r.name,
            current_stock: r.current_stock,
            cost_price: r.cost_price,
            last_sold_at: r.last_sold_at || 'never',
            days_since_sold: r.days_since_sold === Infinity ? 'never' : r.days_since_sold,
            locked_value: r.locked_value,
          })))}
        />
      </Section>

      <Section title="แนะนำสั่งเพิ่ม"
        subtitle="สต็อก ≤ 3 · ใช้ velocity 30 วันล่าสุด · คุม 6 สัปดาห์ (+15% buffer สำหรับรุ่นขายดี)">
        <ReorderTable
          rows={reorder}
          onExport={() => downloadCsv('reorder-suggestions.csv', (reorder || []).map((r) => ({
            id: r.id,
            name: r.name,
            current_stock: r.current_stock,
            avg_per_day: r.avgPerDay.toFixed(2),
            target_stock: r.targetStock,
            suggested_reorder: r.suggestedReorder,
          })))}
        />
      </Section>
    </div>
  );
}
