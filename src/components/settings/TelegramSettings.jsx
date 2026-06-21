// Telegram bot settings  token, chat, schedules, webhook, test/preview.
// super_admin only (tab gated in AppSettingsModal).

import React, { useCallback, useEffect, useState } from 'react';
import { sb } from '../../lib/supabase-client.js';
import { mapError } from '../../lib/error-map.js';
import Icon from '../ui/Icon.jsx';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

const MSG = {
  loadFail: '\u0e42\u0e2b\u0e25\u0e14 Telegram \u0e44\u0e21\u0e48\u0e44\u0e14\u0e49: ',
  saved: '\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01 Telegram \u0e41\u0e25\u0e49\u0e27',
  saveFail: '\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e44\u0e21\u0e48\u0e44\u0e14\u0e49: ',
  needToken: '\u0e43\u0e2a\u0e48 Bot Token \u0e41\u0e25\u0e49\u0e27\u0e01\u0e14\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e01\u0e48\u0e2d\u0e19',
  noChats: '\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e21\u0e35\u0e41\u0e0a\u0e17 \u2014 \u0e2a\u0e48\u0e07\u0e02\u0e49\u0e2d\u0e04\u0e27\u0e32\u0e21\u0e43\u0e2b\u0e49 bot \u0e01\u0e48\u0e2d\u0e19 1 \u0e04\u0e23\u0e31\u0e49\u0e07 \u0e41\u0e25\u0e49\u0e27\u0e25\u0e2d\u0e07\u0e43\u0e2b\u0e21\u0e48',
  chatFail: '\u0e14\u0e36\u0e07 Chat ID \u0e44\u0e21\u0e48\u0e44\u0e14\u0e49: ',
  testOk: '\u0e2a\u0e48\u0e07\u0e02\u0e49\u0e2d\u0e04\u0e27\u0e32\u0e21\u0e17\u0e14\u0e2a\u0e2d\u0e1a\u0e41\u0e25\u0e49\u0e27 \u2014 \u0e14\u0e39\u0e43\u0e19 Telegram',
  testFail: '\u0e17\u0e14\u0e2a\u0e2d\u0e1a\u0e2a\u0e48\u0e07\u0e44\u0e21\u0e48\u0e44\u0e14\u0e49: ',
  previewFail: '\u0e14\u0e39\u0e15\u0e31\u0e27\u0e2d\u0e22\u0e48\u0e32\u0e07\u0e44\u0e21\u0e48\u0e44\u0e14\u0e49: ',
  webhookOk: '\u0e15\u0e34\u0e14 webhook \u0e41\u0e25\u0e49\u0e27 \u2014 \u0e43\u0e0a\u0e49\u0e04\u0e33\u0e2a\u0e31\u0e48\u0e07 /today \u0e43\u0e19 Telegram \u0e44\u0e14\u0e49',
  webhookFail: '\u0e15\u0e34\u0e14 webhook \u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08',
  webhookErr: '\u0e15\u0e34\u0e14 webhook \u0e44\u0e21\u0e48\u0e44\u0e14\u0e49: ',
  webhookCheckErr: '\u0e15\u0e23\u0e27\u0e08 webhook \u0e44\u0e21\u0e48\u0e44\u0e14\u0e49: ',
  loading: '\u0e01\u0e33\u0e25\u0e31\u0e07\u0e42\u0e2b\u0e25\u0e14\u2026',
  intro: '\u0e2a\u0e48\u0e07\u0e2a\u0e23\u0e38\u0e1b\u0e22\u0e2d\u0e14\u0e2d\u0e31\u0e15\u0e42\u0e19\u0e21\u0e31\u0e15\u0e34 + \u0e15\u0e2d\u0e1a\u0e04\u0e33\u0e2a\u0e31\u0e48\u0e07\u0e43\u0e19 Telegram (/today, /yesterday, /sales, /lowstock)',
  connectBot: '\u0e40\u0e0a\u0e37\u0e48\u0e2d\u0e21\u0e15\u0e48\u0e2d Bot',
  fromBotFather: '\u0e08\u0e32\u0e01 @BotFather',
  pickChat: '\u2014 \u0e40\u0e25\u0e37\u0e2d\u0e01\u0e41\u0e0a\u0e17 \u2014',
  save: '\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01',
  testSend: '\u0e17\u0e14\u0e2a\u0e2d\u0e1a\u0e2a\u0e48\u0e07',
  preview: '\u0e14\u0e39\u0e15\u0e31\u0e27\u0e2d\u0e22\u0e48\u0e32\u0e07\u0e22\u0e2d\u0e14\u0e40\u0e21\u0e37\u0e48\u0e2d\u0e27\u0e32\u0e19',
  schedule: '\u0e01\u0e32\u0e23\u0e2a\u0e48\u0e07\u0e2d\u0e31\u0e15\u0e42\u0e19\u0e21\u0e31\u0e15\u0e34 (\u0e40\u0e27\u0e25\u0e32 \u0e01\u0e17\u0e21.)',
  daily: '\u0e2a\u0e23\u0e38\u0e1b\u0e23\u0e32\u0e22\u0e27\u0e31\u0e19 (\u0e40\u0e21\u0e37\u0e48\u0e2d\u0e27\u0e32\u0e19)',
  dailyHour: '\u0e40\u0e27\u0e25\u0e32\u0e2a\u0e48\u0e07\u0e23\u0e32\u0e22\u0e27\u0e31\u0e19',
  monthly: '\u0e2a\u0e23\u0e38\u0e1b\u0e23\u0e32\u0e22\u0e40\u0e14\u0e37\u0e2d\u0e19 (\u0e27\u0e31\u0e19\u0e17\u0e35\u0e48 1 \u0e02\u0e2d\u0e07\u0e40\u0e14\u0e37\u0e2d\u0e19)',
  monthlyHour: '\u0e40\u0e27\u0e25\u0e32\u0e2a\u0e48\u0e07\u0e23\u0e32\u0e22\u0e40\u0e14\u0e37\u0e2d\u0e19',
  lowStock: '\u0e40\u0e01\u0e13\u0e11\u0e36\u0e2a\u0e15\u0e47\u0e2d\u0e01\u0e15\u0e48\u0e33 (/lowstock)',
  stockAdjustNotify: '\u0e41\u0e08\u0e49\u0e07\u0e40\u0e15\u0e37\u0e2d\u0e19\u0e40\u0e21\u0e37\u0e48\u0e2d\u0e21\u0e35\u0e01\u0e32\u0e23\u0e1b\u0e23\u0e31\u0e1a\u0e2a\u0e15\u0e47\u0e2d\u0e01 (\u0e21\u0e37\u0e2d)',
  twoWay: 'Bot \u0e2a\u0e2d\u0e07\u0e17\u0e32\u0e07 (\u0e04\u0e33\u0e2a\u0e31\u0e48\u0e07\u0e43\u0e19\u0e41\u0e0a\u0e17)',
  installWebhook: '\u0e15\u0e34\u0e14 webhook',
  checkWebhook: '\u0e15\u0e23\u0e27\u0e08\u0e2a\u0e16\u0e32\u0e19\u0e30 webhook',
  lastDaily: '\u0e2a\u0e48\u0e07\u0e23\u0e32\u0e22\u0e27\u0e31\u0e19\u0e25\u0e48\u0e32\u0e2a\u0e38\u0e14:',
  lastMonthly: '\u0e2a\u0e48\u0e07\u0e23\u0e32\u0e22\u0e40\u0e14\u0e37\u0e2d\u0e19\u0e25\u0e48\u0e32\u0e2a\u0e38\u0e14:',
  lastErr: '\u0e02\u0e49\u0e2d\u0e1c\u0e34\u0e14\u0e1e\u0e25\u0e32\u0e14\u0e25\u0e48\u0e32\u0e2a\u0e38\u0e14:',
  previewTitle: '\u0e15\u0e31\u0e27\u0e2d\u0e22\u0e48\u0e32\u0e07\u0e02\u0e49\u0e2d\u0e04\u0e27\u0e32\u0e21',
  viewChatId: '\u0e14\u0e39 Chat ID',
  hourSuffix: ' \u0e19.',
  chatDefault: '\u0e41\u0e0a\u0e17',
  typePrivate: '\u0e2a\u0e48\u0e27\u0e19\u0e15\u0e31\u0e27',
  typeGroup: '\u0e01\u0e25\u0e38\u0e48\u0e21',
};

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
  else parts.push(MSG.chatDefault);
  const type = c.type === 'private' ? MSG.typePrivate : c.type === 'group' ? MSG.typeGroup : c.type || '';
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
        stock_adjust_notify_enabled,
        last_summary_sent_at,
        last_monthly_sent_at,
        last_summary_error
      `)
      .eq('id', 1)
      .maybeSingle();
    setLoading(false);
    if (error) {
      toast?.push(MSG.loadFail + mapError(error), 'error');
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
      stock_adjust_notify_enabled: data?.stock_adjust_notify_enabled ?? true,
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
        stock_adjust_notify_enabled: !!draft.stock_adjust_notify_enabled,
        daily_summary_enabled: !!draft.daily_enabled,
        daily_summary_hour: Number(draft.daily_hour) || 21,
      }).eq('id', 1);
      if (error) throw error;
      toast?.push(MSG.saved, 'success');
      await load();
    } catch (e) {
      toast?.push(MSG.saveFail + mapError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const fetchChats = async () => {
    if (!draft?.telegram_bot_token?.trim()) {
      toast?.push(MSG.needToken, 'error');
      return;
    }
    setBusy(true);
    try {
      await save();
      const data = await invoke({ action: 'list_chats' });
      setChats(data.chats || []);
      if (!data.chats?.length) {
        toast?.push(MSG.noChats, 'info');
      }
    } catch (e) {
      toast?.push(MSG.chatFail + mapError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const testSend = async () => {
    setBusy(true);
    try {
      await save();
      await invoke({ action: 'test' });
      toast?.push(MSG.testOk, 'success');
      await load();
    } catch (e) {
      toast?.push(MSG.testFail + mapError(e), 'error');
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
      toast?.push(MSG.previewFail + mapError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const installWebhook = async () => {
    setBusy(true);
    try {
      await save();
      const data = await invoke({ action: 'install_webhook' });
      if (data?.ok) toast?.push(MSG.webhookOk, 'success');
      else toast?.push(MSG.webhookFail, 'error');
    } catch (e) {
      toast?.push(MSG.webhookErr + mapError(e), 'error');
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
      toast?.push(MSG.webhookCheckErr + mapError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading || !draft) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted py-8 justify-center">
        <span className="spinner"/> {MSG.loading}
      </div>
    );
  }

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="space-y-5 fade-in">
      <div className="text-xs text-muted-soft bg-surface-soft rounded-lg px-3.5 py-2.5 border hairline">
        {MSG.intro}
      </div>

      <div className="bg-surface-soft rounded-xl p-4 border hairline space-y-3">
        <div className="text-sm font-medium text-ink flex items-center gap-1.5">
          <Icon name="link" size={15} className="text-primary"/> {MSG.connectBot}
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-muted">Bot Token</label>
          <input
            type="password"
            className="input mt-1 w-full font-mono text-sm"
            placeholder="123456789:ABC..."
            value={draft.telegram_bot_token}
            onChange={(e) => set('telegram_bot_token', e.target.value)}
            autoComplete="off"
          />
          <div className="text-[11px] text-muted-soft mt-1">{MSG.fromBotFather}</div>
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
              {MSG.viewChatId}
            </button>
          </div>
          {chats.length > 0 && (
            <select
              className="input mt-2 w-full text-sm"
              value={draft.telegram_chat_id}
              onChange={(e) => set('telegram_chat_id', e.target.value)}
            >
              <option value="">{MSG.pickChat}</option>
              {chats.map((c) => (
                <option key={c.id} value={String(c.id)}>{chatLabel(c)}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className="btn-primary !py-2 !px-4 text-sm" onClick={save} disabled={busy}>
            {busy ? <span className="spinner"/> : <Icon name="check" size={14}/>}
            {MSG.save}
          </button>
          <button type="button" className="btn-secondary !py-2 !px-3 text-sm" onClick={testSend} disabled={busy}>
            {MSG.testSend}
          </button>
          <button type="button" className="btn-secondary !py-2 !px-3 text-sm" onClick={previewYesterday} disabled={busy}>
            {MSG.preview}
          </button>
        </div>
      </div>

      <div className="bg-surface-soft rounded-xl p-4 border hairline space-y-4">
        <div className="text-sm font-medium text-ink">{MSG.schedule}</div>

        <label className="flex items-center justify-between gap-3 cursor-pointer">
          <span className="text-sm">{MSG.daily}</span>
          <input type="checkbox" checked={draft.daily_enabled} onChange={(e) => set('daily_enabled', e.target.checked)} />
        </label>
        {draft.daily_enabled && (
          <div>
            <label className="text-xs text-muted">{MSG.dailyHour}</label>
            <select className="input mt-1 w-full" value={draft.daily_hour} onChange={(e) => set('daily_hour', Number(e.target.value))}>
              {HOURS.map((h) => (
                <option key={h} value={h}>{String(h).padStart(2, '0')}:00{MSG.hourSuffix}</option>
              ))}
            </select>
          </div>
        )}

        <label className="flex items-center justify-between gap-3 cursor-pointer border-t hairline-soft pt-3">
          <span className="text-sm">{MSG.monthly}</span>
          <input type="checkbox" checked={draft.monthly_enabled} onChange={(e) => set('monthly_enabled', e.target.checked)} />
        </label>
        {draft.monthly_enabled && (
          <div>
            <label className="text-xs text-muted">{MSG.monthlyHour}</label>
            <select className="input mt-1 w-full" value={draft.monthly_hour} onChange={(e) => set('monthly_hour', Number(e.target.value))}>
              {HOURS.map((h) => (
                <option key={h} value={h}>{String(h).padStart(2, '0')}:00{MSG.hourSuffix}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="text-xs text-muted">{MSG.lowStock}</label>
          <input
            type="number"
            min={0}
            max={999}
            className="input mt-1 w-24"
            value={draft.low_stock_threshold}
            onChange={(e) => set('low_stock_threshold', e.target.value)}
          />
        </div>

        <label className="flex items-center justify-between gap-3 cursor-pointer border-t hairline-soft pt-3">
          <span className="text-sm">{MSG.stockAdjustNotify}</span>
          <input
            type="checkbox"
            checked={draft.stock_adjust_notify_enabled}
            onChange={(e) => set('stock_adjust_notify_enabled', e.target.checked)}
          />
        </label>
      </div>

      <div className="bg-surface-soft rounded-xl p-4 border hairline space-y-3">
        <div className="text-sm font-medium text-ink">{MSG.twoWay}</div>
        <div className="text-[11px] text-muted-soft">
          /today /yesterday /month /lastmonth /sales 7 /lowstock /help
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary !py-2 !px-3 text-sm" onClick={installWebhook} disabled={busy}>
            {MSG.installWebhook}
          </button>
          <button type="button" className="btn-secondary !py-2 !px-3 text-sm" onClick={checkWebhook} disabled={busy}>
            {MSG.checkWebhook}
          </button>
        </div>
        {webhookInfo && (
          <pre className="text-[10px] font-mono bg-surface-strong rounded p-2 overflow-x-auto max-h-32">
            {JSON.stringify(webhookInfo, null, 2)}
          </pre>
        )}
      </div>

      <div className="text-[11px] text-muted space-y-1 font-mono">
        <div>{MSG.lastDaily} {fmtDateTime(draft.last_summary_sent_at)}</div>
        <div>{MSG.lastMonthly} {fmtDateTime(draft.last_monthly_sent_at)}</div>
        {draft.last_summary_error && (
          <div className="text-error break-all">{MSG.lastErr} {draft.last_summary_error}</div>
        )}
      </div>

      {previewText && (
        <div className="bg-surface-soft rounded-xl p-4 border hairline">
          <div className="text-xs uppercase tracking-wider text-muted mb-2">{MSG.previewTitle}</div>
          <pre className="text-xs whitespace-pre-wrap font-sans text-ink leading-relaxed">{previewText.replace(/<[^>]+>/g, '')}</pre>
        </div>
      )}
    </div>
  );
}
