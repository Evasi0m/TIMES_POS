import React, { useEffect, useRef } from 'react';
import Icon from '../../ui/Icon.jsx';
import SkuThumb from './SkuThumb.jsx';
import {
  resolvePickStock,
  stockShortfall,
  lineNeedsSubstitutionAck,
} from './helpers.js';
import { TTC_COPY } from './copy.js';

export default function TikTokItemNavigator({
  items,
  activeItemId,
  picks,
  orderCtx,
  catalog,
  substitutionMeta,
  matchConfirmed,
  onSelect,
  onClear,
  disabled,
}) {
  const chipRefs = useRef({});

  useEffect(() => {
    if (!activeItemId) return;
    const el = chipRefs.current[activeItemId];
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [activeItemId, items.length]);

  if (!items.length) return null;

  return (
    <div className="ttc-focus-nav shrink-0 min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5 inline-flex items-center gap-1.5">
        <Icon name="link" size={11}/> {TTC_COPY.navMatchItems(items.length)}
      </div>
      <div className="ttc-focus-nav__track">
        {items.map((it, idx) => {
          const pick = picks[it.id];
          const matched = Boolean(pick?.id);
          const active = activeItemId === it.id;
          const skuName = it.sku_name || it.product_name || '—';
          const shortfall = matched ? stockShortfall(it, pick, catalog, orderCtx) : null;
          const stock = matched ? resolvePickStock(pick, catalog) : null;
          const needsResolution = matched && lineNeedsSubstitutionAck(it, pick, substitutionMeta?.[it.id], matchConfirmed);
          const substOk = substitutionMeta?.[it.id]?.substitute === true;
          const confirmed = matchConfirmed?.[it.id];

          let chipClass = ' ttc-focus-chip--pending';
          if (matched) {
            if (shortfall) chipClass = ' ttc-focus-chip--stock-warn';
            else if (needsResolution) chipClass = ' ttc-focus-chip--subst';
            else chipClass = ' ttc-focus-chip--matched';
          }

          return (
            <div
              key={it.id}
              ref={(node) => {
                if (node) chipRefs.current[it.id] = node;
                else delete chipRefs.current[it.id];
              }}
              className={
                'ttc-focus-chip' +
                (active ? ' ttc-focus-chip--active' : '') +
                chipClass +
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
                    shortfall ? (
                      <span className="inline-flex items-center gap-0.5 text-[#b3261e]">
                        <Icon name="alert" size={10}/>
                        {TTC_COPY.navStockShort(stock)}
                      </span>
                    ) : needsResolution ? (
                      <span className="inline-flex items-center gap-0.5 text-amber-800">
                        <Icon name="alert" size={10}/>
                        {TTC_COPY.navPendingResolution}
                      </span>
                    ) : substOk ? (
                      <span className="inline-flex items-center gap-0.5 text-[#0a7a43]">
                        <Icon name="check" size={10}/> {TTC_COPY.navSubstOk}
                      </span>
                    ) : confirmed ? (
                      <span className="inline-flex items-center gap-0.5 text-[#0a7a43]">
                        <Icon name="check" size={10}/> {TTC_COPY.navMatchOk}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 text-[#0a7a43]">
                        <Icon name="check" size={10}/> {TTC_COPY.navModelOk(stock ?? '?')}
                      </span>
                    )
                  ) : (
                    <span className="inline-flex items-center gap-0.5 text-[#8a6500]">
                      <Icon name="alert" size={10}/> {TTC_COPY.navWaitingPick}
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
                  aria-label="เปลี่ยนสินค้า"
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
