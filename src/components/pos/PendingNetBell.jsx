import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { sb } from '../../lib/supabase-client.js';
import Icon from '../ui/Icon.jsx';
import ProductThumb from '../ui/ProductThumb.jsx';

/**
 * Notification bell for e-commerce sales rung up with "ใส่ทีหลัง" — i.e. bills
 * whose real net_received hasn't been entered yet (sale_orders.net_received_pending).
 *
 * Hidden when there's nothing pending. When there is, the bell turns red with a
 * count and (on desktop) an iMessage-style bubble pointing at it. Clicking opens
 * an iOS Haptic-Touch-style blurred popover listing the pending bills (product
 * image, name, date, #bill). Tapping a bill opens a number-entry popup that
 * writes net_received and clears the pending flag.
 *
 * Stays in sync via the `pending-net-changed` window event (dispatched after a
 * sale is rung up and after an amount is saved) plus a refetch on window focus.
 *
 * Props:
 *   toast — function(message, type) from useToast().push
 */

const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok',
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
};

export default function PendingNetBell({ toast }) {
  const [bills, setBills]   = useState([]);
  const [open, setOpen]     = useState(false);
  const [entry, setEntry]   = useState(null); // bill currently being filled
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data: orders, error } = await sb.from('sale_orders')
      .select('id, sale_date')
      .eq('net_received_pending', true)
      .eq('status', 'active')
      .order('sale_date', { ascending: false });
    if (error || !orders?.length) { setBills([]); return; }

    const ids = orders.map(o => o.id);
    const { data: items } = await sb.from('sale_order_items')
      .select('sale_order_id, product_id, product_name')
      .in('sale_order_id', ids);

    // Resolve thumbnails for the products that have a hosted image.
    const productIds = [...new Set((items || []).map(i => i.product_id).filter(Boolean))];
    const imgMap = {};
    if (productIds.length) {
      const { data: imgs } = await sb.from('product_images')
        .select('product_id, image_url, status')
        .in('product_id', productIds)
        .eq('status', 'found');
      (imgs || []).forEach(r => { imgMap[r.product_id] = r.image_url; });
    }

    const byOrder = {};
    (items || []).forEach(i => {
      (byOrder[i.sale_order_id] ||= []).push({
        product_id: i.product_id,
        name: i.product_name || '',
        _imageUrl: i.product_id ? (imgMap[i.product_id] || null) : null,
      });
    });

    setBills(orders.map(o => ({
      id: o.id, sale_date: o.sale_date, items: byOrder[o.id] || [],
    })));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onChange = () => load();
    window.addEventListener('pending-net-changed', onChange);
    window.addEventListener('focus', onChange);
    return () => {
      window.removeEventListener('pending-net-changed', onChange);
      window.removeEventListener('focus', onChange);
    };
  }, [load]);

  useEffect(() => {
    if (!open && !entry) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { if (entry) setEntry(null); else setOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, entry]);

  const count = bills.length;
  if (count === 0) return null;

  const openEntry = (bill) => { setEntry(bill); setAmount(''); };

  const save = async () => {
    const value = Number(amount);
    if (!amount || !(value > 0)) { toast?.('กรุณากรอกจำนวนเงินที่ถูกต้อง', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await sb.from('sale_orders')
        .update({ net_received: value, net_received_pending: false })
        .eq('id', entry.id);
      if (error) throw error;
      toast?.(`บันทึกยอดบิล #${entry.id} แล้ว`, 'success');
      setEntry(null);
      window.dispatchEvent(new Event('pending-net-changed'));
      await load();
    } catch (e) {
      toast?.('บันทึกไม่สำเร็จ: ' + (e?.message || 'unknown'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Bell + desktop iMessage bubble */}
      <div className="relative flex items-center gap-2">
        <div className="hidden lg:block relative">
          <div className="px-3 py-1.5 rounded-2xl bg-error text-white text-xs font-medium shadow-md whitespace-nowrap">
            มี {count} รายการยังไม่ได้ใส่ราคา
          </div>
          {/* tail pointing right, toward the bell */}
          <div className="absolute top-1/2 -right-1 -translate-y-1/2 w-3 h-3 bg-error rotate-45" />
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`มี ${count} รายการยังไม่ได้ใส่ราคา`}
          className="relative inline-flex items-center justify-center w-10 h-10 rounded-full bg-error text-white shadow-md hover:opacity-90 active:scale-95 transition"
        >
          <Icon name="bell" size={20} />
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-white text-error text-[11px] font-bold inline-flex items-center justify-center tabular-nums ring-2 ring-error">
            {count > 99 ? '99+' : count}
          </span>
        </button>
      </div>

      {/* List popover — iOS Haptic-Touch style blurred backdrop */}
      {open && createPortal(
        <div className="fixed inset-0 z-[130] flex items-start justify-center pt-[12vh] px-4"
             onClick={() => setOpen(false)}>
          <div className="absolute inset-0 modal-overlay holo-backdrop-in" />
          <div className="relative w-full max-w-md glass-strong holo-card-in rounded-2xl shadow-2xl border hairline overflow-hidden"
               onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b hairline flex items-center gap-2">
              <Icon name="bell" size={16} className="text-error" />
              <div className="font-semibold text-sm">รอใส่ราคาที่ร้านได้รับ ({count})</div>
              <button className="ml-auto p-1.5 rounded-lg hover:bg-surface-strong/50 transition"
                      onClick={() => setOpen(false)} aria-label="ปิด">
                <Icon name="x" size={18} />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto divide-y hairline">
              {bills.map(b => {
                const first = b.items[0];
                const more = b.items.length - 1;
                const names = b.items.map(i => i.name).filter(Boolean).join(', ');
                return (
                  <button key={b.id} type="button" onClick={() => openEntry(b)}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-surface-strong/40 transition">
                    <div className="relative flex-shrink-0">
                      <ProductThumb product={{ name: first?.name || '', _imageUrl: first?._imageUrl }} size="md" />
                      {more > 0 && (
                        <span className="absolute -bottom-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-surface-dark text-on-dark text-[10px] font-semibold inline-flex items-center justify-center ring-2 ring-white">
                          +{more}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{names || '—'}</div>
                      <div className="text-xs text-muted-soft mt-0.5 tabular-nums">
                        {fmtDate(b.sale_date)} · บิล #{b.id}
                      </div>
                    </div>
                    <Icon name="chevron-r" size={16} className="text-muted-soft flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Amount-entry popup */}
      {entry && createPortal(
        <div className="fixed inset-0 z-[140] flex items-center justify-center px-4"
             onClick={() => !saving && setEntry(null)}>
          <div className="absolute inset-0 modal-overlay" />
          <div className="relative w-full max-w-xs card-canvas rounded-2xl shadow-2xl p-4 holo-card-in"
               onClick={e => e.stopPropagation()}>
            <div className="font-semibold text-sm mb-1">เงินที่ร้านได้รับ · บิล #{entry.id}</div>
            <div className="text-xs text-muted-soft mb-3 truncate">
              {entry.items.map(i => i.name).filter(Boolean).join(', ') || '—'}
            </div>
            <input
              autoFocus
              type="number"
              inputMode="decimal"
              className="input w-full !h-11 !text-base"
              placeholder="ยอดเงินที่ได้รับ (บาท)"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save(); }}
            />
            <div className="flex gap-2 mt-4">
              <button className="btn-secondary flex-1" onClick={() => setEntry(null)} disabled={saving}>
                ยกเลิก
              </button>
              <button className="btn-primary flex-1" onClick={save} disabled={saving}>
                {saving ? <span className="spinner" /> : <Icon name="check" size={16} />} บันทึก
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
