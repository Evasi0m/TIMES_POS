import React from 'react';
import Icon from '../../ui/Icon.jsx';
import ExpandableImageThumb from '../../ui/ExpandableImageThumb.jsx';
import TikTokStatusBadge from './TikTokStatusBadge.jsx';
import { fmtTHB } from '../../../lib/format.js';

function SkuThumb({ url, alt }) {
  return (
    <ExpandableImageThumb
      src={url}
      alt={alt || ''}
      className="w-14 h-14 rounded-lg border hairline bg-surface-soft shrink-0"
      imgClassName="w-full h-full object-cover rounded-lg"
      placeholder={(
        <div className="w-14 h-14 rounded-lg bg-surface-soft border hairline flex items-center justify-center shrink-0 text-muted product-img-shadow">
          <Icon name="image" size={20}/>
        </div>
      )}
    />
  );
}

export default function TikTokOrderCard({
  order,
  lines,
  imageByProduct,
  isSelected,
  canShip,
  labelBusy,
  shipBusy,
  lineTitle,
  shippingLabelText,
  paymentLabel,
  fmtDateTime,
  onToggleSelect,
  onShip,
  onPrintLabel,
  onPrintPackingSlip,
  staggerIndex = 0,
  embedded = false,
}) {
  const canSelect = order.status === 'active';

  return (
    <article
      style={embedded ? undefined : { '--i': Math.min(staggerIndex, 8) }}
      className={
        embedded
          ? 'bg-surface-strong/30 ' + (isSelected ? 'bg-primary/[0.04]' : '')
          : 'card-canvas overflow-hidden ring-1 ring-hairline fade-in stagger hover-lift ' +
            (isSelected ? 'ring-primary/40 bg-primary/[0.03]' : '')
      }
    >
      <header className="flex flex-wrap items-center gap-2 px-4 py-3 border-b hairline bg-surface-soft/50 text-xs">
        {canSelect && (
          <input
            type="checkbox"
            className="shrink-0 w-4 h-4"
            checked={isSelected}
            onChange={onToggleSelect}
            aria-label="เลือกออเดอร์"
          />
        )}
        <span className="font-mono font-semibold text-ink text-sm">
          {order.tiktok_order_id || `#${order.id}`}
        </span>
        <TikTokStatusBadge
          status={order.tiktok_order_status}
          className={'!text-[11px]' + (embedded ? ' lg:hidden' : '')}
        />
        <span className="text-muted ml-auto tabular-nums">{fmtDateTime(order.sale_date)}</span>
        <span className="text-muted-soft hidden sm:inline">POS #{order.id}</span>
      </header>

      <div className="p-4 grid grid-cols-1 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.1fr)] gap-3 items-start">
        <div className="space-y-3 min-w-0">
          {lines.length === 0 && (
            <div className="text-sm text-muted">ไม่มีรายการสินค้า</div>
          )}
          {lines.map((l) => (
            <div key={l.id} className="flex gap-3">
              <SkuThumb url={l.sku_image_url || imageByProduct[l.product_id]} alt={lineTitle(l)}/>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium line-clamp-2">{lineTitle(l)}</div>
                <div className="text-xs text-muted mt-0.5 tabular-nums">× {l.quantity}</div>
                {l.seller_sku && (
                  <div className="text-xs text-muted-soft font-mono mt-0.5">SKU: {l.seller_sku}</div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Status — desktop column */}
        <div className="hidden lg:block text-sm">
          <TikTokStatusBadge status={order.tiktok_order_status} className="!text-[11px]"/>
        </div>

        <div className="space-y-2 text-sm text-muted lg:border-l hairline lg:pl-4">
          <div className="lg:hidden">
            <TikTokStatusBadge status={order.tiktok_order_status} className="!text-[11px] mb-2"/>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-soft mb-0.5">การจัดส่ง</div>
            <div>{shippingLabelText}</div>
            {order.tracking_number && (
              <div className="text-xs font-mono mt-1 text-muted-soft">#{order.tracking_number}</div>
            )}
            {order.shipping_recipient_name && (
              <div className="text-xs mt-1 line-clamp-2">{order.shipping_recipient_name}</div>
            )}
          </div>
          <div className="lg:hidden">
            <div className="text-[10px] uppercase tracking-wider text-muted-soft mb-0.5">ยอดชำระ</div>
            <div className="font-display text-xl tabular-nums text-ink">{fmtTHB(order.grand_total)}</div>
            <div className="text-xs mt-0.5">{paymentLabel}</div>
            {order.net_received != null && (
              <div className="text-xs text-muted-soft tabular-nums mt-0.5">net {fmtTHB(order.net_received)}</div>
            )}
          </div>
        </div>

        {/* Price — desktop column */}
        <div className="hidden lg:block text-right">
          <div className="font-display text-lg tabular-nums text-ink">{fmtTHB(order.grand_total)}</div>
          <div className="text-xs text-muted mt-0.5">{paymentLabel}</div>
          {order.net_received != null && (
            <div className="text-xs text-muted-soft tabular-nums mt-0.5">net {fmtTHB(order.net_received)}</div>
          )}
        </div>

        {order.status === 'active' && (
          <div className="flex flex-col gap-2 w-full lg:items-end">
            {canShip && (
              <button
                type="button"
                className="btn-primary !h-11 !py-0 !text-sm w-full min-h-[44px] whitespace-nowrap"
                disabled={shipBusy === order.id}
                onClick={onShip}
              >
                {shipBusy === order.id ? <span className="spinner"/> : null}
                เตรียมจัดส่ง+พิมพ์
              </button>
            )}
            <button
              type="button"
              className="btn-secondary !h-11 !py-0 !text-sm w-full min-h-[44px]"
              disabled={labelBusy === order.id || order.tiktok_shipping_type === 'SELLER'}
              onClick={onPrintLabel}
            >
              {labelBusy === order.id ? <span className="spinner"/> : <Icon name="printer" size={16}/>}
              ปริ้น label
            </button>
            <button
              type="button"
              className="btn-secondary !h-10 !py-0 !text-xs w-full"
              disabled={labelBusy === order.id || order.tiktok_shipping_type === 'SELLER'}
              onClick={onPrintPackingSlip}
            >
              packing slip
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
