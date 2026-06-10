// TikTok returns/refunds — list + issue credit note (ใบลดหนี้).
import React, { useCallback, useEffect, useState } from 'react';
import { sb } from '../../lib/supabase-client.js';
import { mapError } from '../../lib/error-map.js';
import { fmtTHB } from '../../lib/format.js';
import Icon from '../ui/Icon.jsx';
import TikTokSection from './tiktok/TikTokSection.jsx';
import { TikTokGlassBtn } from './tiktok/glass/index.js';

const RETURN_STATUS = {
  RETURN_OR_REFUND_REQUEST_PENDING: 'รอตรวจสอบ',
  REFUND_OR_RETURN_REQUEST_REJECT_PENDING: 'รอปฏิเสธ',
  RETURN_OR_REFUND_REQUEST_SUCCESS: 'อนุมัติ',
  COMPLETED: 'เสร็จสิ้น',
  CANCELLED: 'ยกเลิก',
};

const RETURNS_GRID = 'grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,0.9fr)]';

export default function TikTokReturns({ toast }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await sb.from('tiktok_return_orders')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      setRows(data || []);
    } catch (e) {
      toast?.push('โหลดรายการคืนไม่ได้: ' + mapError(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await sb.functions.invoke('tiktok-returns-sync', {
        body: { hours: 720 },
      });
      if (error) {
        let msg = error.message || 'sync failed';
        try { const ctx = await error.context?.json?.(); if (ctx?.error) msg = ctx.error; } catch { /* ignore */ }
        throw new Error(msg);
      }
      if (data?.ok === false) throw new Error(data.error || 'sync failed');
      toast?.push(`ดึงรายการคืน ${data?.upserted ?? 0} รายการ`, 'success');
      await load();
    } catch (e) {
      toast?.push('ดึงรายการคืนไม่ได้: ' + mapError(e), 'error');
    } finally {
      setSyncing(false);
    }
  };

  const issueCreditNote = async (row) => {
    if (busy) return;
    setBusy(row.id);
    try {
      const { data, error } = await sb.rpc('create_tiktok_credit_note', {
        p_tiktok_return_id: row.id,
      });
      if (error) throw error;
      toast?.push(`ออกใบลดหนี้ ${data?.credit_note_no || ''}`, 'success');
      await load();
    } catch (e) {
      toast?.push('ออกใบลดหนี้ไม่ได้: ' + mapError(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <TikTokSection
      title="คืนเงิน / คืนสินค้า"
      subtitle={`${rows.length} รายการ`}
      actions={(
        <>
          <TikTokGlassBtn variant="hero" className="tt-glass__btn--lg" onClick={load} disabled={loading}>
            {loading ? <span className="spinner"/> : <Icon name="refresh" size={16}/>} รีเฟรช
          </TikTokGlassBtn>
          <TikTokGlassBtn variant="coral" className="tt-glass__btn--lg" onClick={sync} disabled={syncing}>
            {syncing ? <span className="spinner"/> : <Icon name="download" size={16}/>} ดึงรายการคืน
          </TikTokGlassBtn>
        </>
      )}
    >
      <div className="tt-glass__notice mb-4">
        <strong className="text-ink">แนะนำ:</strong> บันทึกรับคืนที่เมนู{' '}
        <strong className="text-ink">รับคืนจากลูกค้า</strong>{' '}
        เพื่อ sync สต็อก POS ↔ TikTok อัตโนมัติ — ปุ่ม &quot;ออกใบลดหนี้&quot; ด้านล่างออกเอกสารอย่างเดียว ไม่ mirror สต็อก
      </div>
      <div className="tt-glass__table overflow-x-auto">
        <div className={'tt-glass__table-head grid ' + RETURNS_GRID + ' min-w-[720px]'}>
          <span>TikTok Order</span>
          <span>ประเภท</span>
          <span>สถานะ</span>
          <span className="text-right">ยอดคืน</span>
          <span>ใบลดหนี้</span>
          <span>การกระทำ</span>
        </div>
        {rows.length === 0 && (
          <div className="tt-glass__table-empty">ไม่มีรายการคืน</div>
        )}
        <div className="tt-glass__table-body">
        {rows.map(r => (
          <div key={r.id} className={'tt-glass__table-row grid ' + RETURNS_GRID + ' min-w-[720px]'}>
            <span className="font-mono text-xs font-semibold">{r.tiktok_order_id || '—'}</span>
            <span className="text-xs">{r.return_type || '—'}</span>
            <span className="text-xs">{RETURN_STATUS[r.return_status] || r.return_status || '—'}</span>
            <span className="text-right tabular-nums">{r.refund_amount != null ? fmtTHB(r.refund_amount) : '—'}</span>
            <span className="font-mono text-xs">
              {r.return_order_id
                ? <span className="text-success">ออกแล้ว</span>
                : <span className="text-muted">—</span>}
            </span>
            <span>
              <TikTokGlassBtn
                variant="outline"
                disabled={!r.sale_order_id || !!r.return_order_id || busy === r.id}
                onClick={() => issueCreditNote(r)}
                title={!r.sale_order_id ? 'ยังไม่ผูกกับออเดอร์ POS' : ''}
              >
                {busy === r.id ? <span className="spinner"/> : 'ออกใบลดหนี้'}
              </TikTokGlassBtn>
            </span>
          </div>
        ))}
        </div>
      </div>
    </TikTokSection>
  );
}
