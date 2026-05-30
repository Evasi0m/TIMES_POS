import React, { useState, useEffect, useCallback } from 'react';
import { sb } from '../../lib/supabase-client.js';
import { mapError } from '../../lib/error-map.js';
import Icon from '../ui/Icon.jsx';

/**
 * Admin control for the `product-image-backfill` edge function.
 *
 * Two actions:
 *   • "ดึงรูปเพิ่ม"      — resolve images for products that don't have one yet
 *                          (default mode), strip white bg, host in Storage.
 *   • "ลบพื้นหลังรูปเดิม" — re-run bg removal on already-found rows.
 *
 * Each click processes one small batch (the function caps work per call); press
 * again to continue. The function is admin-gated server-side, so this only works
 * for an authenticated admin.
 */
export default function ProductImageBackfillCard({ toast }) {
  const [counts, setCounts] = useState({ total: null, withImage: null });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const loadCounts = useCallback(async () => {
    try {
      const [tot, img] = await Promise.all([
        sb.from('products').select('id', { count: 'exact', head: true }),
        sb.from('product_images').select('product_id', { count: 'exact', head: true }).eq('status', 'found'),
      ]);
      setCounts({ total: tot.count ?? null, withImage: img.count ?? null });
    } catch { /* advisory only */ }
  }, []);

  useEffect(() => { loadCounts(); }, [loadCounts]);

  const run = async (body, label) => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const { data, error } = await sb.functions.invoke('product-image-backfill', { body });
      if (error) throw error;
      setResult(data);
      toast?.({
        variant: 'success',
        text: `${label}: พบ ${data?.found ?? 0} · ลบพื้นหลัง ${data?.bg_removed ?? 0} · ไม่พบ ${data?.not_found ?? 0} · ข้าม ${data?.skipped ?? 0}`,
      });
      await loadCounts();
    } catch (e) {
      toast?.({ variant: 'error', text: 'รันไม่สำเร็จ: ' + (mapError(e) || e?.message || 'unknown') });
    } finally {
      setBusy(false);
    }
  };

  const { total, withImage } = counts;

  return (
    <div className="card-canvas overflow-hidden">
      <div className="p-4 border-b hairline">
        <div className="font-semibold flex items-center gap-2">
          <Icon name="watch" size={16}/>
          รูปสินค้า (Product images)
        </div>
        <div className="text-xs text-muted-soft mt-0.5 tabular-nums">
          {total != null && withImage != null
            ? `มีรูปแล้ว ${withImage.toLocaleString('th-TH')} / ${total.toLocaleString('th-TH')} รายการ`
            : 'กำลังโหลดสถานะ…'}
        </div>
      </div>

      <div className="p-4 space-y-3">
        <p className="text-xs text-muted-soft leading-relaxed">
          ดึงรูปจากเว็บแบรนด์ (Casio, Alba), ลบพื้นหลังขาว แล้วเก็บเป็น PNG โปร่งใสในระบบ
          — ทำทีละชุด กดซ้ำเพื่อทำต่อจนครบ
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={busy}
            onClick={() => run({ limit: 25 }, 'ดึงรูปเพิ่ม')}
          >
            {busy ? <span className="spinner"/> : <Icon name="package-in" size={15}/>}
            ดึงรูปเพิ่ม (25)
          </button>
          <button
            type="button"
            className="btn-ghost text-sm"
            disabled={busy}
            onClick={() => run({ reprocessExisting: true, limit: 25 }, 'ลบพื้นหลังรูปเดิม')}
          >
            <Icon name="refresh" size={14} className={busy ? 'animate-spin' : ''}/>
            ลบพื้นหลังรูปเดิม
          </button>
        </div>

        {result && (
          <div className="text-xs text-muted-soft tabular-nums bg-surface-soft rounded-lg p-2.5">
            ประมวลผล {result.processed ?? 0} รายการ · พบ {result.found ?? 0} · ลบพื้นหลัง {result.bg_removed ?? 0}
            {' · '}ไม่พบ {result.not_found ?? 0} · ข้าม {result.skipped ?? 0}
            {result.remaining_hint ? ` — ${result.remaining_hint}` : ''}
          </div>
        )}
      </div>
    </div>
  );
}
