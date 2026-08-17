import React from 'react';
import BottomSheet from '../ui/mobile/BottomSheet.jsx';
import { BRAND_RULES } from '../../lib/product-classify.js';

/** Mobile brand facet menu (replaces horizontal chips). */
export default function ProductBrandPickerSheet({
  open,
  onClose,
  filter,
  brandCounts,
  catalogLoaded = true,
  onPick,
}) {
  const rowCls = (active) =>
    'w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left text-sm font-medium border-b hairline last:border-0 transition-colors ' +
    (active ? 'bg-primary/8 text-primary' : 'text-ink hover:bg-surface-strong/60');

  return (
    <BottomSheet open={open} onClose={onClose} title="เลือกแบรนด์">
      <button type="button" className={rowCls(filter.brand === 'all')} onClick={() => onPick('all')}>
        <span>ทั้งหมด</span>
        {catalogLoaded && <span className="text-xs text-muted-soft tabular-nums">{brandCounts.all || 0}</span>}
      </button>
      {BRAND_RULES.map((b) => {
        const count = catalogLoaded ? (brandCounts[b.id] || 0) : null;
        if (catalogLoaded && count === 0 && filter.brand !== b.id) return null;
        return (
          <button key={b.id} type="button" className={rowCls(filter.brand === b.id)} onClick={() => onPick(b.id)}>
            <span>{b.label}</span>
            {count != null && <span className="text-xs text-muted-soft tabular-nums">{count}</span>}
          </button>
        );
      })}
    </BottomSheet>
  );
}
