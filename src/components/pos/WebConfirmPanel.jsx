// Web Shop order confirmation — POS-side review queue (Hybrid B).
//
// Web orders land as status='pending', channel='web'. Cashier matches SKUs,
// enters net received, and confirm_web_sale_order() cuts stock + issues tax invoice.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { sb } from '../../lib/supabase-client.js';
import { mapError } from '../../lib/error-map.js';
import { getProductCatalog } from '../../lib/product-catalog-cache.js';
import WebPendingModal from './web-confirm/WebPendingModal.jsx';
import {
  SORT_OLDEST,
  SORT_NEWEST,
  resolveSubstitutionForConfirm,
  isGenericTikTokSku,
} from './tiktok-confirm/helpers.js';
import { WCC_COPY } from './web-confirm/copy.js';
import { fetchTikTokMappingsBySkuIds } from '../../lib/tiktok-inventory-sync.js';

export default function WebConfirmPanel({ toast, onConfirmed }) {
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState(null);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [picks, setPicks] = useState({});
  const [substitutionMeta, setSubstitutionMeta] = useState({});
  const [matchConfirmed, setMatchConfirmed] = useState({});
  const [net, setNet] = useState('');
  const [deferNet, setDeferNet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
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
        sb.rpc('get_pending_web_orders', { p_limit: 200 }),
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
      toast?.('โหลดออเดอร์ Web Shop รอยืนยันไม่ได้: ' + mapError(e), 'error');
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onChange = () => load({ quiet: true });
    window.addEventListener('web-pending-changed', onChange);
    window.addEventListener('focus', onChange);
    const id = setInterval(onChange, 60_000);
    return () => {
      window.removeEventListener('web-pending-changed', onChange);
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

  const openOrder = async (o) => {
    setActiveId(o.id);
    const items = o.items || [];
    let catalog = products;
    if (!catalog.length) {
      catalog = await loadCatalog({ quiet: true });
    }

    const skuIds = items.map(it => it.tiktok_sku_id).filter(Boolean);
    let mappings = [];
    try {
      mappings = await fetchTikTokMappingsBySkuIds(skuIds);
    } catch { /* pre-fill is best-effort */ }
    const mappingBySku = Object.fromEntries(
      mappings.map(m => [String(m.tiktok_sku_id), m]),
    );

    const seed = {};
    const matchSeed = {};
    items.forEach(it => {
      const mapping = it.tiktok_sku_id ? mappingBySku[String(it.tiktok_sku_id)] : null;
      const productId = it.product_id || mapping?.product_id;
      if (productId) {
        const prod = catalog.find(p => p.id === productId);
        seed[it.id] = {
          id: productId,
          name: prod?.name || it.product_name || it.sku_name || '',
          model_code: prod?.model_code,
          current_stock: prod?.current_stock,
        };
        if (mapping?.product_id && isGenericTikTokSku(it)) {
          matchSeed[it.id] = true;
        }
      }
    });
    setPicks(seed);
    setMatchConfirmed(matchSeed);
    setSubstitutionMeta({});
    setNet('');
    setDeferNet(false);
    if (!products.length && catalog.length) {
      setProducts(catalog);
    }
  };

  const backToList = () => {
    setActiveId(null);
    setPicks({});
    setSubstitutionMeta({});
    setMatchConfirmed({});
    setNet('');
    setDeferNet(false);
  };

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
    const orderNo = activeOrder.web_order_number || `#${confirmedId}`;
    setSaving(true);
    let ok = false;
    try {
      const p_items = (activeOrder.items || []).map((it) => {
        const pick = picks[it.id];
        const product_id = pick?.id ?? null;
        const { substitute, substitution_note } = resolveSubstitutionForConfirm(
          it,
          pick,
          substitutionMeta[it.id],
          matchConfirmed,
        );
        return {
          item_id: it.id,
          product_id,
          substitute,
          substitution_note,
        };
      });
      const { error } = await sb.rpc('confirm_web_sale_order', {
        p_order_id: confirmedId,
        p_items,
        p_net_received: value,
      });
      if (error) throw error;
      ok = true;
      const subCount = p_items.filter(x => x.substitute).length;
      toast?.(`ยืนยันออเดอร์ Web ${orderNo} แล้ว`, 'success');
      if (subCount > 0) {
        toast?.(
          `มี ${subCount} รายการส่งคนละรุ่น — ตรวจสต็อกหลังจัดส่ง`,
          'warning',
          { duration: 8000 },
        );
      }
      window.dispatchEvent(new Event('web-pending-changed'));
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
        aria-label={`${WCC_COPY.badgeLabel} ${count} รายการ`}
        className="wcc-pending-badge font-display"
      >
        <span className="wcc-pending-badge__count">
          <span className="wcc-pending-badge__count-num">{count > 99 ? '99+' : count}</span>
        </span>
        <span className="wcc-pending-badge__label">{WCC_COPY.badgeLabel}</span>
      </button>
    </div>
  );

  return (
    <>
      {badge}

      {open && createPortal(
        <WebPendingModal
          closing={closing}
          onClose={closeAll}
          onBack={backToList}
          activeOrder={activeOrder}
          count={count}
          sortedOrders={sortedOrders}
          sortOrder={sortOrder}
          onSortChange={setSortOrder}
          onOpenOrder={openOrder}
          saving={saving}
          picks={picks}
          setPicks={setPicks}
          substitutionMeta={substitutionMeta}
          setSubstitutionMeta={setSubstitutionMeta}
          matchConfirmed={matchConfirmed}
          setMatchConfirmed={setMatchConfirmed}
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
          toast={toast}
        />,
        document.body
      )}
    </>
  );
}
