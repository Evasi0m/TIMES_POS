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
import { fetchAll } from '../../lib/sb-paginate.js';
import { mapError } from '../../lib/error-map.js';
import { classifySkuMatch } from '../../lib/fuzzy-match.js';
import { pollTikTokOrders, formatPollToast } from '../../lib/tiktok-poll-sync.js';
import { useSimulatedSyncProgress } from '../../lib/use-simulated-sync-progress.js';
import TikTokSyncOverlay from '../ui/TikTokSyncOverlay.jsx';
import Icon from '../ui/Icon.jsx';
import ExpandableImageThumb from '../ui/ExpandableImageThumb.jsx';

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

function ProductPicker({ onPick, disabled }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const search = async (term) => {
    setQ(term);
    if (term.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const { data: byCode } = await sb.from('products')
        .select('id, name, barcode').eq('barcode', term.trim()).limit(5);
      const { data: byName } = await sb.from('products')
        .select('id, name, barcode').ilike('name', `%${term.trim()}%`).limit(20);
      const merged = [...(byCode || []), ...(byName || [])];
      const seen = new Set();
      setResults(merged.filter(p => !seen.has(p.id) && seen.add(p.id)));
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={q}
        disabled={disabled}
        onChange={e => search(e.target.value)}
        placeholder="ค้นชื่อ / บาร์โค้ด สินค้า POS"
        className="input !h-11 !rounded-xl !py-2.5 !text-sm w-full"
      />
      {searching && <span className="spinner absolute right-3 top-3"/>}
      {results.length > 0 && (
        <div className="absolute z-30 mt-1.5 w-full max-h-60 overflow-y-auto card-canvas rounded-xl border hairline shadow-lg">
          {results.map(p => (
            <button
              key={p.id}
              type="button"
              className="block w-full text-left px-3.5 py-2.5 text-sm hover:bg-primary/5 border-b hairline last:border-0"
              onClick={() => { onPick(p); setQ(''); setResults([]); }}
            >
              <div className="font-medium truncate">{p.name}</div>
              {p.barcode && <div className="text-muted-soft font-mono text-xs mt-0.5">{p.barcode}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One line item in the confirm view — card layout matching the list rows. */
function ConfirmItemCard({ item, pick, suggestion, match, onPick, onClear, disabled }) {
  const skuName = item.sku_name || item.product_name || '—';
  return (
    <div className="rounded-2xl border hairline bg-surface-strong/60 p-4 space-y-4">
      <div className="flex items-start gap-4">
        <SkuThumb url={item.sku_image_url}/>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-baseline gap-2 min-w-0 flex-wrap">
            <span className="text-[17px] font-semibold text-ink leading-snug">{skuName}</span>
            <span className="text-muted-soft font-medium">|</span>
            <span className="text-[15px] font-medium text-muted tabular-nums">×{item.quantity}</span>
          </div>
          {item.seller_sku && (
            <div className="text-[14px] text-muted font-mono">{item.seller_sku}</div>
          )}
          <div className="text-[14px] tabular-nums text-muted">
            ราคาต่อชิ้น <span className="font-semibold text-ink">{fmtTHB(item.unit_price)}</span>
          </div>
        </div>
      </div>

      <div className="glass-soft !bg-surface-strong/75 ring-1 ring-hairline shadow-sm rounded-xl p-3.5 space-y-3">
        <SectionPill icon="link">จับคู่กับสินค้า POS</SectionPill>

        {pick ? (
          <div className="flex items-center gap-3 rounded-xl border border-[#0a7a43]/30 bg-[#e6f7ed] px-3.5 py-3">
            <Icon name="check" size={18} className="text-[#0a7a43] shrink-0"/>
            <div className="min-w-0 flex-1 text-[15px] font-medium text-[#0a5a32] leading-snug">{pick.name}</div>
            {!disabled && (
              <button type="button" className="btn-secondary !py-1.5 !px-3 !text-xs shrink-0" onClick={onClear}>
                เปลี่ยน
              </button>
            )}
          </div>
        ) : (
          <>
            {suggestion && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border hairline bg-surface-soft px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-medium leading-snug">{suggestion.product.name}</div>
                  <div className="mt-1.5">
                    <span className={
                      'text-[11px] px-2 py-0.5 rounded-md font-semibold ' +
                      (match.status === 'auto' ? 'bg-[#e6f7ed] text-[#0a7a43]' : 'bg-[#fff7e6] text-[#8a6500]')
                    }>
                      {match.status === 'auto' ? 'จับคู่อัตโนมัติได้' : 'ข้อเสนอ'}
                      {' · '}{TIER_LABEL[suggestion.tier] || suggestion.tier}
                      {' '}{Math.round(suggestion.score * 100)}%
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-primary !py-2 !px-4 !text-sm shrink-0"
                  disabled={disabled}
                  onClick={() => onPick(suggestion.product)}
                >
                  ยืนยัน
                </button>
              </div>
            )}
            <ProductPicker onPick={onPick} disabled={disabled}/>
          </>
        )}
      </div>
    </div>
  );
}

/** Order summary + item matching + net received footer. */
function OrderConfirmView({
  order, matchByItem, picks, setPicks, net, setNet, saving, allMatched, onConfirm,
}) {
  const items = order.items || [];
  const matchedCount = items.filter(it => picks[it.id]?.id).length;

  return (
    <div className="flex flex-col max-h-[75vh]">
      {/* Order meta */}
      <div className="px-4 sm:px-5 py-4 border-b hairline shrink-0 space-y-3">
        <div className="text-[14px] text-muted leading-relaxed">
          <span className="text-muted-soft">หมายเลขคำสั่งซื้อ: </span>
          <span className="font-mono text-ink break-all">{order.tiktok_order_id}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-muted">
          <span className="tabular-nums">{fmtTime(order.sale_date)}</span>
          <span className="text-muted-soft">|</span>
          <span className={
            'font-medium ' + (matchedCount === items.length ? 'text-[#0a7a43]' : 'text-[#8a6500]')
          }>
            {matchedCount === items.length ? 'จับคู่ครบแล้ว' : `จับคู่แล้ว ${matchedCount}/${items.length}`}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="glass-soft !bg-surface-strong/75 ring-1 ring-hairline shadow-sm rounded-xl p-3.5">
            <SectionPill icon="receipt">ราคาที่ลูกค้าจ่าย</SectionPill>
            <div className="mt-2 text-2xl font-display tabular-nums text-ink">{fmtTHB(order.grand_total)}</div>
          </div>
          <div className="glass-soft !bg-surface-strong/75 ring-1 ring-hairline shadow-sm rounded-xl p-3.5">
            <SectionPill icon="credit-card">วิธีชำระ (TikTok)</SectionPill>
            <div className="mt-2 text-[16px] font-medium text-ink leading-snug">
              {order.tiktok_payment_method || order.payment_method || '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
        {items.map(it => {
          const match = matchByItem[it.id];
          const suggestion = match?.status === 'auto'
            ? { product: match.product, tier: match.tier, score: match.score }
            : match?.candidates?.[0];
          return (
            <ConfirmItemCard
              key={it.id}
              item={it}
              pick={picks[it.id]}
              suggestion={suggestion}
              match={match}
              disabled={saving}
              onPick={(p) => setPicks(prev => ({ ...prev, [it.id]: { id: p.id, name: p.name } }))}
              onClear={() => setPicks(prev => { const n = { ...prev }; delete n[it.id]; return n; })}
            />
          );
        })}
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
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                className="input !h-11 !rounded-xl !py-2.5 !text-sm flex-1 tabular-nums"
                placeholder="ยอดที่ TikTok โอนเข้าร้าน (บาท)"
                value={net}
                onChange={e => setNet(e.target.value)}
                disabled={saving}
              />
              <button
                type="button"
                className="btn-secondary !h-11 !px-3 !text-xs whitespace-nowrap shrink-0"
                onClick={() => setNet(String(order.grand_total))}
                disabled={saving}
              >
                = ยอดลูกค้า
              </button>
            </div>
            <div className="text-[11px] text-white/75">ใช้คำนวณกำไร · ไม่แสดงในใบเสร็จลูกค้า</div>
          </div>
        </div>

        {!allMatched && (
          <div className="text-sm text-[#8a6500] flex items-center gap-2 px-1">
            <Icon name="alert" size={16}/> ต้องจับคู่สินค้าให้ครบทุกรายการก่อนยืนยัน
          </div>
        )}

        <button
          className="btn-primary w-full !py-3.5 !text-base inline-flex items-center justify-center gap-2"
          onClick={onConfirm}
          disabled={saving || !allMatched}
        >
          {saving ? <span className="spinner"/> : <Icon name="check" size={18}/>}
          ยืนยันการขาย · ตัดสต็อก
        </button>
      </div>
    </div>
  );
}

export default function TikTokConfirmPanel({ toast, size = 50 }) {
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(null);  // selected order id
  const [picks, setPicks] = useState({});          // { item_id: {id, name} }
  const [net, setNet] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const syncProgress = useSimulatedSyncProgress();
  const [closing, setClosing] = useState(false);
  const [sortOrder, setSortOrder] = useState(SORT_OLDEST);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const [pending, prods] = await Promise.all([
        sb.rpc('get_pending_tiktok_orders', { p_limit: 200 }),
        products.length
          ? Promise.resolve({ data: products })
          : fetchAll((from, to) => sb.from('products').select('id, name, model_code, barcode').range(from, to)),
      ]);
      if (pending.error) throw pending.error;
      const list = Array.isArray(pending.data) ? pending.data : [];
      setOrders(list);
      if (!products.length && prods.data) setProducts(prods.data);
      return list;
    } catch (e) {
      toast?.('โหลดออเดอร์ TikTok รอยืนยันไม่ได้: ' + mapError(e), 'error');
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [toast, products]);

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

  // Per-item SKU classification for the active order's unmatched lines.
  const matchByItem = useMemo(() => {
    if (!activeOrder || !products.length) return {};
    const out = {};
    for (const it of (activeOrder.items || [])) {
      const sku = it.seller_sku || it.sku_name || '';
      out[it.id] = sku ? classifySkuMatch(sku, products) : { status: 'none', candidates: [] };
    }
    return out;
  }, [activeOrder, products]);

  const openOrder = (o) => {
    setActiveId(o.id);
    // Seed picks from line items already matched at import.
    const seed = {};
    (o.items || []).forEach(it => {
      if (it.product_id) seed[it.id] = { id: it.product_id, name: it.product_name || it.sku_name || '' };
    });
    setPicks(seed);
    setNet('');
  };

  const backToList = () => { setActiveId(null); setPicks({}); setNet(''); };

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

  const confirm = async () => {
    if (!activeOrder || !allMatched) return;
    const value = net === '' ? null : Number(net);
    if (net !== '' && !(value >= 0)) { toast?.('กรอกเงินที่ร้านได้รับให้ถูกต้อง', 'error'); return; }
    setSaving(true);
    try {
      const p_items = (activeOrder.items || []).map(it => ({
        item_id: it.id,
        product_id: picks[it.id]?.id ?? null,
      }));
      const { error } = await sb.rpc('confirm_tiktok_sale_order', {
        p_order_id: activeOrder.id,
        p_items,
        p_net_received: value,
      });
      if (error) throw error;
      toast?.(`ยืนยันออเดอร์ TikTok #${activeOrder.tiktok_order_id} แล้ว`, 'success');
      window.dispatchEvent(new Event('tiktok-pending-changed'));
      window.dispatchEvent(new Event('pending-net-changed'));
      backToList();
      await load();
    } catch (e) {
      toast?.('ยืนยันไม่สำเร็จ: ' + mapError(e), 'error');
    } finally {
      setSaving(false);
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
            className={`relative w-full max-w-3xl glass-strong rounded-3xl border hairline overflow-hidden ${closing ? 'holo-card-out' : 'holo-card-in'}`}
            onClick={e => e.stopPropagation()}
          >
            {/* header */}
            <div className="relative flex items-center gap-2.5 px-4 py-3.5 border-b hairline">
              {activeOrder ? (
                <button className="pnb-iconbtn -ml-1" onClick={backToList} aria-label="ย้อนกลับ" disabled={saving}>
                  <Icon name="chevron-l" size={20} />
                </button>
              ) : (
                <span className="pnb-bell-chip" style={{ background: '#fe2c55', color: '#fff' }}>
                  <Icon name="cart" size={15} />
                </span>
              )}
              <div className="min-w-0">
                <div className="font-semibold text-[16px] sm:text-[17px] leading-tight truncate">
                  {activeOrder ? 'ยืนยันการขาย TikTok' : 'Order TikTok รอยืนยัน'}
                </div>
                <div className="text-[12px] sm:text-[13px] text-muted-soft mt-0.5 tabular-nums truncate">
                  {activeOrder
                    ? `${fmtTime(activeOrder.sale_date)} · ${fmtTHB(activeOrder.grand_total)}`
                    : `${count} ออเดอร์รอจับคู่ + กรอกเงินที่ร้านได้รับ`}
                </div>
              </div>
              {!activeOrder && (
                <button
                  className="pnb-iconbtn ml-auto mr-1"
                  onClick={syncFromTikTok}
                  aria-label="อัปเดตข้อมูลจาก TikTok"
                  title="อัปเดตข้อมูล TikTok (เหมือนหน้า TikTok Shop)"
                  disabled={refreshing}
                >
                  {refreshing
                    ? <span className="text-[11px] font-semibold tabular-nums min-w-[2ch] text-primary">{syncProgress.pct}%</span>
                    : <Icon name="refresh" size={16} />}
                </button>
              )}
              <button className={'pnb-iconbtn ' + (activeOrder ? 'ml-auto' : '')} onClick={closeAll} aria-label="ปิด" disabled={saving || closing}>
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
                matchByItem={matchByItem}
                picks={picks}
                setPicks={setPicks}
                net={net}
                setNet={setNet}
                saving={saving}
                allMatched={allMatched}
                onConfirm={confirm}
              />
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
