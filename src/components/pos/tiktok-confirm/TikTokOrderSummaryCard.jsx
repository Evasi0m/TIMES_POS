import React from 'react';
import Icon from '../../ui/Icon.jsx';
import TikTokStatusBadge from '../../ecommerce/tiktok/TikTokStatusBadge.jsx';
import { fmtTHB, fmtTime } from './helpers.js';

/**
 * Order summary — softened teal accent on a cream-framed strip (cart style).
 * Compact: order id + total on one row, meta below. Dark-readable type.
 */
export default function TikTokOrderSummaryCard({ order }) {
  const payment = order.tiktok_payment_method || order.payment_method || '—';

  return (
    <div className="ttc-order-strip relative overflow-hidden rounded-xl px-3 py-2.5">
      <div className="relative flex items-center gap-3">
        <span className="ttc-order-strip__icon shrink-0">
          <Icon name="cart" size={16}/>
        </span>

        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider font-semibold ttc-teal-ink">
            ออเดอร์ TikTok
          </div>
          <div
            className="font-mono text-[13px] font-semibold text-ink leading-snug break-all select-all"
            title={order.tiktok_order_id}
          >
            {order.tiktok_order_id}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-[11px] font-medium text-muted">
            <span className="tabular-nums">{fmtTime(order.sale_date)}</span>
            <span className="text-muted-soft">·</span>
            <span>{payment}</span>
            <TikTokStatusBadge
              status={order.tiktok_order_status}
              className="!text-[10px] !rounded-md"
            />
          </div>
        </div>

        <div className="text-right shrink-0 self-start">
          <div className="text-[9px] uppercase tracking-wider font-semibold text-muted-soft">ยอดรวม</div>
          <div className="text-xl font-display font-semibold tabular-nums ttc-teal-ink leading-tight">
            {fmtTHB(order.grand_total)}
          </div>
        </div>
      </div>
    </div>
  );
}
