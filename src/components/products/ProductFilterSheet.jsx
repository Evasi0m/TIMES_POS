import React from 'react';
import Icon from '../ui/Icon.jsx';
import {
  SERIES_RULES,
  SERIES_SUBS,
  MATERIAL_MAP,
  COLOR_MAP,
  PRICE_PRESETS,
} from '../../lib/product-classify.js';

/** Bottom-sheet / modal for advanced product filters (price, Casio facets, stock). */
export default function ProductFilterSheet({
  open,
  onClose,
  filter,
  setFilter,
  materialCounts,
  colorCounts,
  showCasioFacets,
  seriesCounts,
  subTypeCounts,
  setSeries,
  setSubType,
}) {
  if (!open) return null;

  const setMaterial = (m) => setFilter((f) => ({ ...f, material: m === f.material ? '' : m, color: '' }));
  const setColor = (c) => setFilter((f) => ({ ...f, color: c === f.color ? '' : c }));
  const chipCls = (active) =>
    'py-1.5 px-3 rounded-full text-xs font-medium border inline-flex items-center gap-1.5 transition-all ' +
    (active
      ? 'bg-ink text-canvas border-ink shadow-sm'
      : 'bg-surface-strong text-ink border-hairline hover:bg-surface-strong/80');
  const setPricePreset = (preset) => setFilter((f) => {
    const same = f.minPrice === preset.min && f.maxPrice === preset.max;
    return { ...f, minPrice: same ? 0 : preset.min, maxPrice: same ? 0 : preset.max };
  });

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center sm:justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-nightshade/40 fade-in"/>
      <div
        className="relative w-full sm:max-w-lg bg-canvas rounded-2xl shadow-2xl border hairline max-h-[85vh] flex flex-col fade-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b hairline">
          <div className="font-display text-lg flex items-center gap-2">
            <Icon name="filter" size={18}/> ตัวกรอง
          </div>
          <button type="button" className="btn-ghost !py-1.5 !px-2" onClick={onClose} aria-label="ปิด">
            <Icon name="x" size={18}/>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-sm font-medium">เฉพาะของพร้อมขาย</div>
              <div className="text-xs text-muted-soft">ซ่อนสินค้าที่สต็อก ≤ 0</div>
            </div>
            <input
              type="checkbox"
              className="w-5 h-5 accent-primary"
              checked={filter.inStockOnly}
              onChange={(e) => setFilter((f) => ({ ...f, inStockOnly: e.target.checked }))}
            />
          </label>

          <div>
            <div className="text-xs uppercase tracking-wider text-muted mb-2">ช่วงราคา</div>
            <div className="grid grid-cols-2 gap-2">
              {PRICE_PRESETS.map((p) => {
                const active = filter.minPrice === p.min && filter.maxPrice === p.max;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPricePreset(p)}
                    className={
                      'py-2 px-3 rounded-lg text-sm font-medium border transition-all ' +
                      (active
                        ? 'bg-ink text-canvas border-ink shadow-sm'
                        : 'bg-surface-strong text-ink border-hairline hover:bg-surface-strong/80')
                    }
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                placeholder="ต่ำสุด"
                className="input !py-2 !text-sm flex-1 tabular-nums"
                value={filter.minPrice || ''}
                onChange={(e) => setFilter((f) => ({ ...f, minPrice: Math.max(0, Number(e.target.value) || 0) }))}
              />
              <span className="text-muted-soft">–</span>
              <input
                type="number"
                inputMode="numeric"
                placeholder="สูงสุด"
                className="input !py-2 !text-sm flex-1 tabular-nums"
                value={filter.maxPrice || ''}
                onChange={(e) => setFilter((f) => ({ ...f, maxPrice: Math.max(0, Number(e.target.value) || 0) }))}
              />
            </div>
          </div>

          {showCasioFacets && (
            <>
              {Object.keys(seriesCounts).length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted mb-2">Series</div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setSeries?.('')} className={chipCls(!filter.series)}>
                      ทุก Series <span className="opacity-60 tabular-nums">{seriesCounts.__total || 0}</span>
                    </button>
                    {SERIES_RULES.map((s) => {
                      const count = seriesCounts[s.id] || 0;
                      if (count === 0 && filter.series !== s.id) return null;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSeries?.(s.id)}
                          className={chipCls(filter.series === s.id)}
                        >
                          {s.label} <span className="opacity-60 tabular-nums">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {filter.series && SERIES_SUBS[filter.series] && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted mb-2">ประเภท</div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setSubType?.('')} className={chipCls(!filter.subType)}>
                      ทุกประเภท <span className="opacity-60 tabular-nums">{subTypeCounts?.__total || 0}</span>
                    </button>
                    {SERIES_SUBS[filter.series].map((s) => {
                      const count = subTypeCounts?.[s.id] || 0;
                      if (count === 0 && filter.subType !== s.id) return null;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSubType?.(s.id)}
                          className={chipCls(filter.subType === s.id)}
                        >
                          {s.label} <span className="opacity-60 tabular-nums">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {Object.keys(materialCounts).length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted mb-2">วัสดุสาย</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(materialCounts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([code, count]) => {
                        const meta = MATERIAL_MAP[code];
                        if (!meta) return null;
                        const active = filter.material === code;
                        return (
                          <button
                            key={code}
                            type="button"
                            onClick={() => setMaterial(code)}
                            className={
                              'py-1.5 px-3 rounded-full text-xs font-medium border inline-flex items-center gap-1.5 transition-all ' +
                              (active
                                ? 'bg-ink text-canvas border-ink shadow-sm'
                                : 'bg-surface-strong text-ink border-hairline hover:bg-surface-strong/80')
                            }
                          >
                            <span
                              className="inline-block w-3 h-3 rounded-full border border-white/40"
                              style={{ background: meta.swatch }}
                            />
                            {meta.label}
                            <span className="opacity-60 tabular-nums">{count}</span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}

              {Object.keys(colorCounts).length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted mb-2">โทนสี</div>
                  <div className="flex flex-wrap gap-2">
                    {Object.keys(COLOR_MAP)
                      .filter((c) => (colorCounts[c] || 0) > 0)
                      .map((code) => {
                        const meta = COLOR_MAP[code];
                        const count = colorCounts[code] || 0;
                        const active = filter.color === code;
                        return (
                          <button
                            key={code}
                            type="button"
                            onClick={() => setColor(code)}
                            className={
                              'py-1.5 px-3 rounded-full text-xs font-medium border inline-flex items-center gap-1.5 transition-all ' +
                              (active
                                ? 'bg-ink text-canvas border-ink shadow-sm'
                                : 'bg-surface-strong text-ink border-hairline hover:bg-surface-strong/80')
                            }
                          >
                            <span
                              className="inline-block w-3 h-3 rounded-full border border-white/40"
                              style={{ background: meta.hex }}
                            />
                            {meta.label}
                            <span className="opacity-60 tabular-nums">{count}</span>
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 px-4 py-3 border-t hairline bg-surface-soft pb-safe">
          <button
            type="button"
            className="btn-ghost flex-1"
            onClick={() => setFilter((f) => ({
              ...f,
              series: '',
              subType: '',
              material: '',
              color: '',
              minPrice: 0,
              maxPrice: 0,
              inStockOnly: false,
            }))}
          >
            ล้างตัวกรอง
          </button>
          <button type="button" className="btn-primary flex-1" onClick={onClose}>
            เสร็จสิ้น
          </button>
        </div>
      </div>
    </div>
  );
}
