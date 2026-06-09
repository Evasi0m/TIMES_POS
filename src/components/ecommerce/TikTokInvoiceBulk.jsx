// TikTok bulk tax invoice — edit buyer, issue, print A4, CSV export.
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { sb } from '../../lib/supabase-client.js';
import { mapError } from '../../lib/error-map.js';
import { fmtThaiDateShort } from '../../lib/format.js';
import { fullBuyerValid } from '../../lib/tax-buyer.js';
import FullTaxInvoiceA4 from '../invoice/FullTaxInvoiceA4.jsx';
import Icon from '../ui/Icon.jsx';
import TikTokSection from './tiktok/TikTokSection.jsx';

function buyerReady(order) {
  return fullBuyerValid({
    name: order.buyer_name,
    address: order.buyer_address,
    taxId: order.buyer_tax_id,
  });
}

export default function TikTokInvoiceSection({ orders, itemsByOrder, toast, onOrdersChange }) {
  const [shop, setShop] = useState(null);
  const [editOrder, setEditOrder] = useState(null);
  const [buyer, setBuyer] = useState({ name: '', taxId: '', address: '', branch: 'สำนักงานใหญ่' });
  const [busy, setBusy] = useState(null);
  const [printOrders, setPrintOrders] = useState(null);
  const [printItems, setPrintItems] = useState({});
  const copies = 'both';

  useEffect(() => {
    sb.from('shop_settings').select('*').eq('id', 1).single().then(({ data }) => setShop(data));
  }, []);

  const activeOrders = orders.filter(o => o.status !== 'voided');

  const openEdit = (order) => {
    setEditOrder(order);
    setBuyer({
      name: order.buyer_name || order.shipping_recipient_name || '',
      taxId: order.buyer_tax_id || '',
      address: order.buyer_address || order.shipping_address || '',
      branch: order.buyer_branch || 'สำนักงานใหญ่',
    });
  };

  const saveAndIssue = async () => {
    if (!editOrder || busy) return;
    if (!fullBuyerValid(buyer)) {
      toast?.push('ต้องมี ชื่อ + เลขผู้เสียภาษี (10-13 หลัก) + ที่อยู่', 'error');
      return;
    }
    setBusy(editOrder.id);
    try {
      const { data, error } = await sb.rpc('issue_tax_invoice_for_order', {
        p_order_id: editOrder.id,
        p_buyer: {
          buyer_name: buyer.name.trim(),
          buyer_tax_id: buyer.taxId.replace(/\D/g, ''),
          buyer_address: buyer.address.trim(),
          buyer_branch: buyer.branch.trim() || 'สำนักงานใหญ่',
        },
      });
      if (error) throw error;
      toast?.push(`ออกใบกำกับ ${data.tax_invoice_no}`, 'success');
      onOrdersChange?.(list => list.map(o => o.id === data.id ? { ...o, ...data } : o));
      setEditOrder(null);
    } catch (e) {
      toast?.push('ออกใบกำกับไม่ได้: ' + mapError(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const loadForPrint = useCallback(async (orderIds) => {
    const itemsMap = {};
    for (const id of orderIds) {
      const { data } = await sb.from('sale_order_items')
        .select('*')
        .eq('sale_order_id', id)
        .order('id');
      itemsMap[id] = data || [];
    }
    setPrintItems(itemsMap);
  }, []);

  const printOne = async (order) => {
    if (!buyerReady(order)) {
      openEdit(order);
      toast?.push('กรุณาเติม Tax ID ก่อนพิมพ์', 'info');
      return;
    }
    setPrintOrders([order]);
    await loadForPrint([order.id]);
    setTimeout(() => window.print(), 300);
  };

  const printBulk = async () => {
    const ready = activeOrders.filter(buyerReady);
    if (!ready.length) {
      toast?.push('ไม่มีออเดอร์ที่พร้อมพิมพ์ (ต้องมี Tax ID ครบ)', 'error');
      return;
    }
    setPrintOrders(ready);
    await loadForPrint(ready.map(o => o.id));
    setTimeout(() => window.print(), 400);
  };

  const exportCsv = () => {
    const rows = activeOrders.filter(o => o.tax_invoice_no);
    if (!rows.length) {
      toast?.push('ไม่มีใบกำกับในช่วงนี้', 'info');
      return;
    }
    const header = ['เลขใบกำกับ', 'วันที่', 'TikTok Order', 'POS #', 'ผู้ซื้อ', 'Tax ID', 'สาขา', 'ที่อยู่', 'ยอดรวม', 'VAT'];
    const lines = rows.map(o => [
      o.tax_invoice_no,
      fmtThaiDateShort(String(o.sale_date || '').slice(0, 10)),
      o.tiktok_order_id || '',
      o.id,
      o.buyer_name || '',
      o.buyer_tax_id || '',
      o.buyer_branch || '',
      (o.buyer_address || '').replace(/"/g, '""'),
      o.grand_total,
      o.vat_amount,
    ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    const bom = '\uFEFF';
    const blob = new Blob([bom + header.join(',') + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tiktok-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const a4Copies = copies === 'both' ? ['ต้นฉบับ', 'สำเนา'] : copies === 'copy' ? ['สำเนา'] : ['ต้นฉบับ'];

  return (
    <TikTokSection
      title="ใบกำกับภาษีเต็มรูป"
      subtitle={`${activeOrders.length} ออเดอร์ TikTok`}
      actions={(
        <>
          <button type="button" className="btn-secondary !h-11 !py-0 !px-4 !text-sm" onClick={exportCsv}>
            <Icon name="download" size={16}/> Export CSV
          </button>
          <button type="button" className="btn-primary !h-11 !py-0 !px-4 !text-sm" onClick={printBulk}>
            <Icon name="receipt" size={16}/> พิมพ์ใบกำกับทั้งหมด
          </button>
        </>
      )}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b hairline">
              <th className="py-2 px-3">TikTok Order</th>
              <th className="py-2 px-3">ผู้ซื้อ</th>
              <th className="py-2 px-3">Tax ID</th>
              <th className="py-2 px-3">เลขใบกำกับ</th>
              <th className="py-2 px-3">การกระทำ</th>
            </tr>
          </thead>
          <tbody>
            {activeOrders.length === 0 && (
              <tr><td colSpan={5} className="py-6 text-center text-muted text-sm">ไม่มีออเดอร์</td></tr>
            )}
            {activeOrders.map(o => (
              <tr key={o.id} className="border-b hairline last:border-0">
                <td className="py-2 px-3 font-mono text-xs">{o.tiktok_order_id || `#${o.id}`}</td>
                <td className="py-2 px-3">{o.buyer_name || o.shipping_recipient_name || '—'}</td>
                <td className="py-2 px-3">
                  {buyerReady(o)
                    ? <span className="text-success text-xs">ครบ</span>
                    : <span className="text-[#8a6500] text-xs">รอ Tax ID</span>}
                </td>
                <td className="py-2 px-3 font-mono text-xs">{o.tax_invoice_no || '—'}</td>
                <td className="py-2 px-3">
                  <div className="flex gap-1">
                    <button type="button" className="btn-secondary !py-1 !text-xs" onClick={() => openEdit(o)}>
                      แก้/ออกใบ
                    </button>
                    <button
                      type="button"
                      className="btn-secondary !py-1 !text-xs"
                      disabled={!buyerReady(o)}
                      onClick={() => printOne(o)}
                    >
                      พิมพ์ A4
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editOrder && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40" onClick={() => setEditOrder(null)}>
          <div className="card-canvas rounded-xl p-5 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-medium mb-3">ข้อมูลผู้ซื้อ — {editOrder.tiktok_order_id}</h3>
            <div className="space-y-3 text-sm">
              <div>
                <label className="text-xs text-muted block mb-1">ชื่อผู้ซื้อ *</label>
                <input className="input w-full" value={buyer.name} onChange={e => setBuyer(b => ({ ...b, name: e.target.value }))}/>
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">เลขประจำตัวผู้เสียภาษี *</label>
                <input className="input w-full" value={buyer.taxId} onChange={e => setBuyer(b => ({ ...b, taxId: e.target.value }))}/>
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">ที่อยู่ *</label>
                <textarea className="input w-full min-h-[80px]" value={buyer.address} onChange={e => setBuyer(b => ({ ...b, address: e.target.value }))}/>
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">สาขา</label>
                <input className="input w-full" value={buyer.branch} onChange={e => setBuyer(b => ({ ...b, branch: e.target.value }))}/>
              </div>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button type="button" className="btn-secondary" onClick={() => setEditOrder(null)}>ยกเลิก</button>
              <button type="button" className="btn-primary" disabled={busy === editOrder.id} onClick={saveAndIssue}>
                {busy === editOrder.id ? <span className="spinner"/> : 'ออกใบกำกับ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk A4 print portal */}
      {printOrders?.length > 0 && shop && createPortal(
        <div className="fulltax-print-portal">
          {printOrders.flatMap(order =>
            a4Copies.map(label => (
              <FullTaxInvoiceA4
                key={`${order.id}-${label}`}
                order={order}
                items={printItems[order.id] || itemsByOrder[order.id] || []}
                shop={shop}
                copyLabel={label}
              />
            )),
          )}
        </div>,
        document.body,
      )}
    </TikTokSection>
  );
}

export { buyerReady };
