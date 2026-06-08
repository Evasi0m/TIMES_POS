// TikTok Shop connection status + OAuth connect button (admin).
import React, { useCallback, useEffect, useState } from 'react';
import { sb } from '../../lib/supabase-client.js';
import { mapError } from '../../lib/error-map.js';
import Icon from '../ui/Icon.jsx';
import TikTokHealthCard from './TikTokHealthCard.jsx';

function fmtExpiry(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
}

export default function TikTokSettings({ toast, compact = false }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await sb.rpc('get_tiktok_connection_status');
    setLoading(false);
    if (error) {
      toast?.push('โหลดสถานะ TikTok ไม่ได้: ' + mapError(error), 'error');
      return;
    }
    setStatus(data || { connected: false });
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tiktok') === 'connected') {
      toast?.push('เชื่อมต่อ TikTok Shop สำเร็จ', 'success');
      params.delete('tiktok');
      const q = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (q ? '?' + q : ''));
      load();
    }
    const err = params.get('tiktok_error');
    if (err) {
      toast?.push('เชื่อมต่อ TikTok ไม่สำเร็จ: ' + decodeURIComponent(err), 'error');
      params.delete('tiktok_error');
      const q = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (q ? '?' + q : ''));
    }
  }, [load, toast]);

  const connect = async () => {
    setConnecting(true);
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session?.access_token) {
        toast?.push('กรุณาเข้าสู่ระบบก่อน', 'error');
        return;
      }
      const { data, error } = await sb.functions.invoke('tiktok-connect', { method: 'POST' });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      toast?.push(data?.error || 'เริ่ม OAuth ไม่ได้', 'error');
    } catch (e) {
      toast?.push('เชื่อมต่อไม่ได้: ' + mapError(e), 'error');
    } finally {
      setConnecting(false);
    }
  };

  const connected = status?.connected;
  const expired = status?.token_expired;
  const statusLabel = connected
    ? (expired ? 'หมดอายุ — ต้องเชื่อมต่อใหม่' : 'เชื่อมต่อแล้ว')
    : 'ยังไม่เชื่อมต่อ';

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted text-sm py-3 px-1">
        <span className="spinner"/> กำลังโหลดสถานะการเชื่อมต่อ…
      </div>
    );
  }

  if (compact) {
    return (
      <div className="rounded-xl border hairline overflow-hidden bg-surface-strong/50">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5 lg:py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className={
              'w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ' +
              (connected && !expired ? 'bg-success/15' : 'bg-surface-soft')
            }>
              <Icon name="store" size={18} className={connected && !expired ? 'text-success' : 'text-muted'}/>
            </div>
            <div className="min-w-0">
              <div className={'text-sm font-semibold ' + (expired ? 'text-error' : 'text-ink')}>{statusLabel}</div>
              {status?.shop_name && (
                <div className="text-xs text-muted truncate">{status.shop_name}</div>
              )}
            </div>
          </div>

          {connected && (
            <>
              <div className="hidden sm:block w-px h-9 bg-hairline shrink-0"/>
              <div className="text-xs shrink-0">
                <div className="text-muted-soft mb-0.5">เชื่อมต่อเมื่อ</div>
                <div className="tabular-nums">{fmtExpiry(status.connected_at)}</div>
              </div>
              <div className="text-xs shrink-0">
                <div className="text-muted-soft mb-0.5">Token หมดอายุ</div>
                <div className={'tabular-nums ' + (expired ? 'text-error font-medium' : '')}>
                  {fmtExpiry(status.access_token_expires_at)}
                </div>
              </div>
            </>
          )}

          <button
            type="button"
            className="btn-secondary !py-1.5 !text-xs ml-auto shrink-0"
            onClick={connect}
            disabled={connecting}
          >
            {connecting ? <span className="spinner"/> : <Icon name="refresh" size={14}/>}
            {connected ? 'เชื่อมต่อใหม่' : 'เชื่อมต่อ TikTok Shop'}
          </button>
        </div>

        {(status?.last_error || status?.last_refresh_error) && (
          <div className="text-xs text-error bg-error/10 border-t hairline px-4 py-2">
            {status.last_error || status.last_refresh_error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 fade-in">
      <div className="text-xs text-muted-soft bg-surface-soft rounded-lg px-3.5 py-2.5 border hairline">
        เชื่อมต่อ TikTok Shop เพื่อดึงออเดอร์อัตโนมัติ — ต้องตั้งค่า Partner Center และ Supabase secrets ก่อน (ดู docs/TIKTOK_INTEGRATION.md)
      </div>

      <div className="rounded-xl border hairline p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className={"w-10 h-10 rounded-xl flex items-center justify-center " + (connected && !expired ? 'bg-success/15' : 'bg-surface-soft')}>
            <Icon name="store" size={20} className={connected && !expired ? 'text-success' : 'text-muted'}/>
          </div>
          <div>
            <div className="font-semibold text-ink">{statusLabel}</div>
            {status?.shop_name && (
              <div className="text-sm text-muted">{status.shop_name}</div>
            )}
          </div>
        </div>

        {connected && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-soft mb-0.5">เชื่อมต่อเมื่อ</div>
              <div>{fmtExpiry(status.connected_at)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-soft mb-0.5">Token หมดอายุ</div>
              <div className={expired ? 'text-error font-medium' : ''}>{fmtExpiry(status.access_token_expires_at)}</div>
            </div>
          </div>
        )}

        {(status?.last_error || status?.last_refresh_error) && (
          <div className="text-xs text-error bg-error/10 rounded-lg px-3 py-2">
            {status.last_error || status.last_refresh_error}
          </div>
        )}

        <button type="button" className="btn-primary w-full sm:w-auto" onClick={connect} disabled={connecting}>
          {connecting ? <span className="spinner"/> : <Icon name="store" size={16}/>}
          {connected ? 'เชื่อมต่อใหม่' : 'เชื่อมต่อ TikTok Shop'}
        </button>
      </div>

      {connected && <TikTokHealthCard />}
    </div>
  );
}
