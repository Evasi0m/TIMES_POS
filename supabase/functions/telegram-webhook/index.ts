// Telegram webhook — receives `Update` payloads from Telegram and replies
// with the requested summary. Two-way bot for commands like /today, /month.
//
// Security model (in this exact order):
//   1. Reject if missing/wrong `X-Telegram-Bot-Api-Secret-Token` header.
//      The secret is a 32-byte random hex stored in shop_secrets.webhook_secret
//      and given to Telegram via setWebhook(secret_token=...).
//   2. Reject if message.chat.id != shop_secrets.telegram_chat_id.
//      This lets the bot ignore curious users who message it directly even
//      if they somehow learned the bot's username. The owner's chat_id is
//      the only authorized correspondent.
//
// IMPORTANT: this function MUST be deployed with verify_jwt=false. Telegram
// has no way to send a Supabase JWT — auth is entirely via the secret_token
// header above.
//
// Reply policy: every command produces ONE message. If the command needs
// data fetching (most do), we send a "⏳ กำลังคำนวณ..." reply first only
// for the slowest queries — but here Edge runtime is fast enough that
// commands return in well under Telegram's 60-second handler timeout, so
// we just compute + reply once.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  bangkokDate,
  computeDailySummary,
  computeLowStock,
  computeMonthlySummary,
  computeRangeSummary,
  formatDaily,
  formatHelp,
  formatLowStock,
  formatMonthly,
  formatRange,
  sendTelegram,
} from '../_shared/telegram-format.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface TgChat { id: number; type: string; title?: string; username?: string }
interface TgUser { id: number; first_name?: string; username?: string }
interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
}

// 200 OK is what Telegram wants in all cases — we never want it to retry.
// Errors are logged via console.error which lands in Supabase function logs.
const OK = () => new Response('ok', { status: 200 });

// ─────────────────────────────────────────────────────────────────────────
//  COMMAND HANDLERS
//  Each returns the reply text. Caller is responsible for sending.
// ─────────────────────────────────────────────────────────────────────────

async function handleCommand(
  supa: any,
  cmd: string,
  args: string[],
  chatId: number,
  threshold: number,
): Promise<string> {
  switch (cmd) {
    case '/start':
    case '/help':
      return formatHelp(chatId);

    case '/whoami':
      return `🪪 <b>Chat ID ของคุณ</b>\n<code>${chatId}</code>`;

    case '/today':
      return formatDaily(await computeDailySummary(supa, bangkokDate(0)));

    case '/yesterday':
      return formatDaily(await computeDailySummary(supa, bangkokDate(-1)));

    case '/month': {
      // Month-to-date — use computeRangeSummary with days = day-of-month so
      // it bottoms out at "the 1st" of the current month. Gives a quick
      // picture even mid-month.
      const today = bangkokDate(0);
      const dom = Number(today.split('-')[2]);
      return formatRange(await computeRangeSummary(supa, dom));
    }

    case '/lastmonth': {
      const today = bangkokDate(0);
      const [y, m] = today.split('-').map(Number);
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      const yyyymm = `${py}-${String(pm).padStart(2, '0')}`;
      return formatMonthly(await computeMonthlySummary(supa, yyyymm));
    }

    case '/sales': {
      // /sales 7  or  /sales 30   — first arg is days (default 7).
      const raw = args[0] || '7';
      const num = parseInt(raw.replace(/[^\d]/g, ''), 10);
      const days = isFinite(num) && num > 0 ? Math.min(365, num) : 7;
      return formatRange(await computeRangeSummary(supa, days));
    }

    case '/lowstock': {
      const items = await computeLowStock(supa, threshold);
      return formatLowStock(items.map(p => ({ name: p.name, current_stock: p.current_stock })), threshold);
    }

    default:
      return [
        `❓ ไม่รู้จักคำสั่ง <code>${escapeHtml(cmd)}</code>`,
        '',
        'พิมพ์ /help เพื่อดูคำสั่งทั้งหมด',
      ].join('\n');
  }
}

// Pure parser — extracts command name + args from a `text` field. Tolerates
// the `@BotName` suffix that Telegram appends in group chats (e.g.
// "/today@MyShopBot 7" → cmd="/today", args=["7"]).
function parseCommand(text: string): { cmd: string; args: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const parts = trimmed.split(/\s+/);
  let cmd = parts[0].toLowerCase();
  const at = cmd.indexOf('@');
  if (at !== -1) cmd = cmd.slice(0, at);
  return { cmd, args: parts.slice(1) };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─────────────────────────────────────────────────────────────────────────
//  HTTP HANDLER
// ─────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Telegram only POSTs. Anything else = silent OK.
  if (req.method !== 'POST') return OK();

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  // ── 1. Verify the secret_token header
  const headerSecret = req.headers.get('X-Telegram-Bot-Api-Secret-Token');
  const { data: secret } = await supa.from('shop_secrets').select('*').eq('id', 1).maybeSingle();
  if (!secret?.webhook_secret) {
    console.error('webhook: no webhook_secret configured');
    return OK();   // 200 so Telegram doesn't retry, but ignore.
  }
  if (headerSecret !== secret.webhook_secret) {
    console.warn('webhook: secret mismatch — rejecting');
    return OK();
  }

  // ── 2. Parse the update
  let update: TgUpdate;
  try {
    update = await req.json();
  } catch {
    console.warn('webhook: invalid JSON body');
    return OK();
  }

  const msg = update.message || update.edited_message;
  if (!msg) return OK();           // ignore non-message updates
  if (!msg.text) return OK();      // ignore stickers/photos/etc.

  // ── 3. Authorize sender — must match the configured chat_id.
  // chat_id can be negative (groups) or positive (private). We do a string
  // compare since shop_secrets stores chat_id as text.
  const incomingChatId = String(msg.chat.id);
  const allowedChatId = String(secret.telegram_chat_id || '');
  if (!allowedChatId) {
    // Unconfigured — just guide the user with their chat_id.
    if (msg.text.startsWith('/start') || msg.text.startsWith('/whoami')) {
      await sendTelegram(secret.telegram_bot_token, msg.chat.id,
        `👋 ยินดีต้อนรับ\n\n<b>Chat ID ของคุณ:</b>\n<code>${msg.chat.id}</code>\n\nนำ Chat ID ไปใส่ใน TIMES POS → การตั้งค่า → Telegram → กดบันทึก แล้วลองใหม่อีกครั้ง`);
    }
    return OK();
  }
  if (incomingChatId !== allowedChatId) {
    // Wrong chat — silently ignore (don't leak that the bot exists/works).
    console.warn(`webhook: chat ${incomingChatId} not authorized (expected ${allowedChatId})`);
    return OK();
  }

  // ── 4. Parse + dispatch
  const parsed = parseCommand(msg.text);
  if (!parsed) {
    // Non-command messages get a gentle nudge (only on first word, not on
    // every chatter — but we don't track conversation state so just always).
    await sendTelegram(secret.telegram_bot_token, msg.chat.id,
      'พิมพ์ /help เพื่อดูคำสั่งที่ใช้ได้ครับ', { replyToMessageId: msg.message_id });
    return OK();
  }

  let reply: string;
  try {
    reply = await handleCommand(
      supa, parsed.cmd, parsed.args, msg.chat.id, secret.low_stock_threshold || 3,
    );
  } catch (err) {
    console.error('webhook command error:', err);
    reply = `⚠️ เกิดข้อผิดพลาด: <code>${escapeHtml(String(err)).slice(0, 200)}</code>`;
  }

  try {
    await sendTelegram(secret.telegram_bot_token, msg.chat.id, reply, {
      replyToMessageId: msg.message_id,
    });
  } catch (err) {
    console.error('webhook reply send failed:', err);
  }
  return OK();
});
