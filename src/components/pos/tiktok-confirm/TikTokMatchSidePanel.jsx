import React from 'react';
import Icon from '../../ui/Icon.jsx';
import PosProductMatcher from './PosProductMatcher.jsx';
import SkuThumb from './SkuThumb.jsx';
import { extractTikTokSkuKey, fmtTHB } from './helpers.js';

/**
 * Full-width "focus one item at a time" matcher area.
 * Three states (all-matched / matched / unmatched) preserved — restyled from
 * the old narrow side column to a full-width focus pane with a candidate grid.
 */
export default function TikTokMatchSidePanel({
  item,
  matched,
  pick,
  disabled,
  catalog,
  catalogLoading,
  catalogError,
  onRetryCatalog,
  onPick,
  onClear,
  onEditMatches,
}) {
  if (!item) {
    return (
      <div className="ttc-match-side-panel ttc-focus-pane flex flex-col items-center justify-center h-full p-6 text-center">
        <div className="ttc-focus-done-badge">
          <Icon name="check" size={30} className="text-[#0a7a43]"/>
        </div>
        <div className="text-base font-semibold text-ink mt-3">จับคู่ครบทุกรายการแล้ว</div>
        <div className="text-sm text-muted mt-1">กรอกเงินที่ได้รับด้านล่าง แล้วกดยืนยัน</div>
        {onEditMatches && !disabled && (
          <button
            type="button"
            className="btn-secondary !py-1.5 !px-4 !text-xs mt-4"
            onClick={onEditMatches}
          >
            <Icon name="refresh" size={13}/> แก้ไขการจับคู่
          </button>
        )}
      </div>
    );
  }

  const skuName = item.sku_name || item.product_name || '—';
  const skuKey = extractTikTokSkuKey(item);

  if (matched) {
    return (
      <div className="ttc-match-side-panel ttc-focus-pane flex flex-col h-full p-3">
        <div className="ttc-focus-item-head ttc-focus-item-head--matched">
          <SkuThumb url={item.sku_image_url} sizeClass="w-12 h-12" iconSize={20}/>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium leading-snug line-clamp-2">{skuName}</div>
            <div className="text-[11px] text-muted tabular-nums mt-0.5">
              {skuKey && <span className="font-mono">{skuKey} · </span>}
              ×{item.quantity} · {fmtTHB(item.unit_price)}
            </div>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center p-5 rounded-2xl border border-[#0a7a43]/25 bg-[#e6f7ed]/60 mt-2.5">
          <Icon name="check" size={30} className="text-[#0a7a43] mb-2"/>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#0a7a43]/80">จับคู่กับสินค้า POS</div>
          <div className="text-base font-semibold text-[#0a5a32] mt-1 font-mono break-all">{pick.name}</div>
          {onClear && !disabled && (
            <button
              type="button"
              className="btn-secondary !py-1.5 !px-4 !text-xs mt-4"
              onClick={() => onClear(item.id)}
            >
              <Icon name="refresh" size={13}/> เปลี่ยนการจับคู่
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="ttc-match-side-panel ttc-focus-pane flex flex-col h-full min-h-0 p-3">
      <div className="ttc-focus-item-head shrink-0">
        <SkuThumb url={item.sku_image_url} sizeClass="w-12 h-12" iconSize={20}/>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-snug line-clamp-2 break-words">{skuName}</div>
          <div className="text-[11px] text-muted tabular-nums mt-0.5">
            {skuKey && <span className="font-mono text-ink/70">{skuKey} · </span>}
            ×{item.quantity} · {fmtTHB(item.unit_price)}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col mt-2.5">
        <PosProductMatcher
          item={item}
          catalog={catalog}
          catalogLoading={catalogLoading}
          catalogError={catalogError}
          onRetryCatalog={onRetryCatalog}
          onPick={onPick}
          disabled={disabled}
          layout="focus"
          recommendLimit={10}
        />
      </div>
    </div>
  );
}
