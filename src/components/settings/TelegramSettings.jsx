// Telegram bot settings — tab body inside AppSettingsModal.
//
// Five sections, top-to-bottom:
//   1. การเชื่อมต่อ        — bot token, chat picker, manual test send
//   2. การแจ้งเตือนอัตโนมัติ — toggles + schedule for daily / monthly
//   3. ดูตัวอย่างข้อความ    — preview the rendered text for each kind
//   4. Bot สั่งงาน          — webhook install/teardown for /commands
//   5. ประวัติการส่ง        — last_*_sent_at + last_summary_error
//
// All interaction with Telegram (test, preview, webhook ops) goes through
// the `telegram-send` edge function via supabase.functions.invoke(). The
// browser never sees the bot token after the first save.

import React, { useEffect, useState } from 'react';
import { sb } from '../../lib/supabase-client.js';
import Icon from '../ui/Icon.jsx';

// ─────────────────────────────────────────────────────────────────────────
//  Hours dropdown — 0..23
// ─────────────────────────────────────────────────────────────────────────
const HOURS = Array.from({ length: 24 }, (_, h) => h);

// ─────────────────────────────────────────────────────────────────────────
//  Pretty-format the relative time of last_*_sent_at.
// ─────────────────────────────────────────────────────────────────────────
function fmtRelative(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'อนาคต';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'เมื่อสักครู่';
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ชม.ที่แล้ว`;
  const d = Math.floor(h / 24);
  return `${d} วันที่แล้ว`;
}

export function TelegramSettings({ toast }) {
  const [row, setRow] = useState(null);            // raw shop_secrets row
  const [busy, setBusy] = useState(false);
  const [chats, setChats] = useState([]);          // [{id, title, type}]
  const [chatsLoading, setChatsLoading] = useState(false);

  // Preview state — `previewKind` is 'daily'|'monthly' when open.
  const [previewKind, setPreviewKind] = useState(null);
  const [previewText, setPreviewText] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);

  // Webhook status — populated by `webhook_status` action.
  const [hookStatus, setHookStatus] = useState(null);
  const [hookBusy, setHookBusy] = useState(false);

  // ── Initial load ───────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data, error } = await sb.from('shop_secrets').select('*').eq('id', 1).maybeSingle();
      if (error) { toast.push('โหลดการตั้งค่า Telegram ไม่ได้: ' + error.message, 'error'); return; }
      setRow(data);
    })();
  }, [toast]);

  // ── Field setters — keep `row` immutable; UI binds to it directly. ─
  const set = (k, v) => setRow(r => ({ ...r, [k]: v }));

  // ── Persist a single field (or several) to shop_secrets immediately.
  // Auto-save flows let the user toggle a switch and forget — no extra
  // "save" button to remember. Each save is fire-and-forget with toast.
  const persist = async (patch, opts = {}) => {
    setBusy(true);
    const { error } = await sb.from('shop_secrets').update({
      ...patch, updated_at: new Date().toISOString(),
    }).eq('id', 1);
    setBusy(false);
    if (error) {
      toast.push('บันทึกไม่ได้: ' + error.message, 'error');
      return false;
    }
    if (opts.silent !== true) toast.push('บันทึกแล้ว', 'success');
    setRow(r => ({ ...r, ...patch }));
    return true;
  };

  // ── Section 1: bot token save (commits the in-input value) ─────────
  const saveToken = async () => {
    const tok = (row?.telegram_bot_token || '').trim();
    if (!tok) { toast.push('กรุณาวาง bot token', 'warn'); return; }
    await persist({ telegram_bot_token: tok });
  };

  // ── Section 1: fetch chat IDs via Telegram getUpdates ──────────────
  // Direct call from the browser — token must be present. Only used to
  // help the user pick a chat at setup time. For sending we always go
  // through the edge function.
  const fetchChats = async () => {
    const tok = (row?.telegram_bot_token || '').trim();
    if (!tok) { toast.push('ใส่ bot token ก่อน', 'warn'); return; }
    setChatsLoading(true); setChats([]);
    try {
      const res = await fetch(`https://api.telegram.org/bot${tok}/getUpdates`);
      const json = await res.json();
      if (!json.ok) {
        toast.push('Telegram: ' + (json.description || 'ไม่สำเร็จ'), 'error');
        return;
      }
      const seen = new Map();
      for (const u of json.result || []) {
        const c = u.message?.chat || u.edited_message?.chat || u.channel_post?.chat;
        if (c) seen.set(c.id, c);
      }
      const list = Array.from(seen.values());
      if (!list.length) {
        toast.push('ยังไม่พบข้อความ — ลอง /start ในแชทนั้นก่อน', 'info');
      }
      setChats(list);
    } catch (err) {
      toast.push('โหลด chat ไม่ได้: ' + String(err), 'error');
    } finally {
      setChatsLoading(false);
    }
  };

  // ── Test send (round-trips through edge function) ──────────────────
  const testSend = async () => {
    setBusy(true);
    const { data, error } = await sb.functions.invoke('telegram-send', {
      body: { action: 'test' },
    });
    setBusy(false);
    if (error || !data?.ok) {
      toast.push('ทดสอบส่งไม่ได้: ' + (data?.error || error?.message || 'unknown'), 'error');
      return;
    }
    toast.push('ส่งข้อความทดสอบสำเร็จ — เช็ค Telegram', 'success');
  };

  // ── Section 3: preview a template ──────────────────────────────────
  const openPreview = async (kind) => {
    setPreviewKind(kind);
    setPreviewText('');
    setPreviewBusy(true);
    const { data, error } = await sb.functions.invoke('telegram-send', {
      body: { action: 'preview', kind },
    });
    setPreviewBusy(false);
    if (error || !data?.ok) {
      setPreviewText('— โหลดตัวอย่างไม่ได้ —\n' + (data?.error || error?.message || ''));
      return;
    }
    setPreviewText(data.text || '');
  };

  // Manual one-off send (real Telegram message, not preview).
  const sendNow = async (kind) => {
    if (!confirm('ยืนยันส่งข้อความนี้ไปยัง Telegram จริงตอนนี้?')) return;
    setPreviewBusy(true);
    const { data, error } = await sb.functions.invoke('telegram-send', {
      body: { action: 'send', kind },
    });
    setPreviewBusy(false);
    if (error || !data?.ok) {
      toast.push('ส่งไม่สำเร็จ: ' + (data?.error || error?.message || 'unknown'), 'error');
      return;
    }
    toast.push('ส่งสำเร็จ — เช็ค Telegram', 'success');
    // Refresh row so the "ประวัติการส่ง" section shows the new timestamp
    const { data: r } = await sb.from('shop_secrets').select('*').eq('id', 1).maybeSingle();
    if (r) setRow(r);
  };

  // ── Section 4: webhook install / status / delete ───────────────────
  const refreshHookStatus = async () => {
    setHookBusy(true);
    const { data, error } = await sb.functions.invoke('telegram-send', {
      body: { action: 'webhook_status' },
    });
    setHookBusy(false);
    if (error) { toast.push('ดู webhook ไม่ได้: ' + error.message, 'error'); return; }
    setHookStatus(data);
  };
  const installHook = async () => {
    setHookBusy(true);
    const { data, error } = await sb.functions.invoke('telegram-send', {
      body: { action: 'install_webhook' },
    });
    setHookBusy(false);
    if (error || !data?.ok) {
      toast.push('ติดตั้ง webhook ไม่สำเร็จ: ' + (data?.setWebhook?.description || error?.message || 'unknown'), 'error');
      return;
    }
    toast.push('ติดตั้ง webhook สำเร็จ — ลองพิมพ์ /help ใน Telegram', 'success');
    await refreshHookStatus();
  };
  const removeHook = async () => {
    if (!confirm('ลบ webhook? Bot จะหยุดตอบคำสั่งจากคุณ')) return;
    setHookBusy(true);
    const { data, error } = await sb.functions.invoke('telegram-send', {
      body: { action: 'delete_webhook' },
    });
    setHookBusy(false);
    if (error) { toast.push('ลบ webhook ไม่ได้: ' + error.message, 'error'); return; }
    toast.push('ลบ webhook แล้ว', 'success');
    setHookStatus(data);
  };

  // ── Render ─────────────────────────────────────────────────────────
  if (!row) return <div className="text-sm text-muted py-6">กำลังโหลด...</div>;

  return (
    <div className="space-y-5">

      {/* ── Section 1: การเชื่อมต่อ ─────────────────────── */}
      <Section title="1. การเชื่อมต่อ" icon="zap">
        <div>
          <label className="text-xs uppercase tracking-wider text-muted">Bot Token</label>
          <div className="flex gap-2 mt-1">
            <input
              className="input flex-1 font-mono text-xs"
              value={row.telegram_bot_token || ''}
              onChange={e => set('telegram_bot_token', e.target.value)}
              placeholder="123456:ABCdef..."
              autoComplete="off" spellCheck="false"
            />
            <button className="btn-secondary" onClick={saveToken} disabled={busy}>
              <Icon name="check" size={14}/> บันทึก
            </button>
          </div>
          <div className="text-[11px] text-muted-soft mt-1">
            ขอที่ <span className="font-mono">@BotFather</span> → /newbot — แล้ววาง token ที่นี่
          </div>
        </div>

        <div>
          <label className="text-xs uppercase tracking-wider text-muted">Chat ID</label>
          <div className="flex gap-2 mt-1">
            <input
              className="input flex-1 font-mono text-sm"
              value={row.telegram_chat_id || ''}
              onChange={e => set('telegram_chat_id', e.target.value)}
              placeholder="ส่งข้อความหา bot แล้วกดปุ่ม 'ค้นหา'"
            />
            <button className="btn-secondary" onClick={fetchChats} disabled={chatsLoading}>
              {chatsLoading ? <span className="spinner"/> : <Icon name="search" size={14}/>} ค้นหา
            </button>
            <button className="btn-secondary" onClick={() => persist({ telegram_chat_id: (row.telegram_chat_id||'').trim() || null })}>
              <Icon name="check" size={14}/>
            </button>
          </div>
          {chats.length > 0 && (
            <div className="mt-2 space-y-1">
              {chats.map(c => (
                <button
                  key={c.id} type="button"
                  onClick={() => persist({ telegram_chat_id: String(c.id) })}
                  className={"w-full text-left text-sm px-3 py-2 rounded-md border transition " + (
                    String(row.telegram_chat_id) === String(c.id)
                      ? 'bg-primary/10 border-primary text-primary'
                      : 'bg-white border-hairline hover:border-primary/30'
                  )}
                >
                  <span className="font-mono mr-2">{c.id}</span>
                  <span className="text-muted">{c.title || c.username || c.type}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button className="btn-primary w-full" onClick={testSend} disabled={busy || !row.telegram_bot_token || !row.telegram_chat_id}>
          {busy ? <span className="spinner"/> : <Icon name="zap" size={14}/>}
          ทดสอบส่งข้อความ
        </button>
      </Section>

      {/* ── Section 2: การแจ้งเตือนอัตโนมัติ ─────────────── */}
      <Section title="2. การแจ้งเตือนอัตโนมัติ" icon="calendar">
        <div className="text-[11px] text-muted-soft -mt-1">
          ทำงานทุกชั่วโมง — เช็คเวลา (เวลาไทย) แล้วส่งให้อัตโนมัติ
        </div>

        <ScheduleRow
          label="สรุปประจำวัน"
          desc="ส่งทุกวันเวลาที่ตั้ง — สรุปยอดของเมื่อวาน"
          enabled={row.daily_enabled}
          hour={row.daily_hour}
          onToggle={(v) => persist({ daily_enabled: v }, { silent: true })}
          onHour={(h) => persist({ daily_hour: h }, { silent: true })}
        />

        <ScheduleRow
          label="สรุปสิ้นเดือน"
          desc="ส่งวันที่ 1 ของเดือนใหม่ — สรุปยอดเดือนก่อน"
          enabled={row.monthly_enabled}
          hour={row.monthly_hour}
          onToggle={(v) => persist({ monthly_enabled: v }, { silent: true })}
          onHour={(h) => persist({ monthly_hour: h }, { silent: true })}
        />

        <div className="pt-2 border-t hairline-soft">
          <label className="text-xs uppercase tracking-wider text-muted">เกณฑ์สต็อกใกล้หมด</label>
          <div className="flex gap-2 items-center mt-1">
            <input
              type="number" min="0" max="999"
              className="input w-24 text-center font-mono"
              value={row.low_stock_threshold ?? 3}
              onChange={e => set('low_stock_threshold', Math.max(0, Number(e.target.value)||0))}
              onBlur={() => persist({ low_stock_threshold: row.low_stock_threshold ?? 3 }, { silent: true })}
            />
            <span className="text-sm text-muted">ชิ้น — เมื่อสต็อก ≤ ตัวเลขนี้ จะแสดงในคำสั่ง /lowstock</span>
          </div>
        </div>
      </Section>

      {/* ── Section 3: ดูตัวอย่างข้อความ ─────────────────── */}
      <Section title="3. ดูตัวอย่าง / ส่งทันที" icon="edit">
        <div className="text-[11px] text-muted-soft -mt-1">
          ดูว่าข้อความจะหน้าตาเป็นยังไง หรือกด "ส่งทันที" เพื่อยิงไปจริง
        </div>
        <div className="grid grid-cols-2 gap-2">
          <PreviewButton kind="daily"   label="📊 Daily"    onClick={() => openPreview('daily')} />
          <PreviewButton kind="monthly" label="🗓 Monthly"  onClick={() => openPreview('monthly')} />
        </div>

        {previewKind && (
          <div className="rounded-lg border hairline bg-canvas/40 p-3 mt-2">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-xs text-muted uppercase tracking-wider">
                ตัวอย่าง: {previewKind === 'daily' ? 'Daily' : 'Monthly'}
              </div>
              <div className="flex gap-1">
                <button className="btn-ghost text-xs" onClick={() => openPreview(previewKind)} disabled={previewBusy}>
                  <Icon name="refresh" size={12}/> รีโหลด
                </button>
                <button className="btn-primary text-xs" onClick={() => sendNow(previewKind)} disabled={previewBusy || !row.telegram_bot_token || !row.telegram_chat_id}>
                  ส่งทันที
                </button>
                <button className="btn-ghost text-xs" onClick={() => setPreviewKind(null)}>
                  <Icon name="x" size={12}/>
                </button>
              </div>
            </div>
            <pre className="text-xs whitespace-pre-wrap leading-relaxed font-mono text-ink overflow-x-auto max-h-72">
              {previewBusy ? 'กำลังโหลด...' : stripHtmlTags(previewText)}
            </pre>
          </div>
        )}
      </Section>

      {/* ── Section 4: Two-way bot (webhook) ──────────────── */}
      <Section title="4. Bot สั่งงาน (พิมพ์ /today, /month ฯลฯ)" icon="zap">
        <div className="text-[11px] text-muted-soft -mt-1">
          ติดตั้ง webhook แล้วพิมพ์คำสั่งใน Telegram เพื่อขอข้อมูลแบบ real-time
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-md border hairline bg-canvas/40 p-2 font-mono">
            /today, /yesterday<br/>/month, /lastmonth
          </div>
          <div className="rounded-md border hairline bg-canvas/40 p-2 font-mono">
            /sales 7, /sales 30<br/>/lowstock, /whoami, /help
          </div>
        </div>

        <div className="flex gap-2">
          <button className="btn-primary flex-1" onClick={installHook} disabled={hookBusy || !row.telegram_bot_token}>
            {hookBusy ? <span className="spinner"/> : <Icon name="check" size={14}/>}
            ติดตั้ง / อัปเดต Webhook
          </button>
          <button className="btn-secondary" onClick={refreshHookStatus} disabled={hookBusy || !row.telegram_bot_token}>
            <Icon name="refresh" size={14}/> สถานะ
          </button>
          <button className="btn-secondary text-error" onClick={removeHook} disabled={hookBusy || !row.telegram_bot_token}>
            <Icon name="x" size={14}/> ลบ
          </button>
        </div>

        {hookStatus && (
          <div className="rounded-md border hairline bg-canvas/40 p-3 text-xs space-y-1">
            <div>
              <span className="text-muted">URL:</span>{' '}
              <span className="font-mono break-all">{hookStatus?.result?.url || '(ไม่ได้ตั้ง)'}</span>
            </div>
            <div>
              <span className="text-muted">Pending updates:</span>{' '}
              <span className="font-mono">{hookStatus?.result?.pending_update_count ?? '—'}</span>
            </div>
            {hookStatus?.result?.last_error_message && (
              <div className="text-error">
                <span className="text-muted">Last error:</span>{' '}
                {hookStatus.result.last_error_message}
              </div>
            )}
          </div>
        )}
      </Section>

      {/* ── Section 5: ประวัติการส่ง ───────────────────── */}
      <Section title="5. ประวัติการส่ง" icon="calendar">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <HistoryCard label="Daily"   ts={row.last_summary_sent_at}/>
          <HistoryCard label="Monthly" ts={row.last_monthly_sent_at}/>
        </div>
        {row.last_summary_error && (
          <div className="rounded-md border border-error/30 bg-error/5 text-error text-xs p-3 mt-2">
            <div className="font-medium mb-1">⚠️ Error ล่าสุด</div>
            <div className="font-mono break-all">{row.last_summary_error}</div>
          </div>
        )}
      </Section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  Subcomponents
// ─────────────────────────────────────────────────────────────────────────

function Section({ title, icon, children }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
        <Icon name={icon} size={14}/>
        {title}
      </h3>
      <div className="space-y-3 pl-1">{children}</div>
    </section>
  );
}

// One row inside section 2 — toggle + hour dropdown.
function ScheduleRow({ label, desc, enabled, hour, onToggle, onHour }) {
  return (
    <div className="flex items-center gap-3 py-2 border-t hairline-soft first:border-t-0 first:pt-0">
      <button
        type="button"
        onClick={() => onToggle(!enabled)}
        aria-pressed={enabled}
        className={
          "flex-shrink-0 w-11 h-6 rounded-full relative transition " +
          (enabled ? 'bg-primary' : 'bg-hairline')
        }
      >
        <span
          className={
            "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition " +
            (enabled ? 'left-[22px]' : 'left-0.5')
          }
        />
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-ink font-medium">{label}</div>
        <div className="text-[11px] text-muted-soft">{desc}</div>
      </div>
      <select
        className="input !py-1 !px-2 text-sm font-mono w-24 text-center"
        value={hour}
        onChange={e => onHour(Number(e.target.value))}
        disabled={!enabled}
      >
        {HOURS.map(h => (
          <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
        ))}
      </select>
    </div>
  );
}

function PreviewButton({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border hairline bg-white hover:border-primary/40 transition py-2 text-sm font-medium"
    >
      {label}
    </button>
  );
}

function HistoryCard({ label, ts }) {
  return (
    <div className="rounded-md border hairline bg-canvas/40 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="text-sm text-ink font-medium">{ts ? fmtRelative(ts) : 'ยังไม่เคยส่ง'}</div>
      {ts && <div className="text-[10px] text-muted-soft font-mono">{new Date(ts).toLocaleString('th-TH')}</div>}
    </div>
  );
}

// Strip the HTML tags we use in templates (<b>, <i>, <code>) for the preview
// pane. Telegram renders them as bold/italic/mono, but we show plain text in
// the UI so the user sees the structure without parsing the markup themselves.
function stripHtmlTags(s) {
  if (!s) return '';
  return s
    .replace(/<\/?b>/g, '')
    .replace(/<\/?i>/g, '')
    .replace(/<\/?code>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export default TelegramSettings;
