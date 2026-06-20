import React, { forwardRef } from 'react';
import Icon from '../ui/Icon.jsx';
import ExpandableImageThumb from '../ui/ExpandableImageThumb.jsx';
import ProductThumb from '../ui/ProductThumb.jsx';
import { tiktokSkuDisplayLabel } from '../../lib/tiktok-mirror-helpers.js';
import { addVat, fmtTHB } from '../../lib/money.js';
import { getRowAsideImageUrl } from './bill-review-shared.js';

function WorkCardVisual({ row, tiktokCatalog = [], productImagesById = {} }) {
  if (row.tiktok_skip) {
    return (
      <div className="rrm-work-card__visual rrm-work-card__visual--skip" aria-label="\u0e44\u0e21\u0e48 sync TikTok">
        <Icon name="store" size={20} className="text-[#6d28d9] opacity-70"/>
      </div>
    );
  }

  const imageUrl = getRowAsideImageUrl(row, { catalog: tiktokCatalog, productImagesById });
  const alt = tiktokSkuDisplayLabel(row.tiktok_sku || row.tiktok_mapping) || row.model_code || row.product?.name || '';

  if (imageUrl) {
    return (
      <ExpandableImageThumb
        src={imageUrl}
        alt={alt}
        className="rrm-work-card__visual"
        imgClassName="w-full h-full object-contain rounded-[inherit]"
        placeholder={(
          <div className="rrm-work-card__visual rrm-work-card__visual--skeleton" aria-hidden="true">
            <span className="skeleton absolute inset-0 rounded-[inherit]"/>
          </div>
        )}
      />
    );
  }

  if (row.product) {
    const productWithImage = {
      ...row.product,
      _imageRow: productImagesById[row.product.id] || null,
    };
    return (
      <div className="rrm-work-card__visual rrm-work-card__visual--product flex items-center justify-center p-2">
        <ProductThumb product={productWithImage} size="lg" className="!shadow-none"/>
      </div>
    );
  }

  return (
    <div className="rrm-work-card__visual rrm-work-card__visual--skeleton" aria-label="\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e21\u0e35\u0e23\u0e39\u0e1b\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32">
      <span className="skeleton absolute inset-0 rounded-[inherit]"/>
    </div>
  );
}

const ReceiveReviewWorkCard = forwardRef(function ReceiveReviewWorkCard(
  {
    rowIndex,
    row,
    hasVat,
    displayState,
    duplicate,
    onRemove,
    tiktokCatalog = [],
    productImagesById = {},
    secondaryAction = null,
    cardCls = '',
    children,
  },
  ref,
) {
  const grossCost = hasVat ? addVat(row.unit_cost) : row.unit_cost;

  return (
    <div
      ref={ref}
      className={'rrm-work-card card-canvas ttc-rl w-full ' + cardCls}
      id="receive-match-workspace"
    >
      <div className="rrm-work-card__hero">
        <WorkCardVisual row={row} tiktokCatalog={tiktokCatalog} productImagesById={productImagesById}/>
        <div className="rrm-work-card__hero-meta min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className={'ai-row-badge !w-7 !h-7 !text-[11px] shrink-0 ' + displayState.badgeCls}>
              {rowIndex + 1}
            </span>
            <div className="font-mono text-[15px] font-bold text-ink leading-snug break-all min-w-0">
              {row.model_code}
            </div>
          </div>
          <div className="text-sm text-muted tabular-nums mt-1">
            {'\u00d7'}{row.quantity} {'\u00b7'} {fmtTHB(grossCost)}
            {hasVat && <span className="text-muted-soft"> ({'\u0e23\u0e27\u0e21'} VAT)</span>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <span className={'air-status-chip ' + displayState.pillCls}>
              <Icon name={displayState.icon} size={9}/>
              <span>{displayState.label}</span>
            </span>
            {duplicate && (
              <span className="air-chip air-chip--dup" title="model \u0e19\u0e35\u0e49\u0e21\u0e35\u0e21\u0e32\u0e01\u0e01\u0e27\u0e48\u0e32\u0e2b\u0e19\u0e36\u0e48\u0e07\u0e1a\u0e23\u0e23\u0e17\u0e31\u0e14\u0e43\u0e19\u0e1a\u0e34\u0e25">\u0e0b\u0e49\u0e33?</span>
            )}
          </div>
        </div>
        <button
          type="button"
          className="btn-ghost icon-btn-44 !p-0 shrink-0 text-muted-soft hover:text-error"
          onClick={onRemove}
          aria-label="\u0e25\u0e1a\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e19\u0e35\u0e49"
        >
          <Icon name="trash" size={18}/>
        </button>
      </div>

      <div className="hairline" role="presentation"/>

      <div className="rrm-work-card__body">
        {children}
      </div>

      {secondaryAction && (
        <div className="rrm-work-card__actions">
          <button
            type="button"
            className="btn-secondary w-full"
            onClick={secondaryAction.onClick}
          >
            {secondaryAction.icon && <Icon name={secondaryAction.icon} size={15}/>}
            {secondaryAction.label}
          </button>
        </div>
      )}
    </div>
  );
});

export default ReceiveReviewWorkCard;
