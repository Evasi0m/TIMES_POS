// Telegram daily-summary settings panel (admin-only).
//
// Lives in the AppSettingsModal as a collapsible section. Reads/writes
// `shop_secrets` (admin RLS — cashiers cannot even SELECT) and triggers
// the deployed `daily-telegram-summary` edge function in test/preview
// modes for a one-click verification flow.
//
// Setup flow for the owner:
//   1. Open @BotFather on Telegram → /newbot → copy bot token
//   2. Paste token here → กดปุ่ม "ดู Chat ID จาก bot"
//      (BUT first message your bot once so it has a chat to fetch)
//   3. Pick chat_id from list → กดปุ่ม "ทดสอบส่ง" → ดู Telegram
//   4. เปิด switch ส่งอัตโนมัติ
//
// Security: bot token is stored in `shop_secrets` (admin-only RLS).
// Token is masked in the UI by default; click "ดู" to reveal.

import React, { useEffect, useState } from 'react';
import { sb } from '../../lib/supabase-client.js';
import Icon from '../ui/Icon.jsx';

const HOUR_OPTIONS = [
  { v: 9,  label: '09:00' }, { v: 12, label: '12:00' },
  { v: 18, label: '18:00' }, { v: 19, label: '19:00' },
  { v: 20, label: '20:00' }, { v: 21, label: '21:00' },
  { v: 22, label: '22:00' }, { v: 23, label: '23:00' },
];

export default function TelegramSettings({ toast }) {
  const [secret, setSecret] = useState(null);            // null = loading
  const [draft, setDraft] = useState({
    telegram_bot_token: '', telegram_chat_id: '',
    daily_summary_enabled: false, daily_summary_hour: 21,
  });
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState({ test: false, chats: false, preview: false });
  const [chatHits, setChatHits] = useState(null);        // null | [] | [{id,title}]
  const [previewText, setPreviewText] = useState(null);  // last preview body

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await sb.from('shop_secrets').select('*').eq('id', 1).maybeSingle();
      if (cancelled) return;
      if (error) {
        // RLS denial = cashier opened settings as admin somehow → just leave UI empty.
        toast?.push?.('โหลด Telegram settings ไม่ได้ (อาจไม่ใช่ admin)', 'error');
        setSecret({});
        return;
      }
      setSecret(data || {});
      setDraft({
        telegram_bot_token: data?.telegram_bot_token || '',
        telegram_chat_id:   data?.telegram_chat_id   || '',
        daily_summary_enabled: !!data?.daily_summary_enabled,
        daily_summary_hour: data?.daily_summary_hour ?? 21,
      });
    })();
    return () => { cancelled = true; };
  }, [toast]);

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    setSaving(true);
    const payload = {
      telegram_bot_token:    draft.telegram_bot_token.trim() || null,
      telegram_chat_id:      draft.telegram_chat_id.trim() || null,
      daily_summary_enabled: !!draft.daily_summary_enabled,
      daily_summary_hour:    Number(draft.daily_summary_hour) || 21,
    };
    const { error } = await sb.from('shop_secrets').update(payload).eq('id', 1);
    setSaving(false);
    if (error) { toast?.push?.('บันทึกไม่ได้: ' + error.message, 'error'); return; }
    toast?.push?.('บันทึกการตั้งค่า Telegram แล้ว', 'success');
    setSecret((s) => ({ ...(s || {}), ...payload }));
  };

  // Hit Telegram getUpdates directly from the browser. Token stays
  // client-side; no need to round-trip through the edge function.
  const fetchChatIds = async () => {
    const token = draft.telegram_bot_token.trim();
    if (!token) { toast?.push?.('กรอก Bot Token ก่อน', 'error'); return; }
    setBusy((b) => ({ ...b, chats: true }));
    setChatHits(null);
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
      const json = await res.json();
      if (!json.ok) { toast?.push?.('Telegram: ' + (json.description || 'failed'), 'error'); return; }
      // Dedupe by chat.id; latest wins for the title.
      const map = new Map();
      for (const upd of json.result || []) {
        const chat = upd.message?.chat || upd.edited_message?.chat
                  || upd.channel_post?.chat;
        if (!chat) continue;
        const title = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || '(no name)';
        map.set(chat.id, { id: chat.id, title, type: chat.type });
      }
      const hits = Array.from(map.values());
      setChatHits(hits);
      if (hits.length === 0) {
        toast?.push?.('ยังไม่มี chat — ส่งข้อความใด ๆ ให้ bot ก่อน แล้วลองใหม่', 'info');
      }
    } catch (e) {
      toast?.push?.('Network error: ' + e.message, 'error');
    } finally {
      setBusy((b) => ({ ...b, chats: false }));
    }
  };

  const callEdge = async (body) => {
    const { data: sess } = await sb.auth.getSession();
    const token = sess?.session?.access_token;
    if (!token) throw new Error('not signed in');
    const res = await fetch(
      'https://zrymhhkqdcttqsdczfcr.supabase.co/functions/v1/daily-telegram-summary',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(body),
      }
    );
    return res.json();
  };

  const sendTest = async () => {
    if (!draft.telegram_bot_token || !draft.telegram_chat_id) {
      toast?.push?.('กรอก Token + Chat ID ก่อน แล้วกด "บันทึก"', 'error');
      return;
    }
    if ((secret?.telegram_bot_token || '') !== draft.telegram_bot_token.trim()
        || (secret?.telegram_chat_id || '') !== draft.telegram_chat_id.trim()) {
      toast?.push?.('กด "บันทึก" ก่อน แล้วทดสอบส่ง', 'info');
      return;
    }
    setBusy((b) => ({ ...b, test: true }));
    try {
      // Call Telegram directly from the browser — Telegram's API supports CORS,
      // and this avoids any edge-function deploy/CORS issues for a simple test send.
      const tgToken = draft.telegram_bot_token.trim();
      const tgChat  = draft.telegram_chat_id.trim();
      const res = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: tgChat,
          text: '✅ <b>เชื่อมต่อ Telegram สำเร็จ</b>\nร้าน TIMES POS · ทดสอบส่งข้อความ',
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      const json = await res.json();
      if (json.ok) toast?.push?.('ส่ง Telegram สำเร็จ ✅ ดูที่ chat ของคุณ', 'success');
      else         toast?.push?.('ส่งไม่สำเร็จ: ' + (json.description || 'unknown'), 'error');
    } catch (e) {
      toast?.push?.('Network error: ' + e.message, 'error');
    } finally {
      setBusy((b) => ({ ...b, test: false }));
    }
  };

  const previewYesterday = async () => {
    setBusy((b) => ({ ...b, preview: true }));
    setPreviewText(null);
    try {
      const r = await callEdge({ preview: true });
      if (r?.ok) setPreviewText(r.text);
      else       toast?.push?.('Preview ล้มเหลว: ' + (r?.error || 'unknown'), 'error');
    } catch (e) {
      toast?.push?.('Network error: ' + e.message, 'error');
    } finally {
      setBusy((b) => ({ ...b, preview: false }));
    }
  };

  if (secret === null) return <div className="skeleton h-32 rounded" />;

  const tokenDirty = (draft.telegram_bot_token || '').trim() !== (secret.telegram_bot_token || '');
  const chatDirty  = (draft.telegram_chat_id || '').trim()  !== (secret.telegram_chat_id || '');
  const dirty = tokenDirty || chatDirty
    || !!draft.daily_summary_enabled !== !!secret.daily_summary_enabled
    || Number(draft.daily_summary_hour) !== Number(secret.daily_summary_hour ?? 21);

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted leading-relaxed bg-white/40 rounded p-3">
        ตั้งค่า Telegram Bot เพื่อให้ระบบส่งสรุปยอดของแต่ละวันเข้า chat ของคุณอัตโนมัติ
        <br/>
        1. เปิด <code className="font-mono text-[11px]">@BotFather</code> บน Telegram → <code>/newbot</code> → copy <b>Bot Token</b><br/>
        2. ส่งข้อความใด ๆ ให้ bot ของคุณก่อน 1 ครั้ง<br/>
        3. วาง token ด้านล่าง → กด <b>"ดู Chat ID"</b> → เลือก chat → กด <b>"ทดสอบส่ง"</b>
      </div>

      {/* Bot token */}
      <div>
        <label className="text-xs uppercase tracking-wider text-muted">Bot Token</label>
        <div className="mt-1 flex gap-2">
          <input
            type={showToken ? 'text' : 'password'}
            className="input flex-1 font-mono text-xs"
            placeholder="123456:ABC-DEF..."
            value={draft.telegram_bot_token}
            onChange={(e) => set('telegram_bot_token', e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="btn-ghost !px-3"
            onClick={() => setShowToken((s) => !s)}
            title={showToken ? 'ซ่อน' : 'แสดง'}>
            <Icon name={showToken ? 'x' : 'edit'} size={16} />
          </button>
        </div>
      </div>

      {/* Chat id + helper */}
      <div>
        <label className="text-xs uppercase tracking-wider text-muted">Chat ID</label>
        <div className="mt-1 flex gap-2">
          <input
            className="input flex-1 font-mono text-xs"
            placeholder="เช่น 123456789 หรือ -1001234567890"
            value={draft.telegram_chat_id}
            onChange={(e) => set('telegram_chat_id', e.target.value)}
            spellCheck={false}
          />
          <button type="button" className="btn-secondary !text-xs whitespace-nowrap"
            onClick={fetchChatIds} disabled={busy.chats}>
            {busy.chats ? <span className="spinner mr-1"/> : <Icon name="search" size={14} className="mr-1"/>}
            ดู Chat ID
          </button>
        </div>
        {chatHits && chatHits.length > 0 && (
          <div className="mt-2 rounded-md bg-white/60 border hairline divide-y divide-hairline-soft">
            {chatHits.map((c) => (
              <button key={c.id} type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-primary/5 flex items-center justify-between gap-2"
                onClick={() => set('telegram_chat_id', String(c.id))}>
                <span className="truncate">
                  <span className="font-medium">{c.title}</span>
                  <span className="text-muted-soft text-xs ml-2">({c.type})</span>
                </span>
                <span className="font-mono text-xs text-muted">{c.id}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Schedule + enabled */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs uppercase tracking-wider text-muted">เวลาส่ง (เวลากรุงเทพ)</label>
          <select className="input mt-1"
            value={draft.daily_summary_hour}
            onChange={(e) => set('daily_summary_hour', Number(e.target.value))}>
            {HOUR_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-muted">การส่งอัตโนมัติ</label>
          <label className="mt-2 flex items-center gap-2 cursor-pointer">
            <input type="checkbox"
              checked={!!draft.daily_summary_enabled}
              onChange={(e) => set('daily_summary_enabled', e.target.checked)}
              className="w-4 h-4 accent-primary" />
            <span className="text-sm">{draft.daily_summary_enabled ? 'เปิดอยู่' : 'ปิดอยู่'}</span>
          </label>
        </div>
      </div>

      {/* Save / test row */}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary !text-sm"
          disabled={saving || !dirty} onClick={save}>
          {saving ? <span className="spinner mr-1"/> : <Icon name="check" size={14} className="mr-1"/>}
          บันทึก
        </button>
        <button type="button" className="btn-secondary !text-sm"
          disabled={busy.test || dirty} onClick={sendTest}
          title={dirty ? 'บันทึกก่อน' : ''}>
          {busy.test ? <span className="spinner mr-1"/> : <Icon name="zap" size={14} className="mr-1"/>}
          ทดสอบส่ง
        </button>
        <button type="button" className="btn-secondary !text-sm"
          disabled={busy.preview} onClick={previewYesterday}>
          {busy.preview ? <span className="spinner mr-1"/> : <Icon name="receipt" size={14} className="mr-1"/>}
          ดูตัวอย่างยอดเมื่อวาน
        </button>
      </div>

      {previewText && (
        <pre className="bg-white/60 border hairline rounded p-3 text-xs whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto"
          dangerouslySetInnerHTML={{ __html: previewText }} />
      )}

      {/* Last status */}
      <div className="text-xs text-muted border-t hairline-soft pt-3 space-y-1">
        {secret.last_summary_sent_at ? (
          <div>ส่งล่าสุด: <span className="text-ink">{new Date(secret.last_summary_sent_at).toLocaleString('th-TH')}</span></div>
        ) : (
          <div className="text-muted-soft">ยังไม่มีประวัติการส่ง</div>
        )}
        {secret.last_summary_error && (
          <div className="text-error">
            <Icon name="alert" size={11} className="inline mr-1"/>
            ครั้งล่าสุดผิดพลาด: <span className="font-mono">{secret.last_summary_error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
