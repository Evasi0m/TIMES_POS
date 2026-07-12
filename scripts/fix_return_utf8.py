#!/usr/bin/env python3
"""Write TikTok return UI files with correct UTF-8 (ASCII-only source)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def u(s: str) -> str:
    return s.encode('utf-8').decode('unicode_escape')

FILES = {
    'src/components/pos/TikTokReturnPanel.jsx': u(r'''// TikTok stock resolution \u2014 POS return confirmation queue.
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
      toast?.('\u0e42\u0e2b\u0e25\u0e14\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e23\u0e2d\u0e15\u0e35\u0e01\u0e25\u0e31\u0e1a\u0e44\u0e21\u0e48\u0e44\u0e14\u0e49: ' + mapError(e), 'error');
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
      toast?.(msg + ` \u00b7 \u0e1a\u0e34\u0e25 #${activeOrder.id}`, 'success');
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
      toast?.('\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01\u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08: ' + mapError(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const count = orders.length;
  const countLabel = count > 99 ? '99+' : count;
  const badgeAria = `${TTR_COPY.badgeLabel} ${count} \u0e23\u0e32\u0e22\u0e01\u0e32\u0e23`;
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
'''),

    'src/components/pos/tiktok-return/TikTokReturnOrderRow.jsx': u(r'''import React from 'react';
import Icon from '../../ui/Icon.jsx';
import TikTokStatusBadge from '../../ecommerce/tiktok/TikTokStatusBadge.jsx';
import { TikTokGlassBadge } from '../../ecommerce/tiktok/glass/index.js';
import SkuThumb from '../tiktok-confirm/SkuThumb.jsx';
import { fmtTHB, fmtTime, itemSkuLabel } from '../tiktok-confirm/helpers.js';
import { resolutionKindLabel } from '../../../lib/tiktok-stock-resolution.js';

const BADGE_COMPACT = '!text-[10px] !rounded-md !normal-case !tracking-normal !font-semibold';

export default function TikTokReturnOrderRow({ order, onOpen, opening = false }) {
  const items = order.items || [];
  const firstItem = items[0];
  const extraCount = items.length - 1;
  const kindLabel = resolutionKindLabel(order.tiktok_resolution_kind);

  return (
    <button
      type="button"
      onClick={() => onOpen(order)}
      className={
        'ttc-return-card w-full text-left glass-soft !bg-surface-strong/90 ring-1 ring-hairline hover:ring-[#d97706]/25 shadow-sm rounded-lg hover-lift p-4 group transition-[box-shadow,transform,ring-color] ' +
        (opening ? 'ttc-return-card--opening' : '')
      }
      disabled={opening}
    >
      <div className="flex items-start gap-4">
        {firstItem ? (
          <SkuThumb url={firstItem.sku_image_url} sizeClass="w-16 h-16 sm:w-[72px] sm:h-[72px]" iconSize={24}/>
        ) : (
          <div className="w-16 h-16 rounded-xl bg-surface-soft border hairline flex items-center justify-center text-muted shrink-0">
            <Icon name="package" size={24}/>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              {firstItem ? (
                <>
                  <div className="text-base sm:text-[17px] font-semibold text-ink leading-snug line-clamp-2" title={itemSkuLabel(firstItem)}>
                    {itemSkuLabel(firstItem)}
                    {extraCount > 0 && (
                      <span className="text-muted font-medium text-sm ml-1">+{extraCount} \u0e23\u0e32\u0e22\u0e01\u0e32\u0e23</span>
                    )}
                  </div>
                  <div className="text-sm text-muted tabular-nums mt-0.5">
                    {items.length} \u0e23\u0e32\u0e22\u0e01\u0e32\u0e23
                    {Number(firstItem.quantity) > 1 && ` \u00b7 \u00d7${firstItem.quantity}`}
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted">\u0e44\u0e21\u0e48\u0e21\u0e35\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32</div>
              )}
            </div>
            <div className="text-right shrink-0">
              <div className="text-lg sm:text-xl font-display font-semibold tabular-nums text-ink">
                {fmtTHB(order.grand_total)}
              </div>
              <div className="text-xs text-muted tabular-nums mt-0.5">{fmtTime(order.sale_date)}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-3">
            <TikTokGlassBadge tone="warn" context="surface" className={BADGE_COMPACT}>
              {kindLabel}
            </TikTokGlassBadge>
            <TikTokStatusBadge
              status={order.tiktok_order_status}
              className={BADGE_COMPACT}
            />
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="text-[11px] text-muted-soft font-mono truncate" title={order.tiktok_order_id}>
              #{order.tiktok_order_id}
            </div>
            <span className="ttc-row-cta inline-flex items-center gap-1 text-sm font-medium group-hover:gap-1.5 transition-all shrink-0">
              {opening ? (
                <>
                  <span className="spinner" aria-hidden="true"/>
                  \u0e01\u0e33\u0e25\u0e31\u0e07\u0e40\u0e1b\u0e34\u0e14\u2026
                </>
              ) : (
                <>
                  \u0e22\u0e37\u0e19\u0e22\u0e31\u0e19
                  <Icon name="chevron-r" size={14}/>
                </>
              )}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
'''),

    'src/components/pos/tiktok-return/TikTokReturnConfirmPane.jsx': u(r'''import React, { useEffect } from 'react';
import Icon from '../../ui/Icon.jsx';
import { TikTokGlassBadge } from '../../ecommerce/tiktok/glass/index.js';
import { fmtTHB, fmtTime, itemSkuLabel } from '../tiktok-confirm/helpers.js';
import {
  RESOLUTION_KIND,
  defaultGoodsReturnedForKind,
  resolutionKindLabel,
} from '../../../lib/tiktok-stock-resolution.js';
import { TTR_COPY } from './copy.js';

export default function TikTokReturnConfirmPane({
  order,
  goodsReturned,
  setGoodsReturned,
  notes,
  setNotes,
  saving,
}) {
  const kind = order?.tiktok_resolution_kind;
  const kindLabel = resolutionKindLabel(kind);
  const items = order?.items || [];

  useEffect(() => {
    const def = defaultGoodsReturnedForKind(kind);
    if (def !== null) setGoodsReturned(def);
    else setGoodsReturned(null);
  }, [order?.id, kind, setGoodsReturned]);

  const hint = kind === RESOLUTION_KIND.CANCEL_PRE_SHIP
    ? TTR_COPY.preShipHint
    : kind === RESOLUTION_KIND.REFUND_ONLY
      ? TTR_COPY.refundOnlyHint
      : TTR_COPY.postShipHint;

  const mustChoose = defaultGoodsReturnedForKind(kind) === null;

  return (
    <div className="flex flex-col min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
      <div className="glass-soft rounded-xl p-4 ring-1 ring-hairline">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-muted uppercase tracking-wider">POS #{order.id}</div>
            <div className="font-display text-xl mt-1">{fmtTHB(order.grand_total)}</div>
            <div className="text-xs text-muted mt-0.5">{fmtTime(order.sale_date)}</div>
          </div>
          <TikTokGlassBadge tone="warn" context="surface">{kindLabel}</TikTokGlassBadge>
        </div>
        <div className="text-[11px] text-muted-soft font-mono mt-2 truncate">{order.tiktok_order_id}</div>
      </div>

      <div className="tt-glass__notice text-xs leading-relaxed">
        {TTR_COPY.confirmHint} \u00b7 {hint}
      </div>

      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id} className="flex justify-between gap-2 text-sm py-2 border-b hairline last:border-0">
            <span className="min-w-0 truncate" title={itemSkuLabel(it)}>{itemSkuLabel(it)}</span>
            <span className="tabular-nums shrink-0">\u00d7{it.quantity}</span>
          </li>
        ))}
      </ul>

      <div className="space-y-2">
        <label className={
          'flex items-start gap-3 cursor-pointer p-3 rounded-xl border transition-colors ' +
          (goodsReturned === true ? 'border-primary/40 bg-primary/5' : 'border-hairline hover:border-primary/20')
        }>
          <input
            type="radio"
            name="goods-returned"
            className="mt-1"
            checked={goodsReturned === true}
            onChange={() => setGoodsReturned(true)}
            disabled={saving}
          />
          <div>
            <div className="text-sm font-medium">{TTR_COPY.confirmReceived}</div>
          </div>
        </label>

        <label className={
          'flex items-start gap-3 cursor-pointer p-3 rounded-xl border transition-colors ' +
          (goodsReturned === false ? 'border-[#8a6500]/40 bg-warning/10' : 'border-hairline hover:border-warning/20')
        }>
          <input
            type="radio"
            name="goods-returned"
            className="mt-1"
            checked={goodsReturned === false}
            onChange={() => setGoodsReturned(false)}
            disabled={saving}
          />
          <div>
            <div className="text-sm font-medium text-[#8a6500]">{TTR_COPY.confirmLost}</div>
          </div>
        </label>
      </div>

      {mustChoose && goodsReturned === null && (
        <div className="text-xs text-warning flex items-center gap-1.5">
          <Icon name="alert" size={14}/>
          {TTR_COPY.mustChoose}
        </div>
      )}

      <div>
        <label className="text-xs uppercase tracking-wider text-muted">\u0e2b\u0e21\u0e32\u0e22\u0e40\u0e2b\u0e15\u0e38 (\u0e44\u0e21\u0e48\u0e1a\u0e31\u0e07\u0e04\u0e31\u0e1a)</label>
        <textarea
          className="input mt-1 w-full"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={saving}
          placeholder="\u0e40\u0e0a\u0e48\u0e19 \u0e02\u0e2d\u0e07\u0e40\u0e2a\u0e35\u0e22\u0e2b\u0e32\u0e22 / \u0e2a\u0e32\u0e40\u0e2b\u0e15\u0e38\u0e01\u0e32\u0e23\u0e15\u0e35\u0e01\u0e25\u0e31\u0e1a..."
        />
      </div>
    </div>
  );
}
'''),

    'src/components/pos/tiktok-return/TikTokReturnList.jsx': u(r'''import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import TikTokListPagination from '../../ecommerce/tiktok/TikTokListPagination.jsx';
import TikTokReturnOrderRow from './TikTokReturnOrderRow.jsx';
import { useScrollFrostEdges } from '../../../hooks/useScrollFrostEdges.js';
import { SORT_OLDEST } from '../tiktok-confirm/helpers.js';
import { TTR_COPY } from './copy.js';

export default function TikTokReturnList({
  orders,
  sortOrder,
  onSortChange,
  onOpen,
  openingId,
  disabled,
}) {
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [sortOrder, pageSize]);

  const totalPages = Math.max(1, Math.ceil(orders.length / pageSize));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageOrders = useMemo(
    () => orders.slice((safePage - 1) * pageSize, safePage * pageSize),
    [orders, safePage, pageSize],
  );

  const { ref: scrollRef, edges: scrollEdges } = useScrollFrostEdges([
    pageOrders.length,
    safePage,
    pageSize,
  ]);

  return (
    <div className={
      'flex flex-col min-h-0 h-full ' +
      (disabled ? 'pointer-events-none select-none opacity-60 ' : '') +
      (openingId ? 'pointer-events-none select-none ' : '')
    }>
      <div className="px-4 py-2.5 ttc-list-toolbar bg-surface-soft/40 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <span className="text-xs text-muted tabular-nums">
          <span className="font-semibold text-[#d97706] text-sm">{orders.length.toLocaleString('th-TH')}</span> \u0e2d\u0e2d\u0e40\u0e14\u0e2d\u0e23\u0e4c
        </span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs text-muted-soft">\u0e40\u0e23\u0e35\u0e22\u0e07</span>
            <select
              className="input !h-8 !rounded-lg !py-0 !px-2 !text-xs !w-auto"
              value={sortOrder}
              onChange={(e) => onSortChange(e.target.value)}
              aria-label="\u0e40\u0e23\u0e35\u0e22\u0e07\u0e25\u0e33\u0e14\u0e31\u0e1a\u0e2d\u0e2d\u0e40\u0e14\u0e2d\u0e23\u0e4c"
              disabled={disabled}
            >
              <option value={SORT_OLDEST}>\u0e40\u0e01\u0e48\u0e32\u0e01\u0e48\u0e2d\u0e19</option>
              <option value="newest">\u0e43\u0e2b\u0e21\u0e48\u0e01\u0e48\u0e2d\u0e19</option>
            </select>
          </label>
        </div>
      </div>

      <div className="ttc-scroll-frost flex-1 min-h-0 bg-surface-cream-strong">
        <div ref={scrollRef} className="ttc-scroll-frost__viewport">
          <div className="ttc-scroll-frost__inner">
            {pageOrders.map((o) => (
              <TikTokReturnOrderRow
                key={o.id}
                order={o}
                onOpen={onOpen}
                opening={openingId === o.id}
              />
            ))}
            {!pageOrders.length && (
              <div className="p-10 text-center">
                <Icon name="package" size={32} className="text-muted mx-auto mb-3"/>
                <p className="text-sm text-muted">{TTR_COPY.empty}</p>
              </div>
            )}
          </div>
        </div>
        <div
          className={'ttc-scroll-frost__edge ttc-scroll-frost__edge--top' + (scrollEdges.top ? ' is-visible' : '')}
          aria-hidden="true"
        />
        <div
          className={'ttc-scroll-frost__edge ttc-scroll-frost__edge--bottom' + (scrollEdges.bottom ? ' is-visible' : '')}
          aria-hidden="true"
        />
      </div>

      <TikTokListPagination
        variant="modal"
        total={orders.length}
        page={safePage}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  );
}
'''),
}

if __name__ == '__main__':
    for rel, content in FILES.items():
        path = ROOT / rel
        path.write_text(content, encoding='utf-8')
        assert path.read_text(encoding='utf-8')
        print('wrote', rel)
