// TikTok product matching — link unmatched line items to POS products.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sb } from '../../lib/supabase-client.js';
import { getProductCatalog } from '../../lib/product-catalog-cache.js';
import { mapError } from '../../lib/error-map.js';
import { classifySkuMatch } from '../../lib/fuzzy-match.js';
import Icon from '../ui/Icon.jsx';
import ExpandableImageThumb from '../ui/ExpandableImageThumb.jsx';

const TIER_LABEL = {
  exact: 'ตรงกัน',
  suffix: 'suffix ตรงรุ่น',
  prefix: 'prefix ใกล้เคียง',
  fuzzy: 'คล้ายกัน',
};

function ProductPicker({ onPick, disabled }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const search = async (term) => {
    setQ(term);
    if (term.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      // exact barcode first, then name contains
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
        className="input !h-9 !rounded-lg !py-0 !px-3 !text-xs w-full"
      />
      {searching && <span className="spinner absolute right-2 top-2"/>}
      {results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto card-canvas rounded-lg border hairline shadow-lg">
          {results.map(p => (
            <button
              key={p.id}
              type="button"
              className="block w-full text-left px-3 py-2 text-xs hover:bg-primary/5 border-b hairline last:border-0"
              onClick={() => { onPick(p); setQ(''); setResults([]); }}
            >
              <div className="font-medium truncate">{p.name}</div>
              {p.barcode && <div className="text-muted-soft font-mono">{p.barcode}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TikTokMatching({ toast }) {
  const [items, setItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [skuBusy, setSkuBusy] = useState(false);
  const [applyStock, setApplyStock] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [unmatched, allProducts] = await Promise.all([
        sb.rpc('get_tiktok_unmatched_items', { p_limit: 200 }),
        getProductCatalog(sb),
      ]);
      if (unmatched.error) throw unmatched.error;
      if (allProducts.error) throw allProducts.error;
      setItems(unmatched.data || []);
      setProducts(allProducts.data || []);
    } catch (e) {
      toast?.push('โหลดรายการที่ยังไม่จับคู่ไม่ได้: ' + mapError(e), 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // Per-item SKU classification (auto target or ranked suggestions).
  const matchByItem = useMemo(() => {
    if (!products.length) return {};
    const out = {};
    for (const it of items) {
      const sku = it.seller_sku || it.sku_name || '';
      out[it.id] = sku ? classifySkuMatch(sku, products) : { status: 'none', candidates: [] };
    }
    return out;
  }, [items, products]);

  const autoMatchCount = useMemo(
    () => Object.values(matchByItem).filter(m => m.status === 'auto').length,
    [matchByItem],
  );

  const link = async (item, product) => {
    if (busy) return;
    setBusy(item.id);
    try {
      const { error } = await sb.rpc('link_tiktok_item_to_product', {
        p_item_id: item.id,
        p_product_id: product.id,
        p_apply_stock: applyStock,
      });
      if (error) throw error;
      toast?.push(`จับคู่ "${product.name}" แล้ว`, 'success');
      await load();
    } catch (e) {
      toast?.push('จับคู่ไม่ได้: ' + mapError(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const autoRelink = async () => {
    setAutoBusy(true);
    try {
      const { data, error } = await sb.rpc('relink_tiktok_by_mapping', { p_apply_stock: applyStock });
      if (error) throw error;
      toast?.push(`จับคู่อัตโนมัติ ${data?.relinked ?? 0} รายการ`, (data?.relinked ?? 0) > 0 ? 'success' : 'info');
      await load();
    } catch (e) {
      toast?.push('จับคู่อัตโนมัติไม่ได้: ' + mapError(e), 'error');
    } finally {
      setAutoBusy(false);
    }
  };

  // Batch-link every item whose best SKU candidate is an auto-tier match
  // (exact / whitelisted distributor suffix). Lower-confidence prefix/fuzzy
  // matches are left for one-click confirmation per row.
  const autoMatchBySku = async () => {
    const targets = items
      .map(it => ({ it, m: matchByItem[it.id] }))
      .filter(({ m }) => m?.status === 'auto');
    if (!targets.length) {
      toast?.push('ไม่มีรายการที่จับคู่อัตโนมัติด้วย SKU ได้', 'info');
      return;
    }
    setSkuBusy(true);
    let ok = 0;
    let fail = 0;
    for (const { it, m } of targets) {
      try {
        const { error } = await sb.rpc('link_tiktok_item_to_product', {
          p_item_id: it.id,
          p_product_id: m.product.id,
          p_apply_stock: applyStock,
        });
        if (error) throw error;
        ok++;
      } catch {
        fail++;
      }
    }
    toast?.push(
      `จับคู่ด้วย SKU แล้ว ${ok} รายการ` + (fail ? ` (พลาด ${fail})` : ''),
      ok > 0 ? 'success' : 'error',
    );
    setSkuBusy(false);
    await load();
  };

  return (
    <div className="rounded-xl border hairline overflow-hidden">
      <div className="px-4 py-3 bg-surface-soft border-b hairline flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-sm">จับคู่สินค้า ({items.length})</span>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={applyStock} onChange={e => setApplyStock(e.target.checked)}/>
            ตัดสต็อกย้อนหลัง
          </label>
          <button type="button" className="btn-secondary !py-1.5 !text-xs" onClick={load} disabled={loading}>
            {loading ? <span className="spinner"/> : <Icon name="refresh" size={14}/>} รีเฟรช
          </button>
          <button
            type="button"
            className="btn-primary !py-1.5 !text-xs"
            onClick={autoMatchBySku}
            disabled={skuBusy || autoMatchCount === 0}
            title="จับคู่อัตโนมัติเฉพาะคู่ที่ SKU ตรงรุ่น (suffix อยู่ใน whitelist)"
          >
            {skuBusy ? <span className="spinner"/> : <Icon name="zap" size={14}/>}
            จับคู่ด้วย SKU{autoMatchCount > 0 ? ` (${autoMatchCount})` : ''}
          </button>
          <button type="button" className="btn-secondary !py-1.5 !text-xs" onClick={autoRelink} disabled={autoBusy}>
            {autoBusy ? <span className="spinner"/> : <Icon name="link" size={14}/>} จับคู่อัตโนมัติใหม่
          </button>
        </div>
      </div>

      <div className="divide-y hairline">
        {items.length === 0 && (
          <div className="py-6 text-center text-muted text-sm">ไม่มีรายการที่ต้องจับคู่</div>
        )}
        {items.map(it => {
          const match = matchByItem[it.id];
          const suggestion = match?.status === 'auto'
            ? { product: match.product, tier: match.tier, score: match.score }
            : match?.candidates?.[0];
          return (
            <div key={it.id} className="p-3 flex flex-wrap items-center gap-3">
              <ExpandableImageThumb
                src={it.sku_image_url}
                alt={it.product_name || it.sku_name || ''}
                className="w-10 h-10 rounded border hairline shrink-0"
                imgClassName="w-full h-full object-cover rounded"
                placeholder={(
                  <div className="w-10 h-10 rounded bg-surface-soft border hairline flex items-center justify-center text-muted shrink-0">
                    <Icon name="image" size={14}/>
                  </div>
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{it.product_name || it.sku_name || '—'}</div>
                <div className="text-xs text-muted-soft truncate">
                  {it.seller_sku && <span className="font-mono">{it.seller_sku}</span>}
                  {it.tiktok_order_id && <span className="ml-2 font-mono">#{it.tiktok_order_id}</span>}
                  <span className="ml-2">×{it.quantity}</span>
                </div>
              </div>
              <div className="w-full sm:w-80 shrink-0 space-y-1.5">
                {busy === it.id ? (
                  <div className="text-xs text-muted flex items-center gap-2"><span className="spinner"/> กำลังจับคู่…</div>
                ) : (
                  <>
                    {suggestion && (
                      <div className="flex items-center gap-2 rounded-lg border hairline bg-surface-soft px-2.5 py-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium truncate">{suggestion.product.name}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={
                              'text-[10px] px-1.5 py-0.5 rounded font-medium ' +
                              (match.status === 'auto'
                                ? 'bg-[#e6f7ed] text-[#0a7a43]'
                                : 'bg-[#fff7e6] text-[#8a6500]')
                            }>
                              {match.status === 'auto' ? 'จับคู่อัตโนมัติได้' : 'ข้อเสนอ'}
                              {' · '}{TIER_LABEL[suggestion.tier] || suggestion.tier}
                              {' '}{Math.round(suggestion.score * 100)}%
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn-primary !py-1 !px-2.5 !text-xs shrink-0"
                          disabled={!!busy}
                          onClick={() => link(it, suggestion.product)}
                        >
                          ยืนยัน
                        </button>
                      </div>
                    )}
                    <ProductPicker onPick={(p) => link(it, p)} disabled={!!busy}/>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
