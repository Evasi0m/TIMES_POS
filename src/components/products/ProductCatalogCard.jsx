import React, { memo } from 'react';
import ProductThumb from '../ui/ProductThumb.jsx';
import TikTokLinkedBadge from '../ecommerce/TikTokLinkedBadge.jsx';
import { roundMoney } from '../../lib/money.js';

function nameLengthClass(name) {
  const len = String(name || '').length;
  if (len > 28) return 'product-catalog-card__name--long';
  if (len > 18) return 'product-catalog-card__name--mid';
  return '';
}

function fmtPlain(n) {
  return roundMoney(n).toLocaleString('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/**
 * Vertical catalog tile (1:1 media) for ProductsView grid mode.
 * Stock badge: card top-right. TikTok badge: photo top-left.
 */
function ProductCatalogCard({
  product,
  latestCost = null,
  canEdit = false,
  onOpen,
  tiktokMapping = null,
  showTikTokBadge = false,
  isNew = false,
}) {
  const stock = Number(product?.current_stock) || 0;
  const oos = stock <= 0;
  const name = product?.name || '—';
  const nameCls = nameLengthClass(name);
  const showTikTok = Boolean(showTikTokBadge && tiktokMapping);

  const handleActivate = () => {
    if (canEdit && onOpen) onOpen(product);
  };

  const handleKeyDown = (e) => {
    if (!canEdit) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleActivate();
    }
  };

  return (
    <div
      role={canEdit ? 'button' : undefined}
      tabIndex={canEdit ? 0 : undefined}
      onClick={canEdit ? handleActivate : undefined}
      onKeyDown={canEdit ? handleKeyDown : undefined}
      className={
        'product-catalog-card' +
        (canEdit ? ' product-catalog-card--clickable' : '') +
        (oos ? ' product-catalog-card--oos' : '')
      }
      title={canEdit ? `แก้ไข: ${name}` : name}
    >
      <div
        className="product-catalog-card__stock"
        aria-label={oos ? 'หมดสต็อก' : `คงเหลือ ${stock}`}
      >
        <div
          className={
            'stock-gem stock-gem--circle stock-gem--md ' +
            (oos ? 'stock-gem--out' : 'stock-gem--in')
          }
        >
          <span className="stock-gem__num">{stock}</span>
        </div>
      </div>

      <div className="product-catalog-card__media">
        {showTikTok && (
          <div className="product-catalog-card__tiktok">
            <TikTokLinkedBadge mapping={tiktokMapping} size={16} />
          </div>
        )}
        <div className="product-catalog-card__media-inner">
          <ProductThumb
            product={product}
            fill
            expandable={false}
            fallback={showTikTok ? 'brand' : 'sku'}
          />
        </div>
      </div>

      <div className="product-catalog-card__body">
        <div className="product-catalog-card__name-row">
          <span className={'product-catalog-card__name ' + nameCls} title={name}>
            {name}
          </span>
          {isNew && (
            <span className="product-catalog-card__badges">
              <span className="new-product-badge shrink-0">ใหม่</span>
            </span>
          )}
        </div>

        <div className="product-catalog-card__costs" title="ทุนตั้งต้น | ทุนล่าสุด">
          <span className={latestCost ? 'text-muted-soft' : 'text-ink font-medium'}>
            {fmtPlain(product?.cost_price)}
          </span>
          <span className="product-catalog-card__costs-sep" aria-hidden="true">|</span>
          <span className={latestCost ? 'text-ink font-medium' : 'text-muted-soft'}>
            {latestCost ? fmtPlain(latestCost.unit_price) : '—'}
          </span>
        </div>

        <div className="product-catalog-card__price">
          <div className="price-gem price-gem--soft-ink">
            <span className="price-gem__num">{fmtPlain(product?.retail_price)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(ProductCatalogCard);
