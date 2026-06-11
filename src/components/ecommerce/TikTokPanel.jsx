// TikTok Shop — orders, SKU images, shipping labels, tax invoices.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sb } from '../../lib/supabase-client.js';
import { mapError } from '../../lib/error-map.js';
import { fullBuyerValid } from '../../lib/tax-buyer.js';
import { formatPollToast } from '../../lib/tiktok-poll-sync.js';
import {
  fetchRecentTikTokOrders,
  fetchItemsByOrderIds,
  fetchProductImageMap,
  TIKTOK_ORDERS_LOAD_CAP,
} from '../../lib/tiktok-orders-load.js';
import { TIKTOK_LIVE_POLL_MS, useTikTokLiveSync } from '../../lib/use-tiktok-live-sync.js';
import { useSimulatedSyncProgress } from '../../lib/use-simulated-sync-progress.js';
import TikTokInvoiceSection, { buyerReady } from './TikTokInvoiceBulk.jsx';
import TikTokReturns from './TikTokReturns.jsx';
import TikTokMatching from './TikTokMatching.jsx';
import TikTokStockReconcile from './TikTokStockReconcile.jsx';
import { fetchShippingLabels, printLabelUrl, printMergedLabels } from './TikTokLabelPrint.js';
import TikTokConnectionStrip from './tiktok/TikTokConnectionStrip.jsx';
import TikTokStatStrip from './tiktok/TikTokStatStrip.jsx';
import TikTokOrdersToolbar from './tiktok/TikTokOrdersToolbar.jsx';
import TikTokStatusTabs from './tiktok/TikTokStatusTabs.jsx';
import TikTokBulkActionBar from './tiktok/TikTokBulkActionBar.jsx';
import TikTokOrderList from './tiktok/TikTokOrderList.jsx';
import {
  navigateToTikTokCancelledReturn,
  saleMatchesOrderSearch,
} from '../../lib/tiktok-cancel-return.js';
import { fetchVoidStockStatusMap } from '../../lib/sale-void-stock-status.js';

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

function normStatus(st) {
  if (!st) return '';
  const s = String(st).trim();
  return NUMERIC_STATUS[s] || s.toUpperCase();
}

const PAYMENT_LABEL = {
  cod: 'เก็บเงินปลายทาง',
  transfer: 'ชำระออนไลน์',
  cash: 'เงินสด',
  card: 'บัตร',
};

const ORDER_TABS = [
  { k: 'all', label: 'ทั้งหมด' },
  { k: 'to_ship', label: 'ที่จะจัดส่ง' },
  { k: 'shipped', label: 'จัดส่งแล้ว' },
  { k: 'completed', label: 'เสร็จสิ้น' },
  { k: 'on_hold', label: 'รอดำเนินการ' },
  { k: 'cancelled', label: 'ยกเลิก' },
  { k: 'delivery_failed', label: 'การจัดส่งไม่สำเร็จ' },
];

const NEEDS_RTS = new Set(['AWAITING_SHIPMENT', 'PARTIALLY_SHIPPING']);
const SHIPPED = new Set(['IN_TRANSIT', 'DELIVERED']);
const COMPLETED = new Set(['COMPLETED']);
const ON_HOLD = new Set(['ON_HOLD']);
const CANCELLED = new Set(['CANCELLED']);
const DELIVERY_FAILED = new Set([
  'DELIVERY_FAILED', 'FAILED_DELIVERY', 'UNABLE_TO_DELIVER', 'DELIVERY_FAILURE',
]);
const TO_SHIP = new Set(['AWAITING_SHIPMENT', 'AWAITING_COLLECTION', 'PARTIALLY_SHIPPING']);

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

function paymentLabel(o) {
  return PAYMENT_LABEL[o.payment_method] || o.payment_method || '—';
}

function canShipOrder(o) {
  return NEEDS_RTS.has(normStatus(o.tiktok_order_status));
}

export default function TikTokPanel({ toast, section = 'orders', onSyncChange, isSuperAdmin = false, setView }) {
  const [orders, setOrders] = useState([]);
  const [itemsByOrder, setItemsByOrder] = useState({});
  const [imageByProduct, setImageByProduct] = useState({});
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [labelBusy, setLabelBusy] = useState(null);
  const [shipBusy, setShipBusy] = useState(null);
  const [shipFilter, setShipFilter] = useState('to_ship');
  const [orderSearch, setOrderSearch] = useState('');
  const [voidStockStatus, setVoidStockStatus] = useState({});
  const [selected, setSelected] = useState(new Set());
  const [singleId, setSingleId] = useState('');
  const [singleBusy, setSingleBusy] = useState(false);
  const [ordersTruncated, setOrdersTruncated] = useState(false);
  const syncProgress = useSimulatedSyncProgress();
  const wasSyncingRef = useRef(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const { data: orderRows, error: ordersErr } = await fetchRecentTikTokOrders(sb);
      if (ordersErr) throw ordersErr;
      const list = orderRows || [];
      setOrders(list);
      setOrdersTruncated(list.length >= TIKTOK_ORDERS_LOAD_CAP);
      setSelected(new Set());

      if (list.length) {
        const orderIds = list.map(o => o.id);
        const map = await fetchItemsByOrderIds(sb, orderIds);
        setItemsByOrder(map);

        const productIds = [...new Set(
          Object.values(map).flat().map(it => it.product_id).filter(Boolean),
        )];
        setImageByProduct(await fetchProductImageMap(sb, productIds));

        const voidedIds = list.filter(o => o.status === 'voided').map(o => o.id);
        if (voidedIds.length) {
          try {
            setVoidStockStatus(await fetchVoidStockStatusMap(sb, voidedIds));
          } catch {
            setVoidStockStatus({});
          }
        } else {
          setVoidStockStatus({});
        }
      } else {
        setItemsByOrder({});
        setImageByProduct({});
        setVoidStockStatus({});
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

  const tabFilteredOrders = useMemo(
    () => orders.filter(o => orderMatchesTab(o, shipFilter)),
    [orders, shipFilter],
  );

  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim();
    if (!q) return tabFilteredOrders;
    return orders.filter(o => saleMatchesOrderSearch(o, q));
  }, [orders, tabFilteredOrders, orderSearch]);

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
      const voided = Number(data?.voided ?? 0);
      const { message, level } = formatPollToast(data, { beforeCount, afterCount });
      toast?.push(message, level);
      if (voided > 0) {
        toast?.push(
          `TikTok ยกเลิก ${voided} ออเดอร์ — ดูในแท็บ「ยกเลิก」 (บิลไม่หายจากระบบ)`,
          'info',
        );
        setShipFilter('cancelled');
      }
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

  const handleReturnGoods = useCallback((order) => {
    if (!order?.id) return;
    navigateToTikTokCancelledReturn(order.id, setView);
    toast?.push(`เปิดฟอร์มรับคืนสำหรับบิล #${order.id}`, 'info');
  }, [setView, toast]);

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
    <div className="tt-glass__workspace fade-in">
      {section === 'orders' && (
        <>
          <section className="tt-glass__group" aria-label="TikTok overview">
            <div className="tt-glass__group-heading">
              <h2 className="tt-glass__group-title">Overview</h2>
              <p className="tt-glass__group-caption">สถานะร้านและงานที่ต้องจัดการตอนนี้</p>
            </div>
            <div className="tt-glass__overview-grid">
              <TikTokConnectionStrip
                toast={toast}
                livePollSec={TIKTOK_LIVE_POLL_MS / 1000}
                liveLabel={liveLabel}
                pullBusy={pullBusy}
              />
              <TikTokStatStrip cards={statCards}/>
            </div>
          </section>

          <section className="tt-glass__group" aria-label="TikTok order controls">
            <div className="tt-glass__group-heading">
              <h2 className="tt-glass__group-title">Command Center</h2>
              <p className="tt-glass__group-caption">ดึงข้อมูลและจัดการออเดอร์แบบกลุ่ม</p>
            </div>
            <div className="tt-glass__command-panel">
              <TikTokOrdersToolbar
                singleId={singleId}
                onSingleIdChange={setSingleId}
                orderSearch={orderSearch}
                onOrderSearchChange={setOrderSearch}
                onSyncSingle={syncSingle}
                onSyncOrders={syncOrders}
                onRefresh={load}
                onPrintLabels={() => printLabels(selectedIds.length ? selectedIds : activeFiltered.map(o => o.id))}
                onShipPackages={() => shipPackages(selectedIds)}
                loading={loading}
                syncing={syncing}
                pullBusy={pullBusy}
                singleBusy={singleBusy}
                syncPct={syncProgress.pct}
                labelBusy={labelBusy}
                shipBusy={shipBusy}
                selectedCount={selectedIds.length}
                activeFilteredCount={activeFiltered.length}
              />
              <TikTokBulkActionBar
                selectedCount={selectedIds.length}
                onPrint={() => printLabels(selectedIds)}
                onShip={() => shipPackages(selectedIds)}
                labelBusy={labelBusy}
                shipBusy={shipBusy}
              />
            </div>
          </section>

          <section className="tt-glass__group" aria-label="TikTok order list">
            <div className="tt-glass__group-heading">
              <h2 className="tt-glass__group-title">Work Queue</h2>
              <p className="tt-glass__group-caption">รายการออเดอร์ตามสถานะที่เลือก</p>
            </div>
            <div className="tt-glass__filter-rail">
              <TikTokStatusTabs
                tabs={ORDER_TABS}
                activeKey={shipFilter}
                tabCounts={tabCounts}
                onSelect={setShipFilter}
                onSelectAll={selectAllVisible}
                selectableCount={activeFiltered.length}
              />
            </div>
            <TikTokOrderList
              loading={loading}
              orders={filteredOrders}
              ordersTruncated={ordersTruncated}
              ordersCap={TIKTOK_ORDERS_LOAD_CAP}
              orderSearch={orderSearch}
              itemsByOrder={itemsByOrder}
              imageByProduct={imageByProduct}
              selected={selected}
              shipFilter={shipFilter}
              canShipFn={canShipOrder}
              labelBusy={labelBusy}
              shipBusy={shipBusy}
              lineTitle={lineTitle}
              shippingLabel={shippingLabel}
              paymentLabel={paymentLabel}
              fmtDateTime={fmtDateTime}
              livePollSec={TIKTOK_LIVE_POLL_MS / 1000}
              syncing={syncing}
              pullBusy={pullBusy}
              syncPct={syncProgress.pct}
              onToggleSelect={toggleSelect}
              onShip={shipPackages}
              onPrintLabel={printOneLabel}
              onPrintPackingSlip={printOneLabel}
              onSyncOrders={syncOrders}
              onReturnGoods={handleReturnGoods}
              voidStockStatus={voidStockStatus}
            />
          </section>
        </>
      )}

      {section === 'invoices' && (
        <section className="tt-glass__group" aria-label="TikTok tax documents">
          <div className="tt-glass__group-heading">
            <h2 className="tt-glass__group-title">Tax Documents</h2>
            <p className="tt-glass__group-caption">ตรวจ Tax ID แก้ข้อมูลผู้ซื้อ และพิมพ์ใบกำกับ</p>
          </div>
          <TikTokInvoiceSection
            orders={orders}
            itemsByOrder={itemsByOrder}
            toast={toast}
            onOrdersChange={setOrders}
          />
        </section>
      )}

      {section === 'returns' && (
        <section className="tt-glass__group" aria-label="TikTok returns desk">
          <div className="tt-glass__group-heading">
            <h2 className="tt-glass__group-title">Returns Desk</h2>
            <p className="tt-glass__group-caption">ดึงรายการคืน ตรวจสถานะ และออกใบลดหนี้</p>
          </div>
          <TikTokReturns toast={toast} />
        </section>
      )}

      {section === 'matching' && isSuperAdmin && (
        <section className="tt-glass__group" aria-label="TikTok matching queue">
          <div className="tt-glass__group-heading">
            <h2 className="tt-glass__group-title">Matching Queue</h2>
            <p className="tt-glass__group-caption">จับคู่ SKU จาก TikTok กับสินค้าใน POS</p>
          </div>
          <TikTokMatching toast={toast} />
        </section>
      )}

      {section === 'stock' && isSuperAdmin && (
        <section className="tt-glass__group" aria-label="TikTok stock control">
          <div className="tt-glass__group-heading">
            <h2 className="tt-glass__group-title">Stock Control</h2>
            <p className="tt-glass__group-caption">ตรวจสุขภาพระบบและ reconcile สต็อก POS ↔ TikTok</p>
          </div>
          <TikTokStockReconcile toast={toast} setView={setView} />
        </section>
      )}
    </div>
  );
}
