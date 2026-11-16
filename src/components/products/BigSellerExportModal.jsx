import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import Modal from '../ui/Modal.jsx';
import Icon from '../ui/Icon.jsx';
import { sb } from '../../lib/supabase-client.js';
import { fetchAll, fetchAllFromTable } from '../../lib/sb-paginate.js';
import { fetchTikTokMappings } from '../../lib/tiktok-inventory-sync.js';
import {
  movementDecision, netByProduct, resolveSkuMap, aggregateBySku, reconcileLines,
  buildStockInAoa, buildStockOutAoa, chunkRows, exportFilename, parseSkuSheet, SHEET_NAME,
} from '../../lib/bigseller-export.js';

/**
 * Export ไป BigSeller — Manual Stock-In / Stock-Out files for the stock changes
 * BigSeller can't see (store / facebook / web sales, receives, adjustments …).
 * Logic lives in lib/bigseller-export.js; tables + RPCs in migration 088.
 */

const CHUNK = 200;

async function selectIn(table, select, column, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await sb.from(table).select(select).in(column, ids.slice(i, i + CHUNK));
    if (error) throw error;
    out.push(...(data || []));
  }
  return out;
}

function downloadSheets(kind, rows, date) {
  const parts = chunkRows(rows);
  const names = [];
  parts.forEach((part, i) => {
    const aoa = kind === 'in' ? buildStockInAoa(part) : buildStockOutAoa(part);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), SHEET_NAME);
    const name = exportFilename(kind, date, null, i + 1, parts.length);
    XLSX.writeFile(wb, name, { bookType: 'xlsx' });
    names.push(name);
  });
  return names;
}

const fmtDate = d => new Date(d).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
// Warehouse stock was set equal to POS at this moment; only changes after it go to BigSeller.
const WAREHOUSE_SYNCED_AT = '2026-11-16T14:15';

export default function BigSellerExportModal({ open, onClose, toast }) {
  const [state, setState] = useState(null);          // {last_to_movement_id, max_movement_id}
  const [skuCount, setSkuCount] = useState(null);
  const [merchantSkus, setMerchantSkus] = useState([]);
  const [batches, setBatches] = useState([]);
  const [startAt, setStartAt] = useState(WAREHOUSE_SYNCED_AT);
  const [preview, setPreview] = useState(null);
  const [manual, setManual] = useState({});           // product_id → typed SKU
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const firstRun = state && state.last_to_movement_id == null;

  const load = useCallback(async () => {
    setErr('');
    const [{ data: st, error: e1 }, skus, { data: bs, error: e3 }] = await Promise.all([
      sb.rpc('bigseller_export_state'),
      fetchAllFromTable(sb, 'bigseller_skus', { select: 'merchant_sku', orderColumn: 'merchant_sku', ascending: true }),
      sb.from('bigseller_export_batches')
        .select('id, created_at, created_by_email, from_movement_id, to_movement_id, in_rows, out_rows, unresolved_count, filename_in, filename_out')
        .order('id', { ascending: false }).limit(10),
    ]);
    const e = e1 || skus.error || e3;
    if (e) { setErr(e.message); return; }
    setState(st);
    setMerchantSkus(skus.data.map(r => r.merchant_sku));
    setSkuCount(skus.data.length);
    setBatches(bs || []);
  }, []);

  useEffect(() => {
    if (!open) return;
    setPreview(null); setManual({});
    load();
  }, [open, load]);

  const compute = useCallback(async () => {
    setBusy('compute'); setErr('');
    try {
      const { data: st, error: se } = await sb.rpc('bigseller_export_state');
      if (se) throw se;
      let from = st.last_to_movement_id;
      if (from == null) {
        const { data, error } = await sb.rpc('bigseller_movement_id_before', { p_at: new Date(startAt).toISOString() });
        if (error) throw error;
        from = Number(data) || 0;
      }
      const to = Number(st.max_movement_id) || 0;
      const { data: moves, error: me } = await fetchAll((a, b) =>
        sb.rpc('bigseller_export_movements', { p_from: from, p_to: to }).range(a, b));
      if (me) throw me;

      const unknown = [...new Set(moves.filter(m => movementDecision(m) === 'unknown').map(m => m.reason))];
      const net = netByProduct(moves);
      const ids = [...net.keys()].filter(id => net.get(id));
      const [products, saved, mappings] = await Promise.all([
        selectIn('products', 'id, name, cost_price', 'id', ids),
        selectIn('bigseller_sku_map', 'product_id, merchant_sku, source', 'product_id', ids),
        ids.length ? fetchTikTokMappings(ids) : [],
      ]);
      const productsById = new Map(products.map(p => [Number(p.id), p]));
      const savedMap = new Map(saved.map(r => [Number(r.product_id), r]));
      const tiktokByProduct = new Map();
      for (const m of mappings) {
        if (!m.product_id || !m.seller_sku) continue;
        const k = Number(m.product_id);
        tiktokByProduct.set(k, [...(tiktokByProduct.get(k) || []), m.seller_sku]);
      }
      const { resolved, toSave, unresolved: unresolvedInfo, skipped } =
        resolveSkuMap(ids, { productsById, tiktokByProduct, merchantSkus, savedMap });
      const skipIds = new Set(skipped.map(x => x.product_id));
      const { stockIn, stockOut, unresolved } = aggregateBySku(net, resolved, productsById, skipIds);
      const info = new Map(unresolvedInfo.map(u => [u.product_id, u]));
      setPreview({
        from, to, moveCount: moves.length,
        exported: moves.filter(m => movementDecision(m) === 'export').length,
        unknown, stockIn, stockOut, toSave,
        reconcile: reconcileLines(moves, resolved, productsById),
        unresolved: unresolved.map(u => ({ ...u, ...info.get(u.product_id), net: u.net })),
        skipped: skipped.map(x => ({ ...x, net: net.get(x.product_id) })),
      });
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy('');
    }
  }, [startAt, merchantSkus]);

  const saveChoice = async (row, okMsg) => {
    setBusy('manual'); setErr('');
    const { error } = await sb.rpc('bigseller_set_sku_map', { p_rows: [row] });
    setBusy('');
    if (error) { setErr(error.message); return; }
    toast?.push(okMsg, 'success');
    compute();
  };

  const saveManual = (productId, fallback) => {
    const typed = String(manual[productId] ?? fallback ?? '').trim();
    if (!typed) return;
    // Only SKUs that exist in the uploaded BigSeller list (case-insensitive).
    const sku = merchantSkus.find(s => s.toUpperCase() === typed.toUpperCase());
    if (!sku) { setErr(`ไม่มี SKU "${typed}" ในรายการ BigSeller — เลือกจากรายการ หรืออัปโหลดรายการ SKU ใหม่`); return; }
    saveChoice({ product_id: productId, merchant_sku: sku, source: 'manual' }, 'บันทึก SKU แล้ว');
  };

  const skipProduct = (productId) =>
    saveChoice({ product_id: productId, source: 'skip' }, 'ตั้งเป็น "ไม่ส่ง BigSeller" แล้ว');

  const unskipProduct = async (productId) => {
    setBusy('manual'); setErr('');
    const { error } = await sb.rpc('bigseller_clear_sku_map', { p_product_id: productId });
    setBusy('');
    if (error) { setErr(error.message); return; }
    compute();
  };

  const doExport = async () => {
    if (!preview || preview.unknown.length) return;
    setBusy('export'); setErr('');
    try {
      if (preview.toSave.length) {
        const { error } = await sb.rpc('bigseller_set_sku_map', { p_rows: preview.toSave });
        if (error) throw error;
      }
      const now = new Date();
      const inNames = preview.stockIn.length ? chunkRows(preview.stockIn).map((_, i, a) => exportFilename('in', now, null, i + 1, a.length)) : [];
      const outNames = preview.stockOut.length ? chunkRows(preview.stockOut).map((_, i, a) => exportFilename('out', now, null, i + 1, a.length)) : [];
      // Record first: if someone else exported this range meanwhile, nothing downloads.
      const { error } = await sb.rpc('bigseller_record_batch', {
        p_from: preview.from,
        p_to: preview.to,
        p_rows_in: preview.stockIn,
        p_rows_out: preview.stockOut,
        p_unresolved: preview.unresolved.map(u => ({ product_id: u.product_id, name: u.name, net: u.net })),
        p_filename_in: inNames.join(', ') || null,
        p_filename_out: outNames.join(', ') || null,
      });
      if (error) throw error;
      if (preview.stockIn.length) downloadSheets('in', preview.stockIn, now);
      if (preview.stockOut.length) downloadSheets('out', preview.stockOut, now);
      toast?.push(preview.stockIn.length || preview.stockOut.length ? 'ดาวน์โหลดไฟล์ BigSeller แล้ว' : 'บันทึกรอบ export แล้ว (ไม่มีรายการ)', 'success');
      setPreview(null);
      load();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy('');
    }
  };

  const redownload = async (id) => {
    setBusy(`re${id}`); setErr('');
    const { data, error } = await sb.from('bigseller_export_batches').select('created_at, rows_in, rows_out').eq('id', id).single();
    setBusy('');
    if (error) { setErr(error.message); return; }
    if (data.rows_in?.length) downloadSheets('in', data.rows_in, data.created_at);
    if (data.rows_out?.length) downloadSheets('out', data.rows_out, data.created_at);
    if (!data.rows_in?.length && !data.rows_out?.length) toast?.push('รอบนี้ไม่มีรายการ', 'info');
  };

  const uploadSkus = async (file) => {
    if (!file) return;
    setBusy('upload'); setErr('');
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false });
      const skus = parseSkuSheet(aoa);
      if (!skus.length) throw new Error('ไม่พบ SKU ในไฟล์');
      const { data, error } = await sb.rpc('bigseller_replace_skus', { p_skus: skus });
      if (error) throw error;
      toast?.push(`อัปเดตรายการ SKU BigSeller ${data} รายการ`, 'success');
      setPreview(null);
      await load();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy('');
    }
  };

  const skuListId = 'bigseller-sku-options';
  const datalist = useMemo(() => (
    <datalist id={skuListId}>{merchantSkus.map(s => <option key={s} value={s}/>)}</datalist>
  ), [merchantSkus]);

  return (
    <Modal open={open} onClose={onClose} title="Export ไป BigSeller" wide
      footer={
        <div className="flex gap-2 justify-end w-full">
          <button type="button" className="btn-secondary" onClick={onClose}>ปิด</button>
          {!preview ? (
            <button type="button" className="btn-primary" disabled={!!busy || !state || !skuCount} onClick={compute}>
              {busy === 'compute' ? 'กำลังคำนวณ…' : 'คำนวณรายการ'}
            </button>
          ) : (
            <button type="button" className="btn-primary" disabled={!!busy || preview.unknown.length > 0} onClick={doExport}>
              {busy === 'export' ? 'กำลังบันทึก…' : 'ดาวน์โหลด + บันทึกรอบ'}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        {datalist}
        {err && <div className="rounded-lg bg-error/10 text-error px-3 py-2">{err}</div>}

        <section className="rounded-lg border border-hairline p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-medium">รายการ Merchant SKU ของ BigSeller</div>
              <div className="text-muted">{skuCount == null ? 'กำลังโหลด…' : `${skuCount.toLocaleString()} SKU`}</div>
            </div>
            <label className="btn-secondary cursor-pointer inline-flex items-center gap-1.5">
              <Icon name="file" size={16}/>
              {busy === 'upload' ? 'กำลังอัปโหลด…' : 'อัปโหลด CSV / XLSX'}
              <input type="file" accept=".csv,.xlsx,.xls" className="hidden" disabled={!!busy}
                onChange={e => { uploadSkus(e.target.files?.[0]); e.target.value = ''; }}/>
            </label>
          </div>
          {skuCount === 0 && <div className="text-warning">อัปโหลดรายการ SKU ก่อน export ครั้งแรก (คอลัมน์แรก หรือคอลัมน์ที่หัวมีคำว่า SKU)</div>}
        </section>

        {state && (
          <section className="rounded-lg border border-hairline p-3 space-y-2">
            {firstRun ? (
              <>
                <div className="font-medium">ครั้งแรก: เริ่มนับการเปลี่ยนแปลงสต็อกตั้งแต่</div>
                <input type="datetime-local" className="input w-full" value={startAt}
                  onChange={e => { setStartAt(e.target.value); setPreview(null); }}/>
                <div className="text-muted">ค่าเริ่มต้น = เวลาที่ตั้งสต็อกคลัง BigSeller ให้เท่ากับ POS (16 พ.ย. 2569 ≈ 14:15) — รายการก่อนหน้านั้นไม่ส่ง</div>
              </>
            ) : (
              <div>รอบนี้: การเปลี่ยนแปลงหลัง movement #{state.last_to_movement_id} ถึง #{state.max_movement_id}</div>
            )}
          </section>
        )}

        {preview && (
          <section className="rounded-lg border border-hairline p-3 space-y-3">
            {preview.unknown.length > 0 && (
              <div className="rounded-lg bg-error/10 text-error px-3 py-2">
                พบเหตุผลสต็อกที่ไม่รู้จัก: {preview.unknown.join(', ')} — export ไม่ได้จนกว่าจะเพิ่มกฎ
              </div>
            )}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-surface-soft p-2"><div className="text-lg font-semibold">{preview.stockIn.length}</div><div className="text-muted">Stock-In</div></div>
              <div className="rounded-lg bg-surface-soft p-2"><div className="text-lg font-semibold">{preview.stockOut.length}</div><div className="text-muted">Stock-Out</div></div>
              <div className="rounded-lg bg-surface-soft p-2"><div className={'text-lg font-semibold ' + (preview.unresolved.length ? 'text-warning' : '')}>{preview.unresolved.length}</div><div className="text-muted">หา SKU ไม่เจอ</div></div>
            </div>
            <div className="text-muted">
              movement #{preview.from + 1}–#{preview.to} · {preview.moveCount} รายการ, นับ {preview.exported} (ข้ามออเดอร์ TikTok / Shopee / Lazada ที่ BigSeller ตัดเอง)
            </div>
            {preview.reconcile.length > 0 && (
              <div className="rounded-lg bg-warning/10 px-3 py-2 space-y-1">
                <div className="font-medium text-warning">ตรวจแถว reconcile ก่อน import ({preview.reconcile.length})</div>
                <div className="text-muted text-xs">ถ้าเกิดจากออเดอร์ TikTok ที่ BigSeller ตัดไปแล้ว ให้ลบแถวนั้นออกจากไฟล์ก่อน import</div>
                {preview.reconcile.map(r => (
                  <div key={r.product_id} className="flex justify-between gap-2">
                    <span className="truncate">{r.name}{r.sku && r.sku !== r.name ? <span className="text-muted"> → {r.sku}</span> : null}</span>
                    <span className="tabular-nums">{r.qty > 0 ? '+' : ''}{r.qty}</span>
                  </div>
                ))}
              </div>
            )}
            {preview.unresolved.length > 0 && (
              <div className="space-y-2">
                <div className="font-medium text-warning">สินค้าที่ยังไม่รู้ SKU — จะไม่ถูก export จนกว่าจะเลือก</div>
                {preview.unresolved.map(u => (
                  <div key={u.product_id} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{u.name} <span className="text-muted">({u.net > 0 ? '+' : ''}{u.net})</span></div>
                      {u.problem === 'conflict' && <div className="text-muted text-xs">TikTok ผูกหลาย SKU: {u.candidates?.join(', ')}</div>}
                      {u.problem === 'ambiguous' && <div className="text-muted text-xs">ตรงหลาย SKU: {u.candidates?.join(', ')}</div>}
                      {u.problem === 'not_in_bigseller' && <div className="text-muted text-xs">SKU {u.candidates?.[0]} ไม่มีใน BigSeller</div>}
                    </div>
                    <input className="input w-40" list={skuListId} placeholder="Merchant SKU"
                      value={manual[u.product_id] ?? (u.problem === 'not_in_bigseller' ? '' : (u.candidates?.[0] || ''))}
                      onChange={e => setManual(m => ({ ...m, [u.product_id]: e.target.value }))}/>
                    <button type="button" className="btn-secondary" disabled={!!busy}
                      onClick={() => saveManual(u.product_id, u.problem === 'not_in_bigseller' ? '' : u.candidates?.[0])}>บันทึก</button>
                    <button type="button" className="btn-secondary whitespace-nowrap" disabled={!!busy}
                      title="สินค้านี้ไม่มีใน BigSeller — ไม่ต้องส่งอีก" onClick={() => skipProduct(u.product_id)}>ไม่ส่ง BigSeller</button>
                  </div>
                ))}
              </div>
            )}
            {preview.skipped.length > 0 && (
              <details className="text-muted">
                <summary className="cursor-pointer">ไม่ส่ง BigSeller ({preview.skipped.length})</summary>
                <div className="mt-1 space-y-1">
                  {preview.skipped.map(x => (
                    <div key={x.product_id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{x.name} <span>({x.net > 0 ? '+' : ''}{x.net})</span></span>
                      <button type="button" className="btn-secondary !h-8" disabled={!!busy} onClick={() => unskipProduct(x.product_id)}>เลิกข้าม</button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </section>
        )}

        {batches.length > 0 && (
          <section className="space-y-1">
            <div className="font-medium">รอบที่ export แล้ว</div>
            {batches.map(b => (
              <div key={b.id} className="flex items-center justify-between gap-2 border-b border-hairline py-1.5">
                <div className="min-w-0">
                  <div>{fmtDate(b.created_at)} <span className="text-muted">· #{b.from_movement_id + 1}–#{b.to_movement_id}</span></div>
                  <div className="text-muted text-xs">In {b.in_rows} · Out {b.out_rows}{b.unresolved_count ? ` · ไม่รู้ SKU ${b.unresolved_count}` : ''}{b.created_by_email ? ` · ${b.created_by_email}` : ''}</div>
                </div>
                <button type="button" className="btn-secondary !h-9" disabled={!!busy || (!b.in_rows && !b.out_rows)} onClick={() => redownload(b.id)}>
                  {busy === `re${b.id}` ? '…' : 'โหลดอีกครั้ง'}
                </button>
              </div>
            ))}
          </section>
        )}
      </div>
    </Modal>
  );
}
