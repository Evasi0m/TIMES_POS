// TikTok pairing on the product detail editor — unlink, move to another model, push stock.
import React, { useEffect, useState } from 'react';
import { sb } from '../../lib/supabase-client.js';
import { mapError } from '../../lib/error-map.js';
import { searchProducts } from '../../lib/product-search.js';
import { fetchTikTokMappings } from '../../lib/tiktok-inventory-sync.js';
import { isLikelyWrongTikTokModel, rankPosModelsForTikTokSku } from '../../lib/tiktok-mapping-model.js';
import {
  findSameModelProduct,
  pushPosStockToTikTok,
  reassignTikTokMapping,
  unlinkTikTokMapping,
} from '../../lib/tiktok-mapping-edit.js';
import Icon from '../ui/Icon.jsx';
import Modal from '../ui/Modal.jsx';

function skuLabel(mapping) {
  return mapping?.seller_sku || mapping?.tiktok_product_name || mapping?.tiktok_sku_id || '—';
}

function mirrorNote(result) {
  if (!result || result.skipped) {
    if (result?.reason === 'not_connected') return '???????????????? ???????????????? TikTok ?????? (???????????????)';
    if (result?.reason === 'same_product') return '';
    return '????????????????';
  }
  const results = result.results || [];
  const ok = results.filter(r => r.status === 'success').length;
  const fail = results.filter(r => r.status === 'failed').length;
  if (fail) return `?????????? TikTok ???? ${ok} ?????? · ????????? ${fail}`;
  if (ok) return `?????????????? TikTok ???? ${ok} ??????`;
  return '????????????????';
}

export default function ProductTikTokMappingPanel({ product, toast, askConfirm }) {
  const productId = product?.id;
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [changeTarget, setChangeTarget] = useState(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(null);

  const load = async () => {
    if (!productId) return;
    setLoading(true);
    try {
      const rows = await fetchTikTokMappings([productId]);
      setMappings(rows || []);
      const next = {};
      await Promise.all((rows || []).map(async (m) => {
        if (!isLikelyWrongTikTokModel(m.seller_sku, product.name)) return;
        try {
          const hit = await findSameModelProduct(m.seller_sku, productId);
          if (hit) next[m.tiktok_sku_id] = hit;
        } catch { /* suggestion is optional */ }
      }));
      setSuggestions(next);
    } catch (e) {
      toast?.push('?????????? TikTok ??????: ' + mapError(e), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [productId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!changeTarget) return undefined;
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return undefined;
    }
    let cancel = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const { data, error } = await searchProducts(sb, q, { limit: 20 });
        if (error) throw error;
        const ranked = rankPosModelsForTikTokSku(changeTarget.seller_sku || q, data || [], {
          excludeId: productId,
        });
        if (!cancel) setHits(ranked);
      } catch (e) {
        if (!cancel) toast?.push('?????????????: ' + mapError(e), 'error');
      } finally {
        if (!cancel) setSearching(false);
      }
    }, 250);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [query, changeTarget, productId, toast]);

  const openChange = (mapping) => {
    setChangeTarget(mapping);
    setPicked(suggestions[mapping.tiktok_sku_id] || null);
    setQuery(mapping.seller_sku || mapping.tiktok_product_name || '');
    setHits([]);
  };

  const closeChange = () => {
    setChangeTarget(null);
    setPicked(null);
    setQuery('');
    setHits([]);
  };

  const runReassign = async (mapping, toProduct) => {
    const ok = await askConfirm?.({
      title: '?????????????????',
      message: `???? TikTok SKU "${skuLabel(mapping)}" ??? ${product.name} ?? ${toProduct.name} ???????????? ${toProduct.current_stock ?? 0} ?? TikTok`,
      okLabel: '???????????',
    });
    if (!ok) return;
    setBusyId(mapping.tiktok_sku_id);
    try {
      const result = await reassignTikTokMapping({
        mapping,
        fromProductId: productId,
        toProduct,
      });
      const note = mirrorNote(result);
      toast?.push(note || `???????????? ${toProduct.name} ????`, result?.results?.some(r => r.status === 'failed') ? 'warning' : 'success');
      closeChange();
      await load();
    } catch (e) {
      toast?.push('????????????????????: ' + mapError(e), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const runUnlink = async (mapping) => {
    const ok = await askConfirm?.({
      title: '???????????? TikTok',
      message: `???????????? SKU "${skuLabel(mapping)}" ??? ${product.name} — ????? TikTok ????????????????????????`,
      okLabel: '????????????',
      danger: true,
    });
    if (!ok) return;
    setBusyId(mapping.tiktok_sku_id);
    try {
      await unlinkTikTokMapping(mapping.tiktok_sku_id, productId);
      toast?.push(`???????????? ${skuLabel(mapping)} ????`, 'success');
      await load();
    } catch (e) {
      toast?.push('?????????????????????: ' + mapError(e), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const runPush = async () => {
    setBusyId('push');
    try {
      const result = await pushPosStockToTikTok([productId]);
      const note = mirrorNote(result);
      toast?.push(note || '????????????', result?.results?.some(r => r.status === 'failed') ? 'warning' : 'success');
    } catch (e) {
      toast?.push('?????????? TikTok ?????????: ' + mapError(e), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="product-editor__card">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="product-editor__section-head mb-0">
          <Icon name="link" size={12} className="text-muted"/>
          <span className="product-editor__section-label">?????? TikTok</span>
        </div>
        {mappings.length > 0 && (
          <button type="button" className="btn-secondary !px-3 !text-xs" onClick={runPush} disabled={!!busyId}>
            {busyId === 'push' ? <span className="spinner"/> : <Icon name="refresh" size={14}/>}
            ?????????????? TikTok
          </button>
        )}
      </div>

      {loading && <div className="text-sm text-muted flex items-center gap-2"><span className="spinner"/> ???????????????…</div>}

      {!loading && mappings.length === 0 && (
        <p className="text-sm text-muted">?????????????????????? TikTok</p>
      )}

      <div className="space-y-2">
        {mappings.map(m => {
          const wrong = isLikelyWrongTikTokModel(m.seller_sku, product.name);
          const suggestion = suggestions[m.tiktok_sku_id];
          const busy = busyId === m.tiktok_sku_id;
          return (
            <div key={m.tiktok_sku_id} className="rounded-lg border hairline-soft bg-surface-soft p-3 space-y-2">
              <div className="min-w-0">
                <div className="font-mono text-sm font-semibold truncate">{skuLabel(m)}</div>
                <div className="text-xs text-muted truncate">???????????????? {product.name} · ????? {product.current_stock ?? 0}</div>
              </div>
              {wrong && (
                <div className="text-xs text-error flex items-start gap-1.5">
                  <Icon name="alert" size={13} className="shrink-0 mt-0.5"/>
                  <span>???? TikTok ????????????? — ??????? TikTok ?????????????????????????????</span>
                </div>
              )}
              {suggestion && (
                <button
                  type="button"
                  className="btn-secondary !text-xs !px-3"
                  disabled={!!busyId}
                  onClick={() => runReassign(m, suggestion)}
                >
                  ??????????? {suggestion.name} · ????? {suggestion.current_stock ?? 0}
                </button>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary !text-xs !px-3" disabled={!!busyId} onClick={() => openChange(m)}>
                  {busy ? <span className="spinner"/> : <Icon name="edit" size={14}/>} ?????????????????
                </button>
                <button type="button" className="btn-secondary !text-xs !px-3 !text-error" disabled={!!busyId} onClick={() => runUnlink(m)}>
                  <Icon name="x" size={14}/> ????????????
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        open={!!changeTarget}
        onClose={closeChange}
        title="?????????????????"
        wide
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={closeChange}>???</button>
            <button
              type="button"
              className="btn-ruby-premium"
              disabled={!picked || !!busyId}
              onClick={() => picked && changeTarget && runReassign(changeTarget, picked)}
            >
              ?????????????????
            </button>
          </>
        }
      >
        {changeTarget && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              TikTok SKU <span className="font-mono font-semibold text-ink">{skuLabel(changeTarget)}</span> ???????????? {product.name}
            </p>
            <input
              className="input w-full font-mono"
              value={query}
              onChange={e => { setQuery(e.target.value); setPicked(null); }}
              placeholder="?????????????????"
              aria-label="??????????????????"
            />
            {searching && <div className="text-xs text-muted flex items-center gap-2"><span className="spinner"/> ????????…</div>}
            <div className="max-h-64 overflow-auto space-y-1">
              {hits.map(({ product: hit, match }) => {
                const same = match.tier === 'exact' || match.tier === 'suffix';
                const active = picked?.id === hit.id;
                return (
                  <button
                    key={hit.id}
                    type="button"
                    className={'w-full text-left rounded-lg border px-3 py-2 ' + (active ? 'border-ink bg-surface-strong' : 'hairline-soft bg-surface')}
                    onClick={() => setPicked(hit)}
                  >
                    <div className="font-mono text-sm font-semibold truncate">{hit.name}</div>
                    <div className="text-[11px] text-muted tabular-nums">
                      ????? {hit.current_stock ?? 0}
                      {same ? ' · ???????' : ''}
                    </div>
                  </button>
                );
              })}
              {!searching && query.trim().length >= 2 && hits.length === 0 && (
                <p className="text-sm text-muted">?????????</p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
