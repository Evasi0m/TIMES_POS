import React from 'react';

/** Flat order line row — no nested backdrop-filter */
export default function TikTokGlassLineItem({
  thumb,
  title,
  sku,
  quantity,
  isLast = false,
  className = '',
}) {
  return (
    <li className={'tt-glass__line-item' + (isLast ? ' tt-glass__line-item--last' : '') + (className ? ' ' + className : '')}>
      <div className="tt-glass__line-item__thumb">
        {thumb}
      </div>
      <div className="tt-glass__line-item__body">
        <div className="tt-glass__line-item__title">{title}</div>
        {(sku || quantity != null) && (
          <div className="tt-glass__line-item__meta">
            {sku && <span className="tt-glass__line-item__sku">SKU: {sku}</span>}
          </div>
        )}
      </div>
      {quantity != null && (
        <span className="tt-glass__qty-pill">× {quantity}</span>
      )}
    </li>
  );
}
