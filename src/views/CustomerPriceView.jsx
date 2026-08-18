import React, { useEffect, useMemo, useState } from 'react';
import { sb } from '../lib/supabase-client.js';
import { searchProducts } from '../lib/product-search.js';
import {
  BRAND_RULES,
  SERIES_RULES,
  SERIES_SUBS,
  PRICE_PRESETS,
  enrichProduct,
  filterProducts,
  sortProducts,
  matchSubType,
} from '../lib/product-classify.js';
import {
  mergeCustomerPriceConfig,
  customerPriceQuote,
  filterCustomerPriceProducts,
  sortCustomerPriceProducts,
} from '../lib/customer-price.js';
import { fmtTHB } from '../lib/format.js';
import ProductThumb from '../components/ui/ProductThumb.jsx';
import Icon from '../components/ui/Icon.jsx';
import ProductBrandPickerSheet from '../components/products/ProductBrandPickerSheet.jsx';
import ProductFilterSheet from '../components/products/ProductFilterSheet.jsx';

const PAGE = 60;

/** Catalog-style Latin digits: "3,690.-" — avoids Taviraj/th-TH numeral distortion. */
function fmtCatalogPrice(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('en-US') + '.-';
}

const isMobileViewport = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches;

const DEFAULT_FILTER = {
  query: '',
  brand: 'all',
  series: '',
  subType: '',
  material: '',
  color: '',
  minPrice: 0,
  maxPrice: 0,
  inStockOnly: false,
  sort: 'newest',
};

function CustomerPriceCard({ product, quote, onOpen }) {
  const stock = Number(product?.current_stock) || 0;
  const oos = stock <= 0;
  return (
    <button
      type="button"
      className={'customer-price-card' + (oos ? ' customer-price-card--oos' : '')}
      onClick={() => onOpen(product)}
    >
      <div
        className="customer-price-card__stock"
        aria-label={oos ? 'หมดสต็อก' : `คงเหลือ ${stock}`}
      >
        <div
          className={
            'stock-gem stock-gem--circle stock-gem--md ' +
            (oos ? 'stock-gem--out' : 'stock-gem--in')
          }
        >
          <span className="stock-gem__num">{stock}</span>
        </div>
      </div>
      <div className="customer-price-card__media">
        {quote.strikeRetail && (
          <span className="customer-price-card__badge">-{quote.discountPct}%</span>
        )}
        <div className="customer-price-card__media-inner">
          <ProductThumb product={product} fill expandable={false} fallback="sku" />
        </div>
      </div>
      <div className="customer-price-card__body">
        <div className="customer-price-card__name" title={product.name}>{product.name}</div>
        {quote.hasSell ? (
          <div className="customer-price-card__sell">{fmtCatalogPrice(quote.sell)}</div>
        ) : (
          <div className="customer-price-card__na">ยังไม่มีราคาขาย</div>
        )}
        {quote.strikeRetail && (
          <div className="customer-price-card__retail">ราคาปกติ {fmtCatalogPrice(quote.retail).replace('.-', '')} บาท</div>
        )}
        {!quote.hasSell && quote.retail > 0 && (
          <div className="customer-price-card__tag">ป้าย {fmtCatalogPrice(quote.retail)}</div>
        )}
      </div>
    </button>
  );
}

export default function CustomerPriceView({ config }) {
  const priceConfig = config || mergeCustomerPriceConfig(null);
  const [queryInput, setQueryInput] = useState('');
  const [filter, setFilter] = useState(DEFAULT_FILTER);
  const [searchRows, setSearchRows] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [pageSize, setPageSize] = useState(PAGE);
  const [open, setOpen] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [brandPickerOpen, setBrandPickerOpen] = useState(false);

  useEffect(() => {
    const trimmed = queryInput.trim();
    if (/^\d{8,}$/.test(trimmed)) {
      setFilter((f) => (f.query === queryInput ? f : { ...f, query: queryInput }));
      return;
    }
    const t = setTimeout(() => {
      setFilter((f) => (f.query === queryInput ? f : { ...f, query: queryInput }));
    }, 180);
    return () => clearTimeout(t);
  }, [queryInput]);

  useEffect(() => {
    const q = filter.query.trim();
    if (!q) {
      setSearchRows([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);
    const t = setTimeout(async () => {
      const { data, error } = await searchProducts(sb, q);
      if (cancelled) return;
      if (error) {
        setSearchRows([]);
      } else {
        setSearchRows((data || []).map((p) => enrichProduct(p)));
      }
      setSearchLoading(false);
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [filter.query]);

  useEffect(() => { setPageSize(PAGE); }, [filter]);

  const hasSearch = !!filter.query.trim();

  const filtered = useMemo(() => {
    if (!hasSearch) return [];
    const state = { ...filter, query: '' };
    const base = filterCustomerPriceProducts(
      searchRows,
      state,
      priceConfig,
      filterProducts,
    );
    return sortCustomerPriceProducts(base, filter.sort, priceConfig, sortProducts);
  }, [hasSearch, searchRows, filter, priceConfig]);

  const visible = filtered.slice(0, pageSize);

  const brandCounts = useMemo(() => {
    if (!hasSearch) return { all: 0 };
    const c = { all: searchRows.length };
    searchRows.forEach((p) => { c[p._brand] = (c[p._brand] || 0) + 1; });
    return c;
  }, [searchRows, hasSearch]);

  const seriesCounts = useMemo(() => {
    if (!hasSearch || filter.brand !== 'casio') return {};
    const c = { __total: 0 };
    searchRows.forEach((p) => {
      if (p._brand !== 'casio') return;
      c.__total++;
      if (p._series) c[p._series] = (c[p._series] || 0) + 1;
    });
    return c;
  }, [searchRows, filter.brand, hasSearch]);

  const subTypeCounts = useMemo(() => {
    if (!hasSearch || filter.brand !== 'casio' || !filter.series) return {};
    const subs = SERIES_SUBS[filter.series] || [];
    if (!subs.length) return {};
    const base = searchRows.filter((p) => p._brand === 'casio' && p._series === filter.series);
    const c = { __total: base.length };
    subs.forEach((s) => { c[s.id] = base.filter((p) => matchSubType(p, s)).length; });
    return c;
  }, [searchRows, filter.brand, filter.series, hasSearch]);

  const materialCounts = useMemo(() => {
    if (!hasSearch || filter.brand !== 'casio') return {};
    const base = filterCustomerPriceProducts(
      searchRows,
      { ...filter, query: '', material: '', color: '', minPrice: 0, maxPrice: 0 },
      priceConfig,
      filterProducts,
    );
    const c = {};
    base.forEach((p) => { if (p._material) c[p._material] = (c[p._material] || 0) + 1; });
    return c;
  }, [searchRows, filter, priceConfig, hasSearch]);

  const colorCounts = useMemo(() => {
    if (!hasSearch || filter.brand !== 'casio') return {};
    const base = filterCustomerPriceProducts(
      searchRows,
      { ...filter, query: '', color: '', minPrice: 0, maxPrice: 0 },
      priceConfig,
      filterProducts,
    );
    const c = {};
    base.forEach((p) => { if (p._color) c[p._color] = (c[p._color] || 0) + 1; });
    return c;
  }, [searchRows, filter, priceConfig, hasSearch]);

  const advancedCount = (filter.material ? 1 : 0) + (filter.color ? 1 : 0)
    + ((filter.minPrice > 0 || filter.maxPrice > 0) ? 1 : 0)
    + (filter.inStockOnly ? 1 : 0)
    + (filter.series ? 1 : 0) + (filter.subType ? 1 : 0);

  const activePricePreset = PRICE_PRESETS.find(
    (p) => p.min === filter.minPrice && p.max === filter.maxPrice,
  );

  const hasAnyFilter = filter.brand !== 'all' || !!filter.series || !!filter.subType
    || !!filter.material || !!filter.color
    || filter.minPrice > 0 || filter.maxPrice > 0 || filter.inStockOnly;

  const clearFilters = () => {
    setFilter((f) => ({
      ...f,
      brand: 'all',
      series: '',
      subType: '',
      material: '',
      color: '',
      minPrice: 0,
      maxPrice: 0,
      inStockOnly: false,
    }));
  };

  const setBrand = (b) => {
    setFilter((f) => ({ ...f, brand: b, series: '', subType: '', material: '', color: '' }));
  };
  const setSeries = (s) => setFilter((f) => ({ ...f, series: s, subType: '', material: '', color: '' }));
  const setSubType = (s) => setFilter((f) => ({ ...f, subType: s, material: '', color: '' }));

  const chipCls = (active) =>
    'px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap inline-flex items-center gap-1 ' +
    (active ? 'lg-tile-dark' : 'lg-tile text-muted hover:text-ink');

  const brandFilterLabel = filter.brand === 'all'
    ? 'ทั้งหมด'
    : (BRAND_RULES.find((b) => b.id === filter.brand)?.label || filter.brand);

  const showCasioFacets = filter.brand === 'casio'
    || searchRows.some((p) => p._brand === 'casio');

  const openQuote = open ? customerPriceQuote(open, priceConfig) : null;

  return (
    <div className="px-4 py-4 lg:px-10 lg:py-6 lg:flex lg:flex-col">
      <div className="products-toolbar mb-2 flex-shrink-0">
        <div className="products-toolbar__line products-toolbar__line--search">
          <div className="products-search-wrap">
            <span className="products-search-icon" aria-hidden="true">
              <Icon name="search" size={17} strokeWidth={2.25}/>
            </span>
            <input
              className={
                'input products-search-input products-search-input--no-camera w-full !h-11 !text-sm' +
                (queryInput ? ' has-clear' : '')
              }
              placeholder="ชื่อรุ่น หรือ บาร์โค้ด"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              autoFocus={!isMobileViewport()}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {queryInput && (
              <button
                type="button"
                onClick={() => { setQueryInput(''); setFilter((f) => ({ ...f, query: '' })); }}
                className="products-search-clear"
                aria-label="ล้างคำค้น"
              >
                <Icon name="x" size={14}/>
              </button>
            )}
          </div>
          <button
            type="button"
            className="products-toolbar__filter products-toolbar__icon-btn btn-secondary relative icon-btn-44 !p-0 !w-11 !h-11 flex-shrink-0"
            onClick={() => setSheetOpen(true)}
            title="ตัวกรอง"
            aria-label="ตัวกรอง"
            disabled={!hasSearch}
          >
            <Icon name="sliders-h" size={20} strokeWidth={1.75}/>
            {advancedCount > 0 && (
              <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-on-primary text-[10px] font-bold tabular-nums border border-canvas">
                {advancedCount}
              </span>
            )}
          </button>
        </div>
        <div className="products-toolbar__line products-toolbar__line--controls">
          <select
            className="input products-toolbar__sort !py-1.5 !text-sm !h-11"
            value={filter.sort}
            onChange={(e) => setFilter((f) => ({ ...f, sort: e.target.value }))}
            aria-label="เรียงลำดับ"
            disabled={!hasSearch}
          >
            <option value="newest">ใหม่ล่าสุด</option>
            <option value="oldest">เก่าสุด</option>
            <option value="price-asc">ราคา ต่ำ → สูง</option>
            <option value="price-desc">ราคา สูง → ต่ำ</option>
            <option value="name">ชื่อรุ่น A-Z</option>
          </select>
          <button
            type="button"
            className="products-toolbar__brand btn-secondary !h-11 !px-2.5 !text-sm lg:hidden"
            onClick={() => setBrandPickerOpen(true)}
            aria-label="เลือกแบรนด์"
            disabled={!hasSearch}
          >
            <Icon name="tag" size={14} className="shrink-0"/>
            <span className="truncate max-w-[5rem]">{brandFilterLabel}</span>
            <Icon name="chevron-d" size={12} className="shrink-0 opacity-70"/>
          </button>
        </div>
      </div>

      {hasSearch && (
        <div className="hidden lg:flex gap-1.5 mb-2 flex-shrink-0 overflow-x-auto pb-1 scrollbar-thin">
          <button type="button" onClick={() => setBrand('all')} className={chipCls(filter.brand === 'all')}>
            ทั้งหมด <span className="opacity-60 tabular-nums">{brandCounts.all || 0}</span>
          </button>
          {BRAND_RULES.map((b) => {
            const count = brandCounts[b.id] || 0;
            if (count === 0 && filter.brand !== b.id) return null;
            return (
              <button key={b.id} type="button" onClick={() => setBrand(b.id)} className={chipCls(filter.brand === b.id)}>
                {b.label} <span className="opacity-60 tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {hasSearch && filter.brand === 'casio' && (
        <div className="hidden lg:flex gap-1.5 mb-2 flex-shrink-0 overflow-x-auto pb-1 scrollbar-thin">
          <button type="button" onClick={() => setSeries('')} className={chipCls(!filter.series)}>
            ทุก Series <span className="opacity-60 tabular-nums">{seriesCounts.__total || 0}</span>
          </button>
          {SERIES_RULES.map((s) => {
            const count = seriesCounts[s.id] || 0;
            if (count === 0 && filter.series !== s.id) return null;
            return (
              <button key={s.id} type="button" onClick={() => setSeries(s.id)} className={chipCls(filter.series === s.id)}>
                {s.label} <span className="opacity-60 tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {hasSearch && (filter.material || filter.color || filter.series || filter.subType
        || activePricePreset || filter.minPrice > 0 || filter.maxPrice > 0 || filter.inStockOnly) && (
        <div className="flex flex-wrap gap-1.5 mb-2 items-center flex-shrink-0">
          {activePricePreset && (
            <button
              type="button"
              onClick={() => setFilter((f) => ({ ...f, minPrice: 0, maxPrice: 0 }))}
              className="px-2.5 py-1 rounded-full text-xs bg-primary/10 text-primary border border-primary/20 inline-flex items-center gap-1.5 hover:bg-primary/20"
            >
              <Icon name="tag" size={11}/> {activePricePreset.label}
              <Icon name="x" size={11} className="opacity-70"/>
            </button>
          )}
          {!activePricePreset && (filter.minPrice > 0 || filter.maxPrice > 0) && (
            <button
              type="button"
              onClick={() => setFilter((f) => ({ ...f, minPrice: 0, maxPrice: 0 }))}
              className="px-2.5 py-1 rounded-full text-xs bg-primary/10 text-primary border border-primary/20 inline-flex items-center gap-1.5 hover:bg-primary/20"
            >
              ราคา {filter.minPrice > 0 ? fmtTHB(filter.minPrice) : '—'} – {filter.maxPrice > 0 ? fmtTHB(filter.maxPrice) : '—'}
              <Icon name="x" size={11} className="opacity-70"/>
            </button>
          )}
          {filter.inStockOnly && (
            <button
              type="button"
              onClick={() => setFilter((f) => ({ ...f, inStockOnly: false }))}
              className="px-2.5 py-1 rounded-full text-xs bg-primary/10 text-primary border border-primary/20 inline-flex items-center gap-1.5 hover:bg-primary/20"
            >
              มีสต็อก <Icon name="x" size={11} className="opacity-70"/>
            </button>
          )}
          {filter.series && (
            <button
              type="button"
              onClick={() => setSeries('')}
              className="px-2.5 py-1 rounded-full text-xs bg-primary/10 text-primary border border-primary/20 inline-flex items-center gap-1.5 hover:bg-primary/20"
            >
              {SERIES_RULES.find((s) => s.id === filter.series)?.label}
              <Icon name="x" size={11} className="opacity-70"/>
            </button>
          )}
          {filter.subType && SERIES_SUBS[filter.series] && (
            <button
              type="button"
              onClick={() => setSubType('')}
              className="px-2.5 py-1 rounded-full text-xs bg-primary/10 text-primary border border-primary/20 inline-flex items-center gap-1.5 hover:bg-primary/20"
            >
              {SERIES_SUBS[filter.series].find((s) => s.id === filter.subType)?.label}
              <Icon name="x" size={11} className="opacity-70"/>
            </button>
          )}
          {hasAnyFilter && (
            <button
              type="button"
              onClick={clearFilters}
              className="px-2.5 py-1 rounded-full text-xs text-muted hover:text-ink inline-flex items-center gap-1 underline underline-offset-2"
            >
              <Icon name="x" size={11}/> ล้างตัวกรอง
            </button>
          )}
        </div>
      )}

      {hasSearch && (
        <div className="text-xs text-muted mb-2 flex-shrink-0 flex items-center gap-2">
          <span>
            พบ <span className="font-medium text-ink tabular-nums">{filtered.length.toLocaleString('th-TH')}</span> รายการ
          </span>
          {filtered.length > visible.length && (
            <span className="text-muted-soft">· แสดง {visible.length.toLocaleString('th-TH')}</span>
          )}
        </div>
      )}

      {hasSearch && (
        <div className="card-canvas overflow-hidden flex-1 min-h-0">
          <div className="product-catalog-scroll">
            {searchLoading ? (
              <div className="p-4 text-muted text-sm flex items-center gap-2">
                <span className="spinner"/>กำลังค้นหา...
              </div>
            ) : (
              <div className="customer-price-grid">
                {filtered.length === 0 && (
                  <div className="product-catalog-empty">
                    {hasAnyFilter ? 'ไม่พบสินค้าตรงกับตัวกรอง' : 'ไม่พบสินค้า — ลองคำค้นอื่น'}
                  </div>
                )}
                {visible.map((p) => (
                  <CustomerPriceCard
                    key={p.id}
                    product={p}
                    quote={customerPriceQuote(p, priceConfig)}
                    onOpen={setOpen}
                  />
                ))}
              </div>
            )}
            {filtered.length > visible.length && (
              <div className="pt-2 pb-3 flex justify-center">
                <button
                  type="button"
                  className="btn-secondary !py-2 !text-sm"
                  onClick={() => setPageSize((n) => n + PAGE)}
                >
                  ดูเพิ่ม ({(filtered.length - visible.length).toLocaleString('th-TH')} รายการ)
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {!hasSearch && !searchLoading && (
        <div className="py-12 text-center text-sm text-muted">
          พิมพ์ชื่อรุ่นหรือบาร์โค้ดเพื่อค้นหา
        </div>
      )}

      <ProductBrandPickerSheet
        open={brandPickerOpen}
        onClose={() => setBrandPickerOpen(false)}
        filter={filter}
        brandCounts={brandCounts}
        catalogLoaded={hasSearch}
        onPick={(b) => { setBrand(b); setBrandPickerOpen(false); }}
      />

      <ProductFilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        filter={filter}
        setFilter={setFilter}
        materialCounts={materialCounts}
        colorCounts={colorCounts}
        showCasioFacets={showCasioFacets}
        seriesCounts={seriesCounts}
        subTypeCounts={subTypeCounts}
        setSeries={setSeries}
        setSubType={setSubType}
      />

      {open && openQuote && (
        <div
          className="customer-price-overlay"
          onClick={() => setOpen(null)}
          role="presentation"
        >
          <div
            className="customer-price-overlay__card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={open.name}
          >
            <button
              type="button"
              className="customer-price-overlay__close"
              onClick={() => setOpen(null)}
              aria-label="ปิด"
            >
              <Icon name="x" size={18}/>
            </button>
            <div className="customer-price-overlay__media">
              {openQuote.strikeRetail && (
                <span className="customer-price-overlay__badge">-{openQuote.discountPct}%</span>
              )}
              <div className="customer-price-overlay__media-inner">
                <ProductThumb product={open} fill expandable fallback="sku" />
              </div>
            </div>
            <div className="customer-price-overlay__name">{open.name}</div>
            {openQuote.hasSell ? (
              <div className="customer-price-overlay__sell">{fmtCatalogPrice(openQuote.sell)}</div>
            ) : (
              <div className="customer-price-card__na">ยังไม่มีราคาขาย — รับเข้าก่อนจึงจะคิดจากทุนได้</div>
            )}
            {openQuote.strikeRetail && (
              <div className="customer-price-overlay__retail">
                ราคาปกติ {fmtCatalogPrice(openQuote.retail).replace('.-', '')} บาท
              </div>
            )}
            {openQuote.strikeRetail && (
              <div className="customer-price-overlay__disc">
                ส่วนลด {fmtCatalogPrice(openQuote.discountBaht).replace('.-', '')} บาท ({openQuote.discountPct}%)
              </div>
            )}
            {!openQuote.hasSell && openQuote.retail > 0 && (
              <div className="text-sm text-muted mt-1">ป้าย {fmtCatalogPrice(openQuote.retail)}</div>
            )}
            <div className="customer-price-overlay__stock">
              {(Number(open.current_stock) || 0) <= 0
                ? 'หมดสต็อก'
                : `คงเหลือ ${Number(open.current_stock) || 0} ชิ้น`}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
