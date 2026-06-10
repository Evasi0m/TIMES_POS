// TikTok returns/refunds — list + issue credit note (ใบลดหนี้).
import React, { useCallback, useEffect, useState } from 'react';
import { sb } from '../../lib/supabase-client.js';
import { mapError } from '../../lib/error-map.js';
import { fmtTHB } from '../../lib/format.js';
import Icon from '../ui/Icon.jsx';
import TikTokSection from './tiktok/TikTokSection.jsx';

const RETURN_STATUS = {
  RETURN_OR_REFUND_REQUEST_PENDING: 'รอตรวจสอบ',
  REFUND_OR_RETURN_REQUEST_REJECT_PENDING: 'รอปฏิเสธ',
  RETURN_OR_REFUND_REQUEST_SUCCESS: 'อนุมัติ',
  COMPLETED: 'เสร็จสิ้น',
  CANCELLED: 'ยกเลิก',
};

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
          <button type="button" className="btn-secondary !h-11 !py-0 !px-4 !text-sm" onClick={load} disabled={loading}>
            {loading ? <span className="spinner"/> : <Icon name="refresh" size={16}/>} รีเฟรช
          </button>
          <button type="button" className="btn-primary !h-11 !py-0 !px-4 !text-sm" onClick={sync} disabled={syncing}>
            {syncing ? <span className="spinner"/> : <Icon name="download" size={16}/>} ดึงรายการคืน
          </button>
        </>
      )}
    >
      <div className="mb-4 rounded-xl border hairline bg-surface-soft px-4 py-3 text-sm text-muted leading-relaxed">
        <strong className="text-ink">แนะนำ:</strong> บันทึกรับคืนที่เมนู{' '}
        <strong className="text-ink">รับคืนจากลูกค้า</strong>{' '}
        เพื่อ sync สต็อก POS ↔ TikTok อัตโนมัติ — ปุ่ม &quot;ออกใบลดหนี้&quot; ด้านล่างออกเอกสารอย่างเดียว ไม่ mirror สต็อก
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b hairline">
              <th className="py-2 px-3">TikTok Order</th>
              <th className="py-2 px-3">ประเภท</th>
              <th className="py-2 px-3">สถานะ</th>
              <th className="py-2 px-3 text-right">ยอดคืน</th>
              <th className="py-2 px-3">ใบลดหนี้</th>
              <th className="py-2 px-3">การกระทำ</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-muted text-sm">ไม่มีรายการคืน</td></tr>
            )}
            {rows.map(r => (
              <tr key={r.id} className="border-b hairline last:border-0">
                <td className="py-2 px-3 font-mono text-xs">{r.tiktok_order_id || '—'}</td>
                <td className="py-2 px-3 text-xs">{r.return_type || '—'}</td>
                <td className="py-2 px-3 text-xs">{RETURN_STATUS[r.return_status] || r.return_status || '—'}</td>
                <td className="py-2 px-3 text-right tabular-nums">{r.refund_amount != null ? fmtTHB(r.refund_amount) : '—'}</td>
                <td className="py-2 px-3 font-mono text-xs">
                  {r.return_order_id
                    ? <span className="text-success">ออกแล้ว</span>
                    : <span className="text-muted">—</span>}
                </td>
                <td className="py-2 px-3">
                  <button
                    type="button"
                    className="btn-secondary !py-1 !text-xs"
                    disabled={!r.sale_order_id || !!r.return_order_id || busy === r.id}
                    onClick={() => issueCreditNote(r)}
                    title={!r.sale_order_id ? 'ยังไม่ผูกกับออเดอร์ POS' : ''}
                  >
                    {busy === r.id ? <span className="spinner"/> : 'ออกใบลดหนี้'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TikTokSection>
  );
}
