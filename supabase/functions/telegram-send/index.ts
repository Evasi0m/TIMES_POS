// Telegram outbound function — replaces the legacy `daily-telegram-summary`.
//
// Handles every direction-out scenario:
//   - Hourly cron tick (body `{"kind":"cron"}`) — checks BKK hour against
//     each enabled notification's schedule and dispatches if due.
//   - Manual preview         — `{"action":"preview","kind":"daily|monthly|brief","date?":"YYYY-MM-DD"}`
//   - Manual one-off send    — `{"action":"send",   "kind":"daily|monthly|brief","date?":"YYYY-MM-DD"}`
//   - Test ping              — `{"action":"test"}`
//   - Range query            — `{"action":"preview","kind":"range","days":7}`
//   - Webhook install/teardown — `{"action":"install_webhook"}` / `{"action":"delete_webhook"}` /
//                                 `{"action":"webhook_status"}`
//
// Auth: `verify_jwt = true`. Cron passes the service-role JWT (configured
// via Vault in migration 008/013); the admin's session token works for the
// manual UI flows.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  bangkokDate,
  bangkokDayOfMonth,
  bangkokHour,
  computeDailySummary,
  computeMonthlySummary,
  computeRangeSummary,
  formatDaily,
  formatMonthly,
  formatRange,
  sendTelegram,
} from '../_shared/telegram-format.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface ReqBody {
  action?: 'send' | 'preview' | 'test' | 'install_webhook' | 'delete_webhook' | 'webhook_status';
  kind?: 'daily' | 'monthly' | 'range' | 'cron';
  date?: string;          // YYYY-MM-DD, target day for daily
  yyyymm?: string;        // YYYY-MM,    target month for monthly
  days?: number;          // for kind=range
  // Backward compat with the legacy function:
  test?: boolean;
  preview?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
//  RESPONSE HELPER
// ─────────────────────────────────────────────────────────────────────────

const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

// ─────────────────────────────────────────────────────────────────────────
//  WEBHOOK INSTALL — sets up Telegram → telegram-webhook function
// ─────────────────────────────────────────────────────────────────────────

async function installWebhook(supa: any, token: string): Promise<any> {
  // Ensure we have a webhook_secret (migration seeds it; this is just
  // belt-and-suspenders for accounts created before migration 012).
  const { data: row } = await supa.from('shop_secrets')
    .select('webhook_secret').eq('id', 1).maybeSingle();
  let secret: string = row?.webhook_secret;
  if (!secret) {
    secret = crypto.getRandomValues(new Uint8Array(32))
      .reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
    await supa.from('shop_secrets').update({ webhook_secret: secret }).eq('id', 1);
  }

  const webhookUrl = `${SUPABASE_URL}/functions/v1/telegram-webhook`;
  const setRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      // Allow only message + edited_message (we don't need callback_query yet).
      allowed_updates: ['message', 'edited_message'],
      drop_pending_updates: true,
    }),
  });
  const setBody = await setRes.json();

  // Set the bot's command list (shows up in the / menu in clients).
  const cmdRes = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commands: [
        { command: 'today', description: 'สรุปวันนี้' },
        { command: 'yesterday', description: 'สรุปเมื่อวาน' },
        { command: 'month', description: 'สรุปเดือนนี้' },
        { command: 'lastmonth', description: 'สรุปเดือนก่อน' },
        { command: 'sales', description: 'สรุปยอด N วัน — เช่น /sales 7' },
        { command: 'lowstock', description: 'สินค้าใกล้หมด' },
        { command: 'whoami', description: 'แสดง Chat ID' },
        { command: 'help', description: 'รายการคำสั่งทั้งหมด' },
      ],
    }),
  });
  const cmdBody = await cmdRes.json();

  return { ok: setBody.ok && cmdBody.ok, setWebhook: setBody, setMyCommands: cmdBody };
}

async function deleteWebhook(token: string): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ drop_pending_updates: true }),
  });
  return res.json();
}

async function getWebhookInfo(token: string): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────
//  KIND DISPATCH — builds + (optionally) sends one summary type.
// ─────────────────────────────────────────────────────────────────────────

async function buildMessage(
  supa: any,
  kind: 'daily' | 'monthly' | 'range',
  opts: { date?: string; yyyymm?: string; days?: number },
): Promise<string> {
  switch (kind) {
    case 'daily': {
      const date = opts.date || bangkokDate(-1);
      return formatDaily(await computeDailySummary(supa, date));
    }
    case 'monthly': {
      // Default = the month BEFORE today. So a manual "send monthly" on
      // May 5 sends April's report, matching the cron behaviour on the 1st.
      let yyyymm = opts.yyyymm;
      if (!yyyymm) {
        const today = bangkokDate(0);
        const [y, m] = today.split('-').map(Number);
        const py = m === 1 ? y - 1 : y;
        const pm = m === 1 ? 12 : m - 1;
        yyyymm = `${py}-${String(pm).padStart(2, '0')}`;
      }
      return formatMonthly(await computeMonthlySummary(supa, yyyymm));
    }
    case 'range': {
      const days = Math.max(1, Math.min(365, Number(opts.days) || 7));
      return formatRange(await computeRangeSummary(supa, days));
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  CRON DISPATCH — checks each enabled notification and sends if due.
// ─────────────────────────────────────────────────────────────────────────

async function dispatchCron(supa: any, secret: any) {
  const hour = bangkokHour();
  const today = bangkokDate(0);
  const dom = bangkokDayOfMonth();
  const sent: string[] = [];

  const token = secret.telegram_bot_token;
  const chatId = secret.telegram_chat_id;
  if (!token || !chatId) return { skipped: 'no-token-or-chat' };

  // Daily summary — every day at daily_hour, summarises yesterday.
  if (secret.daily_enabled && hour === secret.daily_hour) {
    const lastSent = secret.last_summary_sent_at?.slice(0, 10);
    if (lastSent !== today) {
      try {
        const text = await buildMessage(supa, 'daily', {});
        await sendTelegram(token, chatId, text);
        await supa.from('shop_secrets').update({
          last_summary_sent_at: new Date().toISOString(),
          last_summary_error: null,
        }).eq('id', 1);
        sent.push('daily');
      } catch (err) {
        await supa.from('shop_secrets').update({
          last_summary_error: String(err).slice(0, 500),
        }).eq('id', 1);
      }
    }
  }

  // Monthly summary — only on the 1st, at monthly_hour, sends previous month.
  if (secret.monthly_enabled && dom === 1 && hour === secret.monthly_hour) {
    const lastSent = secret.last_monthly_sent_at?.slice(0, 10);
    if (lastSent !== today) {
      try {
        const text = await buildMessage(supa, 'monthly', {});
        await sendTelegram(token, chatId, text);
        await supa.from('shop_secrets').update({
          last_monthly_sent_at: new Date().toISOString(),
          last_summary_error: null,
        }).eq('id', 1);
        sent.push('monthly');
      } catch (err) {
        await supa.from('shop_secrets').update({
          last_summary_error: String(err).slice(0, 500),
        }).eq('id', 1);
      }
    }
  }

  // Morning brief was removed in May 2026 — only daily & monthly remain.

  return { sent, hour, dom };
}

// ─────────────────────────────────────────────────────────────────────────
//  HTTP HANDLER
// ─────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  let body: ReqBody = {};
  if (req.method === 'POST') {
    try { body = await req.json(); } catch { /* empty body */ }
  }

  // Backward compat with the old function: { test:true } / { preview:true } / { date:... }
  if (body.test && !body.action) body.action = 'test';
  if (body.preview && !body.action) { body.action = 'preview'; body.kind = body.kind || 'daily'; }

  // Read shop_secrets (single row, id=1)
  const { data: secret, error: secErr } = await supa
    .from('shop_secrets').select('*').eq('id', 1).maybeSingle();
  if (secErr) return json({ ok: false, error: secErr.message }, 500);

  const token = secret?.telegram_bot_token;
  const chatId = secret?.telegram_chat_id;

  // ── Webhook management ──────────────────────────────────────────────
  if (body.action === 'install_webhook') {
    if (!token) return json({ ok: false, error: 'missing bot token' }, 400);
    const result = await installWebhook(supa, token);
    return json({ ok: !!result.ok, ...result });
  }
  if (body.action === 'delete_webhook') {
    if (!token) return json({ ok: false, error: 'missing bot token' }, 400);
    return json(await deleteWebhook(token));
  }
  if (body.action === 'webhook_status') {
    if (!token) return json({ ok: false, error: 'missing bot token' }, 400);
    return json(await getWebhookInfo(token));
  }

  // ── Test ping ───────────────────────────────────────────────────────
  if (body.action === 'test') {
    if (!token || !chatId) return json({ ok: false, error: 'missing token or chat_id' }, 400);
    try {
      await sendTelegram(token, chatId,
        '✅ <b>เชื่อมต่อ Telegram สำเร็จ</b>\nร้าน TIMES POS · ทดสอบส่งข้อความ');
      return json({ ok: true });
    } catch (err) {
      return json({ ok: false, error: String(err) }, 502);
    }
  }

  // ── Cron tick ───────────────────────────────────────────────────────
  if (body.kind === 'cron' && !body.action) {
    if (!secret) return json({ ok: false, error: 'no shop_secrets row' }, 500);
    return json({ ok: true, ...(await dispatchCron(supa, secret)) });
  }

  // ── Build a message for preview / manual send ───────────────────────
  const kind = (body.kind || 'daily') as 'daily' | 'monthly' | 'range';
  if (!['daily', 'monthly', 'range'].includes(kind)) {
    return json({ ok: false, error: 'bad kind: ' + kind }, 400);
  }

  let text: string;
  try {
    text = await buildMessage(supa, kind, {
      date: body.date, yyyymm: body.yyyymm, days: body.days,
    });
  } catch (err) {
    return json({ ok: false, error: 'compute failed: ' + String(err) }, 500);
  }

  if (body.action === 'preview') {
    return json({ ok: true, kind, text });
  }

  // Default = send.
  if (!token || !chatId) return json({ ok: false, error: 'missing token or chat_id' }, 400);
  try {
    await sendTelegram(token, chatId, text);
    // Stamp last_*_sent_at for visibility in the UI.
    const now = new Date().toISOString();
    const stampField =
      kind === 'daily' ? 'last_summary_sent_at' :
      kind === 'monthly' ? 'last_monthly_sent_at' : null;
    if (stampField) {
      await supa.from('shop_secrets').update({
        [stampField]: now, last_summary_error: null,
      }).eq('id', 1);
    }
    return json({ ok: true, sent: true, kind, text });
  } catch (err) {
    const msg = String(err);
    await supa.from('shop_secrets').update({
      last_summary_error: msg.slice(0, 500),
    }).eq('id', 1);
    return json({ ok: false, error: msg }, 502);
  }
});
