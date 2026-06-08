// TikTok Shop — orders, SKU images, shipping labels, tax invoices.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sb } from '../../lib/supabase-client.js';
import { fetchAll } from '../../lib/sb-paginate.js';
import { mapError } from '../../lib/error-map.js';
import { fmtTHB, fmtThaiDateShort } from '../../lib/format.js';
import { fullBuyerValid } from '../../lib/tax-buyer.js';
import { formatPollToast } from '../../lib/tiktok-poll-sync.js';
import { TIKTOK_LIVE_POLL_MS, useTikTokLiveSync } from '../../lib/use-tiktok-live-sync.js';
import { useSimulatedSyncProgress } from '../../lib/use-simulated-sync-progress.js';
import Icon from '../ui/Icon.jsx';
import ExpandableImageThumb from '../ui/ExpandableImageThumb.jsx';
import TikTokSettings from '../settings/TikTokSettings.jsx';
import TikTokInvoiceSection, { buyerReady } from './TikTokInvoiceBulk.jsx';
import TikTokReturns from './TikTokReturns.jsx';
import TikTokMatching from './TikTokMatching.jsx';
import { fetchShippingLabels, printLabelUrl, printMergedLabels } from './TikTokLabelPrint.js';

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
}

const NUMERIC_STATUS = {
  '100': 'UNPAID',
  '111': 'AWAITING_SHIPMENT',
  '112': 'AWAITING_COLLECTION',
  '114': 'PARTIALLY_SHIPPING',
  '121': 'IN_TRANSIT',
  '122': 'DELIVERED',
  '130': 'COMPLETED',
  '140': 'CANCELLED',
};

/** Normalize DB/API status (handles numeric codes like "111"). */
function normStatus(st) {
  if (!st) return '';
  const s = String(st).trim();
  return NUMERIC_STATUS[s] || s.toUpperCase();
}

const STATUS_LABEL = {
  AWAITING_SHIPMENT: 'รอจัดส่ง',
  AWAITING_COLLECTION: 'รอเข้ารับ',
  IN_TRANSIT: 'กำลังส่ง',
  DELIVERED: 'ส่งแล้ว',
  COMPLETED: 'สำเร็จ',
  CANCELLED: 'ยกเลิก',
  UNPAID: 'ยังไม่ชำระ',
  ON_HOLD: 'รอดำเนินการ',
  PARTIALLY_SHIPPING: 'ส่งบางส่วน',
  DELIVERY_FAILED: 'จัดส่งไม่สำเร็จ',
  FAILED_DELIVERY: 'จัดส่งไม่สำเร็จ',
};

const PAYMENT_LABEL = {
  cod: 'เก็บเงินปลายทาง',
  transfer: 'ชำระออนไลน์',
  cash: 'เงินสด',
  card: 'บัตร',
};

/** TikTok Seller Center — 7 แท็บหลัก (ไม่แตก sub-tab) */
const ORDER_TABS = [
  { k: 'all', label: 'ทั้งหมด' },
  { k: 'to_ship', label: 'ที่จะจัดส่ง' },
  { k: 'shipped', label: 'จัดส่งแล้ว' },
  { k: 'completed', label: 'เสร็จสิ้น' },
  { k: 'on_hold', label: 'รอดำเนินการ' },
  { k: 'cancelled', label: 'ยกเลิก' },
  { k: 'delivery_failed', label: 'การจัดส่งไม่สำเร็จ' },
];

/** ยังต้องกด RTS / เตรียมจัดส่ง (ไม่รวม รอเข้ารับ ที่ส่งแล้ว) */
const NEEDS_RTS = new Set(['AWAITING_SHIPMENT', 'PARTIALLY_SHIPPING']);
const SHIPPED = new Set(['IN_TRANSIT', 'DELIVERED']);
const COMPLETED = new Set(['COMPLETED']);
const ON_HOLD = new Set(['ON_HOLD']);
const CANCELLED = new Set(['CANCELLED']);
const DELIVERY_FAILED = new Set([
  'DELIVERY_FAILED', 'FAILED_DELIVERY', 'UNABLE_TO_DELIVER', 'DELIVERY_FAILURE',
]);

/** ที่จะจัดส่ง = รอจัดส่ง + รอเข้ารับ (+ ส่งบางส่วนที่ยังไม่ครบ) */
const TO_SHIP = new Set(['AWAITING_SHIPMENT', 'AWAITING_COLLECTION', 'PARTIALLY_SHIPPING']);

/** แท็บปฏิบัติการ — นับเฉพาะออเดอร์ที่ยังไม่ void (ตรง TikTok Seller Center) */
function isOperationalOrder(o) {
  return o.status !== 'voided' && (o.status === 'active' || o.status === 'pending');
}

function orderMatchesTab(o, tabKey) {
  const st = normStatus(o.tiktok_order_status);
  if (tabKey === 'all') return true;
  if (tabKey === 'cancelled') return o.status === 'voided' || CANCELLED.has(st);
  if (!isOperationalOrder(o)) return false;
  if (tabKey === 'to_ship') return TO_SHIP.has(st);
  if (tabKey === 'shipped') return SHIPPED.has(st);
  if (tabKey === 'completed') return COMPLETED.has(st);
  if (tabKey === 'on_hold') return ON_HOLD.has(st);
  if (tabKey === 'delivery_failed') return DELIVERY_FAILED.has(st);
  return true;
}

function shippingLabel(o) {
  const t = String(o.tiktok_shipping_type || '').toUpperCase();
  if (t === 'TIKTOK') return 'จัดส่งโดยแพลตฟอร์ม';
  if (t === 'SELLER') return 'จัดส่งเอง';
  if (o.tracking_number) return 'มี tracking';
  return '—';
}

function lineTitle(item) {
  return item.product_name || item.sku_name || '—';
}

function SkuThumb({ url, alt }) {
  return (
    <ExpandableImageThumb
      src={url}
      alt={alt || ''}
      className="w-12 h-12 rounded-lg border hairline bg-surface-soft shrink-0"
      imgClassName="w-full h-full object-cover rounded-lg"
      placeholder={(
        <div className="w-12 h-12 rounded-lg bg-surface-soft border hairline flex items-center justify-center shrink-0 text-muted">
          <Icon name="image" size={18}/>
        </div>
      )}
    />
  );
}

export default function TikTokPanel({ toast, section = 'orders', onSyncChange, isSuperAdmin = false }) {
  const [orders, setOrders] = useState([]);
  const [itemsByOrder, setItemsByOrder] = useState({});
  const [imageByProduct, setImageByProduct] = useState({});
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [labelBusy, setLabelBusy] = useState(null);
  const [shipBusy, setShipBusy] = useState(null);
  const [shipFilter, setShipFilter] = useState('to_ship');
  const [selected, setSelected] = useState(new Set());
  const [singleId, setSingleId] = useState('');
  const [singleBusy, setSingleBusy] = useState(false);
  const syncProgress = useSimulatedSyncProgress();
  const wasSyncingRef = useRef(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      // โหลดออเดอร์ TikTok ทั้งหมดใน DB — กรองวันที่ทำฝั่ง client ตามแท็บ
      const { data: orderRows } = await fetchAll((fromIdx, toIdx) =>
        sb.from('sale_orders')
          .select('*')
          .eq('channel', 'tiktok')
          .not('tiktok_order_id', 'is', null)
          .order('sale_date', { ascending: false })
          .range(fromIdx, toIdx),
      );
      const list = orderRows || [];
      setOrders(list);
      setSelected(new Set());

      if (list.length) {
        const ids = list.map(o => o.id);
        const { data: items } = await fetchAll((fromIdx, toIdx) =>
          sb.from('sale_order_items')
            .select('*')
            .in('sale_order_id', ids)
            .range(fromIdx, toIdx),
        );
        const map = {};
        (items || []).forEach(it => {
          (map[it.sale_order_id] ||= []).push(it);
        });
        setItemsByOrder(map);

        // Fallback images: for matched products, pull product_images.
        const productIds = [...new Set((items || [])
          .map(it => it.product_id).filter(Boolean))];
        if (productIds.length) {
          const { data: imgs } = await sb.from('product_images')
            .select('product_id, image_url')
            .in('product_id', productIds)
            .not('image_url', 'is', null);
          const imgMap = {};
          (imgs || []).forEach(r => { if (r.image_url) imgMap[r.product_id] = r.image_url; });
          setImageByProduct(imgMap);
        } else {
          setImageByProduct({});
        }
      } else {
        setItemsByOrder({});
        setImageByProduct({});
      }
      return list;
    } catch (e) {
      toast?.push('โหลดข้อมูล TikTok ไม่ได้: ' + mapError(e), 'error');
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [toast]);

  const reloadQuiet = useCallback(() => load({ quiet: true }), [load]);

  const { pullFromTikTok, pullBusy } = useTikTokLiveSync({
    enabled: section === 'orders',
    onReload: reloadQuiet,
    onPulled: () => setLastSyncedAt(new Date()),
  });

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (syncing) {
      wasSyncingRef.current = true;
      onSyncChange?.({ syncing: true, pct: syncProgress.pct });
      return;
    }
    if (wasSyncingRef.current) {
      wasSyncingRef.current = false;
      onSyncChange?.({ syncing: false, pct: syncProgress.pct });
    }
  }, [syncing, syncProgress.pct, onSyncChange]);

  const tabCounts = useMemo(() => {
    const counts = {};
    for (const t of ORDER_TABS) {
      counts[t.k] = orders.filter(o => orderMatchesTab(o, t.k)).length;
    }
    return counts;
  }, [orders]);

  const filteredOrders = useMemo(
    () => orders.filter(o => orderMatchesTab(o, shipFilter)),
    [orders, shipFilter],
  );

  const stats = useMemo(() => ({
    total: orders.length,
    awaitingShip: tabCounts.to_ship ?? 0,
    shipped: tabCounts.shipped ?? 0,
    pendingTax: orders.filter(o =>
      o.status !== 'voided'
      && !fullBuyerValid({ name: o.buyer_name, address: o.buyer_address, taxId: o.buyer_tax_id }),
    ).length,
    voided: tabCounts.cancelled ?? 0,
  }), [orders, tabCounts]);

  const syncOrders = async () => {
    if (syncing) return;
    const beforeCount = orders.length;
    const queued = pullBusy;
    setSyncing(true);
    syncProgress.start();
    if (queued) {
      toast?.push('กำลังซิงค์จาก TikTok อยู่แล้ว — จะอัปเดตต่อในคิวถัดไป…', 'info');
    }
    try {
      const data = await pullFromTikTok({ queue: true });
      let list = null;
      await syncProgress.finish(async () => {
        list = await load({ quiet: true });
      });
      setLastSyncedAt(new Date());
      const afterCount = list?.length ?? beforeCount;
      const { message, level } = formatPollToast(data, { beforeCount, afterCount });
      toast?.push(message, level);
    } catch (e) {
      syncProgress.stop();
      toast?.push('อัปเดตไม่สำเร็จ: ' + mapError(e), 'error');
    } finally {
      setSyncing(false);
      setTimeout(() => syncProgress.reset(), 360);
    }
  };

  const syncSingle = async () => {
    const id = singleId.trim();
    if (!id) { toast?.push('กรอก TikTok Order ID ก่อน', 'info'); return; }
    setSingleBusy(true);
    try {
      const { data, error } = await sb.functions.invoke('tiktok-poll-orders', {
        body: { order_id: id },
      });
      if (error) {
        let msg = error.message || 'sync failed';
        try { const ctx = await error.context?.json?.(); if (ctx?.error) msg = ctx.error; } catch { /* ignore */ }
        throw new Error(msg);
      }
      if (data?.ok === false) throw new Error(data.error || 'sync failed');
      const action = data?.result?.action || 'done';
      toast?.push(`ดึงออเดอร์ ${id} แล้ว (${action})`, 'success');
      setSingleId('');
      await load();
    } catch (e) {
      toast?.push('ดึงออเดอร์รายตัวไม่ได้: ' + mapError(e), 'error');
    } finally {
      setSingleBusy(false);
    }
  };

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    const ids = filteredOrders.filter(o => o.status === 'active').map(o => o.id);
    setSelected(new Set(ids));
  };

  const shipPackages = async (orderIds) => {
    if (!orderIds.length) { toast?.push('เลือกออเดอร์ก่อน', 'info'); return; }
    setShipBusy(orderIds.length > 1 ? 'bulk' : orderIds[0]);
    try {
      const { data, error } = await sb.functions.invoke('tiktok-ship-package', {
        body: { sale_order_ids: orderIds },
      });
      if (error) {
        let msg = error.message || 'ship failed';
        try { const ctx = await error.context?.json?.(); if (ctx?.error) msg = ctx.error; } catch { /* ignore */ }
        throw new Error(msg);
      }
      if (data?.ok === false) throw new Error(data.error || 'ship failed');
      const shipped = Number(data?.shipped ?? 0);
      const failed = Number(data?.failed ?? 0);
      toast?.push(
        `เตรียมจัดส่ง ${shipped} ออเดอร์` + (failed ? ` · ล้มเหลว ${failed}` : ''),
        shipped > 0 ? 'success' : 'info',
      );
      await load();
    } catch (e) {
      toast?.push('เตรียมจัดส่งไม่ได้: ' + mapError(e), 'error');
    } finally {
      setShipBusy(null);
    }
  };

  const printLabels = async (orderIds, docType = 'SHIPPING_LABEL') => {
    if (!orderIds.length) {
      toast?.push('เลือกออเดอร์ก่อน', 'info');
      return;
    }
    setLabelBusy('bulk');
    try {
      const labels = await fetchShippingLabels(orderIds, docType);
      const ok = labels.filter(l => l.doc_url);
      const failed = labels.filter(l => l.error);
      if (!ok.length) {
        throw new Error(failed[0]?.error || 'ไม่มี label ที่ดึงได้');
      }
      if (ok.length === 1) {
        printLabelUrl(ok[0].doc_url);
      } else {
        await printMergedLabels(ok.map(l => l.doc_url));
      }
      if (failed.length) {
        toast?.push(`พิมพ์ ${ok.length} ใบ · ข้าม ${failed.length} ใบ`, 'info');
      } else {
        toast?.push(`พิมพ์ label ${ok.length} ใบ`, 'success');
      }
    } catch (e) {
      toast?.push('ปริ้น label ไม่ได้: ' + mapError(e), 'error');
    } finally {
      setLabelBusy(null);
    }
  };

  const printOneLabel = async (orderId, docType = 'SHIPPING_LABEL') => {
    setLabelBusy(orderId);
    try {
      const labels = await fetchShippingLabels([orderId], docType);
      const label = labels[0];
      if (label?.error) throw new Error(label.error);
      if (!label?.doc_url) throw new Error('ไม่ได้รับ doc_url');
      printLabelUrl(label.doc_url);
      toast?.push('เปิด label แล้ว — กดพิมพ์ใน PDF viewer', 'success');
    } catch (e) {
      toast?.push('ปริ้น label ไม่ได้: ' + mapError(e), 'error');
    } finally {
      setLabelBusy(null);
    }
  };

  const selectedIds = [...selected];
  const activeFiltered = filteredOrders.filter(o => o.status === 'active');

  const statCards = [
    { label: 'ออเดอร์ทั้งหมด', value: stats.total, icon: 'receipt' },
    { label: 'ที่จะจัดส่ง', value: stats.awaitingShip, icon: 'truck', warn: stats.awaitingShip > 0 },
    { label: 'จัดส่งแล้ว', value: stats.shipped, icon: 'package' },
    { label: 'รอ Tax ID', value: stats.pendingTax, icon: 'tag', warn: stats.pendingTax > 0 },
  ];

  const liveLabel = lastSyncedAt
    ? lastSyncedAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <div className="space-y-6 fade-in">
      {section === 'orders' && (
        <div className="space-y-3">
          <TikTokSettings toast={toast} compact />
          <p className="text-[11px] text-muted-soft leading-snug px-0.5 pb-0.5">
            ซิงค์อัตโนมัติจาก TikTok ทุก {TIKTOK_LIVE_POLL_MS / 1000} วินาทีขณะเปิดหน้านี้
            {liveLabel && <> · อัปเดตล่าสุด {liveLabel}</>}
            {' · '}
            <span className="inline-flex items-center gap-1">
              <span className={'w-1.5 h-1.5 rounded-full ' + (pullBusy ? 'bg-amber-500 animate-pulse' : 'bg-[#0a7a43] animate-pulse')}/>
              {pullBusy ? 'กำลังซิงค์…' : 'Live'}
            </span>
          </p>
        </div>
      )}

      {section !== 'orders' && (
        <TikTokSettings toast={toast} />
      )}

      {section === 'orders' && (
      <div className="rounded-xl border hairline overflow-hidden bg-surface-strong/30">
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 hairline border-b hairline bg-surface-soft/50">
          {statCards.map(s => (
            <div key={s.label} className="px-4 py-4">
              <div className="flex items-center gap-1.5 text-[11px] text-muted mb-1">
                <Icon name={s.icon} size={13}/>
                <span className="leading-tight">{s.label}</span>
              </div>
              <div className={'font-display text-2xl tabular-nums leading-none ' + (s.warn ? 'text-error' : 'text-ink')}>
                {s.value}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x hairline">
          <div className="p-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-3">
              ซิงค์ &amp; ดึงข้อมูล
            </h3>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary !py-1.5 !text-xs" onClick={load} disabled={loading || syncing || pullBusy}>
                {loading && !syncing ? <span className="spinner"/> : <Icon name="refresh" size={14}/>}
                รีเฟรช
              </button>
              <button type="button" className="btn-primary !py-1.5 !text-xs" onClick={syncOrders} disabled={syncing}>
                {syncing
                  ? <span className="text-[11px] font-semibold tabular-nums min-w-[2ch]">{syncProgress.pct}%</span>
                  : pullBusy
                    ? <span className="spinner"/>
                    : <Icon name="refresh" size={14}/>}
                อัปเดตข้อมูล TikTok
              </button>
            </div>
            <div className="flex flex-wrap items-stretch gap-2 mt-3 pt-3 border-t hairline">
              <input
                type="text"
                value={singleId}
                onChange={e => setSingleId(e.target.value)}
                placeholder="TikTok Order ID (ดึงรายตัว)"
                className="input !h-9 !min-h-9 !rounded-lg !py-0 !px-3 !text-xs flex-1 min-w-[10rem]"
                onKeyDown={e => { if (e.key === 'Enter') syncSingle(); }}
              />
              <button type="button" className="btn-secondary !h-9 !min-h-9 !py-0 !px-3 !text-xs shrink-0" onClick={syncSingle} disabled={singleBusy}>
                {singleBusy ? <span className="spinner"/> : <Icon name="download" size={14}/>}
                ดึงรายตัว
              </button>
            </div>
          </div>

          <div className="p-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted mb-3">
              จัดส่ง &amp; Label
            </h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary !py-1.5 !text-xs"
                disabled={labelBusy === 'bulk'}
                onClick={() => printLabels(selectedIds.length ? selectedIds : activeFiltered.map(o => o.id))}
              >
                {labelBusy === 'bulk' ? <span className="spinner"/> : <Icon name="printer" size={14}/>}
                {selectedIds.length ? `ปริ้น label (${selectedIds.length})` : 'ปริ้น label ทั้งหมด'}
              </button>
              <button
                type="button"
                className="btn-secondary !py-1.5 !text-xs"
                disabled={shipBusy === 'bulk' || !selectedIds.length}
                onClick={() => shipPackages(selectedIds)}
              >
                {shipBusy === 'bulk' ? <span className="spinner"/> : <Icon name="truck" size={14}/>}
                เตรียมจัดส่ง{selectedIds.length ? ` (${selectedIds.length})` : ''}
              </button>
            </div>
            <p className="text-[11px] text-muted mt-3 leading-snug">
              {selectedIds.length > 0
                ? `เลือกแล้ว ${selectedIds.length} ออเดอร์ — ใช้ปุ่มด้านบนหรือเลือกจากรายการด้านล่าง`
                : 'เลือกออเดอร์จากรายการด้านล่างก่อนเตรียมจัดส่ง · ปริ้น label ได้ทั้งหมดหรือเฉพาะที่เลือก'}
            </p>
          </div>
        </div>
      </div>
      )}

      {section === 'invoices' && (
        <TikTokInvoiceSection
          orders={orders}
          itemsByOrder={itemsByOrder}
          toast={toast}
          onOrdersChange={setOrders}
        />
      )}

      {section === 'returns' && (
        <TikTokReturns toast={toast} />
      )}

      {section === 'matching' && isSuperAdmin && (
        <TikTokMatching toast={toast} />
      )}

      {section === 'orders' && (
        <>
          {/* Status tabs — 7 แท็บตาม TikTok Seller Center */}
          <div className="flex items-center gap-0.5 border-b hairline pb-0 overflow-x-auto">
            {ORDER_TABS.map(f => (
              <button
                key={f.k}
                type="button"
                onClick={() => setShipFilter(f.k)}
                className={'px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition whitespace-nowrap shrink-0 ' +
                  (shipFilter === f.k
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted hover:text-ink')}
              >
                {f.label}
                <span className={'ml-1 tabular-nums ' + (shipFilter === f.k ? 'text-primary' : 'text-muted-soft')}>
                  {tabCounts[f.k] ?? 0}
                </span>
              </button>
            ))}
            <button type="button" className="text-xs text-muted hover:text-ink ml-auto mb-2" onClick={selectAllVisible}>
              เลือกทั้งหมด ({activeFiltered.length})
            </button>
          </div>

          {/* Orders — layout คล้าย TikTok Shop */}
          <div className="rounded-xl border hairline overflow-hidden bg-surface-strong">
            {loading && (
              <div className="p-6 text-muted text-sm flex items-center gap-2">
                <span className="spinner"/> กำลังโหลด…
              </div>
            )}
            {!loading && filteredOrders.length === 0 && (
              <div className="p-10 text-center">
                <div className="text-muted text-sm mb-3">
                  {shipFilter === 'to_ship'
                    ? 'ยังไม่มีออเดอร์ "ที่จะจัดส่ง" — ระบบกำลังดึงจาก TikTok อัตโนมัติ'
                    : 'ยังไม่มีออเดอร์ในแท็บนี้ — รอซิงค์จาก TikTok หรือกดปุ่มด้านล่าง'}
                </div>
                <button type="button" className="btn-primary !text-sm" onClick={syncOrders} disabled={syncing}>
                  {syncing
                    ? <span className="text-sm font-semibold tabular-nums">{syncProgress.pct}%</span>
                    : pullBusy
                      ? <span className="spinner"/>
                      : <Icon name="refresh" size={16}/>}
                  อัปเดตข้อมูลจาก TikTok
                </button>
                <p className="text-xs text-muted-soft mt-3 max-w-md mx-auto">
                  ซิงค์อัตโนมัติทุก {TIKTOK_LIVE_POLL_MS / 1000} วินาที + cron ทุก 5 นาที —
                  ครั้งแรกอาจใช้เวลาสักครู่ถ้ามีออเดอร์จำนวนมาก (ดึงทีละ ~60 รายการ)
                </p>
              </div>
            )}
            {!loading && filteredOrders.length > 0 && (
              <>
                {/* Table header (desktop) */}
                <div className="hidden lg:grid grid-cols-[minmax(0,2.2fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.1fr)] gap-3 px-4 py-2 bg-surface-soft border-b hairline text-xs text-muted font-medium">
                  <div>สินค้า</div>
                  <div>สถานะ</div>
                  <div>การจัดส่ง</div>
                  <div className="text-right">ราคา</div>
                  <div className="text-right">การดำเนินการ</div>
                </div>
                <div className="divide-y hairline">
                  {filteredOrders.map(o => {
                    const lines = itemsByOrder[o.id] || [];
                    const st = normStatus(o.tiktok_order_status);
                    const isSelected = selected.has(o.id);
                    const isToShip = TO_SHIP.has(st);
                    const canShip = NEEDS_RTS.has(st);
                    return (
                      <div key={o.id} className={isSelected ? 'bg-primary/[0.04]' : ''}>
                        {/* Order header bar */}
                        <div className="flex items-center gap-3 px-4 py-2 bg-surface-soft/80 border-b hairline text-xs">
                          {o.status === 'active' && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(o.id)}
                            />
                          )}
                          <span className="font-mono font-semibold text-ink">
                            หมายเลขคำสั่งซื้อ: {o.tiktok_order_id || `#${o.id}`}
                          </span>
                          <span className="text-muted ml-auto tabular-nums">{fmtDateTime(o.sale_date)}</span>
                          <span className="text-muted-soft hidden sm:inline">POS #{o.id}</span>
                        </div>

                        {/* Order body */}
                        <div className="grid lg:grid-cols-[minmax(0,2.2fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.1fr)] gap-3 p-4 items-start">
                          {/* Product column */}
                          <div className="space-y-3">
                            {lines.length === 0 && (
                              <div className="text-sm text-muted">ไม่มีรายการสินค้า</div>
                            )}
                            {lines.map(l => (
                              <div key={l.id} className="flex gap-3">
                                <SkuThumb url={l.sku_image_url || imageByProduct[l.product_id]} alt={lineTitle(l)}/>
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-medium line-clamp-2">{lineTitle(l)}</div>
                                  <div className="text-xs text-muted mt-0.5">× {l.quantity}</div>
                                  {l.seller_sku && (
                                    <div className="text-xs text-muted-soft font-mono mt-0.5">SKU: {l.seller_sku}</div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Status */}
                          <div className="text-sm">
                            <span className={'inline-flex px-2 py-0.5 rounded-md text-xs font-medium ' +
                              (isToShip ? 'bg-[#fff7e6] text-[#8a6500]' : 'bg-surface-soft text-muted')}>
                              {STATUS_LABEL[st] || st || '—'}
                            </span>
                          </div>

                          {/* Shipping */}
                          <div className="text-sm text-muted">
                            <div>{shippingLabel(o)}</div>
                            {o.tracking_number && (
                              <div className="text-xs font-mono mt-1 text-muted-soft">#{o.tracking_number}</div>
                            )}
                            {o.shipping_recipient_name && (
                              <div className="text-xs mt-1 line-clamp-2 text-muted-soft">{o.shipping_recipient_name}</div>
                            )}
                          </div>

                          {/* Price */}
                          <div className="text-right">
                            <div className="font-display text-lg tabular-nums">{fmtTHB(o.grand_total)}</div>
                            <div className="text-xs text-muted mt-0.5">
                              {PAYMENT_LABEL[o.payment_method] || o.payment_method || '—'}
                            </div>
                            {o.net_received != null && (
                              <div className="text-xs text-muted-soft tabular-nums mt-0.5">net {fmtTHB(o.net_received)}</div>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex flex-col gap-2 lg:items-end">
                            {o.status === 'active' && canShip && (
                              <button
                                type="button"
                                className="btn-primary !py-2 !text-xs w-full lg:w-auto whitespace-nowrap"
                                disabled={shipBusy === o.id}
                                onClick={() => shipPackages([o.id])}
                              >
                                {shipBusy === o.id ? <span className="spinner"/> : null}
                                เตรียมจัดส่ง+พิมพ์
                              </button>
                            )}
                            {o.status === 'active' && (
                              <>
                                <button
                                  type="button"
                                  className="btn-secondary !py-1.5 !text-xs w-full lg:w-auto"
                                  disabled={labelBusy === o.id || o.tiktok_shipping_type === 'SELLER'}
                                  onClick={() => printOneLabel(o.id)}
                                >
                                  {labelBusy === o.id ? <span className="spinner"/> : <Icon name="printer" size={14}/>}
                                  ปริ้น label
                                </button>
                                <button
                                  type="button"
                                  className="btn-secondary !py-1.5 !text-xs w-full lg:w-auto"
                                  disabled={labelBusy === o.id || o.tiktok_shipping_type === 'SELLER'}
                                  onClick={() => printOneLabel(o.id, 'PACKING_SLIP')}
                                >
                                  packing slip
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
