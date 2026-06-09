import React from 'react';
import Icon from '../../ui/Icon.jsx';
import TikTokStatusBadge from '../../ecommerce/tiktok/TikTokStatusBadge.jsx';
import SkuThumb from './SkuThumb.jsx';
import { fmtTHB, fmtTime, itemSkuLabel, orderListMeta } from './helpers.js';

export default function TikTokPendingOrderRow({ order, onOpen }) {
  const items = order.items || [];
  const meta = orderListMeta(order);
  const firstItem = items[0];
  const extraCount = items.length - 1;

  return (
    <button
      type="button"
      onClick={() => onOpen(order)}
      className="ttc-pending-card w-full text-left glass-soft !bg-surface-strong/75 ring-1 ring-hairline shadow-sm rounded-lg hover-lift p-4 group transition-all"
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
                      <span className="text-muted font-medium text-sm ml-1">+{extraCount} รายการ</span>
                    )}
                  </div>
                  <div className="text-sm text-muted tabular-nums mt-0.5">
                    {meta.itemCount} รายการ
                    {Number(firstItem.quantity) > 1 && ` · ×${firstItem.quantity}`}
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted">ไม่มีรายการสินค้า</div>
              )}
            </div>
            <div className="text-right shrink-0">
              <div className="text-lg sm:text-xl font-display font-semibold tabular-nums text-ink">
                {fmtTHB(order.grand_total)}
              </div>
              <div className="text-xs text-muted tabular-nums mt-0.5">{fmtTime(order.sale_date)}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <span className={
              'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ' +
              (meta.allMatched
                ? 'bg-[#e6f7ed] text-[#0a7a43]'
                : 'bg-amber-50 text-[#8a6500] ring-1 ring-amber-200/60')
            }>
              {meta.allMatched ? (
                <><Icon name="check" size={12}/> จับคู่ครบแล้ว</>
              ) : (
                <><Icon name="alert" size={12}/> {meta.matchLabel}</>
              )}
            </span>
            <TikTokStatusBadge status={order.tiktok_order_status} className="!text-[11px]"/>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="text-[11px] text-muted-soft font-mono truncate" title={order.tiktok_order_id}>
              #{order.tiktok_order_id}
            </div>
            <span className="inline-flex items-center gap-1 text-sm font-medium text-primary group-hover:gap-1.5 transition-all shrink-0">
              เปิดยืนยัน
              <Icon name="chevron-r" size={16}/>
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
