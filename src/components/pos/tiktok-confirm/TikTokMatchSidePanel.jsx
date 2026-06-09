import React from 'react';
import Icon from '../../ui/Icon.jsx';
import PosProductMatcher from './PosProductMatcher.jsx';
import SkuThumb from './SkuThumb.jsx';
import {
  extractTikTokSkuKey,
  fmtTHB,
  resolvePickStock,
  stockShortfall,
  itemSkuLabel,
} from './helpers.js';

function MatchedSummaryRow({ item, pick, catalog }) {
  const shortfall = stockShortfall(item, pick, catalog);
  const stock = resolvePickStock(pick, catalog);
  return (
    <div
      className={
        'flex items-start gap-2 text-left text-sm py-2 px-2.5 rounded-xl border ' +
        (shortfall
          ? 'border-[#b3261e]/30 bg-[#fdecea]/80'
          : 'border-[#0a7a43]/20 bg-white/60')
      }
    >
      <SkuThumb url={item.sku_image_url} sizeClass="w-9 h-9" iconSize={16}/>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted truncate">{itemSkuLabel(item)}</div>
        <div className="font-mono font-semibold text-[#0a5a32] truncate">{pick?.name || '—'}</div>
        <div className="text-[11px] text-muted tabular-nums mt-0.5">
          {stock != null ? <>stock {stock}</> : 'ไม่ทราบ stock'}
          {shortfall && (
            <span className="text-[#b3261e] font-medium ml-1">
              · ต้องการ {shortfall.need}
            </span>
          )}
        </div>
      </div>
      {shortfall ? (
        <Icon name="alert" size={16} className="text-[#b3261e] shrink-0 mt-0.5"/>
      ) : (
        <Icon name="check" size={16} className="text-[#0a7a43] shrink-0 mt-0.5"/>
      )}
    </div>
  );
}

/**
 * Full-width "focus one item at a time" matcher area.
 * Three states (all-matched / matched / unmatched) preserved — restyled from
 * the old narrow side column to a full-width focus pane with a candidate grid.
 */
export default function TikTokMatchSidePanel({
  item,
  items,
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
  onEditMatches,
}) {
  if (!item) {
    const allItems = items || [];
    const hasStockIssue = allItems.some(
      it => picks[it.id]?.id && stockShortfall(it, picks[it.id], catalog),
    );
    return (
      <div className="ttc-match-side-panel ttc-focus-pane flex flex-col h-full p-3 min-h-0">
        <div className="flex flex-col items-center text-center pt-2 pb-3 shrink-0">
          <div className="ttc-focus-done-badge">
            <Icon name="check" size={30} className="text-[#0a7a43]"/>
          </div>
          <div className="text-base font-semibold text-ink mt-3">จับคู่ครบทุกรายการแล้ว</div>
          <div className="text-sm text-muted mt-1">
            {hasStockIssue
              ? 'มีรายการที่สต็อก POS ไม่พอ — แก้การจับคู่หรือยกเลิกบน TikTok Shop'
              : 'กรอกเงินที่ได้รับด้านล่าง แล้วกดยืนยัน'}
          </div>
        </div>
        {allItems.length > 0 && (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
            {allItems.map(it => (
              <MatchedSummaryRow
                key={it.id}
                item={it}
                pick={picks[it.id]}
                catalog={catalog}
              />
            ))}
          </div>
        )}
        {onEditMatches && !disabled && (
          <button
            type="button"
            className="btn-secondary !py-1.5 !px-4 !text-xs mt-3 shrink-0 self-center"
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
  const shortfall = matched ? stockShortfall(item, pick, catalog) : null;
  const stock = matched ? resolvePickStock(pick, catalog) : null;

  if (matched) {
    return (
      <div className="ttc-match-side-panel ttc-focus-pane flex flex-col h-full p-3">
        <div className={'ttc-focus-item-head' + (shortfall ? '' : ' ttc-focus-item-head--matched')}>
          <SkuThumb url={item.sku_image_url} sizeClass="w-12 h-12" iconSize={20}/>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium leading-snug line-clamp-2">{skuName}</div>
            <div className="text-[11px] text-muted tabular-nums mt-0.5">
              {skuKey && <span className="font-mono">{skuKey} · </span>}
              ×{item.quantity} · {fmtTHB(item.unit_price)}
            </div>
          </div>
        </div>
        <div
          className={
            'flex-1 flex flex-col items-center justify-center text-center p-5 rounded-2xl border mt-2.5 ' +
            (shortfall
              ? 'border-[#b3261e]/35 bg-[#fdecea]/70'
              : 'border-[#0a7a43]/25 bg-[#e6f7ed]/60')
          }
        >
          {shortfall ? (
            <Icon name="alert" size={30} className="text-[#b3261e] mb-2"/>
          ) : (
            <Icon name="check" size={30} className="text-[#0a7a43] mb-2"/>
          )}
          <div
            className={
              'text-[11px] font-semibold uppercase tracking-wider ' +
              (shortfall ? 'text-[#b3261e]/90' : 'text-[#0a7a43]/80')
            }
          >
            จับคู่กับสินค้า POS
          </div>
          <div
            className={
              'text-base font-semibold mt-1 font-mono break-all ' +
              (shortfall ? 'text-[#8a1c12]' : 'text-[#0a5a32]')
            }
          >
            {pick.name}
          </div>
          <div className="text-sm tabular-nums mt-2 text-muted">
            {stock != null ? (
              <>stock <span className="font-semibold text-ink">{stock}</span></>
            ) : (
              'ไม่ทราบ stock ปัจจุบัน'
            )}
          </div>
          {shortfall && (
            <div className="text-sm text-[#b3261e] mt-3 leading-relaxed max-w-sm">
              สต็อก POS ไม่พอ — คงเหลือ {shortfall.stock} ต้องการ {shortfall.need} · ยืนยันไม่ได้
              <div className="text-xs text-[#8a1c12]/90 mt-1.5">
                แนะนำยกเลิกออเดอร์บน TikTok Shop แทน
              </div>
            </div>
          )}
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
