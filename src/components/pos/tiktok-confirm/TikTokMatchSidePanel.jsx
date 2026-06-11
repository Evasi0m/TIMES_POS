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
  needsMatchConfirm,
  needsSubstitutionOption,
  lineNeedsResolutionAck,
  skuMatchStatusMessage,
  resolvePickSkuMatchTier,
} from './helpers.js';
import { TTC_COPY, displayTiktokSkuLabel } from './copy.js';

function MatchCallout() {
  return (
    <div className="ttc-match-callout shrink-0 flex items-start gap-2 px-3 py-2 rounded-xl text-xs leading-relaxed">
      <Icon name="info" size={14} className="shrink-0 mt-0.5 text-primary"/>
      <span>{TTC_COPY.matchCallout}</span>
    </div>
  );
}

function MatchedCompactCard({
  item,
  pick,
  stock,
  shortfall,
  matchConfirmed,
  substitutionMeta,
  onClear,
  onConfirmMatch,
  onSubstitutionChange,
  matchConfirmBusy,
  disabled,
}) {
  const tiktokSku = displayTiktokSkuLabel(extractTikTokSkuKey(item));
  const meta = substitutionMeta?.[item.id];
  const confirmed = matchConfirmed?.[item.id];
  const substitute = meta?.substitute === true;
  const mismatch = isTikTokSkuMismatch(item, pick, matchConfirmed);
  const showConfirm = needsMatchConfirm(item, pick, matchConfirmed) && !substitute;
  const showSubst = needsSubstitutionOption(item, pick, meta, matchConfirmed);
  const needsResolution = lineNeedsResolutionAck(item, pick, meta, matchConfirmed);
  const statusMsg = skuMatchStatusMessage(item, pick, matchConfirmed);
  const { tier } = resolvePickSkuMatchTier(item, pick);
  const suffixOk = tier === 'suffix' && !mismatch && !needsResolution;
  const resolved = confirmed || substitute;

  return (
    <div
      className={
        'ttc-matched-compact ttc-bento rounded-xl border p-3 flex flex-col min-h-0 min-w-0 overflow-hidden ' +
        (shortfall
          ? 'border-[#b3261e]/35 bg-[#fdecea]/70'
          : needsResolution
            ? 'border-amber-400/40 bg-amber-50/60'
            : 'border-[#0a7a43]/25 bg-[#e6f7ed]/60')
      }
    >
      <div className="flex items-center gap-2 min-w-0">
        <SkuThumb url={item.sku_image_url} sizeClass="w-10 h-10" iconSize={18}/>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{TTC_COPY.colTiktok}</div>
          <div className="font-mono text-sm font-medium truncate" title={tiktokSku}>{tiktokSku}</div>
        </div>
        <Icon name="chevron-r" size={16} className="text-muted shrink-0"/>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{TTC_COPY.colStore}</div>
          <div className="font-mono text-sm font-semibold text-[#0a5a32] truncate" title={pick?.name}>
            {pick?.name || '—'}
          </div>
          <div className="text-[11px] text-muted tabular-nums mt-0.5">
            {stock != null ? TTC_COPY.stock(stock) : TTC_COPY.stockUnknown}
          </div>
        </div>
        {!shortfall && resolved && (
          <Icon name="check" size={18} className="text-[#0a7a43] shrink-0"/>
        )}
        {needsResolution && !shortfall && !resolved && (
          <Icon name="alert" size={18} className="text-amber-700 shrink-0"/>
        )}
        {!shortfall && !needsResolution && !resolved && (
          <Icon name="check" size={18} className="text-[#0a7a43] shrink-0"/>
        )}
      </div>
      {suffixOk && (
        <div className="text-xs text-[#0a5a32] mt-2 leading-relaxed flex items-start gap-1.5">
          <Icon name="check" size={14} className="shrink-0 mt-0.5"/>
          {TTC_COPY.suffixSameModel}
        </div>
      )}
      {statusMsg && !substitute && !confirmed && (
        <div className="text-xs mt-2 leading-relaxed text-amber-800">
          {statusMsg}
        </div>
      )}
      {substitute && (
        <div className="text-xs text-[#0a5a32] mt-2 leading-relaxed flex items-start gap-1.5">
          <Icon name="check" size={14} className="shrink-0 mt-0.5"/>
          {TTC_COPY.substReadyReview}
        </div>
      )}
      {confirmed && (
        <div className="text-xs text-[#0a5a32] mt-2 leading-relaxed flex items-start gap-1.5">
          <Icon name="check" size={14} className="shrink-0 mt-0.5"/>
          {TTC_COPY.matchConfirmedAutofill}
        </div>
      )}
      {needsResolution && showConfirm && showSubst && !disabled && (
        <div className="text-[10px] text-muted text-center mt-2.5">{TTC_COPY.pickOneOption}</div>
      )}
      {showConfirm && onConfirmMatch && !disabled && (
        <button
          type="button"
          className="btn-primary !py-2 !text-xs mt-2.5 w-full max-w-full"
          disabled={matchConfirmBusy || substitute}
          onClick={() => onConfirmMatch(item.id)}
        >
          {matchConfirmBusy ? <span className="spinner"/> : <Icon name="check" size={13}/>}
          {TTC_COPY.confirmMatch}
        </button>
      )}
      {showSubst && !disabled && (
        <>
          {showConfirm && (
            <div className="text-[10px] text-muted text-center my-1">{TTC_COPY.orDivider}</div>
          )}
          <label className="ttc-rl__check ttc-bento flex items-start gap-2.5 rounded-xl border border-amber-400/45 p-2.5 cursor-pointer min-w-0 mt-1">
            <input
              type="checkbox"
              className="mt-0.5 w-4 h-4 shrink-0"
              checked={substitute}
              disabled={disabled || confirmed}
              onChange={e => onSubstitutionChange?.(item.id, {
                substitute: e.target.checked,
                note: meta?.note || '',
              })}
            />
            <span className="min-w-0">
              <span className="text-xs font-semibold text-amber-900">{TTC_COPY.substLong}</span>
              <span className="block text-[10px] text-amber-800/90 mt-0.5 leading-relaxed">
                {TTC_COPY.substLongHint}
              </span>
            </span>
          </label>
          {substitute && (
            <input
              type="text"
              className="input !text-xs w-full min-w-0 mt-1.5"
              placeholder="หมายเหตุ (ถ้ามี)"
              value={meta?.note || ''}
              disabled={disabled}
              onChange={e => onSubstitutionChange?.(item.id, { substitute: true, note: e.target.value })}
            />
          )}
        </>
      )}
      {shortfall && (
        <div className="text-xs text-[#b3261e] mt-2 leading-relaxed">
          {TTC_COPY.stockShortfall(shortfall.stock, shortfall.need)}
        </div>
      )}
      {onClear && !disabled && (
        <button
          type="button"
          className="btn-secondary !py-1.5 !px-3 !text-xs mt-2.5 w-full max-w-full"
          onClick={() => onClear(item.id)}
        >
          <Icon name="refresh" size={13}/> {TTC_COPY.changeProduct}
        </button>
      )}
    </div>
  );
}

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
  onGoToReview,
  allMatched,
  matchConfirmed,
  substitutionMeta,
  onConfirmMatch,
  onSubstitutionChange,
  matchConfirmBusy,
  resolutionBlocked,
}) {
  if (!item) {
    return (
      <div className="flex items-center justify-center h-full p-6 text-sm text-muted text-center">
        เลือกรายการจากด้านบน
      </div>
    );
  }

  const skuName = item.sku_name || item.product_name || '—';
  const skuKey = displayTiktokSkuLabel(extractTikTokSkuKey(item));
  const shortfall = matched ? stockShortfall(item, pick, catalog) : null;
  const stock = matched ? resolvePickStock(pick, catalog) : null;
  const canReview = allMatched && !resolutionBlocked;

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
            matchConfirmed={matchConfirmed}
            substitutionMeta={substitutionMeta}
            onClear={onClear}
            onConfirmMatch={onConfirmMatch}
            onSubstitutionChange={onSubstitutionChange}
            matchConfirmBusy={matchConfirmBusy}
            disabled={disabled}
          />
          {resolutionBlocked && (
            <div className="text-xs text-amber-800 text-center leading-relaxed px-1">
              {TTC_COPY.resolutionHint}
            </div>
          )}
          {canReview && onGoToReview && !disabled && (
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
