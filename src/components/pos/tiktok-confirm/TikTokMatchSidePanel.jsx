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
  isTikTokSkuMismatch,
  lineNeedsSubstitutionAck,
} from './helpers.js';

function SubstitutionControls({ item, pick, meta, disabled, onChange, panel = false }) {
  if (!isTikTokSkuMismatch(item, pick)) return null;
  const substitute = meta?.substitute === true;
  const needsAck = lineNeedsSubstitutionAck(item, pick, meta);
  const tiktokSku = extractTikTokSkuKey(item);
  return (
    <div
      className={
        'rounded-xl border border-amber-300/50 bg-amber-50/80 p-3 text-left ' +
        (panel ? 'h-full min-h-0 flex flex-col overflow-y-auto overflow-x-hidden' : 'mt-2.5')
      }
    >
      <div className="text-sm font-semibold text-amber-900">ส่งจริงคนละรุ่น?</div>
      <div className="text-xs text-amber-800/90 mt-1 leading-relaxed break-words">
        TikTok <span className="font-mono font-medium">{tiktokSku}</span>
        {' → '}POS <span className="font-mono font-medium">{pick?.name}</span>
      </div>
      {needsAck && (
        <div className="text-xs text-[#b3261e] font-medium mt-2 leading-relaxed">
          ติ๊กยืนยันด้านล่าง — หรือกดเปลี่ยนการจับคู่ให้ตรง SKU
        </div>
      )}
      <label
        className={
          'flex items-start gap-2.5 mt-3 text-sm text-amber-900 cursor-pointer ' +
          'rounded-lg border border-amber-400/40 bg-white/70 p-2.5 min-w-0'
        }
      >
        <input
          type="checkbox"
          className="mt-0.5 w-4 h-4 shrink-0"
          checked={substitute}
          disabled={disabled}
          onChange={e => onChange({ substitute: e.target.checked, note: meta?.note || '' })}
        />
        <span className="min-w-0 break-words">
          <span className="font-semibold">ส่งจริงคนละรุ่น</span>
          <span className="block text-xs text-amber-800/90 mt-1 font-normal leading-relaxed">
            ลูกค้าตกลงส่งรุ่นอื่น — ไม่อัปเดต mapping ถาวร
          </span>
        </span>
      </label>
      {substitute && (
        <input
          type="text"
          className="input !text-xs mt-2 w-full min-w-0"
          placeholder="หมายเหตุ (ถ้ามี)"
          value={meta?.note || ''}
          disabled={disabled}
          onChange={e => onChange({ substitute: true, note: e.target.value })}
        />
      )}
    </div>
  );
}

function MatchedCompactCard({ item, pick, stock, shortfall, onClear, disabled, vertical = false }) {
  const tiktokSku = extractTikTokSkuKey(item);
  return (
    <div
      className={
        'ttc-matched-compact rounded-xl border p-3 flex flex-col min-h-0 min-w-0 overflow-hidden ' +
        (shortfall
          ? 'border-[#b3261e]/35 bg-[#fdecea]/70'
          : 'border-[#0a7a43]/25 bg-[#e6f7ed]/60')
      }
    >
      {vertical ? (
        <>
          <div className="flex items-center gap-2 min-w-0">
            <SkuThumb url={item.sku_image_url} sizeClass="w-9 h-9" iconSize={16}/>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">TikTok</div>
              <div className="font-mono text-sm font-medium truncate" title={tiktokSku}>{tiktokSku}</div>
            </div>
          </div>
          <div className="border-t border-black/8 my-2 shrink-0"/>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">POS</div>
            <div className="font-mono text-sm font-semibold text-[#0a5a32] truncate" title={pick?.name}>
              {pick?.name || '—'}
            </div>
            <div className="text-[11px] text-muted tabular-nums mt-0.5">
              {stock != null ? <>stock {stock}</> : 'ไม่ทราบ stock'}
            </div>
          </div>
        </>
      ) : (
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
          {!shortfall && (
            <Icon name="check" size={18} className="text-[#0a7a43] shrink-0"/>
          )}
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
          className="btn-secondary !py-1.5 !px-3 !text-xs mt-auto pt-2.5 w-full max-w-full truncate"
          onClick={() => onClear(item.id)}
        >
          <Icon name="refresh" size={13}/> เปลี่ยนการจับคู่
        </button>
      )}
    </div>
  );
}

function MatchedSummaryRow({ item, pick, catalog, substitutionMeta }) {
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
        {substitutionMeta?.[item.id]?.substitute === true && (
          <div className="text-[10px] font-medium text-amber-800 mt-0.5">ส่งจริงคนละรุ่น</div>
        )}
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
  substitutionMeta,
  onSubstitutionChange,
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
                substitutionMeta={substitutionMeta}
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
    const hasMismatch = isTikTokSkuMismatch(item, pick);

    if (hasMismatch) {
      return (
        <div className="ttc-match-side-panel ttc-focus-pane ttc-matched-split flex flex-col h-full min-h-0 p-3 gap-2 overflow-hidden">
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

          <div className="ttc-matched-split__grid flex-1 min-h-0 grid grid-cols-2 gap-2">
            <MatchedCompactCard
              item={item}
              pick={pick}
              stock={stock}
              shortfall={shortfall}
              onClear={onClear}
              disabled={disabled}
              vertical
            />
            <SubstitutionControls
              item={item}
              pick={pick}
              meta={substitutionMeta?.[item.id]}
              disabled={disabled}
              panel
              onChange={(patch) => onSubstitutionChange?.(item.id, patch)}
            />
          </div>
        </div>
      );
    }

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
        <div className="flex-1 min-h-0 flex flex-col justify-center">
          <MatchedCompactCard
            item={item}
            pick={pick}
            stock={stock}
            shortfall={shortfall}
            onClear={onClear}
            disabled={disabled}
          />
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
