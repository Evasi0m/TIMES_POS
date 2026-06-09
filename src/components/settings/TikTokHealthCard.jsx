// TikTok integration health panel (admin) — surfaces token freshness, whether
// background cron can run, the pending-confirm backlog, unmatched lines, and
// mapping completeness in one glance. Reads get_tiktok_health (migration 050).
import React, { useCallback, useEffect, useState } from 'react';
import { sb } from '../../lib/supabase-client.js';
import { mapError } from '../../lib/error-map.js';
import { formatTikTokApiError } from '../../lib/tiktok-mirror-helpers.js';
import { backfillMissingTikTokProductIds } from '../../lib/tiktok-inventory-sync.js';
import Icon from '../ui/Icon.jsx';

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
}

function minutesSince(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((Date.now() - t) / 60000);
}

const TONE = {
  ok: 'text-success',
  warn: 'text-warning',
  bad: 'text-error',
  muted: 'text-muted',
};

function Row({ label, value, tone = 'muted', hint }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b hairline last:border-0">
      <div className="min-w-0">
        <div className="text-sm text-ink">{label}</div>
        {hint && <div className="text-[11px] text-muted-soft mt-0.5">{hint}</div>}
      </div>
      <div className={'text-sm font-medium tabular-nums text-right shrink-0 ' + (TONE[tone] || TONE.muted)}>
        {value}
      </div>
    </div>
  );
}

export default function TikTokHealthCard({ toast }) {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await sb.rpc('get_tiktok_health');
    setLoading(false);
    if (err) {
      setError(mapError(err));
      return;
    }
    setHealth(data || null);
  }, []);

  useEffect(() => { load(); }, [load]);

  const runMappingBackfill = async () => {
    setBackfilling(true);
    try {
      toast?.push('กำลังโหลด catalog TikTok…', 'info', { durationMs: 8000 });
      const { healed, failed } = await backfillMissingTikTokProductIds({ limit: 50 });
      await load();
      setError(null);
      toast?.push(
        `ซ่อม mapping TikTok แล้ว ${healed} รายการ${failed ? ` (ไม่พบ ${failed})` : ''}`,
        healed > 0 ? 'success' : failed > 0 ? 'warning' : 'info',
      );
    } catch (e) {
      setError('ซ่อม mapping ไม่สำเร็จ: ' + formatTikTokApiError(mapError(e)));
    } finally {
      setBackfilling(false);
    }
  };

  if (loading && !health) {
    return (
      <div className="flex items-center gap-2 text-muted text-sm py-3 px-1">
        <span className="spinner"/> กำลังตรวจสถานะระบบ…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border hairline p-4 space-y-2">
        <div className="text-sm text-error">ตรวจสถานะไม่สำเร็จ: {error}</div>
        <button type="button" className="btn-secondary !py-1.5 !text-xs" onClick={load}>
          <Icon name="refresh" size={14}/> ลองใหม่
        </button>
      </div>
    );
  }

  if (!health) return null;

  const hoursLeft = health.access_token_hours_left;
  const tokenTone = health.token_expired ? 'bad' : (hoursLeft != null && hoursLeft < 24 ? 'warn' : 'ok');
  const tokenValue = health.token_expired
    ? 'หมดอายุ'
    : (hoursLeft != null ? `${hoursLeft} ชม.` : '—');

  const cronTone = health.cron_service_key_set === true ? 'ok'
    : (health.cron_service_key_set === false ? 'bad' : 'muted');
  const cronValue = health.cron_service_key_set === true ? 'เปิด'
    : (health.cron_service_key_set === false ? 'ปิด' : 'ตรวจไม่ได้');

  const syncMin = minutesSince(health.last_synced_at);
  const syncTone = syncMin == null ? 'muted' : (syncMin > 15 ? 'warn' : 'ok');
  const syncValue = syncMin == null ? '—'
    : (syncMin < 1 ? 'เมื่อสักครู่' : `${syncMin} นาทีก่อน`);

  const lastErr = health.last_error || health.last_refresh_error;

  return (
    <div className="rounded-xl border hairline p-4 space-y-1">
      <div className="flex items-center justify-between mb-1">
        <div className="font-semibold text-ink flex items-center gap-2">
          <Icon name="monitor" size={16}/> สถานะระบบ TikTok
        </div>
        <button
          type="button"
          className="btn-secondary !py-1 !px-2 !text-xs"
          onClick={load}
          disabled={loading}
        >
          {loading ? <span className="spinner"/> : <Icon name="refresh" size={13}/>}
          รีเฟรช
        </button>
      </div>

      <Row
        label="Cron อัตโนมัติ (poll / settlement / refresh)"
        hint={health.cron_service_key_set === false ? 'ตั้ง service_role_key ใน vault เพื่อเปิด' : 'ดึงออเดอร์เบื้องหลังทุก 5 นาที'}
        value={cronValue}
        tone={cronTone}
      />
      <Row
        label="Access token เหลืออายุ"
        hint={`หมดอายุ ${fmtDateTime(health.access_token_expires_at)}`}
        value={tokenValue}
        tone={tokenTone}
      />
      <Row
        label="Sync ล่าสุด"
        value={syncValue}
        tone={syncTone}
        hint={fmtDateTime(health.last_synced_at)}
      />
      <Row
        label="ออเดอร์รอยืนยัน"
        value={health.pending_count ?? '—'}
        tone={health.pending_count > 0 ? 'warn' : 'ok'}
      />
      <Row
        label="รายการรอจับคู่ SKU"
        hint={health.unmatched_items > 0 ? 'ไปที่ E-Commerce → จับคู่สินค้า' : undefined}
        value={health.unmatched_items ?? '—'}
        tone={health.unmatched_items > 0 ? 'warn' : 'ok'}
      />
      <Row
        label="Mapping พร้อม mirror สต็อก"
        hint={health.mappings_missing_product_id > 0 ? `ขาด product link ${health.mappings_missing_product_id} รายการ` : undefined}
        value={`${(health.mappings_total ?? 0) - (health.mappings_missing_product_id ?? 0)}/${health.mappings_total ?? 0}`}
        tone={health.mappings_missing_product_id > 0 ? 'warn' : 'ok'}
      />
      <Row
        label="Catalog mirror cap"
        hint="โหลด catalog สูงสุด ~500 SKU ต่อครั้ง — ร้านใหญ่ขึ้นอาจต้องเพิ่ม cap"
        value={health.catalog_mirror_max_skus ?? 500}
        tone="muted"
      />

      {health.mappings_missing_product_id > 0 && (
        <button
          type="button"
          className="btn-secondary w-full !py-2 !text-xs mt-2"
          onClick={runMappingBackfill}
          disabled={backfilling}
        >
          {backfilling ? <span className="spinner"/> : <Icon name="refresh" size={14}/>}
          ซ่อม mapping ที่ขาด product id ({health.mappings_missing_product_id})
        </button>
      )}

      {lastErr && (
        <div className="text-xs text-error bg-error/10 rounded-lg px-3 py-2 mt-2">
          {lastErr}
        </div>
      )}

      <div className="text-[10px] text-muted-soft pt-2 text-right">
        ตรวจเมื่อ {fmtDateTime(health.checked_at)}
      </div>
    </div>
  );
}
