import React from 'react';
import Icon from '../../ui/Icon.jsx';
import SkuThumb from './SkuThumb.jsx';
import {
  extractTikTokSkuKey,
  fmtTHB,
  resolvePickStock,
  stockShortfall,
  isGenericTikTokSku,
  lineNeedsSubstitutionAck,
} from './helpers.js';
import { TTC_COPY, displayTiktokSkuLabel } from './copy.js';

function statusOf(item, pick, catalog, meta, matchConfirmed = {}, orderCtx) {
  if (stockShortfall(item, pick, catalog, orderCtx)) return 'stock';
  if (meta?.substitute === true) return 'subst-ok';
  if (matchConfirmed[item.id] && isGenericTikTokSku(item)) return 'match-confirmed';
  if (lineNeedsSubstitutionAck(item, pick, meta, matchConfirmed)) return 'subst';
  return 'ok';
}

const STATUS_META = {
  ok: { cls: 'ttc-rl--ok', label: TTC_COPY.badgeOk, icon: 'check', tone: 'text-[#0a7a43]' },
  'match-confirmed': { cls: 'ttc-rl--ok', label: TTC_COPY.badgeMatchConfirmed, icon: 'check', tone: 'text-[#0a7a43]' },
  'subst-ok': { cls: 'ttc-rl--subst-ok', label: TTC_COPY.badgeSubstOk, icon: 'check', tone: 'text-[#0a7a43]' },
  subst: { cls: 'ttc-rl--subst', label: TTC_COPY.badgeMismatch, icon: 'alert', tone: 'text-amber-700' },
  stock: { cls: 'ttc-rl--stock', label: 'สต็อกไม่พอ', icon: 'alert', tone: 'text-[#b3261e]' },
};

export default function TikTokReviewLineCard({
  item,
  pick,
  catalog,
  orderCtx,
  substitutionMeta,
  matchConfirmed,
  disabled,
  onSubstitutionChange,
  onChangeProduct,
}) {
  const meta = substitutionMeta?.[item.id];
  const tiktokSku = displayTiktokSkuLabel(extractTikTokSkuKey(item));
  const stock = resolvePickStock(pick, catalog);
  const shortfall = stockShortfall(item, pick, catalog, orderCtx);
  const status = statusOf(item, pick, catalog, meta, matchConfirmed, orderCtx);
  const sm = STATUS_META[status];
  const showSubst = status === 'subst' || status === 'subst-ok';
  const substitute = meta?.substitute === true;
  const canChange = (showSubst || status === 'stock') && onChangeProduct && !disabled;

  return (
    <div className={'ttc-rl ttc-bento rounded-2xl border p-3 min-w-0 flex flex-col gap-2.5 ' + sm.cls}>
      <div className="flex items-center gap-3 min-w-0">
        <SkuThumb url={item.sku_image_url} sizeClass="w-12 h-12" iconSize={20}/>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap text-sm font-mono min-w-0">
            <span className="font-medium text-muted truncate" title={tiktokSku}>{tiktokSku}</span>
            <Icon name="chevron-r" size={14} className="text-muted-soft shrink-0"/>
            <span className="font-semibold text-[#0a5a32] truncate" title={pick?.name}>{pick?.name || '—'}</span>
          </div>
          <div className="text-[11px] text-muted tabular-nums mt-1 flex items-center gap-x-2 gap-y-0.5 flex-wrap">
            <span>×{item.quantity} · {fmtTHB(item.unit_price)}</span>
            <span className="text-muted-soft">·</span>
            <span className={shortfall ? 'text-[#b3261e] font-medium' : ''}>
              {stock != null ? TTC_COPY.stock(stock) : TTC_COPY.stockUnknown}
              {shortfall && <> · ต้องการ {shortfall.need}</>}
            </span>
          </div>
        </div>
        <span className={'ttc-rl__badge shrink-0 inline-flex items-center gap-1 ' + sm.tone}>
          <Icon name={sm.icon} size={14}/>
          <span className="text-[11px] font-semibold whitespace-nowrap">{sm.label}</span>
        </span>
      </div>

      {showSubst && (
        <label className="ttc-rl__check ttc-bento flex items-start gap-2.5 rounded-xl border border-amber-400/45 p-2.5 cursor-pointer min-w-0">
          <input
            type="checkbox"
            className="mt-0.5 w-4 h-4 shrink-0"
            checked={substitute}
            disabled={disabled || (matchConfirmed?.[item.id] && !substitute)}
            onChange={e => onSubstitutionChange?.(item.id, { substitute: e.target.checked, note: meta?.note || '' })}
          />
          <span className="min-w-0">
            <span className="text-sm font-semibold text-amber-900">{TTC_COPY.substLong}</span>
            <span className="block text-[11px] text-amber-800/90 mt-0.5 leading-relaxed">
              {TTC_COPY.reviewSubstHint}
            </span>
          </span>
        </label>
      )}

      {showSubst && substitute && (
        <input
          type="text"
          className="input !text-xs w-full min-w-0"
          placeholder="หมายเหตุ (ถ้ามี)"
          value={meta?.note || ''}
          disabled={disabled}
          onChange={e => onSubstitutionChange?.(item.id, { substitute: true, note: e.target.value })}
        />
      )}

      {status === 'stock' && (
        <div className="ttc-rl__alert flex items-center gap-2 text-[#b3261e]">
          <Icon name="alert" size={16} className="shrink-0"/>
          <span className="text-xs font-medium">
            {TTC_COPY.reviewStockShortfall(shortfall?.stock, shortfall?.need)}
          </span>
        </div>
      )}

      {canChange && (
        <button
          type="button"
          className="ttc-rl__change self-start inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          onClick={() => onChangeProduct(item.id)}
        >
          <Icon name="refresh" size={12}/> {TTC_COPY.changeProductToMatch}
        </button>
      )}
    </div>
  );
}
