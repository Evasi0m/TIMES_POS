import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sb } from '../lib/supabase-client.js';
import { searchProducts } from '../lib/product-search.js';
import { getProductListBundle } from '../lib/product-catalog-cache.js';
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
  customerStockStatus,
  filterCustomerPriceProducts,
  sortCustomerPriceProducts,
} from '../lib/customer-price.js';
import { fmtTHB } from '../lib/format.js';
import { useCountUp } from '../hooks/useCountUp.js';
import { useIdleReset } from '../hooks/useIdleReset.js';
import { useMountedToggle } from '../lib/use-mounted-toggle.js';
import ProductThumb from '../components/ui/ProductThumb.jsx';
import Icon from '../components/ui/Icon.jsx';
import ProductBrandPickerSheet from '../components/products/ProductBrandPickerSheet.jsx';
import ProductFilterSheet from '../components/products/ProductFilterSheet.jsx';
import CustomerScanSheet from '../components/customer/CustomerScanSheet.jsx';
import CustomerLanding from '../components/customer/CustomerLanding.jsx';
import KioskExitDialog from '../components/customer/KioskExitDialog.jsx';

const PAGE = 60;
const IDLE_MS = 90_000; // reset the board for the next customer
const KIOSK_PIN_KEY = 'customer_kiosk_pin';

/** Catalog-style Latin digits: "3,690.-" — avoids Taviraj/th-TH numeral distortion. */
function fmtCatalogPrice(n) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('en-US') + '.-';
}
function fmtPlain(n) {
  return (Math.round(Number(n) || 0)).toLocaleString('en-US');
}

const isMobileViewport = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches;

const prefersReducedMotion = () =>
  typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

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
  sort: 'stock-desc',
};

function StockPill({ stock }) {
  const n = Number(stock) || 0;
  const st = customerStockStatus(n);
  return (
    <span className={'customer-stock-pill customer-stock-pill--' + st.id}>
      {n > 0 ? `เหลือ ${n}` : st.label}
    </span>
  );
}

function CustomerPriceCard({ product, quote, index, onOpen }) {
  const stock = Number(product?.current_stock) || 0;
  const oos = stock <= 0;
  const style = prefersReducedMotion() || index >= 24
    ? undefined
    : { animationDelay: (index * 28) + 'ms' };
  return (
    <button
      type="button"
      className={'customer-price-card customer-price-card--enter' + (oos ? ' customer-price-card--oos' : '')}
      style={style}
      onClick={() => onOpen(product)}
    >
      <div className="customer-price-card__media">
        {quote.strikeRetail && (
          <span className="customer-price-card__badge">-{quote.discountPct}%</span>
        )}
        {oos && <span className="customer-price-card__oos-tag">สินค้าหมด</span>}
        <div className="customer-price-card__media-inner">
          <ProductThumb product={product} fill expandable={false} fallback="sku" />
        </div>
      </div>
      <div className="customer-price-card__body">
        <div className="customer-price-card__name" title={product.name}>{product.name}</div>
        <div className="customer-price-card__row">
          <div className="customer-price-card__meta">
            {quote.hasSell ? (
              <div className="customer-price-card__sell">{fmtCatalogPrice(quote.sell)}</div>
            ) : (
              <div className="customer-price-card__na">สอบถามราคา</div>
            )}
            {quote.strikeRetail && (
              <div className="customer-price-card__save">ประหยัด ฿{fmtPlain(quote.discountBaht)}</div>
            )}
            {!quote.hasSell && quote.retail > 0 && (
              <div className="customer-price-card__tag">ป้าย {fmtCatalogPrice(quote.retail)}</div>
            )}
          </div>
          <StockPill stock={stock} />
        </div>
      </div>
    </button>
  );
}

export default function CustomerPriceView({ config }) {
  const priceConfig = config || mergeCustomerPriceConfig(null);
  const rootRef = useRef(null);
  const [queryInput, setQueryInput] = useState('');
  const [filter, setFilter] = useState(DEFAULT_FILTER);
  const [searchRows, setSearchRows] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [catalogRows, setCatalogRows] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState(false);
  const [pageSize, setPageSize] = useState(PAGE);
  const [open, setOpen] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [brandPickerOpen, setBrandPickerOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [kioskOn, setKioskOn] = useState(false);
  const [kioskExitOpen, setKioskExitOpen] = useState(false);

  const hasSearch = !!filter.query.trim();
  const browseActive = !hasSearch && (
    filter.brand !== 'all' || !!filter.series || !!filter.subType
    || !!filter.material || !!filter.color
    || filter.minPrice > 0 || filter.maxPrice > 0 || filter.inStockOnly
  );
  const showLanding = !hasSearch && !browseActive;

  // ── Search input → debounced filter.query ──────────────────────────
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

  // ── Server search on query ─────────────────────────────────────────
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
      setSearchRows(error ? [] : (data || []).map((p) => enrichProduct(p)));
      setSearchLoading(false);
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [filter.query]);

  // ── Lazy-load full catalog for zero-typing browse ──────────────────
  useEffect(() => {
    if (hasSearch || catalogRows.length || catalogLoading) return;
    if (!browseActive) return;
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError(false);
    (async () => {
      const { bundle, error } = await getProductListBundle(sb);
      if (cancelled) return;
      if (error || !bundle) {
        setCatalogError(true);
      } else {
        const rows = bundle.products.map((p) =>
          enrichProduct({ ...p, _imageRow: bundle.imageByProductId.get(p.id) || null }));
        setCatalogRows(rows);
      }
      setCatalogLoading(false);
    })();
    return () => { cancelled = true; };
  }, [browseActive, hasSearch, catalogRows.length, catalogLoading]);

  useEffect(() => { setPageSize(PAGE); }, [filter]);

  const poolRows = hasSearch ? searchRows : catalogRows;
  const loading = hasSearch ? searchLoading : (browseActive && catalogLoading);

  const filtered = useMemo(() => {
    if (showLanding) return [];
    const state = { ...filter, query: '' };
    const base = filterCustomerPriceProducts(poolRows, state, priceConfig, filterProducts);
    const sorted = sortCustomerPriceProducts(base, filter.sort, priceConfig, sortProducts);
    // Out-of-stock always sinks to the bottom, keeping the primary order.
    const inStock = sorted.filter((p) => (Number(p.current_stock) || 0) > 0);
    const outStock = sorted.filter((p) => (Number(p.current_stock) || 0) <= 0);
    return inStock.concat(outStock);
  }, [showLanding, poolRows, filter, priceConfig]);

  const visible = filtered.slice(0, pageSize);

  // ── Facet counts (from the active pool) ────────────────────────────
  const poolReady = hasSearch ? hasSearch : (browseActive && catalogRows.length > 0);
  const brandCounts = useMemo(() => {
    if (!poolReady) return { all: 0 };
    const c = { all: poolRows.length };
    poolRows.forEach((p) => { c[p._brand] = (c[p._brand] || 0) + 1; });
    return c;
  }, [poolRows, poolReady]);

  const seriesCounts = useMemo(() => {
    if (!poolReady || filter.brand !== 'casio') return {};
    const c = { __total: 0 };
    poolRows.forEach((p) => {
      if (p._brand !== 'casio') return;
      c.__total++;
      if (p._series) c[p._series] = (c[p._series] || 0) + 1;
    });
    return c;
  }, [poolRows, filter.brand, poolReady]);

  const subTypeCounts = useMemo(() => {
    if (!poolReady || filter.brand !== 'casio' || !filter.series) return {};
    const subs = SERIES_SUBS[filter.series] || [];
    if (!subs.length) return {};
    const base = poolRows.filter((p) => p._brand === 'casio' && p._series === filter.series);
    const c = { __total: base.length };
    subs.forEach((s) => { c[s.id] = base.filter((p) => matchSubType(p, s)).length; });
    return c;
  }, [poolRows, filter.brand, filter.series, poolReady]);

  const materialCounts = useMemo(() => {
    if (!poolReady || filter.brand !== 'casio') return {};
    const base = filterCustomerPriceProducts(
      poolRows,
      { ...filter, query: '', material: '', color: '', minPrice: 0, maxPrice: 0 },
      priceConfig, filterProducts,
    );
    const c = {};
    base.forEach((p) => { if (p._material) c[p._material] = (c[p._material] || 0) + 1; });
    return c;
  }, [poolRows, filter, priceConfig, poolReady]);

  const colorCounts = useMemo(() => {
    if (!poolReady || filter.brand !== 'casio') return {};
    const base = filterCustomerPriceProducts(
      poolRows,
      { ...filter, query: '', color: '', minPrice: 0, maxPrice: 0 },
      priceConfig, filterProducts,
    );
    const c = {};
    base.forEach((p) => { if (p._color) c[p._color] = (c[p._color] || 0) + 1; });
    return c;
  }, [poolRows, filter, priceConfig, poolReady]);

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

  const resetAll = useCallback(() => {
    setQueryInput('');
    setFilter(DEFAULT_FILTER);
    setOpen(null);
    setSheetOpen(false);
    setBrandPickerOpen(false);
    setPageSize(PAGE);
  }, []);

  const clearFilters = () => {
    setFilter((f) => ({
      ...f, brand: 'all', series: '', subType: '', material: '', color: '',
      minPrice: 0, maxPrice: 0, inStockOnly: false,
    }));
  };

  const setBrand = (b) => setFilter((f) => ({ ...f, brand: b, series: '', subType: '', material: '', color: '' }));
  const setSeries = (s) => setFilter((f) => ({ ...f, series: s, subType: '', material: '', color: '' }));
  const setSubType = (s) => setFilter((f) => ({ ...f, subType: s, material: '', color: '' }));
  const setPricePreset = (p) => setFilter((f) => ({ ...f, minPrice: p.min, maxPrice: p.max }));

  const chipCls = (active) =>
    'px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap inline-flex items-center gap-1 ' +
    (active ? 'lg-tile-dark' : 'lg-tile text-muted hover:text-ink');

  const brandFilterLabel = filter.brand === 'all'
    ? 'ทั้งหมด'
    : (BRAND_RULES.find((b) => b.id === filter.brand)?.label || filter.brand);

  // Keep the last product mounted while the popup plays its exit animation.
  const { render: popupRender, closing: popupClosing } = useMountedToggle(!!open, 260);
  const lastOpenRef = useRef(null);
  if (open) lastOpenRef.current = open;
  const shown = open || lastOpenRef.current;
  const openQuote = shown ? customerPriceQuote(shown, priceConfig) : null;

  // ── Idle reset (skip while a customer is actively reading a popup) ──
  useIdleReset(IDLE_MS, () => { if (!open && !scanOpen) resetAll(); }, kioskOn && !open && !scanOpen);

  // ── Infinite scroll sentinel ───────────────────────────────────────
  const sentinelRef = useRef(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || filtered.length <= visible.length) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setPageSize((n) => n + PAGE);
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length, visible.length]);

  // ── Popup: Esc to close + body scroll lock ─────────────────────────
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  // ── Popup swipe / arrow navigation across the visible list ─────────
  const openIndex = open ? filtered.findIndex((p) => p.id === open.id) : -1;
  const goRel = useCallback((delta) => {
    if (openIndex < 0) return;
    const next = filtered[openIndex + delta];
    if (next) setOpen(next);
  }, [openIndex, filtered]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowRight') goRel(1);
      if (e.key === 'ArrowLeft') goRel(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, goRel]);

  const touchX = useRef(null);
  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 60) goRel(dx < 0 ? 1 : -1);
    touchX.current = null;
  };

  const animatedSell = useCountUp(openQuote?.hasSell ? openQuote.sell : 0, 420, open?.id);

  // ── Kiosk mode ─────────────────────────────────────────────────────
  const getKioskPin = () => {
    try { return localStorage.getItem(KIOSK_PIN_KEY) || ''; } catch { return ''; }
  };
  const enterKiosk = () => {
    let pin = getKioskPin();
    if (!pin) {
      const input = window.prompt('ตั้ง PIN 4 หลักสำหรับออกจากโหมดลูกค้า');
      if (input == null) return;
      const clean = input.replace(/\D/g, '').slice(0, 8);
      if (clean.length < 4) { window.alert('PIN ต้องมีอย่างน้อย 4 หลัก'); return; }
      try { localStorage.setItem(KIOSK_PIN_KEY, clean); } catch { /* ignore */ }
      pin = clean;
    }
    resetAll();
    setKioskOn(true);
    try { rootRef.current?.requestFullscreen?.(); } catch { /* ignore */ }
  };
  const exitKiosk = () => {
    setKioskOn(false);
    setKioskExitOpen(false);
    try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch { /* ignore */ }
  };

  const handleScan = (code) => {
    setScanOpen(false);
    setQueryInput(code);
    setFilter((f) => ({ ...f, query: code }));
  };

  return (
    <div
      ref={rootRef}
      className={'customer-price-root px-4 py-4 lg:px-10 lg:py-6 lg:flex lg:flex-col' + (kioskOn ? ' customer-price-root--kiosk' : '')}
    >
      {/* Toolbar */}
      <div className="products-toolbar mb-2 flex-shrink-0">
        <div className="products-toolbar__line products-toolbar__line--search">
          <div className="products-search-wrap">
            <span className="products-search-icon" aria-hidden="true">
              <Icon name="search" size={17} strokeWidth={2.25}/>
            </span>
            <input
              className={'input products-search-input products-search-input--no-camera w-full !h-11 !text-sm' + (queryInput ? ' has-clear' : '')}
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
            className="products-toolbar__icon-btn btn-secondary icon-btn-44 !p-0 !w-11 !h-11 flex-shrink-0"
            onClick={() => setScanOpen(true)}
            title="สแกนบาร์โค้ด"
            aria-label="สแกนบาร์โค้ด"
          >
            <Icon name="barcode" size={20} strokeWidth={1.75}/>
          </button>
          <button
            type="button"
            className="products-toolbar__filter products-toolbar__icon-btn btn-secondary relative icon-btn-44 !p-0 !w-11 !h-11 flex-shrink-0"
            onClick={() => setSheetOpen(true)}
            title="ตัวกรอง"
            aria-label="ตัวกรอง"
            disabled={showLanding}
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
            disabled={showLanding}
          >
            <option value="stock-desc">จำนวนมาก → น้อย</option>
            <option value="newest">ใหม่ล่าสุด</option>
            <option value="price-asc">ราคา ต่ำ → สูง</option>
            <option value="price-desc">ราคา สูง → ต่ำ</option>
            <option value="name">ชื่อรุ่น A-Z</option>
          </select>
          <button
            type="button"
            className="products-toolbar__brand btn-secondary !h-11 !px-2.5 !text-sm lg:hidden"
            onClick={() => setBrandPickerOpen(true)}
            aria-label="เลือกแบรนด์"
            disabled={showLanding}
          >
            <Icon name="tag" size={14} className="shrink-0"/>
            <span className="truncate max-w-[5rem]">{brandFilterLabel}</span>
            <Icon name="chevron-d" size={12} className="shrink-0 opacity-70"/>
          </button>
          <button
            type="button"
            className={'btn-secondary !h-11 !px-2.5 !text-sm flex-shrink-0 ' + (kioskOn ? '!bg-primary !text-on-primary' : '')}
            onClick={() => (kioskOn ? setKioskExitOpen(true) : enterKiosk())}
            title={kioskOn ? 'ออกจากโหมดลูกค้า' : 'โหมดลูกค้า'}
            aria-label={kioskOn ? 'ออกจากโหมดลูกค้า' : 'โหมดลูกค้า'}
          >
            <Icon name={kioskOn ? 'lock' : 'expand'} size={16} className="shrink-0"/>
            <span className="hidden sm:inline">{kioskOn ? 'ออก' : 'โหมดลูกค้า'}</span>
          </button>
        </div>
      </div>

      {/* Brand chips (desktop) */}
      {!showLanding && (
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

      {/* Casio series chips (desktop) */}
      {!showLanding && filter.brand === 'casio' && (
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

      {/* Active filter chips */}
      {!showLanding && (filter.material || filter.color || filter.series || filter.subType
        || activePricePreset || filter.minPrice > 0 || filter.maxPrice > 0 || filter.inStockOnly) && (
        <div className="flex flex-wrap gap-1.5 mb-2 items-center flex-shrink-0">
          {activePricePreset && (
            <button type="button" onClick={() => setFilter((f) => ({ ...f, minPrice: 0, maxPrice: 0 }))}
              className="px-2.5 py-1 rounded-full text-xs bg-primary/10 text-primary border border-primary/20 inline-flex items-center gap-1.5 hover:bg-primary/20">
              <Icon name="tag" size={11}/> {activePricePreset.label}
              <Icon name="x" size={11} className="opacity-70"/>
            </button>
          )}
          {!activePricePreset && (filter.minPrice > 0 || filter.maxPrice > 0) && (
            <button type="button" onClick={() => setFilter((f) => ({ ...f, minPrice: 0, maxPrice: 0 }))}
              className="px-2.5 py-1 rounded-full text-xs bg-primary/10 text-primary border border-primary/20 inline-flex items-center gap-1.5 hover:bg-primary/20">
              ราคา {filter.minPrice > 0 ? fmtTHB(filter.minPrice) : '—'} – {filter.maxPrice > 0 ? fmtTHB(filter.maxPrice) : '—'}
              <Icon name="x" size={11} className="opacity-70"/>
            </button>
          )}
          {filter.inStockOnly && (
            <button type="button" onClick={() => setFilter((f) => ({ ...f, inStockOnly: false }))}
              className="px-2.5 py-1 rounded-full text-xs bg-primary/10 text-primary border border-primary/20 inline-flex items-center gap-1.5 hover:bg-primary/20">
              มีสต็อก <Icon name="x" size={11} className="opacity-70"/>
            </button>
          )}
          {filter.series && (
            <button type="button" onClick={() => setSeries('')}
              className="px-2.5 py-1 rounded-full text-xs bg-primary/10 text-primary border border-primary/20 inline-flex items-center gap-1.5 hover:bg-primary/20">
              {SERIES_RULES.find((s) => s.id === filter.series)?.label}
              <Icon name="x" size={11} className="opacity-70"/>
            </button>
          )}
          {filter.subType && SERIES_SUBS[filter.series] && (
            <button type="button" onClick={() => setSubType('')}
              className="px-2.5 py-1 rounded-full text-xs bg-primary/10 text-primary border border-primary/20 inline-flex items-center gap-1.5 hover:bg-primary/20">
              {SERIES_SUBS[filter.series].find((s) => s.id === filter.subType)?.label}
              <Icon name="x" size={11} className="opacity-70"/>
            </button>
          )}
          {hasAnyFilter && (
            <button type="button" onClick={clearFilters}
              className="px-2.5 py-1 rounded-full text-xs text-muted hover:text-ink inline-flex items-center gap-1 underline underline-offset-2">
              <Icon name="x" size={11}/> ล้างตัวกรอง
            </button>
          )}
        </div>
      )}

      {/* Result count */}
      {!showLanding && !loading && (
        <div className="text-xs text-muted mb-2 flex-shrink-0 flex items-center gap-2">
          <span>พบ <span className="font-medium text-ink tabular-nums">{filtered.length.toLocaleString('en-US')}</span> รายการ</span>
          {filtered.length > visible.length && (
            <span className="text-muted-soft">· แสดง {visible.length.toLocaleString('en-US')}</span>
          )}
        </div>
      )}

      {/* Landing */}
      {showLanding && (
        <CustomerLanding
          onPickBrand={(b) => setBrand(b)}
          onPickPrice={(p) => setPricePreset(p)}
          onScan={() => setScanOpen(true)}
        />
      )}

      {/* Grid */}
      {!showLanding && (
        <div className="card-canvas overflow-hidden flex-1 min-h-0">
          <div className="product-catalog-scroll">
            {loading ? (
              <div className="customer-price-grid">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="customer-price-skeleton" />
                ))}
              </div>
            ) : (
              <div className="customer-price-grid">
                {filtered.length === 0 && (
                  <div className="product-catalog-empty">
                    {catalogError ? 'โหลดสินค้าไม่สำเร็จ — ลองใหม่อีกครั้ง'
                      : hasAnyFilter ? 'ไม่พบสินค้าตรงกับตัวกรอง'
                        : 'ไม่พบสินค้า — ลองคำค้นอื่น'}
                  </div>
                )}
                {visible.map((p, i) => (
                  <CustomerPriceCard
                    key={p.id}
                    product={p}
                    index={i}
                    quote={customerPriceQuote(p, priceConfig)}
                    onOpen={setOpen}
                  />
                ))}
              </div>
            )}
            {filtered.length > visible.length && (
              <>
                <div ref={sentinelRef} className="h-1" aria-hidden="true" />
                <div className="pt-2 pb-3 flex justify-center">
                  <button type="button" className="btn-secondary !py-2 !text-sm" onClick={() => setPageSize((n) => n + PAGE)}>
                    ดูเพิ่ม ({(filtered.length - visible.length).toLocaleString('en-US')} รายการ)
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <ProductBrandPickerSheet
        open={brandPickerOpen}
        onClose={() => setBrandPickerOpen(false)}
        filter={filter}
        brandCounts={brandCounts}
        catalogLoaded={poolReady}
        onPick={(b) => { setBrand(b); setBrandPickerOpen(false); }}
      />

      <ProductFilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        filter={filter}
        setFilter={setFilter}
        materialCounts={materialCounts}
        colorCounts={colorCounts}
        showCasioFacets={filter.brand === 'casio' || poolRows.some((p) => p._brand === 'casio')}
        seriesCounts={seriesCounts}
        subTypeCounts={subTypeCounts}
        setSeries={setSeries}
        setSubType={setSubType}
      />

      <CustomerScanSheet open={scanOpen} onClose={() => setScanOpen(false)} onScan={handleScan} />

      <KioskExitDialog
        open={kioskExitOpen}
        expectedPin={getKioskPin() || '0000'}
        onUnlock={exitKiosk}
        onClose={() => setKioskExitOpen(false)}
      />

      {/* Detail popup — bottom sheet on phones, centered card on desktop */}
      {popupRender && shown && openQuote && (() => {
        const stock = Number(shown.current_stock) || 0;
        const st = customerStockStatus(stock);
        return (
          <div
            className={'cp-sheet-overlay' + (popupClosing ? ' is-closing' : '')}
            onClick={() => setOpen(null)}
            role="presentation"
          >
            <div
              className="cp-sheet"
              onClick={(e) => e.stopPropagation()}
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
              role="dialog"
              aria-modal="true"
              aria-label={shown.name}
            >
              <div className="cp-sheet__grabber" aria-hidden="true" />
              <button type="button" className="cp-sheet__close" onClick={() => setOpen(null)} aria-label="ปิด">
                <Icon name="x" size={18}/>
              </button>

              <div className="cp-sheet__media" key={shown.id}>
                {openQuote.strikeRetail && (
                  <span className="cp-sheet__badge">
                    <span className="cp-sheet__badge-label">ลด</span>
                    <span className="cp-sheet__badge-pct">{openQuote.discountPct}%</span>
                  </span>
                )}
                <div className="cp-sheet__media-inner">
                  <ProductThumb product={shown} fill expandable showExpandHint={false} fallback="sku" />
                </div>
              </div>

              <div className="cp-sheet__pager">
                <button type="button" className="cp-sheet__nav"
                  onClick={() => goRel(-1)} disabled={openIndex <= 0} aria-label="ก่อนหน้า">
                  <Icon name="chevron-l" size={20}/>
                </button>
                <div className="cp-sheet__pager-mid">
                  {openIndex >= 0 && (
                    <span className="cp-sheet__counter">{openIndex + 1} / {filtered.length}</span>
                  )}
                  <span className="cp-sheet__tap-hint">แตะรูปเพื่อดูภาพใหญ่</span>
                </div>
                <button type="button" className="cp-sheet__nav"
                  onClick={() => goRel(1)} disabled={openIndex < 0 || openIndex >= filtered.length - 1} aria-label="ถัดไป">
                  <Icon name="chevron-r" size={20}/>
                </button>
              </div>

              <div className="cp-sheet__info">
                <div className="cp-sheet__name">{shown.name}</div>

                <div className="cp-sheet__price-box">
                  {openQuote.hasSell ? (
                    <>
                      <div className="cp-sheet__price-label">ราคาพิเศษ</div>
                      <div className="cp-sheet__price">
                        {fmtPlain(open ? animatedSell : openQuote.sell)}<span className="cp-sheet__price-unit">บาท</span>
                      </div>
                    </>
                  ) : (
                    <div className="cp-sheet__ask">สอบถามราคากับพนักงาน</div>
                  )}
                  {openQuote.strikeRetail && (
                    <div className="cp-sheet__compare">
                      <span className="cp-sheet__retail">ปกติ {fmtPlain(openQuote.retail)} บาท</span>
                      <span className="cp-sheet__save">ประหยัด {fmtPlain(openQuote.discountBaht)} บาท</span>
                    </div>
                  )}
                  {!openQuote.hasSell && openQuote.retail > 0 && (
                    <div className="cp-sheet__compare">
                      <span className="cp-sheet__tagprice">ราคาป้าย {fmtPlain(openQuote.retail)} บาท</span>
                    </div>
                  )}
                </div>

                <div className={'cp-sheet__stock cp-sheet__stock--' + st.id}>
                  <span className="cp-sheet__stock-dot" aria-hidden="true" />
                  <span className="cp-sheet__stock-label">{st.label}</span>
                  <span className="cp-sheet__stock-count">
                    {stock > 0 ? <>คงเหลือ <b>{stock}</b> ชิ้น</> : 'รอสินค้าเข้า'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
