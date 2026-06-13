import { useState } from 'react';
import { createPortal } from 'react-dom';
import { isTikTokCancelledVoid } from '../../../lib/tiktok-cancel-return.js';
import { useMountedToggle } from '../../../lib/use-mounted-toggle.js';
import VoidStockStatusBadge from '../../sales/VoidStockStatusBadge.jsx';
import Icon from '../../ui/Icon.jsx';
import ExpandableImageThumb from '../../ui/ExpandableImageThumb.jsx';
import TikTokStatusBadge from './TikTokStatusBadge.jsx';
import { TikTokGlassBtn, TikTokGlassLineItem } from './glass/index.js';
import { fmtTHB } from '../../../lib/format.js';
import MobileIconButton from '../../ui/mobile/MobileIconButton.jsx';

function SkuThumb({ url, alt }) {
  return (
    <ExpandableImageThumb
      src={url}
      alt={alt || ''}
      className="w-full h-full object-cover tt-r-card"
      imgClassName="w-full h-full object-cover tt-r-card"
      placeholder={(
        <div className="w-full h-full flex items-center justify-center text-muted product-img-shadow">
          <Icon name="image" size={18}/>
        </div>
      )}
    />
  );
}

function cardClass(isSelected, embedded, staggerIndex) {
  let cls = 'tt-glass__order-card';
  if (!embedded) cls += ' fade-in stagger';
  if (isSelected) cls += ' tt-glass__order-card--selected';
  return cls;
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
  onReturnGoods,
  voidStockStatus,
  staggerIndex = 0,
  embedded = false,
}) {
  const canSelect = order.status === 'active';
  const orderId = order.tiktok_order_id || `#${order.id}`;

  return (
    <article
      style={embedded ? undefined : { '--i': Math.min(staggerIndex, 8) }}
      className={cardClass(isSelected, embedded, staggerIndex)}
    >
      <header className="tt-glass__order-group-header">
        <div className="tt-glass__order-group-id">
          {canSelect && (
            <input
              type="checkbox"
              className="shrink-0 w-4 h-4"
              checked={isSelected}
              onChange={onToggleSelect}
              aria-label="เลือกออเดอร์"
            />
          )}
          <span className="tt-glass__order-id-label">TikTok Order</span>
          <span className="tt-glass__order-id-chip" title={orderId}>{orderId}</span>
        </div>
        <div className="tt-glass__order-group-meta">
          <span className="lg:hidden">
            <TikTokStatusBadge status={order.tiktok_order_status} context="surface"/>
          </span>
          <time dateTime={order.sale_date}>{fmtDateTime(order.sale_date)}</time>
          <span className="tt-glass__order-pos-id">POS #{order.id}</span>
        </div>
      </header>
      <OrderBody
        order={order}
        lines={lines}
        imageByProduct={imageByProduct}
        canShip={canShip}
        labelBusy={labelBusy}
        shipBusy={shipBusy}
        lineTitle={lineTitle}
        shippingLabelText={shippingLabelText}
        paymentLabel={paymentLabel}
        onShip={onShip}
        onPrintLabel={onPrintLabel}
        onPrintPackingSlip={onPrintPackingSlip}
        onReturnGoods={onReturnGoods}
        voidStockStatus={voidStockStatus}
      />
    </article>
  );
}

function OrderBody({
  order,
  lines,
  imageByProduct,
  canShip,
  labelBusy,
  shipBusy,
  lineTitle,
  shippingLabelText,
  paymentLabel,
  onShip,
  onPrintLabel,
  onPrintPackingSlip,
  onReturnGoods,
  voidStockStatus,
}) {
  const isCancelledVoid = isTikTokCancelledVoid(order);

  return (
    <div className="tt-glass__order-group-body grid grid-cols-1 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.1fr)] gap-3 items-start">
      <div className="min-w-0">
        {lines.length === 0 ? (
          <div className="text-sm text-muted py-1">ไม่มีรายการสินค้า</div>
        ) : (
          <>
            <ul className="tt-glass__line-list hidden lg:block">
              {lines.map((l, idx) => (
                <TikTokGlassLineItem
                  key={l.id}
                  title={lineTitle(l)}
                  sku={l.seller_sku || undefined}
                  quantity={l.quantity}
                  isLast={idx === lines.length - 1}
                  thumb={(
                    <SkuThumb
                      url={l.sku_image_url || imageByProduct[l.product_id]}
                      alt={lineTitle(l)}
                    />
                  )}
                />
              ))}
            </ul>
            <ul className="tt-glass__line-list lg:hidden">
              {lines.slice(0, 2).map((l, idx, arr) => (
                <TikTokGlassLineItem
                  key={l.id}
                  title={lineTitle(l)}
                  sku={l.seller_sku || undefined}
                  quantity={l.quantity}
                  isLast={idx === arr.length - 1 && lines.length <= 2}
                  thumb={(
                    <SkuThumb
                      url={l.sku_image_url || imageByProduct[l.product_id]}
                      alt={lineTitle(l)}
                    />
                  )}
                />
              ))}
              {lines.length > 2 && (
                <li className="text-xs text-muted-soft py-1 pl-1">+{lines.length - 2} รายการ</li>
              )}
            </ul>
          </>
        )}
      </div>

      <div className="hidden lg:block text-sm">
        <TikTokStatusBadge status={order.tiktok_order_status} context="surface"/>
      </div>

      <div className="space-y-2 text-sm text-muted lg:pl-4">
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

      <div className="hidden lg:block text-right">
        <div className="font-display text-lg tabular-nums text-ink">{fmtTHB(order.grand_total)}</div>
        <div className="text-xs text-muted mt-0.5">{paymentLabel}</div>
        {order.net_received != null && (
          <div className="text-xs text-muted-soft tabular-nums mt-0.5">net {fmtTHB(order.net_received)}</div>
        )}
      </div>

      {order.status === 'active' && (
        <ActiveOrderActions
          order={order}
          canShip={canShip}
          shipBusy={shipBusy}
          labelBusy={labelBusy}
          onShip={onShip}
          onPrintLabel={onPrintLabel}
          onPrintPackingSlip={onPrintPackingSlip}
        />
      )}

      {isCancelledVoid && (
        <CancelledOrderActions
          order={order}
          voidStockStatus={voidStockStatus}
          onReturnGoods={onReturnGoods}
        />
      )}
    </div>
  );
}

function ActiveOrderActions({
  order,
  canShip,
  shipBusy,
  labelBusy,
  onShip,
  onPrintLabel,
  onPrintPackingSlip,
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const { render: sheetRender, closing: sheetClosing } = useMountedToggle(moreOpen, 220);
  const labelDisabled = labelBusy === order.id || order.tiktok_shipping_type === 'SELLER';

  return (
    <>
      <div className="hidden lg:flex flex-col gap-2 w-full lg:items-end">
        {canShip && (
          <TikTokGlassBtn
            variant="coral"
            className="tt-glass__btn--lg w-full whitespace-nowrap"
            disabled={shipBusy === order.id}
            onClick={onShip}
          >
            {shipBusy === order.id ? <span className="spinner"/> : null}
            เตรียมจัดส่ง+พิมพ์
          </TikTokGlassBtn>
        )}
        <TikTokGlassBtn
          variant="outline"
          className="tt-glass__btn--lg w-full"
          disabled={labelDisabled}
          onClick={onPrintLabel}
        >
          {labelBusy === order.id ? <span className="spinner"/> : <Icon name="printer" size={16}/>}
          ปริ้น label
        </TikTokGlassBtn>
        <TikTokGlassBtn
          variant="ghost"
          className="w-full !text-xs min-h-[44px]"
          disabled={labelDisabled}
          onClick={onPrintPackingSlip}
        >
          packing slip
        </TikTokGlassBtn>
      </div>

      <div className="lg:hidden flex items-center gap-2 w-full">
        {canShip ? (
          <TikTokGlassBtn
            variant="coral"
            className="tt-glass__btn--lg flex-1 min-h-[44px] whitespace-nowrap"
            disabled={shipBusy === order.id}
            onClick={onShip}
          >
            {shipBusy === order.id ? <span className="spinner"/> : null}
            ดำเนินการ
          </TikTokGlassBtn>
        ) : (
          <TikTokGlassBtn
            variant="outline"
            className="tt-glass__btn--lg flex-1 min-h-[44px]"
            disabled={labelDisabled}
            onClick={onPrintLabel}
          >
            {labelBusy === order.id ? <span className="spinner"/> : <Icon name="printer" size={16}/>}
            ปริ้น label
          </TikTokGlassBtn>
        )}
        {canShip && (
          <MobileIconButton
            icon="printer"
            label="ปริ้น label"
            onClick={onPrintLabel}
            disabled={labelDisabled}
          />
        )}
        <MobileIconButton
          icon="menu"
          label="เพิ่มเติม"
          onClick={() => setMoreOpen(true)}
        />
      </div>

      {sheetRender && createPortal(
        <div
          className={'fixed inset-0 z-[140] flex items-end ' + (sheetClosing ? 'overlay-out' : 'overlay-in')}
          onClick={() => setMoreOpen(false)}
        >
          <div className="absolute inset-0 modal-overlay" />
          <div
            className={'relative w-full glass-strong rounded-t-2xl border-t hairline p-4 pb-safe space-y-1 ' + (sheetClosing ? 'sheet-out' : 'sheet-anim')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full bg-muted-soft/40 mx-auto mb-3" aria-hidden="true" />
            {canShip && (
              <button
                type="button"
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-sm font-medium text-ink"
                onClick={() => { onPrintLabel?.(); setMoreOpen(false); }}
                disabled={labelDisabled}
              >
                <Icon name="printer" size={20} />
                ปริ้น label
              </button>
            )}
            <button
              type="button"
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-sm font-medium text-ink"
              onClick={() => { onPrintPackingSlip?.(); setMoreOpen(false); }}
              disabled={labelDisabled}
            >
              <Icon name="file" size={20} />
              packing slip
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function CancelledOrderActions({ order, voidStockStatus, onReturnGoods }) {
  return (
    <>
      <div className="hidden lg:flex flex-col gap-2 w-full lg:items-end">
        <span className="badge-pill !bg-error/10 !text-error text-[10px] w-full text-center lg:text-right">
          ยกเลิก TikTok
        </span>
        {voidStockStatus && (
          <VoidStockStatusBadge status={voidStockStatus} className="w-full text-center lg:text-right"/>
        )}
        {onReturnGoods && (
          <TikTokGlassBtn
            variant="coral"
            className="tt-glass__btn--lg w-full whitespace-nowrap"
            onClick={() => onReturnGoods(order)}
          >
            <Icon name="package" size={16}/>
            รับคืนสินค้า (เอกสาร)
          </TikTokGlassBtn>
        )}
      </div>

      <div className="lg:hidden flex flex-col gap-2 w-full">
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge-pill !bg-error/10 !text-error text-[10px]">ยกเลิก TikTok</span>
          {voidStockStatus && <VoidStockStatusBadge status={voidStockStatus} />}
        </div>
        {onReturnGoods && (
          <TikTokGlassBtn
            variant="coral"
            className="tt-glass__btn--lg w-full min-h-[44px]"
            onClick={() => onReturnGoods(order)}
          >
            <Icon name="package" size={16}/>
            รับคืนสินค้า
          </TikTokGlassBtn>
        )}
      </div>
    </>
  );
}
