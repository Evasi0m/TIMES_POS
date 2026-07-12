import React, { useEffect } from 'react';
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
        {TTR_COPY.confirmHint} · {hint}
      </div>

      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id} className="flex justify-between gap-2 text-sm py-2 border-b hairline last:border-0">
            <span className="min-w-0 truncate" title={itemSkuLabel(it)}>{itemSkuLabel(it)}</span>
            <span className="tabular-nums shrink-0">×{it.quantity}</span>
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
        <label className="text-xs uppercase tracking-wider text-muted">หมายเหตุ (ไม่บังคับ)</label>
        <textarea
          className="input mt-1 w-full"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={saving}
          placeholder="เช่น ของเสียหาย / สาเหตุการตีกลับ..."
        />
      </div>
    </div>
  );
}
