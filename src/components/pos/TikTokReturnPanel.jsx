// TikTok stock resolution — POS return confirmation queue.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { sb } from '../../lib/supabase-client.js';
import { mapError } from '../../lib/error-map.js';
import {
  confirmTikTokStockResolution,
  defaultGoodsReturnedForKind,
  fetchPendingTikTokStockResolutions,
  notifyTikTokReturnChanged,
  TIKTOK_RETURN_CHANGED_EVENT,
} from '../../lib/tiktok-stock-resolution.js';
import { runReturnMirrorWithFeedback, logMirrorBackgroundError } from '../../lib/tiktok-inventory-sync.js';
import TikTokReturnModal from './tiktok-return/TikTokReturnModal.jsx';
import { SORT_OLDEST } from './tiktok-confirm/helpers.js';
import { TTR_COPY } from './tiktok-return/copy.js';

export default function TikTokReturnPanel({ toast }) {
  const [orders, setOrders] = useState([]);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [openingId, setOpeningId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [goodsReturned, setGoodsReturned] = useState(null);
  const [notes, setNotes] = useState('');
  const [sortOrder, setSortOrder] = useState(SORT_OLDEST);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const list = await fetchPendingTikTokStockResolutions(sb);
      setOrders(list);
      return list;
    } catch (e) {
      toast?.('โหลดรายการรอตีกลับไม่ได้: ' + mapError(e), 'error');
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onChange = () => load({ quiet: true });
    window.addEventListener(TIKTOK_RETURN_CHANGED_EVENT, onChange);
    window.addEventListener('tiktok-pending-changed', onChange);
    window.addEventListener('focus', onChange);
    const id = setInterval(onChange, 60_000);
    return () => {
      window.removeEventListener(TIKTOK_RETURN_CHANGED_EVENT, onChange);
      window.removeEventListener('tiktok-pending-changed', onChange);
      window.removeEventListener('focus', onChange);
      clearInterval(id);
    };
  }, [load]);

  const activeOrder = useMemo(() => orders.find((o) => o.id === activeId) || null, [orders, activeId]);

  const sortedOrders = useMemo(() => {
    const copy = [...orders];
    copy.sort((a, b) => {
      const ta = new Date(a.voided_at || a.sale_date).getTime() || 0;
      const tb = new Date(b.voided_at || b.sale_date).getTime() || 0;
      return sortOrder === SORT_OLDEST ? ta - tb : tb - ta;
    });
    return copy;
  }, [orders, sortOrder]);

  const closeAll = useCallback(() => {
    if (saving || closing) return;
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
      setActiveId(null);
      setGoodsReturned(null);
      setNotes('');
    }, 240);
  }, [saving, closing]);

  const backToList = () => {
    setOpeningId(null);
    setActiveId(null);
    setGoodsReturned(null);
    setNotes('');
  };

  const openOrder = (order) => {
    if (openingId) return;
    setOpeningId(order.id);
    setTimeout(() => {
      setActiveId(order.id);
      setOpeningId(null);
      setGoodsReturned(defaultGoodsReturnedForKind(order.tiktok_resolution_kind));
      setNotes('');
    }, 120);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (activeId && !saving) backToList();
      else closeAll();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, activeId, saving, closeAll]);

  const canConfirm = goodsReturned === true || goodsReturned === false;

  const handleConfirm = async () => {
    if (!activeOrder || !canConfirm || saving) return;
    setSaving(true);
    try {
      const data = await confirmTikTokStockResolution(sb, activeOrder.id, goodsReturned, notes.trim() || null);
      const msg = goodsReturned ? TTR_COPY.successRestocked : TTR_COPY.successLost;
      toast?.(msg + ` · บิล #${activeOrder.id}`, 'success');
      if (goodsReturned) {
        const productIds = (data?.product_ids || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
        if (data?.id && productIds.length) {
          runReturnMirrorWithFeedback({
            toast: toast ? { push: (m, t, o) => toast(m, t, o) } : null,
            returnOrderId: Number(data.id),
            productIds,
          }).catch((e) => logMirrorBackgroundError('tiktok-return', e));
        }
      }
      notifyTikTokReturnChanged();
      const list = await load({ quiet: true });
      backToList();
      if (!list?.length) closeAll();
    } catch (e) {
      toast?.('บันทึกไม่สำเร็จ: ' + mapError(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const count = orders.length;
  const countLabel = count > 99 ? '99+' : count;
  const badgeAria = `${TTR_COPY.badgeLabel} ${count} รายการ`;
  const mobileBtnSize = 40;
  const mobileCountFont = Math.max(11, Math.round(mobileBtnSize * 0.35));

  const badge = (
    <>
      <div className="ttc-return-mobile lg:hidden">
        <button type="button" onClick={() => setOpen(true)} aria-label={badgeAria} title={TTR_COPY.badgeLabel}
          className={'ttc-return-count-btn' + (count === 0 ? ' ttc-return-count-btn--empty' : '')}
          style={{ width: mobileBtnSize, height: mobileBtnSize }}>
          <span className="ttc-return-count-btn__num" style={{ fontSize: mobileCountFont }} aria-hidden="true">{countLabel}</span>
        </button>
      </div>
      <div className="pending-bell hidden lg:block">
        <button type="button" onClick={() => setOpen(true)} aria-label={badgeAria}
          className={'ttc-return-badge font-display ttc-amber-mesh-surface' + (count === 0 ? ' ttc-return-badge--empty' : '')}>
          <span className="ttc-return-badge__count"><span className="ttc-return-badge__count-num">{countLabel}</span></span>
          <span className="ttc-return-badge__label">{TTR_COPY.badgeLabelShort}</span>
        </button>
      </div>
    </>
  );

  return (
    <>
      {badge}
      {open && createPortal(
        <TikTokReturnModal closing={closing} onClose={closeAll} onBack={backToList} activeOrder={activeOrder}
          count={count} sortedOrders={sortedOrders} sortOrder={sortOrder} onSortChange={setSortOrder}
          onOpenOrder={openOrder} openingId={openingId} saving={saving} goodsReturned={goodsReturned}
          setGoodsReturned={setGoodsReturned} notes={notes} setNotes={setNotes} onConfirm={handleConfirm} canConfirm={canConfirm} />,
        document.body,
      )}
    </>
  );
}
