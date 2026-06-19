// Telegram bot settings — token, chat, schedules, webhook, test/preview.
// super_admin only (tab gated in AppSettingsModal).

import React, { useCallback, useEffect, useState } from 'react';
import { sb } from '../../lib/supabase-client.js';
import { mapError } from '../../lib/error-map.js';
import Icon from '../ui/Icon.jsx';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function fmtDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '-';
  return d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
}

function chatLabel(c) {
  const parts = [];
  if (c.title) parts.push(c.title);
  else if (c.first_name) parts.push([c.first_name, c.last_name].filter(Boolean).join(' '));
  else if (c.username) parts.push(`@${c.username}`);
  else parts.push('chat');
  const type = c.type === 'private' ? 'private' : c.type === 'group' ? 'group' : c.type || '';
  return `${parts.join(' ')} (${type}) / ${c.id}`;
}

export default function TelegramSettings({ toast }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [previewText, setPreviewText] = useState('');
  const [chats, setChats] = useState([]);
  const [webhookInfo, setWebhookInfo] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await sb.from('shop_secrets')
      .select(`
        telegram_bot_token,
        telegram_chat_id,
        daily_enabled,
        daily_hour,
        monthly_enabled,
        monthly_hour,
        low_stock_threshold,
        last_summary_sent_at,
        last_monthly_sent_at,
        last_summary_error
      `)
      .eq('id', 1)
      .maybeSingle();
    setLoading(false);
    if (error) {
      toast?.push('???? Telegram ??????: ' + mapError(error), 'error');
      return;
    }
    setDraft({
      telegram_bot_token: data?.telegram_bot_token || '',
      telegram_chat_id: data?.telegram_chat_id || '',
      daily_enabled: data?.daily_enabled ?? false,
      daily_hour: data?.daily_hour ?? 21,
      monthly_enabled: data?.monthly_enabled ?? false,
      monthly_hour: data?.monthly_hour ?? 9,
      low_stock_threshold: data?.low_stock_threshold ?? 3,
      last_summary_sent_at: data?.last_summary_sent_at || null,
      last_monthly_sent_at: data?.last_monthly_sent_at || null,
      last_summary_error: data?.last_summary_error || null,
    });
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const invoke = async (body) => {
    const { data, error } = await sb.functions.invoke('telegram-send', { body });
    if (error) throw error;
    if (data?.ok === false) throw new Error(data.error || 'request failed');
    return data;
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const { error } = await sb.from('shop_secrets').update({
        telegram_bot_token: draft.telegram_bot_token.trim() || null,
        telegram_chat_id: draft.telegram_chat_id.trim() || null,
        daily_enabled: !!draft.daily_enabled,
        daily_hour: Number(draft.daily_hour) || 21,
        monthly_enabled: !!draft.monthly_enabled,
        monthly_hour: Number(draft.monthly_hour) || 9,
        low_stock_threshold: Math.max(0, Math.min(999, Number(draft.low_stock_threshold) || 3)),
        daily_summary_enabled: !!draft.daily_enabled,
        daily_summary_hour: Number(draft.daily_hour) || 21,
      }).eq('id', 1);
      if (error) throw error;
      toast?.push('?????? Telegram ????', 'success');
      await load();
    } catch (e) {
      toast?.push('????????????: ' + mapError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const fetchChats = async () => {
    if (!draft?.telegram_bot_token?.trim()) {
      toast?.push('??? Bot Token ????????????????', 'error');
      return;
    }
    setBusy(true);
    try {
      await save();
      const data = await invoke({ action: 'list_chats' });
      setChats(data.chats || []);
      if (!data.chats?.length) {
        toast?.push('??????????? — ????????????? bot ???? 1 ????? ???????????', 'info');
      }
    } catch (e) {
      toast?.push('??? Chat ID ??????: ' + mapError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const testSend = async () => {
    setBusy(true);
    try {
      await save();
      await invoke({ action: 'test' });
      toast?.push('??????????????????? — ???? Telegram', 'success');
      await load();
    } catch (e) {
      toast?.push('??????????????: ' + mapError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const previewYesterday = async () => {
    setBusy(true);
    setPreviewText('');
    try {
      const data = await invoke({ action: 'preview', kind: 'daily' });
      setPreviewText(data.text || '');
    } catch (e) {
      toast?.push('????????????????: ' + mapError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const installWebhook = async () => {
    setBusy(true);
    try {
      await save();
      const data = await invoke({ action: 'install_webhook' });
      if (data?.ok) toast?.push('??? webhook ???? — ????????? /today ?? Telegram ???', 'success');
      else toast?.push('??? webhook ?????????', 'error');
    } catch (e) {
      toast?.push('??? webhook ??????: ' + mapError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const checkWebhook = async () => {
    setBusy(true);
    try {
      const data = await invoke({ action: 'webhook_status' });
      setWebhookInfo(data?.result || data);
    } catch (e) {
      toast?.push('???? webhook ??????: ' + mapError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading || !draft) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted py-8 justify-center">
        <span className="spinner"/> ?????????…
      </div>
    );
  }

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="space-y-5 fade-in">
      <div className="text-xs text-muted-soft bg-surface-soft rounded-lg px-3.5 py-2.5 border hairline">
        ??????????????????? + ??????????? Telegram (/today, /yesterday, /sales, /lowstock)
      </div>

      <div className="bg-surface-soft rounded-xl p-4 border hairline space-y-3">
        <div className="text-sm font-medium text-ink flex items-center gap-1.5">
          <Icon name="link" size={15} className="text-primary"/> ????????? Bot
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-muted">Bot Token</label>
          <input
            type="password"
            className="input mt-1 w-full font-mono text-sm"
            placeholder="123456789:ABC…"
            value={draft.telegram_bot_token}
            onChange={(e) => set('telegram_bot_token', e.target.value)}
            autoComplete="off"
          />
          <div className="text-[11px] text-muted-soft mt-1">??? @BotFather</div>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-muted">Chat ID</label>
          <div className="flex gap-2 mt-1">
            <input
              type="text"
              className="input flex-1 font-mono text-sm"
              placeholder="-1001234567890"
              value={draft.telegram_chat_id}
              onChange={(e) => set('telegram_chat_id', e.target.value)}
            />
            <button type="button" className="btn-secondary !py-2 !px-3 text-sm whitespace-nowrap" onClick={fetchChats} disabled={busy}>
              ?? Chat ID
            </button>
          </div>
          {chats.length > 0 && (
            <select
              className="input mt-2 w-full text-sm"
              value={draft.telegram_chat_id}
              onChange={(e) => set('telegram_chat_id', e.target.value)}
            >
              <option value="">— ???????? —</option>
              {chats.map((c) => (
                <option key={c.id} value={String(c.id)}>{chatLabel(c)}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className="btn-primary !py-2 !px-4 text-sm" onClick={save} disabled={busy}>
            {busy ? <span className="spinner"/> : <Icon name="check" size={14}/>}
            ??????
          </button>
          <button type="button" className="btn-secondary !py-2 !px-3 text-sm" onClick={testSend} disabled={busy}>
            ????????
          </button>
          <button type="button" className="btn-secondary !py-2 !px-3 text-sm" onClick={previewYesterday} disabled={busy}>
            ?????????????????????
          </button>
        </div>
      </div>

      <div className="bg-surface-soft rounded-xl p-4 border hairline space-y-4">
        <div className="text-sm font-medium text-ink">??????????????? (???? ???.)</div>

        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span className="text-sm">?????????? (????????)</span>
          <input type="checkbox" checked={draft.daily_enabled} onChange={(e) => set('daily_enabled', e.target.checked)} />
        </label>
        {draft.daily_enabled && (
          <div>
            <label className="text-xs text-muted">?????????????</label>
            <select className="input mt-1 w-full" value={draft.daily_hour} onChange={(e) => set('daily_hour', Number(e.target.value))}>
              {HOURS.map((h) => (
                <option key={h} value={h}>{String(h).padStart(2, '0')}:00 ?.</option>
              ))}
            </select>
          </div>
        )}

        <label className="flex items-center justify-between gap-3 cursor-pointer border-t hairline-soft pt-3">
          <span className="text-sm">???????????? (?????? 1 ????????)</span>
          <input type="checkbox" checked={draft.monthly_enabled} onChange={(e) => set('monthly_enabled', e.target.checked)} />
        </label>
        {draft.monthly_enabled && (
          <div>
            <label className="text-xs text-muted">???????????????</label>
            <select className="input mt-1 w-full" value={draft.monthly_hour} onChange={(e) => set('monthly_hour', Number(e.target.value))}>
              {HOURS.map((h) => (
                <option key={h} value={h}>{String(h).padStart(2, '0')}:00 ?.</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="text-xs text-muted">????????????? (/lowstock)</label>
          <input
            type="number"
            min={0}
            max={999}
            className="input mt-1 w-24"
            value={draft.low_stock_threshold}
            onChange={(e) => set('low_stock_threshold', e.target.value)}
          />
        </div>
      </div>

      <div className="bg-surface-soft rounded-xl p-4 border hairline space-y-3">
        <div className="text-sm font-medium text-ink">Bot ?????? (???????????)</div>
        <div className="text-[11px] text-muted-soft">
          /today /yesterday /month /lastmonth /sales 7 /lowstock /help
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary !py-2 !px-3 text-sm" onClick={installWebhook} disabled={busy}>
            ??? webhook
          </button>
          <button type="button" className="btn-secondary !py-2 !px-3 text-sm" onClick={checkWebhook} disabled={busy}>
            ????????? webhook
          </button>
        </div>
        {webhookInfo && (
          <pre className="text-[10px] font-mono bg-surface-strong rounded p-2 overflow-x-auto max-h-32">
            {JSON.stringify(webhookInfo, null, 2)}
          </pre>
        )}
      </div>

      <div className="text-[11px] text-muted space-y-1 font-mono">
        <div>???????????????: {fmtDateTime(draft.last_summary_sent_at)}</div>
        <div>?????????????????: {fmtDateTime(draft.last_monthly_sent_at)}</div>
        {draft.last_summary_error && (
          <div className="text-error break-all">????????????????: {draft.last_summary_error}</div>
        )}
      </div>

      {previewText && (
        <div className="bg-surface-soft rounded-xl p-4 border hairline">
          <div className="text-xs uppercase tracking-wider text-muted mb-2">???????????????</div>
          <pre className="text-xs whitespace-pre-wrap font-sans text-ink leading-relaxed">{previewText.replace(/<[^>]+>/g, '')}</pre>
        </div>
      )}
    </div>
  );
}
