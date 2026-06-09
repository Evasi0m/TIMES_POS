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
import { getProductCatalog } from '../../lib/product-catalog-cache.js';
import { pollTikTokOrders, formatPollToast } from '../../lib/tiktok-poll-sync.js';
import { useSimulatedSyncProgress } from '../../lib/use-simulated-sync-progress.js';
import TikTokPendingModal from './tiktok-confirm/TikTokPendingModal.jsx';
import { SORT_OLDEST, SORT_NEWEST } from './tiktok-confirm/helpers.js';

export default function TikTokConfirmPanel({ toast, onConfirmed }) {
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState(null);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [picks, setPicks] = useState({});
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
      if (it.product_id) {
        const prod = products.find(p => p.id === it.product_id);
        seed[it.id] = {
          id: it.product_id,
          name: prod?.name || it.product_name || it.sku_name || '',
          current_stock: prod?.current_stock,
        };
      }
    });
    setPicks(seed);
    setNet('');
    setDeferNet(false);
    if (!products.length) loadCatalog({ quiet: true });
  };

  const backToList = () => { setActiveId(null); setPicks({}); setNet(''); setDeferNet(false); };

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
      if (e.key !== 'Escape') return;
      if (activeId && !saving) backToList();
      else closeAll();
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
      onConfirmed?.(confirmedId);
      closeAll();
      load();
    }
  };

  const count = orders.length;
  if (count === 0 && !loading) return null;

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
        <TikTokPendingModal
          closing={closing}
          onClose={closeAll}
          onBack={backToList}
          activeOrder={activeOrder}
          count={count}
          sortedOrders={sortedOrders}
          sortOrder={sortOrder}
          onSortChange={setSortOrder}
          onOpenOrder={openOrder}
          refreshing={refreshing}
          syncPct={syncProgress.pct}
          onSync={syncFromTikTok}
          saving={saving}
          picks={picks}
          setPicks={setPicks}
          net={net}
          setNet={setNet}
          deferNet={deferNet}
          setDeferNet={setDeferNet}
          allMatched={allMatched}
          netOk={netOk}
          onConfirm={confirm}
          catalog={products}
          catalogLoading={catalogLoading}
          catalogError={catalogError}
          onRetryCatalog={() => loadCatalog({ force: true })}
        />,
        document.body
      )}
    </>
  );
}
