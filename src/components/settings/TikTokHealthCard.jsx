// TikTok integration health panel — liquid glass UI (stock page only).
import React, { useCallback, useEffect, useState } from 'react';
import { sb } from '../../lib/supabase-client.js';
import { useCan } from '../../lib/perm-context.js';
import { mapError } from '../../lib/error-map.js';
import { formatTikTokApiError } from '../../lib/tiktok-mirror-helpers.js';
import {
  backfillMissingTikTokProductIds,
  backfillTikTokProductImages,
  catalogCapWarning,
  countTikTokCatalog,
  resetPollutedTikTokImages,
} from '../../lib/tiktok-inventory-sync.js';
import Icon from '../ui/Icon.jsx';
import {
  TikTokGlassShell,
  TikTokGlassHero,
  TikTokGlassStat,
  TikTokGlassBtn,
} from '../ecommerce/tiktok/glass/index.js';

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

function HealthSection({ title, children }) {
  return (
    <section className="tt-glass__health-section">
      <h3 className="tt-glass__health-section-title">{title}</h3>
      <div className="tt-glass__health-grid">{children}</div>
    </section>
  );
}

export default function TikTokHealthCard({ toast }) {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [imageBackfilling, setImageBackfilling] = useState(false);
  const [imageResetting, setImageResetting] = useState(false);
  const canRepair = useCan('settings.tiktok');
  const [error, setError] = useState(null);
  const [catalog, setCatalog] = useState(null);

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

  // TikTok listing count vs the full-catalog load cap (one cheap API call).
  // Best-effort: a failure just hides the line.
  useEffect(() => {
    if (!health?.connected) return undefined;
    let cancel = false;
    countTikTokCatalog()
      .then((c) => { if (!cancel) setCatalog(c); })
      .catch(() => { if (!cancel) setCatalog(null); });
    return () => { cancel = true; };
  }, [health?.connected]);
  const capWarning = catalogCapWarning(catalog);

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

  const runImageBackfill = async () => {
    setImageBackfilling(true);
    try {
      toast?.push('กำลังดึงรูปจาก TikTok Shop…', 'info', { durationMs: 60000 });
      const result = await backfillTikTokProductImages({ limit: 150 });
      setError(null);
      const parts = [
        `รวม ${result.synced} รายการ`,
        result.from_orders ? `จากออเดอร์ ${result.from_orders}` : null,
        result.from_catalog ? `จาก TikTok catalog ${result.from_catalog}` : null,
        result.refreshed ? `อัปเดตตาม TikTok ${result.refreshed}` : null,
        result.cleared ? `ลบรูป listing ที่ใช้แทน ${result.cleared}` : null,
        result.incomplete ? 'ยังตรวจไม่ครบ กดอีกครั้ง' : null,
        result.skipped ? `ข้าม ${result.skipped}` : null,
        result.no_image ? `ไม่มีรูป ${result.no_image}` : null,
        result.errors ? `ผิดพลาด ${result.errors}` : null,
      ].filter(Boolean);
      toast?.push(
        `ดึงรูป TikTok แล้ว — ${parts.join(' · ')}`,
        (result.synced || result.refreshed || result.cleared) ? 'success' : 'warning',
        { durationMs: 15000 },
      );
    } catch (e) {
      const msg = 'ดึงรูป TikTok ไม่สำเร็จ: ' + formatTikTokApiError(mapError(e));
      setError(msg);
      toast?.push(msg, 'error', { durationMs: 15000 });
    } finally {
      setImageBackfilling(false);
    }
  };

  const runImageReset = async () => {
    setImageResetting(true);
    try {
      toast?.push('กำลังล้างรูป TikTok ที่ผิดรุ่น…', 'info', { durationMs: 30000 });
      const r = await resetPollutedTikTokImages();
      setError(null);
      const total = r.substitution + r.orphan;
      toast?.push(
        total
          ? `ล้างรูปผิดแล้ว ${total} รุ่น (จากออเดอร์ส่งแทน ${r.substitution} · ยกเลิกจับคู่แล้ว ${r.orphan}) · ดึงรูปใหม่ ${r.refetched}`
          : 'ไม่พบรูป TikTok ที่ผิดรุ่น',
        total ? 'success' : 'info',
        { durationMs: 15000 },
      );
    } catch (e) {
      const msg = 'ล้างรูปผิดไม่สำเร็จ: ' + formatTikTokApiError(mapError(e));
      setError(msg);
      toast?.push(msg, 'error', { durationMs: 15000 });
    } finally {
      setImageResetting(false);
    }
  };

  if (loading && !health) {
    return (
      <TikTokGlassShell loading>
        <div className="tt-glass__health-loading">
          <span className="spinner"/>
          <span>กำลังตรวจสถานะระบบ…</span>
        </div>
      </TikTokGlassShell>
    );
  }

  if (error && !health) {
    return (
      <TikTokGlassShell>
        <div className="tt-glass__body-inner">
          <div className="tt-glass__alert">{error}</div>
          <TikTokGlassBtn variant="outline" onClick={load}>
            <Icon name="refresh" size={14}/> ลองใหม่
          </TikTokGlassBtn>
        </div>
      </TikTokGlassShell>
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
  const mappingReady = (health.mappings_total ?? 0) - (health.mappings_missing_product_id ?? 0);
  const metricCls = 'tt-glass__health-metric';

  return (
    <TikTokGlassShell>
      <TikTokGlassHero
        icon={<Icon name="monitor" size={20} color="#fff"/>}
        eyebrow="TikTok Shop · Health"
        title="สถานะระบบ TikTok"
        actions={(
          <TikTokGlassBtn variant="hero" onClick={load} disabled={loading}>
            {loading ? <span className="spinner"/> : <Icon name="refresh" size={14}/>}
            รีเฟรช
          </TikTokGlassBtn>
        )}
      />

      <div className="tt-glass__body-inner tt-glass__health-body">
        <div className="tt-glass__health-panel">
          <HealthSection title="ระบบ & การเชื่อมต่อ">
            <TikTokGlassStat
              tone={cronTone}
              className={metricCls}
              label="Cron อัตโนมัติ"
              hint={health.cron_service_key_set === false
                ? 'ตั้ง service_role_key ใน vault'
                : 'poll / settlement / refresh'}
              value={cronValue}
            />
            <TikTokGlassStat
              tone={tokenTone}
              className={metricCls}
              label="Access token"
              hint={`หมดอายุ ${fmtDateTime(health.access_token_expires_at)}`}
              value={tokenValue}
            />
            <TikTokGlassStat
              tone={syncTone}
              className={metricCls}
              label="Sync ล่าสุด"
              hint={fmtDateTime(health.last_synced_at)}
              value={syncValue}
            />
          </HealthSection>

          <HealthSection title="คิวงาน & ข้อมูล">
            <TikTokGlassStat
              tone={health.pending_count > 0 ? 'warn' : 'ok'}
              className={metricCls}
              label="ออเดอร์รอยืนยัน"
              value={health.pending_count ?? '—'}
            />
            <TikTokGlassStat
              tone={health.unmatched_items > 0 ? 'warn' : 'ok'}
              className={metricCls}
              label="รอจับคู่ SKU"
              hint={health.unmatched_items > 0 ? 'E-Commerce → จับคู่สินค้า' : undefined}
              value={health.unmatched_items ?? '—'}
            />
            <TikTokGlassStat
              tone={health.mappings_missing_product_id > 0 ? 'warn' : 'ok'}
              className={metricCls}
              label="Mapping mirror"
              hint={health.mappings_missing_product_id > 0
                ? `ขาด product link ${health.mappings_missing_product_id}`
                : 'พร้อม mirror สต็อก'}
              value={`${mappingReady}/${health.mappings_total ?? 0}`}
            />
          </HealthSection>
        </div>

        {(health.mappings_missing_product_id > 0 || (health.mappings_total ?? 0) > 0) && (
          <div className="tt-glass__health-toolbar">
            <p className="tt-glass__health-meta">
              {catalog?.total != null
                ? `TikTok ${catalog.total.toLocaleString('th-TH')} / ${catalog.max_products} listing`
                : `โหลด catalog ได้สูงสุด ${catalog?.max_products ?? 1000} listing`}
            </p>
            {canRepair && (
            <div className="tt-glass__health-actions">
              {health.mappings_missing_product_id > 0 && (
                <TikTokGlassBtn
                  variant="coral"
                  className="tt-glass__btn--lg"
                  onClick={runMappingBackfill}
                  disabled={backfilling || imageBackfilling || imageResetting}
                >
                  {backfilling ? <span className="spinner"/> : <Icon name="refresh" size={14}/>}
                  ซ่อม mapping ({health.mappings_missing_product_id})
                </TikTokGlassBtn>
              )}
              {(health.mappings_total ?? 0) > 0 && (
                <TikTokGlassBtn
                  variant="outline"
                  className="tt-glass__btn--lg"
                  onClick={runImageBackfill}
                  disabled={backfilling || imageBackfilling || imageResetting}
                >
                  {imageBackfilling ? <span className="spinner"/> : <Icon name="image" size={14}/>}
                  ดึงรูป SKU
                </TikTokGlassBtn>
              )}
              {(health.mappings_total ?? 0) > 0 && (
                <TikTokGlassBtn
                  variant="outline"
                  className="tt-glass__btn--lg"
                  onClick={runImageReset}
                  disabled={backfilling || imageBackfilling || imageResetting}
                  title="ลบรูปที่ติดมาจากออเดอร์ส่งแทนรุ่น หรือจาก SKU ที่ยกเลิกจับคู่แล้ว แล้วดึงรูปที่ถูกใหม่"
                >
                  {imageResetting ? <span className="spinner"/> : <Icon name="refresh" size={14}/>}
                  ล้างรูปผิดรุ่น
                </TikTokGlassBtn>
              )}
            </div>
            )}
          </div>
        )}

        {capWarning && <div className="tt-glass__alert">{capWarning}</div>}
        {lastErr && <div className="tt-glass__alert">{lastErr}</div>}
        {error && <div className="tt-glass__alert">{error}</div>}

        <footer className="tt-glass__health-footer">
          ตรวจเมื่อ {fmtDateTime(health.checked_at)}
        </footer>
      </div>
    </TikTokGlassShell>
  );
}
