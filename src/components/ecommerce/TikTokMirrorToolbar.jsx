// Shared min-% + catalog search for inline TikTok matching.
import React, { useEffect, useState } from 'react';
import { mapError } from '../../lib/error-map.js';
import { posSkuSearchVariants } from '../../lib/tiktok-receive-match.js';
import { TIKTOK_MIN_PCT_OPTIONS } from './TikTokSkuMatchRow.jsx';

export default function TikTokMirrorToolbar({
  minPct, onMinPctChange, onSearchCatalog, onRetryCatalog,
  catalogLoading = false, catalogError = null,
  disabled = false, readyCount, totalCount,
}) {
  const [searchQ, setSearchQ] = useState('');
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = searchQ.trim();
    if (!onSearchCatalog || q.length < 2) return;
    const id = setTimeout(async () => {
      setSearching(true);
      try {
        await onSearchCatalog(q, { variants: posSkuSearchVariants(q) });
      } catch (e) {
        console.warn('[TikTokMirrorToolbar] search failed:', mapError(e));
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [searchQ, onSearchCatalog]);

  return (
    <div className="px-3 py-2 border-b hairline bg-surface-soft/40 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">จับคู่ TikTok</span>
        {totalCount > 0 && (
          <span className="text-[11px] tabular-nums text-muted">
            {readyCount}/{totalCount} พร้อม
          </span>
        )}
      </div>

      {catalogError && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-error/5 border border-error/20 px-2.5 py-1.5">
          <span className="text-[11px] text-error/90 flex-1 min-w-0">{catalogError}</span>
          {onRetryCatalog && (
            <button
              type="button"
              className="btn-secondary !py-0.5 !px-2 !text-[10px] shrink-0"
              onClick={onRetryCatalog}
              disabled={disabled || catalogLoading}
            >
              ลองใหม่
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] text-muted shrink-0">candidate ≥</label>
        <select
          className="input !h-7 !w-auto !text-[11px] !py-0"
          value={minPct}
          onChange={e => onMinPctChange?.(Number(e.target.value))}
          disabled={disabled || catalogLoading}
        >
          {TIKTOK_MIN_PCT_OPTIONS.map(n => (
            <option key={n} value={n}>{n}%</option>
          ))}
        </select>
        <div className="flex-1 min-w-[120px] relative">
          <input
            className="input !h-7 !text-[11px] w-full"
            placeholder="ค้นหา TikTok SKU ทั้งชุด"
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            disabled={disabled || searching || catalogLoading}
          />
          {(searching || catalogLoading) && <span className="spinner absolute right-2 top-1.5"/>}
        </div>
      </div>
    </div>
  );
}
