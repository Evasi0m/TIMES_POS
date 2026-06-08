// Inline TikTok SKU picker for one receive line (manual + bulk ×10).
// Search/recommend flow mirrors PosProductMatcher in TikTokConfirmPanel.
import React, { useCallback, useMemo, useState } from 'react';
import Icon from '../ui/Icon.jsx';
import {
  classifyPosToTikTok,
  filterCandidatesByMinPct,
  filterTikTokSkusByTerm,
  findTikTokCandidatesForPosLine,
  matchTikTokByBarcode,
  mergeTiktokSkuPools,
  posLineQuery,
  scorePosToTikTokSku,
  tiktokSkuAsMatchProduct,
} from '../../lib/tiktok-receive-match.js';

export const TIKTOK_MIN_PCT_OPTIONS = [60, 70, 80, 90, 94];

const TIER_LABEL = {
  exact: 'ตรงกัน',
  suffix: 'suffix ตรงรุ่น',
  prefix: 'prefix ใกล้เคียง',
  fuzzy: 'คล้ายกัน',
};

function MatchCandidateRow({ sku, score, tier, onPick, disabled, highlight, compact = false }) {
  const label = sku.seller_sku || sku.name || sku.product_name;
  const subName = sku.product_name && sku.product_name !== label ? sku.product_name : null;
  return (
    <button
      type="button"
      className={'ttc-match-row w-full text-left' + (highlight ? ' ttc-match-row--auto' : '') + (compact ? ' !py-1.5' : '')}
      disabled={disabled}
      onClick={() => onPick(sku)}
    >
      <div className="min-w-0 flex-1">
        <div className={'font-mono font-medium leading-snug truncate ' + (compact ? 'text-xs' : 'text-sm')}>
          {label}
        </div>
        <div className={'text-muted-soft tabular-nums mt-0.5 ' + (compact ? 'text-[10px]' : 'text-[11px]')}>
          {sku.quantity != null && <>TikTok stock {sku.quantity}</>}
          {subName && (
            <span className="ml-1 opacity-80 truncate">{subName}</span>
          )}
        </div>
        {highlight && tier && (
          <span className="inline-block mt-1.5 text-[10px] px-2 py-0.5 rounded-md font-semibold bg-[#e6f7ed] text-[#0a7a43]">
            จับคู่อัตโนมัติ · {TIER_LABEL[tier] || tier} {Math.round(score * 100)}%
          </span>
        )}
      </div>
      {score != null && (
        <span className="ttc-picker-dropdown__score">{Math.round(score * 100)}%</span>
      )}
    </button>
  );
}

export default function TikTokSkuMatchRow({
  line,
  skipped = false,
  tiktokSku = null,
  mapping = null,
  previewStockAfter = null,
  onChange,
  catalog = [],
  catalogLoading = false,
  catalogError = null,
  onRetryCatalog,
  minPct = 60,
  disabled = false,
  compact = false,
  showLabel = true,
}) {
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  const tiktokBefore = tiktokSku?.quantity ?? mapping?.quantity ?? null;
  const query = posLineQuery(line);
  const isSearching = searchQ.trim().length >= 2;

  // Per-line prefilter over the preloaded full catalog (local — no API call).
  // TikTok's keyword search ignores seller_sku, so we match the whole catalog
  // that the hook already pulled instead of hitting the API per line.
  const prefilter = useMemo(() => {
    if (!query || query.length < 3 || !catalog.length) return [];
    return filterTikTokSkusByTerm(line, catalog, { minScore: 0.5, limit: 20 });
  }, [query, line, catalog]);

  const recommendPool = useMemo(
    () => mergeTiktokSkuPools(catalog, prefilter),
    [catalog, prefilter],
  );

  const localMatch = useMemo(() => {
    if (!recommendPool.length || !query) return { status: 'none', candidates: [] };
    return classifyPosToTikTok(line, recommendPool);
  }, [line, recommendPool, query]);

  const recommendations = useMemo(() => {
    if (!query) return [];
    if (catalog.length) {
      return filterCandidatesByMinPct(
        findTikTokCandidatesForPosLine(line, catalog, { minScore: 0.5, limit: 8 }),
        minPct,
      );
    }
    return filterCandidatesByMinPct(
      prefilter.map(sku => {
        const product = tiktokSkuAsMatchProduct(sku);
        const m = scorePosToTikTokSku(query, product.name);
        return { sku: product, score: m.score, tier: m.tier };
      }).filter(c => c.score >= 0.5),
      minPct,
    );
  }, [query, catalog, prefilter, line, minPct]);

  const barcodeHit = useMemo(
    () => (recommendPool.length ? matchTikTokByBarcode(line, recommendPool) : null),
    [line, recommendPool],
  );

  const searchRows = useMemo(() => {
    if (!isSearching) return [];
    const term = searchQ.trim();
    const filtered = filterTikTokSkusByTerm(term, searchResults, { minScore: 0.55, limit: 20 });
    return filtered.map(raw => {
      const sku = tiktokSkuAsMatchProduct(raw);
      return {
        sku,
        score: raw._score ?? scorePosToTikTokSku(term, sku.name).score,
        tier: raw._tier ?? scorePosToTikTokSku(term, sku.name).tier,
        fromApi: true,
      };
    });
  }, [isSearching, searchQ, searchResults]);

  const recommendLoading = catalogLoading;

  // Manual search — filter the preloaded catalog locally (instant, reliable).
  const runSearch = useCallback((term) => {
    setSearchQ(term);
    if (term.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearchResults(filterTikTokSkusByTerm(term.trim(), catalog, { minScore: 0.5, limit: 50 }));
  }, [catalog]);

  const activeSku = tiktokSku || (mapping ? {
    tiktok_sku_id: mapping.tiktok_sku_id,
    tiktok_product_id: mapping.tiktok_product_id,
    seller_sku: mapping.seller_sku,
    product_name: mapping.tiktok_product_name,
    quantity: tiktokBefore,
  } : null);

  const pickSku = (sku) => {
    onChange?.({ tiktok_sku: sku, tiktok_mapping: null });
    setSearchQ('');
    setSearchResults([]);
  };

  const wrapCls = compact
    ? 'mt-2 pt-2 border-t border-dashed border-hairline space-y-2'
    : 'rounded-xl border hairline bg-surface-strong/60 p-3 space-y-2';

  return (
    <div className={wrapCls}>
      {showLabel && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-wider text-muted font-medium">TikTok SKU</div>
          <label className="flex items-center gap-1.5 text-[11px] text-muted cursor-pointer">
            <input
              type="checkbox"
              className="rounded border-hairline"
              checked={skipped}
              disabled={disabled}
              onChange={e => onChange?.({ tiktok_skip: e.target.checked })}
            />
            ไม่ sync
          </label>
        </div>
      )}

      {!skipped && (
        <>
          {activeSku ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#e6f7ed] border border-[#0a7a43]/25 px-2.5 py-1.5">
              <div className="min-w-0">
                <div className="font-mono text-xs text-[#0a5a32] truncate">
                  {activeSku.seller_sku || activeSku.product_name}
                </div>
                <div className="text-[10px] text-[#0a7a43]/80 mt-0.5 tabular-nums">
                  TikTok {tiktokBefore != null ? tiktokBefore : '—'} →{' '}
                  <span className="font-semibold">{previewStockAfter ?? '—'}</span> (mirror)
                </div>
              </div>
              <button
                type="button"
                className="btn-secondary !py-0.5 !px-1.5 !text-[10px]"
                disabled={disabled}
                onClick={() => onChange?.({ tiktok_sku: null, tiktok_mapping: null })}
              >
                เปลี่ยน
              </button>
            </div>
          ) : (
            <div className="ttc-match space-y-3">
              <div>
                <div className={'font-semibold uppercase tracking-wider text-muted-soft mb-1.5 ' + (compact ? 'text-[10px]' : 'text-[11px]')}>
                  ค้นหาเอง
                </div>
                <div className="relative">
                  <input
                    className={'input w-full ' + (compact ? '!h-7 !text-[11px]' : '!h-11 !rounded-xl !py-2.5 !text-sm')}
                    placeholder="พิมพ์ TikTok SKU / รหัสรุ่น"
                    value={searchQ}
                    onChange={e => runSearch(e.target.value)}
                    disabled={disabled}
                    autoComplete="off"
                  />
                </div>
              </div>

              {isSearching ? (
                <div className="ttc-match-panel">
                  <div className="ttc-match-panel__head">
                    ผลการค้นหา
                    <span className="text-muted-soft font-normal normal-case"> · {searchRows.length} รายการ</span>
                  </div>
                  <div className="ttc-match-panel__body">
                    {searchRows.length === 0 && (
                      <div className="ttc-picker-dropdown__empty text-[11px]">ไม่พบ SKU — ลองพิมพ์รหัสอื่น</div>
                    )}
                    {searchRows.map(c => (
                      <MatchCandidateRow
                        key={c.sku.tiktok_sku_id}
                        sku={c.sku}
                        score={c.score}
                        tier={c.tier}
                        disabled={disabled}
                        compact={compact}
                        highlight={localMatch?.status === 'auto' && localMatch?.sku?.tiktok_sku_id === c.sku.tiktok_sku_id}
                        onPick={pickSku}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="ttc-match-panel">
                  <div className="ttc-match-panel__head">
                    รายการแนะนำ
                    {query && (
                      <span className="text-muted-soft font-normal normal-case font-mono ml-1"> · {query}</span>
                    )}
                  </div>
                  <div className="ttc-match-panel__body">
                    {recommendLoading && (
                      <div className="ttc-picker-dropdown__empty flex items-center justify-center gap-2 text-[11px]">
                        <span className="spinner"/> กำลังโหลดรายการสินค้า…
                      </div>
                    )}
                    {!recommendLoading && catalogError && !catalog.length && recommendations.length === 0 && (
                      <div className="ttc-picker-dropdown__empty space-y-2 text-[11px]">
                        <div className="text-error/90 leading-relaxed">{catalogError}</div>
                        {onRetryCatalog && (
                          <button
                            type="button"
                            className="btn-secondary !py-1.5 !px-3 !text-xs w-full inline-flex items-center justify-center gap-2"
                            onClick={onRetryCatalog}
                            disabled={disabled || catalogLoading}
                          >
                            <Icon name="refresh" size={12}/> ลองโหลดใหม่
                          </button>
                        )}
                      </div>
                    )}
                    {!recommendLoading && !catalogError && catalog.length > 0 && recommendations.length === 0 && !barcodeHit && (
                      <div className="ttc-picker-dropdown__empty text-[11px]">
                        ไม่พบรุ่นใกล้เคียงจาก SKU นี้ — ใช้ช่องค้นหาด้านบน
                      </div>
                    )}
                    {!recommendLoading && !catalog.length && !catalogError && recommendations.length === 0 && prefilter.length === 0 && (
                      <div className="ttc-picker-dropdown__empty text-[11px]">
                        ไม่พบรุ่นใกล้เคียง — ใช้ช่องค้นหาด้านบน
                      </div>
                    )}
                    {!recommendLoading && barcodeHit && (
                      <MatchCandidateRow
                        sku={barcodeHit}
                        score={1}
                        tier="exact"
                        disabled={disabled}
                        compact={compact}
                        highlight
                        onPick={pickSku}
                      />
                    )}
                    {!recommendLoading && recommendations
                      .filter(c => !barcodeHit || c.sku.tiktok_sku_id !== barcodeHit.tiktok_sku_id)
                      .slice(0, compact ? 4 : 8)
                      .map(c => (
                        <MatchCandidateRow
                          key={c.sku.tiktok_sku_id}
                          sku={c.sku}
                          score={c.score}
                          tier={c.tier}
                          disabled={disabled}
                          compact={compact}
                          highlight={localMatch?.status === 'auto' && localMatch?.sku?.tiktok_sku_id === c.sku.tiktok_sku_id}
                          onPick={pickSku}
                        />
                      ))}
                  </div>
                </div>
              )}

              {localMatch?.status === 'auto' && localMatch.sku && !isSearching && (
                <button
                  type="button"
                  className={'btn-primary w-full inline-flex items-center justify-center gap-2 ' + (compact ? '!py-1.5 !text-[11px]' : '!py-2.5 !text-sm')}
                  disabled={disabled}
                  onClick={() => pickSku(localMatch.sku)}
                >
                  จับคู่อัตโนมัติ · {localMatch.sku.seller_sku || localMatch.sku.name}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
