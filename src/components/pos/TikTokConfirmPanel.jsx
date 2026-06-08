// TikTok order confirmation — POS-side review queue.
//
// Every TikTok Shop order is imported as status='pending' (no stock cut, no
// tax-invoice number). It surfaces here as a badge next to the POS page title:
// "Order TikTok รอยืนยัน (N)". The cashier opens the panel, matches each line
// item's SKU to a POS product (auto-suggested via the same tier-based matcher
// the E-Commerce admin tool uses), enters the net the shop actually received,
// and confirms. confirm_tiktok_sale_order() then deducts stock once, issues the
// tax-invoice number, and flips the order to 'active' so it flows into Sales
// History + every report. A "TikTok API" badge in Sales History prevents the
// cashier from keying the same sale in manually.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { sb } from '../../lib/supabase-client.js';
import { mapError } from '../../lib/error-map.js';
import { classifySkuMatch, findSkuCandidates } from '../../lib/fuzzy-match.js';
import { getProductCatalog, fetchSkuPrefilter, PRODUCT_CATALOG_SELECT } from '../../lib/product-catalog-cache.js';
import { pollTikTokOrders, formatPollToast } from '../../lib/tiktok-poll-sync.js';
import { useSimulatedSyncProgress } from '../../lib/use-simulated-sync-progress.js';
import TikTokSyncOverlay from '../ui/TikTokSyncOverlay.jsx';
import Icon from '../ui/Icon.jsx';
import ExpandableImageThumb from '../ui/ExpandableImageThumb.jsx';
import DeferNetButton from './DeferNetButton.jsx';

const TIER_LABEL = {
  exact: 'ตรงกัน',
  suffix: 'suffix ตรงรุ่น',
  prefix: 'prefix ใกล้เคียง',
  fuzzy: 'คล้ายกัน',
};

const fmtTHB = (n) =>
  '฿' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtTime = (iso) => {
  try {
    return new Date(iso).toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok',
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
};

const SORT_OLDEST = 'oldest';
const SORT_NEWEST = 'newest';

/** Casio-style model code embedded in TikTok titles (e.g. "รมดำ ECB-S10DB-1A"). */
const SKU_CODE_RE = /[A-Z]{1,4}(?:-[A-Z0-9]{1,6}){1,4}/i;

function extractTikTokSkuKey(item) {
  const seller = (item?.seller_sku || '').trim();
  if (seller) return seller.toUpperCase();
  const text = [item?.sku_name, item?.product_name].filter(Boolean).join(' ');
  const m = text.match(SKU_CODE_RE);
  return m ? m[0].toUpperCase() : text.trim();
}

/** Summary stats for one pending order in the list view. */
function orderListMeta(order) {
  const items = order.items || [];
  const itemCount = items.length;
  const unmatched = items.filter(i => !i.product_id).length;
  const matchLabel = unmatched > 0
    ? `ยังไม่จับคู่ ${unmatched}`
    : 'จับคู่ครบแล้ว';
  return {
    itemCount,
    unmatched,
    matchLabel,
    allMatched: unmatched === 0,
  };
}

function itemSkuLabel(item) {
  return item?.sku_name || item?.product_name || item?.seller_sku || '—';
}

/** One SKU line inside a multi-item order card. */
function OrderListItemLine({ item, showDivider }) {
  const matched = Boolean(item.product_id);
  return (
    <div className={'flex items-center gap-3 min-w-0' + (showDivider ? ' pt-2.5 mt-2.5 border-t hairline' : '')}>
      <SkuThumb url={item.sku_image_url} sizeClass="w-14 h-14" iconSize={22}/>
      <div className="min-w-0 flex-1">
        <div
          className="text-[15px] font-semibold text-ink leading-snug line-clamp-2"
          title={itemSkuLabel(item)}
        >
          {itemSkuLabel(item)}
        </div>
        <div className="text-[13px] text-muted tabular-nums mt-0.5">
          ×{Number(item.quantity) || 1}
          {!matched && (
            <span className="ml-2 font-medium text-[#8a6500]">· ยังไม่จับคู่</span>
          )}
        </div>
      </div>
    </div>
  );
}

// TikTok fulfillment status → Thai label + full theme class string. Class
// names are written out in full (not interpolated) so Tailwind's JIT keeps
// them. Shown next to the order number so the cashier sees the live shipping
// state at a glance.
const TIKTOK_STATUS_BADGE = {
  AWAITING_SHIPMENT:   { label: 'รอจัดส่ง',    cls: 'bg-warning/10 text-warning border-warning/30' },
  AWAITING_COLLECTION: { label: 'รอเข้ารับ',   cls: 'bg-accent-teal/10 text-accent-teal border-accent-teal/30' },
  PARTIALLY_SHIPPING:  { label: 'ส่งบางส่วน',  cls: 'bg-warning/10 text-warning border-warning/30' },
  IN_TRANSIT:          { label: 'กำลังจัดส่ง', cls: 'bg-accent-teal/10 text-accent-teal border-accent-teal/30' },
  DELIVERED:           { label: 'จัดส่งแล้ว',  cls: 'bg-success/10 text-success border-success/20' },
  COMPLETED:           { label: 'สำเร็จ',       cls: 'bg-success/10 text-success border-success/20' },
  ON_HOLD:             { label: 'พักไว้',       cls: 'bg-muted/10 text-muted border-hairline' },
  CANCELLED:           { label: 'ยกเลิก',       cls: 'bg-error/10 text-error border-error/30' },
};

function TikTokOrderStatusBadge({ status, className = '' }) {
  if (!status) return null;
  const key = String(status).toUpperCase();
  const b = TIKTOK_STATUS_BADGE[key]
    || { label: key.replace(/_/g, ' ').toLowerCase(), cls: 'bg-muted/10 text-muted border-hairline' };
  return (
    <span
      className={
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none ' +
        b.cls + ' ' + className
      }
    >
      {b.label}
    </span>
  );
}

/** One row in the pending-order list — large, scannable layout. */
function OrderListRow({ order, onOpen }) {
  const items = order.items || [];
  const meta = orderListMeta(order);
  const multiItem = items.length > 1;

  return (
    <button
      type="button"
      onClick={() => onOpen(order)}
      className="ttc-order-row w-full text-left rounded-2xl border hairline bg-surface-strong/60 hover:bg-surface-strong transition-colors"
    >
      <div className="flex items-stretch gap-3 p-4">
        <div className="min-w-0 flex-1 flex flex-col gap-3 pr-1">
          {multiItem ? (
            /* หลาย SKU — แสดงทุกรายการในกรอบเดียว */
            <div className="flex flex-col">
              {items.map((item, idx) => (
                <OrderListItemLine key={item.id ?? idx} item={item} showDivider={idx > 0}/>
              ))}
            </div>
          ) : items.length === 1 ? (
            /* SKU เดียว — layout เดิม */
            <div className="flex items-center gap-4 min-w-0">
              <SkuThumb url={items[0].sku_image_url}/>
              <div className="min-w-0 flex-1">
                <div
                  className="text-[17px] font-semibold text-ink leading-snug truncate"
                  title={itemSkuLabel(items[0])}
                >
                  {itemSkuLabel(items[0])}
                </div>
                <div className="text-[15px] font-medium text-muted tabular-nums mt-0.5">
                  {meta.itemCount} รายการ
                  {Number(items[0].quantity) > 1 && ` · ×${items[0].quantity}`}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted">ไม่มีรายการสินค้า</div>
          )}

          {multiItem && (
            <div className="text-[13px] font-medium text-muted tabular-nums">
              {meta.itemCount} รายการ
            </div>
          )}

          {/* เวลา | ราคา | สถานะจับคู่ */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] leading-relaxed">
            <span className="tabular-nums text-muted">{fmtTime(order.sale_date)}</span>
            <span className="text-muted-soft">|</span>
            <span className="tabular-nums font-semibold text-ink">{fmtTHB(order.grand_total)}</span>
            <span className="text-muted-soft">|</span>
            <span className={
              'font-medium ' + (meta.allMatched ? 'text-[#0a7a43]' : 'text-[#8a6500]')
            }>
              {meta.matchLabel}
            </span>
          </div>

          <div className="text-[13px] text-muted-soft leading-snug">
            <span className="text-muted">หมายเลขคำสั่งซื้อ: </span>
            <span className="font-mono text-ink/80 break-all">{order.tiktok_order_id}</span>
            <TikTokOrderStatusBadge status={order.tiktok_order_status} className="ml-1.5 align-middle"/>
          </div>
        </div>

        <div className="shrink-0 self-center text-muted-soft">
          <Icon name="chevron-r" size={20}/>
        </div>
      </div>
    </button>
  );
}

function SkuThumb({ url, sizeClass = 'w-[72px] h-[72px]', iconSize = 28, alt = '' }) {
  return (
    <ExpandableImageThumb
      src={url}
      alt={alt}
      className={`${sizeClass} rounded-xl border hairline bg-white shadow-sm shrink-0`}
      imgClassName="w-full h-full object-cover rounded-xl"
      placeholder={(
        <div className={`${sizeClass} rounded-xl bg-surface-soft border hairline flex items-center justify-center text-muted shrink-0`}>
          <Icon name="image" size={iconSize}/>
        </div>
      )}
    />
  );
}

function SectionPill({ icon, children }) {
  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface-cream-strong text-muted text-[10px] font-semibold uppercase tracking-wider">
      {icon && <Icon name={icon} size={11}/>}
      {children}
    </div>
  );
}

function MatchCandidateRow({ product, score, tier, onPick, disabled, highlight }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={'ttc-match-row w-full text-left' + (highlight ? ' ttc-match-row--auto' : '')}
      onClick={() => onPick(product)}
    >
      <div className="min-w-0 flex-1">
        <div className="font-mono text-sm font-medium leading-snug truncate">{product.name}</div>
        <div className="text-[11px] text-muted-soft tabular-nums mt-0.5">
          {product.current_stock != null && <>stock {product.current_stock}</>}
          {Number(product.retail_price) > 0 && (
            <> · ขาย ฿{Number(product.retail_price).toLocaleString()}</>
          )}
          {product.barcode && (
            <span className="font-mono ml-1 opacity-80">{product.barcode}</span>
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

/** Inline 2-mode matcher: รายการแนะนำ (default) + ค้นหาเอง (when typing). */
function PosProductMatcher({
  item, catalog, catalogLoading, catalogError, onRetryCatalog, onPick, disabled,
}) {
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
    if (catalog.length) return findSkuCandidates(skuKey, catalog, { limit: 8, minScore: 0.5 });
    return prefilter;
  }, [skuKey, catalog, prefilter]);

  const localMatch = useMemo(() => {
    const pool = catalog.length
      ? catalog
      : prefilter.map(c => c.product);
    if (!skuKey || !pool.length) return { status: 'none', candidates: [] };
    return classifySkuMatch(skuKey, pool);
  }, [skuKey, catalog, prefilter]);

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

  return (
    <div className="ttc-match space-y-3">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-soft mb-1.5">
          ค้นหาเอง
        </div>
        <div className="relative">
          <input
            type="text"
            value={q}
            disabled={disabled}
            onChange={e => search(e.target.value)}
            placeholder="พิมพ์ชื่อ / บาร์โค้ด สินค้า POS"
            className="input !h-11 !rounded-xl !py-2.5 !text-sm w-full"
            autoComplete="off"
          />
          {searching && <span className="spinner absolute right-3 top-3"/>}
        </div>
      </div>

      {isSearching ? (
        <div className="ttc-match-panel">
          <div className="ttc-match-panel__head">
            ผลการค้นหา
            {!searching && <span className="text-muted-soft font-normal normal-case"> · {searchRows.length} รายการ</span>}
          </div>
          <div className="ttc-match-panel__body">
            {searching && searchRows.length === 0 && (
              <div className="ttc-picker-dropdown__empty">กำลังค้นหา…</div>
            )}
            {!searching && searchRows.length === 0 && (
              <div className="ttc-picker-dropdown__empty">ไม่พบสินค้า — ลองพิมพ์รหัสอื่น</div>
            )}
            {searchRows.map(row => (
              <MatchCandidateRow
                key={row.product.id}
                product={row.product}
                score={row.score}
                tier={row.tier}
                disabled={disabled}
                onPick={pick}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="ttc-match-panel">
          <div className="ttc-match-panel__head">
            รายการแนะนำ
            {skuKey && (
              <span className="text-muted-soft font-normal normal-case font-mono ml-1"> · {skuKey}</span>
            )}
          </div>
          <div className="ttc-match-panel__body">
            {recommendLoading && (
              <div className="ttc-picker-dropdown__empty flex items-center justify-center gap-2">
                <span className="spinner"/> กำลังโหลดรายการสินค้า…
              </div>
            )}
            {!recommendLoading && catalogError && !catalog.length && recommendations.length === 0 && (
              <div className="ttc-picker-dropdown__empty space-y-2">
                <div className="text-error/90 text-xs leading-relaxed">{catalogError}</div>
                {onRetryCatalog && (
                  <button
                    type="button"
                    className="btn-secondary !py-1.5 !px-3 !text-xs w-full"
                    onClick={onRetryCatalog}
                    disabled={disabled || catalogLoading}
                  >
                    <Icon name="refresh" size={12}/> ลองโหลดใหม่
                  </button>
                )}
              </div>
            )}
            {!recommendLoading && !catalogError && catalog.length > 0 && recommendations.length === 0 && (
              <div className="ttc-picker-dropdown__empty">
                ไม่พบรุ่นใกล้เคียงจาก SKU นี้ — ใช้ช่องค้นหาด้านบน
              </div>
            )}
            {!recommendLoading && !catalog.length && !catalogError && recommendations.length === 0 && prefilter.length === 0 && (
              <div className="ttc-picker-dropdown__empty">
                ไม่พบรุ่นใกล้เคียง — ใช้ช่องค้นหาด้านบน
              </div>
            )}
            {!recommendLoading && recommendations.map(c => (
              <MatchCandidateRow
                key={c.product.id}
                product={c.product}
                score={c.score}
                tier={c.tier}
                disabled={disabled}
                highlight={localMatch?.status === 'auto' && localMatch?.product?.id === c.product.id}
                onPick={pick}
              />
            ))}
          </div>
        </div>
      )}

      {localMatch?.status === 'auto' && localMatch.product && !isSearching && (
        <button
          type="button"
          className="btn-primary w-full !py-2.5 !text-sm inline-flex items-center justify-center gap-2"
          disabled={disabled}
          onClick={() => pick(localMatch.product)}
        >
          <Icon name="check" size={16}/>
          ยืนยันจับคู่อัตโนมัติ · {localMatch.product.name}
        </button>
      )}
    </div>
  );
}

/** One line item in the confirm view — card layout matching the list rows. */
function ConfirmItemCard({
  item, pick, onPick, onClear, disabled, catalog, catalogLoading, catalogError, onRetryCatalog,
}) {
  const skuName = item.sku_name || item.product_name || '—';
  return (
    <div className="ttc-confirm-item rounded-2xl border hairline bg-surface-strong/60 overflow-visible">
      <div className="flex items-start gap-4 p-4 pb-3">
        <SkuThumb url={item.sku_image_url}/>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="text-[17px] font-semibold text-ink leading-snug break-words">{skuName}</div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[15px] text-muted">
            <span className="font-medium tabular-nums">×{item.quantity}</span>
          </div>
          {item.seller_sku && (
            <div className="text-[13px] text-muted font-mono break-all">{item.seller_sku}</div>
          )}
          <div className="text-[13px] tabular-nums text-muted">
            ราคาต่อชิ้น <span className="font-semibold text-ink">{fmtTHB(item.unit_price)}</span>
          </div>
        </div>
      </div>

      <div className="px-4 pb-4 border-t hairline pt-3 space-y-3">
        <SectionPill icon="link">จับคู่กับสินค้า POS</SectionPill>

        {pick ? (
          <div className="flex items-center gap-3 rounded-xl border border-[#0a7a43]/30 bg-[#e6f7ed] px-3.5 py-3">
            <Icon name="check" size={18} className="text-[#0a7a43] shrink-0"/>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-medium text-[#0a5a32] leading-snug break-words">{pick.name}</div>
              <div className="text-[11px] text-[#0a7a43]/80 mt-0.5">จับคู่ SKU แล้ว</div>
            </div>
            {!disabled && (
              <button type="button" className="btn-secondary !py-1.5 !px-3 !text-xs shrink-0" onClick={onClear}>
                เปลี่ยน
              </button>
            )}
          </div>
        ) : (
          <PosProductMatcher
            item={item}
            catalog={catalog}
            catalogLoading={catalogLoading}
            catalogError={catalogError}
            onRetryCatalog={onRetryCatalog}
            onPick={onPick}
            disabled={disabled}
          />
        )}
      </div>
    </div>
  );
}

/** Order summary + item matching + net received footer. */
function OrderConfirmView({
  order, picks, setPicks, net, setNet, deferNet, setDeferNet,
  saving, allMatched, netOk, onConfirm, catalog, catalogLoading, catalogError, onRetryCatalog,
}) {
  const items = order.items || [];
  const matchedCount = items.filter(it => picks[it.id]?.id).length;

  return (
    <div className="flex flex-col max-h-[min(82vh,900px)] min-h-0">
      {/* Order meta — grid: left stacks order+status, frame fills right column */}
      <div className="px-4 sm:px-5 py-2.5 border-b hairline shrink-0 ttc-confirm-header">
        <div className="ttc-confirm-header__order truncate" title={order.tiktok_order_id}>
          <span className="text-muted-soft">หมายเลขคำสั่งซื้อ: </span>
          <span className="font-mono text-ink/75">{order.tiktok_order_id}</span>
          <TikTokOrderStatusBadge status={order.tiktok_order_status} className="ml-1.5 align-middle"/>
        </div>
        <div className="ttc-confirm-header__status">
          <span className="tabular-nums">{fmtTime(order.sale_date)}</span>
          <span className="ttc-confirm-header__sep">|</span>
          <span className={
            'ttc-confirm-header__match ' + (matchedCount === items.length ? 'is-done' : 'is-pending')
          }>
            {matchedCount === items.length ? 'จับคู่ครบแล้ว' : `จับคู่แล้ว ${matchedCount}/${items.length}`}
          </span>
        </div>
          <div className="ttc-confirm-sideframe ttc-brown-frame">
          <div className="ttc-confirm-sideframe__layer">
            <span className="ttc-confirm-sideframe__label">ราคา</span>
            <span className="ttc-confirm-sideframe__value ttc-confirm-sideframe__value--price tabular-nums">
              {fmtTHB(order.grand_total)}
            </span>
          </div>
          <div className="ttc-confirm-sideframe__layer">
            <span className="ttc-confirm-sideframe__label">ชำระ</span>
            <span className="ttc-confirm-sideframe__value ttc-confirm-sideframe__value--pay">
              {order.tiktok_payment_method || order.payment_method || '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Line items — scroll; dropdown ลอย portal ไม่โดน clip */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4">
        {items.map(it => (
            <ConfirmItemCard
              key={it.id}
              item={it}
              pick={picks[it.id]}
              disabled={saving}
              catalog={catalog}
              catalogLoading={catalogLoading}
              catalogError={catalogError}
              onRetryCatalog={onRetryCatalog}
              onPick={(p) => setPicks(prev => ({ ...prev, [it.id]: { id: p.id, name: p.name } }))}
              onClear={() => setPicks(prev => { const n = { ...prev }; delete n[it.id]; return n; })}
            />
          ))}
      </div>

      {/* Net received + confirm — same red card pattern as POS checkout */}
      <div className="px-4 sm:px-5 py-4 border-t hairline shrink-0 space-y-3 bg-surface-soft/30">
        <div
          className="relative overflow-hidden rounded-xl p-3.5 border border-[rgba(255,180,180,0.18)] shadow-[0_1px_0_rgba(255,255,255,0.32)_inset,0_-1px_0_rgba(0,0,0,0.12)_inset]"
          style={{ background: 'linear-gradient(180deg, #e85555 0%, #c52828 50%, #9a1414 100%)' }}
        >
          <div className="absolute top-0 left-0 right-0 h-1/2 pointer-events-none rounded-t-xl"
               style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.22), transparent)' }}/>
          <div className="relative space-y-2.5">
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface-strong/20 backdrop-blur text-white text-[10px] font-semibold uppercase tracking-wider border border-white/25">
              <Icon name="store" size={11}/> เงินที่ร้านได้รับ
            </div>
            {deferNet ? (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 h-10 px-3 rounded-xl bg-surface-strong/15 border border-white/20 text-white/90 text-xs flex-1">
                  <Icon name="bell" size={14}/> จะกรอกยอดจริงภายหลังผ่านปุ่มกระดิ่ง
                </div>
                <DeferNetButton
                  active={deferNet}
                  disabled={saving}
                  onToggle={() => {
                    setDeferNet(v => {
                      const next = !v;
                      if (next) setNet('');
                      return next;
                    });
                  }}
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <input
                    type="number"
                    inputMode="decimal"
                    className="input !h-10 !rounded-xl !py-2 !text-sm w-full tabular-nums"
                    placeholder="ยอดที่ TikTok โอนเข้าร้าน (บาท)"
                    value={net}
                    onChange={e => { setNet(e.target.value); setDeferNet(false); }}
                    disabled={saving}
                  />
                </div>
                <DeferNetButton
                  active={deferNet}
                  disabled={saving}
                  onToggle={() => {
                    setDeferNet(v => {
                      const next = !v;
                      if (next) setNet('');
                      return next;
                    });
                  }}
                />
              </div>
            )}
            <div className="text-[11px] text-white/70 mt-1.5">ใช้คำนวณกำไร · ไม่แสดงในใบเสร็จลูกค้า</div>
          </div>
        </div>

        {!allMatched && (
          <div className="text-sm text-[#8a6500] flex items-center gap-2 px-1">
            <Icon name="alert" size={16}/> ต้องจับคู่สินค้าให้ครบทุกรายการก่อนยืนยัน
          </div>
        )}

        {allMatched && !netOk && (
          <div className="text-sm text-[#8a6500] flex items-center gap-2 px-1">
            <Icon name="alert" size={16}/> กรอกเงินที่ร้านได้รับ หรือกด ใส่ทีหลัง
          </div>
        )}

        <button
          className="btn-primary w-full !py-3.5 !text-base inline-flex items-center justify-center gap-2"
          onClick={onConfirm}
          disabled={saving || !allMatched || !netOk}
        >
          {saving ? <span className="spinner"/> : <Icon name="check" size={18}/>}
          ยืนยันการขาย · ตัดสต็อก
        </button>
      </div>
    </div>
  );
}

export default function TikTokConfirmPanel({ toast, size = 50, onConfirmed }) {
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState(null);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(null);  // selected order id
  const [picks, setPicks] = useState({});          // { item_id: {id, name} }
  const [net, setNet] = useState('');
  const [deferNet, setDeferNet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const syncProgress = useSimulatedSyncProgress();
  const [closing, setClosing] = useState(false);
  const [sortOrder, setSortOrder] = useState(SORT_OLDEST);

  const loadCatalog = useCallback(async ({ force = false, quiet = false } = {}) => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const prods = await getProductCatalog(sb, { force });
      if (prods.error) {
        const msg = mapError(prods.error);
        setCatalogError(msg);
        if (!quiet) toast?.('โหลด catalog สินค้าไม่สำเร็จ: ' + msg, 'error');
        return [];
      }
      if (prods.data?.length) {
        setProducts(prods.data);
        setCatalogError(null);
      } else {
        setCatalogError('ไม่พบสินค้าในระบบ');
      }
      return prods.data || [];
    } catch (e) {
      const msg = mapError(e);
      setCatalogError(msg);
      if (!quiet) toast?.('โหลด catalog สินค้าไม่สำเร็จ: ' + msg, 'error');
      return [];
    } finally {
      setCatalogLoading(false);
    }
  }, [toast]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const [pending, prods] = await Promise.all([
        sb.rpc('get_pending_tiktok_orders', { p_limit: 200 }),
        getProductCatalog(sb),
      ]);
      if (pending.error) throw pending.error;
      const list = Array.isArray(pending.data) ? pending.data : [];
      setOrders(list);
      if (prods.error) {
        setCatalogError(mapError(prods.error));
      } else if (prods.data?.length) {
        setProducts(prods.data);
        setCatalogError(null);
      }
      return list;
    } catch (e) {
      toast?.('โหลดออเดอร์ TikTok รอยืนยันไม่ได้: ' + mapError(e), 'error');
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [toast]);

  const stopProgressTimer = syncProgress.stop;
  const startProgressTimer = syncProgress.start;

  /** Same as E-Commerce → TikTok Shop → อัปเดตข้อมูล TikTok */
  const syncFromTikTok = useCallback(async () => {
    const beforeCount = orders.length;
    setRefreshing(true);
    startProgressTimer();
    try {
      const data = await pollTikTokOrders({ resync: true, hours: 720 });
      let list = null;
      await syncProgress.finish(async () => {
        list = await load({ quiet: true });
      });
      const afterCount = list?.length ?? beforeCount;
      const { message, level } = formatPollToast(data, { beforeCount, afterCount });
      toast?.(message, level);
      window.dispatchEvent(new Event('tiktok-pending-changed'));
    } catch (e) {
      stopProgressTimer();
      toast?.('อัปเดตไม่สำเร็จ: ' + mapError(e), 'error');
    } finally {
      setRefreshing(false);
      syncProgress.reset();
    }
  }, [load, toast, orders.length, startProgressTimer, stopProgressTimer, syncProgress]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Imports arrive via cron/webhook server-side, so refresh on focus, on a
  // light interval, and whenever the app signals a change.
  useEffect(() => {
    const onChange = () => load();
    window.addEventListener('tiktok-pending-changed', onChange);
    window.addEventListener('focus', onChange);
    const id = setInterval(onChange, 60_000);
    return () => {
      window.removeEventListener('tiktok-pending-changed', onChange);
      window.removeEventListener('focus', onChange);
      clearInterval(id);
    };
  }, [load]);

  const activeOrder = useMemo(
    () => orders.find(o => o.id === activeId) || null,
    [orders, activeId],
  );

  const sortedOrders = useMemo(() => {
    const copy = [...orders];
    copy.sort((a, b) => {
      const ta = new Date(a.sale_date).getTime() || 0;
      const tb = new Date(b.sale_date).getTime() || 0;
      return sortOrder === SORT_OLDEST ? ta - tb : tb - ta;
    });
    return copy;
  }, [orders, sortOrder]);

  const openOrder = (o) => {
    setActiveId(o.id);
    const seed = {};
    (o.items || []).forEach(it => {
      if (it.product_id) seed[it.id] = { id: it.product_id, name: it.product_name || it.sku_name || '' };
    });
    setPicks(seed);
    setNet('');
    setDeferNet(false);
    if (!products.length) loadCatalog({ quiet: true });
  };

  const backToList = () => { setActiveId(null); setPicks({}); setNet(''); setDeferNet(false); };

  // Animate out, then unmount — same timing/classes as PendingNetBell.
  const closeAll = () => {
    if (saving || closing) return;
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      backToList();
      setClosing(false);
    }, 240);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (activeId && !saving) backToList();
        else closeAll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, activeId, saving]); // eslint-disable-line react-hooks/exhaustive-deps

  const allMatched = activeOrder
    ? (activeOrder.items || []).every(it => picks[it.id]?.id)
    : false;

  const netOk = deferNet || (net !== '' && Number(net) > 0);

  const confirm = async () => {
    if (!activeOrder || !allMatched || !netOk) return;
    const value = deferNet ? null : Number(net);
    if (!deferNet && !(value > 0)) { toast?.('กรอกเงินที่ร้านได้รับให้ถูกต้อง', 'error'); return; }
    const confirmedId = activeOrder.id;
    const confirmedTid = activeOrder.tiktok_order_id;
    setSaving(true);
    let ok = false;
    try {
      const p_items = (activeOrder.items || []).map(it => ({
        item_id: it.id,
        product_id: picks[it.id]?.id ?? null,
      }));
      const { error } = await sb.rpc('confirm_tiktok_sale_order', {
        p_order_id: confirmedId,
        p_items,
        p_net_received: value,
      });
      if (error) throw error;
      ok = true;
      toast?.(`ยืนยันออเดอร์ TikTok #${confirmedTid} แล้ว`, 'success');
      window.dispatchEvent(new Event('tiktok-pending-changed'));
      window.dispatchEvent(new Event('pending-net-changed'));
    } catch (e) {
      toast?.('ยืนยันไม่สำเร็จ: ' + mapError(e), 'error');
    } finally {
      setSaving(false);
    }
    if (ok) {
      // Pop the receipt right away, same as a manual sale. confirm_tiktok_sale_order
      // issues a tax-invoice number, so ReceiptModal opens as ใบกำกับภาษีอย่างย่อ.
      // Close the panel first so the receipt modal (z-100) isn't hidden behind
      // this one (z-130); the pending list refreshes in the background.
      onConfirmed?.(confirmedId);
      closeAll();
      load();
    }
  };

  const count = orders.length;
  if (count === 0) return null;

  const badge = (
    <div className="pending-bell">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Order TikTok รอยืนยัน ${count} รายการ`}
        className="ttc-pending-badge font-display"
      >
        <span className="ttc-pending-badge__count">
          <span className="ttc-pending-badge__count-num">{count > 99 ? '99+' : count}</span>
        </span>
        <span className="ttc-pending-badge__label">Order TikTok รอยืนยัน</span>
      </button>
    </div>
  );

  return (
    <>
      {badge}

      {open && createPortal(
        <div className="fixed inset-0 z-[130] flex items-start justify-center pt-[9vh] px-4" onClick={closeAll}>
          <div className={`absolute inset-0 modal-overlay ${closing ? 'holo-backdrop-out' : 'holo-backdrop-in'}`} />
          <div
            className={`ttc-modal-card relative w-full max-w-3xl glass-strong rounded-3xl border hairline overflow-hidden ${closing ? 'holo-card-out' : 'holo-card-in'}`}
            onClick={e => e.stopPropagation()}
          >
            {/* header */}
            <div className="ttc-modal-header ttc-brown-frame relative flex items-center gap-2.5 px-4 py-2.5 border-b border-white/15">
              {activeOrder ? (
                <button className="pnb-iconbtn -ml-1" onClick={backToList} aria-label="ย้อนกลับ" disabled={saving}>
                  <Icon name="chevron-l" size={20} />
                </button>
              ) : (
                <span className="pnb-bell-chip" style={{ background: '#fe2c55', color: '#fff' }}>
                  <Icon name="cart" size={15} />
                </span>
              )}
              <div className="min-w-0 flex-1 ttc-modal-header__text">
                <div className="ttc-modal-header__title font-semibold text-[15px] sm:text-[16px] leading-tight truncate">
                  {activeOrder ? 'ยืนยันการขาย TikTok' : 'Order TikTok รอยืนยัน'}
                </div>
                <div className="ttc-modal-header__sub text-[11px] sm:text-[12px] mt-0.5 tabular-nums truncate">
                  {activeOrder
                    ? `${fmtTime(activeOrder.sale_date)} · ${fmtTHB(activeOrder.grand_total)}`
                    : `${count} ออเดอร์รอจับคู่ + กรอกเงินที่ร้านได้รับ`}
                </div>
              </div>
              {!activeOrder && (
                <button
                  className="pnb-iconbtn mr-1"
                  onClick={syncFromTikTok}
                  aria-label="อัปเดตข้อมูลจาก TikTok"
                  title="อัปเดตข้อมูล TikTok (เหมือนหน้า TikTok Shop)"
                  disabled={refreshing}
                >
                  {refreshing
                    ? <span className="ttc-modal-header__sub text-[11px] font-semibold tabular-nums min-w-[2ch]">{syncProgress.pct}%</span>
                    : <Icon name="refresh" size={16} />}
                </button>
              )}
              <button className="pnb-iconbtn" onClick={closeAll} aria-label="ปิด" disabled={saving || closing}>
                <Icon name="x" size={18} />
              </button>
            </div>

            {/* body */}
            {!activeOrder ? (
              <div className="relative">
                {refreshing && (
                  <TikTokSyncOverlay
                    pct={syncProgress.pct}
                    phase={refreshing ? 'in' : 'out'}
                    className="rounded-b-3xl"
                  />
                )}
                <div className={'flex items-center justify-between gap-3 px-3 sm:px-4 py-2.5 border-b hairline bg-surface-soft/40 ' + (refreshing ? 'pointer-events-none select-none' : '')}>
                  <span className="text-xs text-muted tabular-nums">{sortedOrders.length} รายการ</span>
                  <label className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-soft hidden sm:inline">เรียง</span>
                    <select
                      className="input !h-9 !rounded-lg !py-0 !px-3 !text-xs !w-auto"
                      value={sortOrder}
                      onChange={e => setSortOrder(e.target.value)}
                      aria-label="เรียงลำดับออเดอร์"
                      disabled={refreshing}
                    >
                      <option value={SORT_OLDEST}>เก่าไปใหม่</option>
                      <option value={SORT_NEWEST}>ใหม่ไปเก่า</option>
                    </select>
                  </label>
                </div>
                <div className={'relative max-h-[68vh] overflow-y-auto p-3 sm:p-4 space-y-3 ' + (refreshing ? 'pointer-events-none select-none' : '')}>
                  {sortedOrders.map(o => (
                    <OrderListRow key={o.id} order={o} onOpen={openOrder}/>
                  ))}
                </div>
              </div>
            ) : (
              <OrderConfirmView
                order={activeOrder}
                picks={picks}
                setPicks={setPicks}
                net={net}
                setNet={setNet}
                deferNet={deferNet}
                setDeferNet={setDeferNet}
                saving={saving}
                allMatched={allMatched}
                netOk={netOk}
                onConfirm={confirm}
                catalog={products}
                catalogLoading={catalogLoading}
                catalogError={catalogError}
                onRetryCatalog={() => loadCatalog({ force: true })}
              />
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
