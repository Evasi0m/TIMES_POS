// TikTok Shop OAuth strip — refined liquid glass (orders page).
import React, { useCallback, useEffect, useState } from 'react';
import { sb } from '../../lib/supabase-client.js';
import { mapError } from '../../lib/error-map.js';
import Icon from '../ui/Icon.jsx';
import {
  TikTokGlassShell,
  TikTokGlassHero,
  TikTokGlassStat,
  TikTokGlassBadge,
  TikTokGlassBtn,
} from '../ecommerce/tiktok/glass/index.js';

function fmtExpiry(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
}

function statusTone(connected, expired) {
  if (!connected) return 'idle';
  if (expired) return 'expired';
  return 'live';
}

export default function TikTokSettings({
  toast,
  livePollSec,
  liveLabel,
  pullBusy,
}) {
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
  const tone = statusTone(connected, expired);
  const statusLabel = connected
    ? (expired ? 'Token หมดอายุ' : 'เชื่อมต่อแล้ว')
    : 'ยังไม่เชื่อมต่อ';
  const lastErr = status?.last_error || status?.last_refresh_error;
  const showLiveFooter = livePollSec != null;

  if (loading) {
    return (
      <TikTokGlassShell loading className={'tt-glass--' + tone}>
        <span className="spinner"/> กำลังโหลดสถานะการเชื่อมต่อ…
      </TikTokGlassShell>
    );
  }

  return (
    <TikTokGlassShell className={'tt-glass--' + tone}>
      <TikTokGlassHero
        icon={<Icon name="shop-bag" size={20} color="#fff"/>}
        eyebrow="TikTok Shop · OAuth"
        title={status?.shop_name || 'เชื่อมต่อร้านค้า'}
        actions={(
          <>
            <TikTokGlassBadge tone={tone}>{statusLabel}</TikTokGlassBadge>
            <TikTokGlassBtn variant="coral" onClick={connect} disabled={connecting}>
              {connecting ? <span className="spinner"/> : <Icon name="link" size={14}/>}
              {connected ? 'เชื่อมต่อใหม่' : 'เชื่อมต่อ'}
            </TikTokGlassBtn>
          </>
        )}
      />

      {connected && (
        <div className="tt-glass__stats">
          <TikTokGlassStat
            icon="calendar"
            label="เชื่อมต่อเมื่อ"
            value={fmtExpiry(status.connected_at)}
          />
          <TikTokGlassStat
            icon="lock"
            label={expired ? 'หมดอายุเมื่อ' : 'ใช้ได้ถึง'}
            value={fmtExpiry(status.access_token_expires_at)}
            warn={expired}
          />
        </div>
      )}

      {lastErr && (
        <div className="tt-glass__alert" style={{ margin: '0.5rem 0.625rem 0' }}>
          <Icon name="alert" size={14}/>
          <span>{lastErr}</span>
        </div>
      )}

      {showLiveFooter && (
        <footer className="tt-glass__livebar">
          <div className="tt-glass__livebar-track">
            <span className="tt-glass__livebar-label">
              Auto-sync · ทุก {livePollSec}s
            </span>
            {liveLabel && (
              <span className="tt-glass__livebar-time tabular-nums">
                {liveLabel}
              </span>
            )}
            <span className={'tt-glass__live-chip' + (pullBusy ? ' tt-glass__live-chip--busy' : '')}>
              <span className="tt-glass__live-chip-dot"/>
              {pullBusy ? 'Syncing' : 'Live'}
            </span>
          </div>
        </footer>
      )}
    </TikTokGlassShell>
  );
}
