// TikTok stock resolution — POS return confirmation queue.
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { sb } from '../../lib/supabase-client.js';
import { mapError } from '../../lib/error-map.js';
import {
  confirmTikTokStockResolution,
  defaultGoodsReturnedForKind,
  fetchPendingTikTokStockResolutions,
  notifyTikTokReturnChanged,
} from '../../lib/tiktok-stock-resolution.js';
import { runReturnMirrorWithFeedback, logMirrorBackgroundError } from '../../lib/tiktok-inventory-sync.js';
import TikTokReturnModal from './tiktok-return/TikTokReturnModal.jsx';
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

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const list = await fetchPendingTikTokStockResolutions(sb);
      setOrders(list);
      return list;
    } catch (e) {
      toast?.('????????????????????????: ' + mapError(e), 'error');
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const activeOrder = orders.find((o) => o.id === activeId) || null;

  const closeAll = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
      setActiveId(null);
      setGoodsReturned(null);
      setNotes('');
    }, 200);
  }, []);

  const backToList = () => {
    setActiveId(null);
    setGoodsReturned(null);
    setNotes('');
  };

  const openOrder = (order) => {
    setOpeningId(order.id);
    setTimeout(() => {
      setActiveId(order.id);
      setOpeningId(null);
      const def = defaultGoodsReturnedForKind(order.tiktok_resolution_kind);
      setGoodsReturned(def);
      setNotes('');
    }, 120);
  };

  const canConfirm = goodsReturned === true || goodsReturned === false;

  const handleConfirm = async () => {
    if (!activeOrder || !canConfirm || saving) return;
    setSaving(true);
    try {
      const data = await confirmTikTokStockResolution(
        sb,
        activeOrder.id,
        goodsReturned,
        notes.trim() || null,
      );
      const msg = goodsReturned ? TTR_COPY.successRestocked : TTR_COPY.successLost;
      toast?.(msg + ` · ??? #${activeOrder.id}`, 'success');

      if (goodsReturned) {
        const productIds = (data?.product_ids || [])
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0);
        if (data?.id && productIds.length) {
          runReturnMirrorWithFeedback({
            toast: toast ? { push: (m, t, o) => toast(m, t, o) } : null,
            returnOrderId: Number(data.id),
            productIds,
          }).catch((e) => logMirrorBackgroundError('tiktok-return', e));
        }
      }

      notifyTikTokReturnChanged();
      await load({ quiet: true });
      backToList();
      if (orders.length <= 1) closeAll();
    } catch (e) {
      toast?.('???????????????: ' + mapError(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const count = orders.length;
  const countLabel = count > 99 ? '99+' : count;
  const badgeAria = `${TTR_COPY.badgeLabel} ${count} ??????`;
  const mobileBtnSize = 40;
  const mobileCountFont = Math.max(11, Math.round(mobileBtnSize * 0.35));

  const badge = (
    <>
      <div className="ttc-return-mobile lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={badgeAria}
          title={TTR_COPY.badgeLabel}
          className={'ttc-return-count-btn' + (count === 0 ? ' ttc-return-count-btn--empty' : '')}
          style={{ width: mobileBtnSize, height: mobileBtnSize }}
        >
          <span
            className="ttc-return-count-btn__num"
            style={{ fontSize: mobileCountFont }}
            aria-hidden="true"
          >
            {countLabel}
          </span>
        </button>
      </div>
      <div className="pending-bell hidden lg:block">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={badgeAria}
          className={'ttc-return-badge font-display' + (count === 0 ? ' ttc-return-badge--empty' : '')}
        >
          <span className="ttc-return-badge__count">
            <span className="ttc-return-badge__count-num">{countLabel}</span>
          </span>
          <span className="ttc-return-badge__label">{TTR_COPY.badgeLabelShort}</span>
        </button>
      </div>
    </>
  );

  return (
    <>
      {badge}

      {open && createPortal(
        <TikTokReturnModal
          closing={closing}
          onClose={closeAll}
          onBack={backToList}
          activeOrder={activeOrder}
          count={count}
          orders={orders}
          onOpenOrder={openOrder}
          openingId={openingId}
          loading={loading}
          saving={saving}
          goodsReturned={goodsReturned}
          setGoodsReturned={setGoodsReturned}
          notes={notes}
          setNotes={setNotes}
          onConfirm={handleConfirm}
          canConfirm={canConfirm}
        />,
        document.body,
      )}
    </>
  );
}
