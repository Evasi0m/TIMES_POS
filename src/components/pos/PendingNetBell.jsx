import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { sb } from '../../lib/supabase-client.js';
import { excludePendingTikTok } from '../../lib/ecommerce-channels.js';
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

export default function PendingNetBell({ toast, size = 44, floating = false, floatClassName = 'top-[30px] right-[40px]' }) {
  const [bills, setBills]     = useState([]);
  const [open, setOpen]       = useState(false);
  const [entry, setEntry]     = useState(null); // bill currently being filled
  const [amount, setAmount]   = useState('');
  const [saving, setSaving]   = useState(false);
  const [closing, setClosing] = useState(false); // drives the exit animation

  // Animate the modal out, then unmount + reset. Guarded so a double-call
  // (Esc + backdrop) can't stack timers into a flicker.
  function closeAll() {
    if (saving) return;
    setClosing(true);
    setTimeout(() => {
      setOpen(false); setEntry(null); setAmount(''); setClosing(false);
    }, 240);
  }

  const load = useCallback(async () => {
    const { data: orders, error } = await excludePendingTikTok(
      sb.from('sale_orders')
        .select('id, sale_date')
        .eq('net_received_pending', true)
        .eq('status', 'active')
        .order('sale_date', { ascending: false }),
    );
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
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { if (entry) { setEntry(null); setAmount(''); } else closeAll(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, entry]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = bills.length;
  if (count === 0) return null;

  // Everything scales off `size` so the circle stays proportional to each
  // page's PageHeader (POS passes a larger value than Sales History).
  const iconSize  = Math.round(size * 0.5);
  const badgeSize = Math.max(18, Math.round(size * 0.46));

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
      setEntry(null); setAmount('');
      window.dispatchEvent(new Event('pending-net-changed'));
      await load();
    } catch (e) {
      toast?.('บันทึกไม่สำเร็จ: ' + (e?.message || 'unknown'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Bell + desktop bubble. In `floating` mode it's portalled to <body> so a
  // transformed ancestor (the page's .view-fade) can't capture its `fixed`
  // positioning and make it jump on mount.
  const bellRow = (
      <div className="relative flex items-center gap-2.5">
        <div className="pending-bubble hidden lg:block relative">
          <div className="imsg-bubble px-3.5 py-2 text-xs font-semibold whitespace-nowrap">
            มี {count} รายการยังไม่ได้ใส่ราคา
          </div>
        </div>
        <div className="pending-bell">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`มี ${count} รายการยังไม่ได้ใส่ราคา`}
            className="relative inline-flex items-center justify-center rounded-full shadow-xl transition-transform duration-200 ease-out hover:scale-105 active:scale-95"
            style={{
              width: size,
              height: size,
              background: `
                radial-gradient(circle at 30% 20%, rgba(254, 202, 202, 0.45), transparent 52%),
                linear-gradient(180deg, #fb6a6a 0%, #dc2626 52%, #991b1b 100%)
              `,
              border: '1px solid rgba(220, 38, 38, 0.5)',
              color: '#fef2f2',
              boxShadow: `
                0 1px 0 rgba(255, 255, 255, 0.45) inset,
                0 -1px 0 rgba(127, 29, 29, 0.3) inset,
                0 8px 24px -6px rgba(220, 38, 38, 0.5),
                0 0 0 1px rgba(220, 38, 38, 0.1)
              `,
            }}
          >
            <span className="pending-bell-icon">
              <Icon name="bell" size={iconSize} style={{ filter: 'drop-shadow(0 1px 2px rgba(60, 5, 5, 0.3))' }} />
            </span>
            <span
              className="pending-badge absolute -top-1 -right-1 px-1 rounded-full font-bold inline-flex items-center justify-center tabular-nums ring-2 ring-white"
              style={{
                minWidth: badgeSize,
                height: badgeSize,
                fontSize: Math.max(10, Math.round(size * 0.25)),
                background: '#fef2f2',
                color: '#dc2626',
                boxShadow: '0 2px 8px rgba(220, 38, 38, 0.35)',
              }}
            >
              {count > 99 ? '99+' : count}
            </span>
          </button>
        </div>
      </div>
  );

  return (
    <>
      {floating
        ? createPortal(
            <div className={`pending-float hidden lg:block fixed z-[60] ${floatClassName}`}>{bellRow}</div>,
            document.body
          )
        : bellRow}

      {/* One liquid-glass modal that morphs between the bill LIST and the
          amount ENTRY for a chosen bill — never two stacked popovers. */}
      {open && createPortal(
        <div className="fixed inset-0 z-[130] flex items-start justify-center pt-[11vh] px-4"
             onClick={closeAll}>
          <div className={`absolute inset-0 modal-overlay ${closing ? 'holo-backdrop-out' : 'holo-backdrop-in'}`} />
          <div
            className={`pnb-card relative w-full max-w-md glass-strong rounded-3xl border hairline overflow-hidden ${closing ? 'holo-card-out' : 'holo-card-in'}`}
            onClick={e => e.stopPropagation()}
          >
            {/* ── header ── */}
            <div className="relative flex items-center gap-2.5 px-4 py-3.5 border-b hairline">
              {entry ? (
                <button
                  className="pnb-iconbtn -ml-1" onClick={() => { setEntry(null); setAmount(''); }}
                  aria-label="ย้อนกลับ" disabled={saving}
                >
                  <Icon name="chevron-l" size={20} />
                </button>
              ) : (
                <span className="pnb-bell-chip"><Icon name="bell" size={15} /></span>
              )}
              <div className="min-w-0">
                <div className="font-semibold text-[15px] leading-tight truncate">
                  {entry ? `เงินที่ร้านได้รับ` : 'รอใส่ราคาที่ร้านได้รับ'}
                </div>
                <div className="text-[11px] text-muted-soft mt-0.5 tabular-nums truncate">
                  {entry ? `บิล #${entry.id} · ${fmtDate(entry.sale_date)}` : `${count} บิลที่ยังไม่ได้ใส่ราคา`}
                </div>
              </div>
              <button className="pnb-iconbtn ml-auto" onClick={closeAll} aria-label="ปิด" disabled={saving}>
                <Icon name="x" size={18} />
              </button>
            </div>

            {/* ── body: morphs between LIST and ENTRY ── */}
            <div key={entry ? `e${entry.id}` : 'list'} className="pnb-step">
              {!entry ? (
                <div className="max-h-[58vh] overflow-y-auto p-2 space-y-1">
                  {bills.map(b => {
                    const first = b.items[0];
                    const more = b.items.length - 1;
                    const names = b.items.map(i => i.name).filter(Boolean).join(', ');
                    return (
                      <button key={b.id} type="button" onClick={() => openEntry(b)}
                        className="pnb-row w-full flex items-center gap-3 p-2.5 text-left rounded-2xl">
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
                        <span className="pnb-chev"><Icon name="chevron-r" size={16} /></span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="px-5 pt-5 pb-5">
                  {/* compact product strip — slimmer, less visual weight */}
                  <div className="pnb-product-strip">
                    <ProductThumb product={{ name: entry.items[0]?.name || '', _imageUrl: entry.items[0]?._imageUrl }} size="sm" />
                    <div className="min-w-0 flex-1 text-[13px] font-medium leading-snug line-clamp-1">
                      {entry.items.map(i => i.name).filter(Boolean).join(', ') || '—'}
                    </div>
                  </div>

                  {/* Cash-App-style centered amount stage */}
                  <div className="pnb-stage">
                    <div className="pnb-stage-label">ยอดเงินที่ร้านได้รับจริง</div>
                    <label className={`pnb-amount2 ${amount ? 'is-filled' : ''}`}>
                      <span className="pnb-baht2">฿</span>
                      <input
                        autoFocus
                        type="text"
                        inputMode="decimal"
                        className="pnb-amount2-input tabular-nums"
                        placeholder="0"
                        size={1}
                        value={amount ? Number(amount).toLocaleString('en-US') : ''}
                        onChange={e => {
                          const raw = e.target.value.replace(/[^\d.]/g, '');
                          setAmount(raw);
                        }}
                        onKeyDown={e => { if (e.key === 'Enter') save(); }}
                      />
                    </label>
                    <div className="pnb-stage-hint">บาท</div>
                  </div>

                  {/* quick-fill chips — common rounding shortcuts */}
                  <div className="grid grid-cols-4 gap-1.5 mt-1">
                    {[100, 500, 1000].map(step => (
                      <button
                        key={step}
                        type="button"
                        className="pnb-chip"
                        onClick={() => setAmount(String((Number(amount) || 0) + step))}
                        disabled={saving}
                      >
                        +{step.toLocaleString('en-US')}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="pnb-chip pnb-chip-ghost"
                      onClick={() => setAmount('')}
                      disabled={saving || !amount}
                    >
                      ล้าง
                    </button>
                  </div>

                  <div className="flex gap-2.5 mt-5">
                    <button className="pnb-btn-back flex-1" onClick={() => { setEntry(null); setAmount(''); }} disabled={saving}>
                      ย้อนกลับ
                    </button>
                    <button className="pnb-btn-save flex-[1.4] inline-flex items-center justify-center gap-1.5" onClick={save} disabled={saving || !amount}>
                      {saving ? <span className="spinner" /> : <Icon name="check" size={16} />} บันทึก
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
