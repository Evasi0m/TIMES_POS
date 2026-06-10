import React from 'react';
import Icon from '../../ui/Icon.jsx';
import PosProductMatcher from './PosProductMatcher.jsx';
import SkuThumb from './SkuThumb.jsx';
import {
  extractTikTokSkuKey,
  fmtTHB,
  resolvePickStock,
  stockShortfall,
  isTikTokSkuMismatch,
} from './helpers.js';

function MatchCallout() {
  return (
    <div className="ttc-match-callout shrink-0 flex items-start gap-2 px-3 py-2 rounded-xl text-xs leading-relaxed">
      <Icon name="info" size={14} className="shrink-0 mt-0.5 text-primary"/>
      <span>
        เลือกสินค้า POS ที่จะ<strong className="font-semibold">ตัดสต็อกจริง</strong>
        {' '}— ถ้าไม่ตรง SKU บน TikTok จะตรวจสอบในขั้น &quot;ตรวจสอบ&quot; ถัดไป
      </span>
    </div>
  );
}

function MatchedCompactCard({ item, pick, stock, shortfall, onClear, disabled }) {
  const tiktokSku = extractTikTokSkuKey(item);
  return (
    <div
      className={
        'ttc-matched-compact ttc-bento rounded-xl border p-3 flex flex-col min-h-0 min-w-0 overflow-hidden ' +
        (shortfall
          ? 'border-[#b3261e]/35 bg-[#fdecea]/70'
          : 'border-[#0a7a43]/25 bg-[#e6f7ed]/60')
      }
    >
      <div className="flex items-center gap-2 min-w-0">
        <SkuThumb url={item.sku_image_url} sizeClass="w-10 h-10" iconSize={18}/>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">TikTok</div>
          <div className="font-mono text-sm font-medium truncate" title={tiktokSku}>{tiktokSku}</div>
        </div>
        <Icon name="chevron-r" size={16} className="text-muted shrink-0"/>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">POS</div>
          <div className="font-mono text-sm font-semibold text-[#0a5a32] truncate" title={pick?.name}>
            {pick?.name || '—'}
          </div>
          <div className="text-[11px] text-muted tabular-nums mt-0.5">
            {stock != null ? <>stock {stock}</> : 'ไม่ทราบ stock'}
          </div>
        </div>
        {!shortfall && !isTikTokSkuMismatch(item, pick) && (
          <Icon name="check" size={18} className="text-[#0a7a43] shrink-0"/>
        )}
        {isTikTokSkuMismatch(item, pick) && !shortfall && (
          <Icon name="alert" size={18} className="text-amber-700 shrink-0"/>
        )}
      </div>
      {isTikTokSkuMismatch(item, pick) && (
        <div className="text-xs text-amber-800 mt-2 leading-relaxed">
          SKU ไม่ตรง TikTok — ติ๊ก &quot;ส่งจริงคนละรุ่น&quot; ในขั้นตอนตรวจสอบ
        </div>
      )}
      {shortfall && (
        <div className="text-xs text-[#b3261e] mt-2 leading-relaxed">
          สต็อก POS ไม่พอ — คงเหลือ {shortfall.stock} ต้องการ {shortfall.need}
        </div>
      )}
      {onClear && !disabled && (
        <button
          type="button"
          className="btn-secondary !py-1.5 !px-3 !text-xs mt-2.5 w-full max-w-full"
          onClick={() => onClear(item.id)}
        >
          <Icon name="refresh" size={13}/> เปลี่ยนสินค้า
        </button>
      )}
    </div>
  );
}

export default function TikTokMatchSidePanel({
  item,
  picks,
  matched,
  pick,
  disabled,
  catalog,
  catalogLoading,
  catalogError,
  onRetryCatalog,
  onPick,
  onClear,
  onGoToReview,
  allMatched,
}) {
  if (!item) {
    return (
      <div className="flex items-center justify-center h-full p-6 text-sm text-muted text-center">
        เลือกรายการจากด้านบน
      </div>
    );
  }

  const skuName = item.sku_name || item.product_name || '—';
  const skuKey = extractTikTokSkuKey(item);
  const shortfall = matched ? stockShortfall(item, pick, catalog) : null;
  const stock = matched ? resolvePickStock(pick, catalog) : null;

  if (matched) {
    return (
      <div className="ttc-match-side-panel ttc-focus-pane flex flex-col h-full min-h-0 p-3 gap-2 overflow-hidden">
        <div className={'ttc-focus-item-head shrink-0' + (shortfall ? '' : ' ttc-focus-item-head--matched')}>
          <SkuThumb url={item.sku_image_url} sizeClass="w-10 h-10" iconSize={18}/>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium leading-snug line-clamp-2">{skuName}</div>
            <div className="text-[11px] text-muted tabular-nums mt-0.5">
              {skuKey && <span className="font-mono">{skuKey} · </span>}
              ×{item.quantity} · {fmtTHB(item.unit_price)}
            </div>
          </div>
        </div>
        <div className="flex-1 min-h-0 flex flex-col justify-center gap-2">
          <MatchedCompactCard
            item={item}
            pick={pick}
            stock={stock}
            shortfall={shortfall}
            onClear={onClear}
            disabled={disabled}
          />
          {allMatched && onGoToReview && !disabled && (
            <button
              type="button"
              className="btn-primary !py-2.5 !text-sm w-full shrink-0"
              onClick={onGoToReview}
            >
              ถัดไป → ตรวจสอบ
              <Icon name="chevron-r" size={16} className="ml-1 inline"/>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="ttc-match-side-panel ttc-focus-pane flex flex-col h-full min-h-0 p-3 gap-2">
      <MatchCallout/>
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

      <div className="flex-1 min-h-0 flex flex-col">
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
