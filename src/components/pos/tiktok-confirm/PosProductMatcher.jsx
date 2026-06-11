import React, { useEffect, useMemo, useState } from 'react';
import { sb } from '../../../lib/supabase-client.js';
import { classifySkuMatch, findSkuCandidates } from '../../../lib/fuzzy-match.js';
import { fetchSkuPrefilter, PRODUCT_CATALOG_SELECT } from '../../../lib/product-catalog-cache.js';
import Icon from '../../ui/Icon.jsx';
import { extractTikTokSkuKey } from './helpers.js';
import { TTC_COPY, TTC_TIER_LABEL } from './copy.js';

function MatchCandidateRow({ product, score, tier, onPick, disabled, highlight, compact, cell }) {
  if (cell) {
    return (
      <button
        type="button"
        disabled={disabled}
        className={'ttc-match-cell text-left' + (highlight ? ' ttc-match-cell--auto' : '')}
        onClick={() => onPick(product)}
      >
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[13px] font-semibold leading-snug truncate">
            {product.name}
          </div>
          <div className="text-[11px] text-muted-soft tabular-nums mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span>
              {product.current_stock != null && TTC_COPY.stock(product.current_stock)}
              {Number(product.retail_price) > 0 && (
                <> · ฿{Number(product.retail_price).toLocaleString()}</>
              )}
            </span>
            {highlight && tier && (
              <span className="text-[#0a7a43] font-semibold inline-flex items-center gap-0.5">
                <Icon name="check" size={10}/> แนะนำ {Math.round(score * 100)}%
              </span>
            )}
          </div>
        </div>
        {score != null && (
          <span className="ttc-match-cell__score shrink-0">{Math.round(score * 100)}%</span>
        )}
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      className={
        'ttc-match-row w-full text-left' +
        (highlight ? ' ttc-match-row--auto' : '') +
        (compact ? ' !py-1.5 !px-2' : '')
      }
      onClick={() => onPick(product)}
    >
      <div className="min-w-0 flex-1">
        <div className={'font-mono font-medium leading-snug truncate ' + (compact ? 'text-xs' : 'text-sm')}>
          {product.name}
        </div>
        <div className="text-[10px] text-muted-soft tabular-nums mt-0.5">
          {product.current_stock != null && TTC_COPY.stock(product.current_stock)}
          {Number(product.retail_price) > 0 && (
            <> · ฿{Number(product.retail_price).toLocaleString()}</>
          )}
        </div>
        {highlight && tier && !compact && (
          <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-md font-semibold bg-[#e6f7ed] text-[#0a7a43]">
            {TTC_COPY.pickerAutoMatch} · {TTC_TIER_LABEL[tier] || tier} {Math.round(score * 100)}%
          </span>
        )}
      </div>
      {score != null && (
        <span className="ttc-picker-dropdown__score">{Math.round(score * 100)}%</span>
      )}
    </button>
  );
}

function MatchCandidatePanel({
  isSearching,
  searching,
  searchRows,
  recommendLoading,
  catalogError,
  catalog,
  catalogLoading,
  onRetryCatalog,
  disabled,
  recommendations,
  displayRecs,
  skuKey,
  localMatch,
  compact,
  pick,
  split,
  side = false,
  focus = false,
}) {
  const bodyClass =
    'ttc-match-panel__body' +
    (focus ? ' ttc-match-panel__body--focus' : side ? ' ttc-match-panel__body--side' : split ? ' ttc-match-panel__body--split' : compact ? ' ttc-match-panel__body--compact' : '');
  const panelFlex = split || focus;
  const cell = focus;

  if (isSearching) {
    return (
      <div className={'ttc-match-panel' + (panelFlex ? ' ttc-match-split-panel flex-1 min-h-0 flex flex-col' : '') + (side ? ' ttc-match-panel--side' : '')}>
        <div className="ttc-match-panel__head">
          ผลการค้นหา
          {!searching && <span className="text-muted-soft font-normal normal-case"> · {searchRows.length}</span>}
        </div>
        <div className={bodyClass}>
          {searching && searchRows.length === 0 && (
            <div className="ttc-picker-dropdown__empty ttc-match-panel__empty">กำลังค้นหา…</div>
          )}
          {!searching && searchRows.length === 0 && (
            <div className="ttc-picker-dropdown__empty ttc-match-panel__empty">ไม่พบสินค้า</div>
          )}
          {searchRows.map(row => (
            <MatchCandidateRow
              key={row.product.id}
              product={row.product}
              score={row.score}
              tier={row.tier}
              disabled={disabled}
              compact={compact}
              cell={cell}
              onPick={pick}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={'ttc-match-panel' + (panelFlex ? ' ttc-match-split-panel flex-1 min-h-0 flex flex-col' : '') + (side ? ' ttc-match-panel--side' : '')}>
      <div className="ttc-match-panel__head">
        {compact ? 'แนะนำ' : 'รายการแนะนำ'}
        {skuKey && (
          <span className="text-muted-soft font-normal normal-case font-mono ml-1"> · {skuKey}</span>
        )}
      </div>
      <div className={bodyClass}>
        {recommendLoading && (
          <div className="ttc-picker-dropdown__empty ttc-match-panel__empty flex items-center justify-center gap-2">
            <span className="spinner"/> โหลด…
          </div>
        )}
        {!recommendLoading && catalogError && !catalog.length && recommendations.length === 0 && (
          <div className="ttc-picker-dropdown__empty ttc-match-panel__empty space-y-2">
            <div className="text-error/90 text-xs">{catalogError}</div>
            {onRetryCatalog && (
              <button
                type="button"
                className="btn-secondary !py-1 !px-2 !text-xs w-full"
                onClick={onRetryCatalog}
                disabled={disabled || catalogLoading}
              >
                <Icon name="refresh" size={12}/> ลองใหม่
              </button>
            )}
          </div>
        )}
        {!recommendLoading && !catalogError && catalog.length > 0 && recommendations.length === 0 && (
          <div className="ttc-picker-dropdown__empty ttc-match-panel__empty">ไม่พบรุ่นใกล้เคียง — ค้นหาด้านบน</div>
        )}
        {!recommendLoading && !catalog.length && !catalogError && recommendations.length === 0 && (
          <div className="ttc-picker-dropdown__empty ttc-match-panel__empty">ไม่พบรุ่นใกล้เคียง — ค้นหาด้านบน</div>
        )}
        {!recommendLoading && displayRecs.map(c => (
          <MatchCandidateRow
            key={c.product.id}
            product={c.product}
            score={c.score}
            tier={c.tier}
            disabled={disabled}
            compact={compact}
            cell={cell}
            highlight={localMatch?.status === 'auto' && localMatch?.product?.id === c.product.id}
            onPick={pick}
          />
        ))}
        {compact && !split && recommendations.length > 3 && (
          <div className="text-[10px] text-muted-soft px-2 py-1">
            +{recommendations.length - 3} รายการ — พิมพ์ค้นหาเพิ่ม
          </div>
        )}
      </div>
    </div>
  );
}

export default function PosProductMatcher({
  item, catalog, catalogLoading, catalogError, onRetryCatalog, onPick, disabled,
  compact = false,
  recommendLimit = 8,
  layout = 'stack',
  onAutoMatchChange,
}) {
  const split = layout === 'split' || layout === 'side';
  const side = layout === 'side';
  const focus = layout === 'focus';
  const skuKey = extractTikTokSkuKey(item);
  const [q, setQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [prefilter, setPrefilter] = useState([]);
  const [prefilterLoading, setPrefilterLoading] = useState(false);

  useEffect(() => {
    if (!skuKey) { setPrefilter([]); return; }
    let cancelled = false;
    (async () => {
      setPrefilterLoading(true);
      try {
        const cands = await fetchSkuPrefilter(sb, skuKey);
        if (!cancelled) setPrefilter(cands);
      } finally {
        if (!cancelled) setPrefilterLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [skuKey]);

  const recommendations = useMemo(() => {
    if (!skuKey) return [];
    if (catalog.length) return findSkuCandidates(skuKey, catalog, { limit: recommendLimit, minScore: 0.5 });
    return prefilter.slice(0, recommendLimit);
  }, [skuKey, catalog, prefilter, recommendLimit]);

  const localMatch = useMemo(() => {
    const pool = catalog.length
      ? catalog
      : prefilter.map(c => c.product);
    if (!skuKey || !pool.length) return { status: 'none', candidates: [] };
    return classifySkuMatch(skuKey, pool);
  }, [skuKey, catalog, prefilter]);

  useEffect(() => {
    onAutoMatchChange?.(localMatch);
  }, [localMatch, onAutoMatchChange]);

  const isSearching = q.trim().length >= 2;
  const recommendLoading = catalogLoading || (prefilterLoading && !catalog.length && !catalogError);

  const searchRows = useMemo(() => {
    if (!isSearching) return [];
    const seen = new Set();
    const rows = [];
    for (const p of searchResults) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        rows.push({ product: p, score: null });
      }
    }
    const fuzzyPool = catalog.length ? catalog : prefilter.map(c => c.product);
    for (const c of findSkuCandidates(q.trim(), fuzzyPool, { limit: 6, minScore: 0.5 })) {
      if (!seen.has(c.product.id)) {
        seen.add(c.product.id);
        rows.push({ product: c.product, score: c.score, tier: c.tier });
      }
    }
    return rows;
  }, [isSearching, searchResults, q, catalog, prefilter]);

  const search = async (term) => {
    setQ(term);
    if (term.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const t = term.trim();
      const { data: byCode } = await sb.from('products')
        .select(PRODUCT_CATALOG_SELECT)
        .eq('barcode', t).limit(5);
      const { data: byName } = await sb.from('products')
        .select(PRODUCT_CATALOG_SELECT)
        .ilike('name', `%${t}%`).limit(20);
      const merged = [...(byCode || []), ...(byName || [])];
      const seen = new Set();
      setSearchResults(merged.filter(p => !seen.has(p.id) && seen.add(p.id)));
    } finally {
      setSearching(false);
    }
  };

  const pick = (p) => {
    onPick(p);
    setQ('');
    setSearchResults([]);
  };

  const displayRecs = compact && !split ? recommendations.slice(0, 3) : recommendations;

  const searchInput = (
    <div className="relative shrink-0">
      <input
        type="text"
        value={q}
        disabled={disabled}
        onChange={e => search(e.target.value)}
        placeholder={(split || compact) && !focus ? TTC_COPY.pickerSearchCompact : TTC_COPY.pickerSearchPlaceholder}
        className={'input w-full ' + (focus ? '!h-11 !rounded-xl !py-2.5 !text-sm' : split ? '!h-9 !rounded-lg !py-1.5 !text-xs' : compact ? '!h-9 !rounded-lg !py-1.5 !text-xs' : '!h-11 !rounded-xl !py-2.5 !text-sm')}
        autoComplete="off"
      />
      {searching && <span className={'spinner absolute right-3 ' + (split && !focus ? 'top-2' : compact && !focus ? 'top-2' : 'top-3')}/>}
    </div>
  );

  const candidatePanel = (
    <MatchCandidatePanel
      isSearching={isSearching}
      searching={searching}
      searchRows={searchRows}
      recommendLoading={recommendLoading}
      catalogError={catalogError}
      catalog={catalog}
      catalogLoading={catalogLoading}
      onRetryCatalog={onRetryCatalog}
      disabled={disabled}
      recommendations={recommendations}
      displayRecs={displayRecs}
      skuKey={skuKey}
      localMatch={localMatch}
      compact={compact && !split && !focus}
      pick={pick}
      split={split}
      side={side}
      focus={focus}
    />
  );

  const autoMatchBtn = localMatch?.status === 'auto' && localMatch.product && !isSearching && (!split || focus) && (
    <button
      type="button"
      className={'btn-primary w-full inline-flex items-center justify-center gap-2 ' + (compact && !focus ? '!py-1.5 !text-xs' : '!py-2.5 !text-sm')}
      disabled={disabled}
      onClick={() => pick(localMatch.product)}
    >
      <Icon name="check" size={compact && !focus ? 14 : 16}/>
      {TTC_COPY.pickerAutoMatch} · {localMatch.product.name}
    </button>
  );

  if (focus) {
    return (
      <div className="ttc-match ttc-match--focus flex flex-col min-h-0 h-full gap-2.5">
        {searchInput}
        {candidatePanel}
        {autoMatchBtn}
      </div>
    );
  }

  if (split) {
    return (
      <div className={'ttc-match flex flex-col min-h-0 h-full gap-2' + (side ? ' ttc-match--side' : ' ttc-match--split')}>
        {searchInput}
        {candidatePanel}
      </div>
    );
  }

  return (
    <div className={'ttc-match ' + (compact ? 'space-y-2' : 'space-y-3')}>
      <div>
        {!compact && (
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-soft mb-1.5">
            ค้นหาเอง
          </div>
        )}
        {searchInput}
      </div>
      {candidatePanel}
      {autoMatchBtn}
    </div>
  );
}
