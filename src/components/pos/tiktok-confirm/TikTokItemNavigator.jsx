import React from 'react';
import Icon from '../../ui/Icon.jsx';
import SkuThumb from './SkuThumb.jsx';

/**
 * Horizontal item switcher for the focus-one-at-a-time confirm flow.
 * Replaces the old vertical item list. Pure presentation — drives the
 * existing activeItemId / handleClear handlers from the pane.
 */
export default function TikTokItemNavigator({ items, activeItemId, picks, onSelect, onClear, disabled }) {
  if (!items.length) return null;

  return (
    <div className="ttc-focus-nav shrink-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5 inline-flex items-center gap-1.5">
        <Icon name="link" size={11}/> จับคู่สินค้า · {items.length} รายการ
      </div>
      <div className="ttc-focus-nav__track">
        {items.map((it, idx) => {
          const matched = Boolean(picks[it.id]?.id);
          const active = activeItemId === it.id;
          const skuName = it.sku_name || it.product_name || '—';
          return (
            <div
              key={it.id}
              className={
                'ttc-focus-chip' +
                (active ? ' ttc-focus-chip--active' : '') +
                (matched ? ' ttc-focus-chip--matched' : ' ttc-focus-chip--pending') +
                (disabled ? ' is-disabled' : '')
              }
              role="button"
              tabIndex={disabled ? -1 : 0}
              onClick={disabled ? undefined : () => onSelect(it.id)}
              onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(it.id); } }}
            >
              <SkuThumb url={it.sku_image_url} sizeClass="w-8 h-8" iconSize={14}/>
              <div className="min-w-0 flex-1">
                <div className="ttc-focus-chip__name">{skuName}</div>
                <div className="ttc-focus-chip__status">
                  {matched ? (
                    <span className="inline-flex items-center gap-0.5 text-[#0a7a43]">
                      <Icon name="check" size={10}/> จับคู่แล้ว
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 text-[#8a6500]">
                      <Icon name="alert" size={10}/> รอจับคู่
                    </span>
                  )}
                </div>
              </div>
              <span className="ttc-focus-chip__num">{idx + 1}</span>
              {matched && !disabled && (
                <button
                  type="button"
                  className="ttc-focus-chip__change"
                  onClick={(e) => { e.stopPropagation(); onClear(it.id); }}
                  aria-label="เปลี่ยนการจับคู่"
                >
                  เปลี่ยน
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
