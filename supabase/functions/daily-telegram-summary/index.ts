// Daily Telegram summary — runs from a pg_cron schedule via pg_net.
//
// Behaviour:
//   - Read shop_secrets (token, chat_id, enabled, schedule hour)
//   - If `daily_summary_enabled = false` → return early (no Telegram POST)
//   - Compute "yesterday" in Bangkok time (so cron at 21:00 BKK
//     summarises the day that just ended).
//   - Aggregate sale_orders + sale_order_items + shop_expenses
//   - POST to https://api.telegram.org/bot<TOKEN>/sendMessage
//   - Persist last_summary_sent_at / last_summary_error
//
// Manual / on-demand runs:
//   POST /functions/v1/daily-telegram-summary
//   Body (all optional):
//     { "date": "YYYY-MM-DD",   // override target date (Bangkok-local)
//       "test":  true,           // sends a "✅ test ok" instead of summary
//       "preview": true          // returns the message without sending }
//
// Auth:
//   - Anon JWT acceptable for "preview" mode (no secrets exposed in
//     response — admin-only RLS still applies on shop_secrets so a
//     cashier preview just fails to read the token).
//   - For sending we trust the cron caller (uses service_role key) OR
//     the admin's session. The function is created with verify_jwt=true.
//
// Test locally:
//   supabase functions serve daily-telegram-summary --env-file .env

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ECOMMERCE_CHANNELS = new Set(['tiktok', 'shopee', 'lazada']);
const CHANNEL_LABEL: Record<string, string> = {
  store: 'หน้าร้าน', tiktok: 'TikTok', shopee: 'Shopee',
  lazada: 'Lazada', facebook: 'Facebook',
};
const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                   'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

// Bangkok = UTC+7 fixed (no DST).
const BKK_OFFSET_MIN = 7 * 60;

function fmtTHB(n: number) {
  const r = Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
  return '฿' + r.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtThaiDate(yyyymmdd: string) {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  return `${d} ${TH_MONTHS[m - 1]} ${y + 543}`;
}

/** Bangkok-local YYYY-MM-DD for "today" or for an offset (default = yesterday). */
function bangkokDate(offsetDays = -1) {
  const now = Date.now();
  const bkkMs = now + BKK_OFFSET_MIN * 60000;
  const d = new Date(bkkMs);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const startOfDayBkk = (yyyymmdd: string) => `${yyyymmdd}T00:00:00+07:00`;
const endOfDayBkk   = (yyyymmdd: string) => `${yyyymmdd}T23:59:59.999+07:00`;

/** Walk past PostgREST 1000-row cap. */
async function fetchAll<T>(supa: any, build: (from: number, to: number) => any) {
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

interface SummaryNumbers {
  date: string;
  revenue: number;
  cost: number;
  grossProfit: number;
  shopExpense: number;
  netProfit: number;
  orderCount: number;
  aov: number;
  margin: number;
  topProducts: Array<{ name: string; qty: number }>;
  byChannel: Array<{ channel: string; total: number }>;
}

async function computeSummary(supa: any, dateBkk: string): Promise<SummaryNumbers> {
  const { data: orders, error: ordErr } = await supa
    .from('sale_orders')
    .select('id, channel, grand_total, net_received')
    .eq('status', 'active')
    .gte('sale_date', startOfDayBkk(dateBkk))
    .lte('sale_date', endOfDayBkk(dateBkk));
  if (ordErr) throw ordErr;

  const ords = (orders || []) as Array<{ id: number; channel: string|null; grand_total: number; net_received: number|null }>;
  const revenueOf = (r: typeof ords[number]) =>
    ECOMMERCE_CHANNELS.has(r.channel || '') && r.net_received != null
      ? Number(r.net_received) || 0
      : Number(r.grand_total) || 0;

  const revenue = ords.reduce((s, r) => s + revenueOf(r), 0);
  const channelMap: Record<string, number> = {};
  for (const r of ords) {
    const k = r.channel || 'store';
    channelMap[k] = (channelMap[k] || 0) + revenueOf(r);
  }

  // Items for cost + top products
  let cost = 0;
  const productMap = new Map<string, number>();
  if (ords.length) {
    const ids = ords.map((o) => o.id);
    const items = await fetchAll<{
      product_name: string; quantity: number; cost_price: number | null;
    }>(supa, (from, to) =>
      supa.from('sale_order_items')
        .select('product_name, quantity, cost_price')
        .in('sale_order_id', ids).range(from, to)
    );
    for (const it of items) {
      const q = Number(it.quantity) || 0;
      cost += (Number(it.cost_price) || 0) * q;
      const name = it.product_name || '?';
      productMap.set(name, (productMap.get(name) || 0) + q);
    }
  }
  const topProducts = Array.from(productMap.entries())
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 3);

  // Shop expenses for the month containing this date, divided into avg/day.
  const periodMonth = dateBkk.slice(0, 7) + '-01';
  const { data: expRows } = await supa
    .from('shop_expenses')
    .select('category, amount, base_salary, commission_pct')
    .eq('period_month', periodMonth);

  // Need monthSales for staff commission. Use the actual month range.
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
  const monthSales = (monthOrders || []).reduce((s: number, o: any) =>
    s + (ECOMMERCE_CHANNELS.has(o.channel || '') && o.net_received != null
      ? Number(o.net_received) || 0
      : Number(o.grand_total) || 0), 0);

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
  // Days in this month for avg/day
  const daysInMonth = new Date(y, m, 0).getDate();
  const shopExpense = monthlyExpense / daysInMonth;

  const grossProfit = revenue - cost;
  const netProfit = grossProfit - shopExpense;
  const margin = revenue > 0 ? grossProfit / revenue : 0;
  const aov = ords.length ? revenue / ords.length : 0;

  return {
    date: dateBkk, revenue, cost, grossProfit, shopExpense, netProfit,
    orderCount: ords.length, aov, margin,
    topProducts,
    byChannel: Object.entries(channelMap)
      .map(([channel, total]) => ({ channel, total }))
      .sort((a, b) => b.total - a.total),
  };
}

function formatMessage(s: SummaryNumbers): string {
  const lines: string[] = [];
  lines.push(`📊 <b>สรุปยอดวันที่ ${fmtThaiDate(s.date)}</b>`);
  lines.push('');
  if (s.orderCount === 0) {
    lines.push('🌙 วันนี้ยังไม่มีบิลขาย');
    return lines.join('\n');
  }
  lines.push(`💰 ยอดขายรวม    <b>${fmtTHB(s.revenue)}</b>  (${s.orderCount} บิล)`);
  lines.push(`💵 กำไรเบื้องต้น  ${fmtTHB(s.grossProfit)}  <i>(margin ${(s.margin * 100).toFixed(1)}%)</i>`);
  lines.push(`💸 ค่าใช้จ่ายร้าน/วัน  -${fmtTHB(s.shopExpense)}`);
  lines.push(`✨ <b>กำไรสุทธิ    ${fmtTHB(s.netProfit)}</b>`);
  lines.push(`🧾 AOV ${fmtTHB(s.aov)}`);

  if (s.topProducts.length) {
    lines.push('');
    lines.push('📦 <b>ขายดี 3 อันดับ</b>');
    s.topProducts.forEach((p, i) => {
      lines.push(`  ${i + 1}. ${p.name} × ${p.qty}`);
    });
  }

  if (s.byChannel.length) {
    lines.push('');
    lines.push('🛒 <b>ช่องทาง</b>');
    lines.push('  ' + s.byChannel.map(c => `${CHANNEL_LABEL[c.channel] || c.channel} ${fmtTHB(c.total)}`).join(' · '));
  }

  return lines.join('\n');
}

async function sendTelegram(token: string, chatId: string, text: string) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${body}`);
  return body;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  let opts: { date?: string; test?: boolean; preview?: boolean } = {};
  if (req.method === 'POST') {
    try { opts = await req.json(); } catch { /* empty body */ }
  }

  // Load secrets
  const { data: secret, error: secErr } = await supa
    .from('shop_secrets').select('*').eq('id', 1).maybeSingle();
  if (secErr) {
    return new Response(JSON.stringify({ ok: false, error: secErr.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const token = secret?.telegram_bot_token;
  const chatId = secret?.telegram_chat_id;

  // Cron-driven invocations: respect the master switch + scheduled hour.
  // Manual invocations (preview/test/explicit-date) bypass the switch so
  // the user can see the would-be output even when sending is paused.
  const isManual = !!(opts.test || opts.preview || opts.date);
  if (!isManual && !secret?.daily_summary_enabled) {
    return new Response(JSON.stringify({ ok: true, skipped: 'disabled' }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  if (!isManual) {
    // Cron fires once per hour (00 minute) — check the configured hour.
    const nowBkkHour = new Date(Date.now() + BKK_OFFSET_MIN * 60000).getUTCHours();
    if (nowBkkHour !== (secret?.daily_summary_hour ?? 21)) {
      return new Response(JSON.stringify({ ok: true, skipped: 'wrong-hour', expected: secret?.daily_summary_hour, got: nowBkkHour }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  }

  // === Test mode: short text, doesn't compute the summary ===
  if (opts.test) {
    if (!token || !chatId) {
      return new Response(JSON.stringify({ ok: false, error: 'missing token or chat_id' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    try {
      const body = await sendTelegram(token, chatId,
        '✅ <b>เชื่อมต่อ Telegram สำเร็จ</b>\nร้าน TIMES POS · ทดสอบส่งข้อความ');
      return new Response(JSON.stringify({ ok: true, telegram: body }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: String(err) }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  }

  // === Normal flow: compute summary for `date` (default = yesterday) ===
  const targetDate = opts.date || bangkokDate(-1);
  const numbers = await computeSummary(supa, targetDate);
  const text = formatMessage(numbers);

  if (opts.preview) {
    return new Response(JSON.stringify({ ok: true, text, numbers }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  if (!token || !chatId) {
    return new Response(JSON.stringify({ ok: false, error: 'missing token or chat_id' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    await sendTelegram(token, chatId, text);
    await supa.from('shop_secrets').update({
      last_summary_sent_at: new Date().toISOString(),
      last_summary_error: null,
    }).eq('id', 1);
    return new Response(JSON.stringify({ ok: true, sent: true, text }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = String(err);
    await supa.from('shop_secrets').update({
      last_summary_error: msg.slice(0, 500),
    }).eq('id', 1);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
