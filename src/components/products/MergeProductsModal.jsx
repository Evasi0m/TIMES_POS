import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import Icon from '../ui/Icon.jsx';
import { sb } from '../../lib/supabase-client.js';
import { fetchAllFromTable } from '../../lib/sb-paginate.js';
import { findDuplicateCandidates } from '../../lib/product-duplicates.js';

/**
 * รวมสินค้าซ้ำ (super admin) — list likely duplicate pairs, then merge one
 * into the other through merge_products (migration 093).
 */

const HIDDEN_KEY = 'times.mergeProducts.hiddenPairs';
const MAX_ROWS = 60;

function loadHidden() {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')); } catch { return new Set(); }
}
function saveHidden(set) {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

export default function MergeProductsModal({ open, onClose, toast, onMerged }) {
  const [products, setProducts] = useState(null);
  const [err, setErr] = useState('');
  const [query, setQuery] = useState('');
  const [showMedium, setShowMedium] = useState(false);
  const [hidden, setHidden] = useState(loadHidden);
  const [pick, setPick] = useState(null);        // {keep, dup}
  const [preview, setPreview] = useState(null);
  const [finalStock, setFinalStock] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setErr(''); setProducts(null);
    try {
      const [p, m] = await Promise.all([
        fetchAllFromTable(sb, 'products', { select: 'id, name, current_stock, barcode' }),
        fetchAllFromTable(sb, 'tiktok_product_mappings', { select: 'tiktok_sku_id, product_id, seller_sku', orderColumn: 'tiktok_sku_id' }),
      ]);
      if (p.error) throw p.error;
      if (m.error) throw m.error;
      const skus = new Map();
      for (const r of m.data || []) {
        if (!r.product_id || !r.seller_sku) continue;
        skus.set(r.product_id, [...(skus.get(r.product_id) || []), r.seller_sku]);
      }
      setProducts((p.data || []).map(x => ({ ...x, tiktokSkus: skus.get(x.id) || [] })));
    } catch (e) {
      setErr(e.message || String(e));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setPick(null); setPreview(null); setQuery('');
    load();
  }, [open, load]);

  const candidates = useMemo(() => (products ? findDuplicateCandidates(products) : []), [products]);

  const visible = useMemo(() => {
    const q = query.trim().toUpperCase().replace(/\s+/g, '');
    return candidates.filter(c => {
      if (hidden.has(`${c.a.id}:${c.b.id}`)) return false;
      if (q) return (c.a.name + '|' + c.b.name).toUpperCase().replace(/\s+/g, '').includes(q);
      return c.level === 'high' || showMedium;
    }).slice(0, MAX_ROWS);
  }, [candidates, hidden, query, showMedium]);

  const highCount = candidates.filter(c => c.level === 'high' && !hidden.has(`${c.a.id}:${c.b.id}`)).length;

  const hidePair = (c) => {
    const next = new Set(hidden);
    next.add(`${c.a.id}:${c.b.id}`);
    setHidden(next); saveHidden(next);
  };

  const choose = async (keep, dup) => {
    setPick({ keep, dup }); setPreview(null); setReason(''); setErr('');
    setBusy('preview');
    const { data, error } = await sb.rpc('merge_products_preview', { p_keep: keep.id, p_dup: dup.id });
    setBusy('');
    if (error) { setErr(error.message); return; }
    setPreview(data);
    setFinalStock(String((Number(data?.keep?.stock) || 0) + (Number(data?.dup?.stock) || 0)));
  };

  const doMerge = async () => {
    if (!pick || !preview) return;
    const n = Number(finalStock);
    if (!Number.isInteger(n)) { setErr('สต็อกหลังรวมต้องเป็นจำนวนเต็ม'); return; }
    setBusy('merge'); setErr('');
    const { error } = await sb.rpc('merge_products', {
      p_keep: pick.keep.id, p_dup: pick.dup.id, p_final_stock: n, p_reason: reason.trim() || null,
    });
    setBusy('');
    if (error) { setErr(error.message); return; }
    toast?.push(`รวม "${pick.dup.name}" เข้า "${pick.keep.name}" แล้ว`, 'success');
    setPick(null); setPreview(null);
    onMerged?.();
    load();
  };

  const stockDelta = preview ? Number(finalStock) - (Number(preview.keep?.stock) || 0) : 0;

  return (
    <Modal open={open} onClose={onClose} title="รวมสินค้าซ้ำ" wide
      footer={
        <div className="flex gap-2 justify-end w-full">
          {pick ? (
            <>
              <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => { setPick(null); setPreview(null); }}>ย้อนกลับ</button>
              <button type="button" className="btn-primary" disabled={!!busy || !preview} onClick={doMerge}>
                {busy === 'merge' ? 'กำลังรวม…' : 'รวมสินค้า'}
              </button>
            </>
          ) : (
            <button type="button" className="btn-secondary" onClick={onClose}>ปิด</button>
          )}
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        {err && <div className="rounded-lg bg-error/10 text-error px-3 py-2">{err}</div>}

        {!pick && (
          <>
            <div className="text-muted">
              ระบบหาคู่ที่น่าจะเป็นรุ่นเดียวกัน — <b>ตรวจด้วยตาก่อนรวมทุกครั้ง</b> รุ่นต่างสีมักต่างกันแค่ 1 ตัวอักษร (เช่น -2A กับ -3A) ซึ่งไม่ใช่สินค้าซ้ำ
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-soft pointer-events-none"><Icon name="search" size={16}/></span>
                <input className="input !pl-9 w-full" placeholder="ค้นรุ่น เช่น AQ-240" value={query} onChange={e => setQuery(e.target.value)}/>
              </div>
              <label className="inline-flex items-center gap-1.5 text-muted">
                <input type="checkbox" checked={showMedium} onChange={e => setShowMedium(e.target.checked)}/>
                แสดงชื่อคล้าย (อาจเป็นคนละสี)
              </label>
            </div>
            {products == null ? (
              <div className="text-muted">กำลังโหลดสินค้า…</div>
            ) : (
              <div className="text-muted text-xs">
                น่าจะซ้ำ {highCount} คู่{query ? ` · ผลค้น "${query}"` : ''}{visible.length >= MAX_ROWS ? ` · แสดง ${MAX_ROWS} คู่แรก พิมพ์ค้นเพื่อกรอง` : ''}
              </div>
            )}
            <div className="space-y-2">
              {visible.map(c => (
                <div key={`${c.a.id}:${c.b.id}`} className={'rounded-lg border p-2.5 space-y-2 ' + (c.level === 'high' ? 'border-warning/50 bg-warning/5' : 'border-hairline')}>
                  <div className="text-xs text-muted">{c.reasons.join(' · ')}</div>
                  {[c.a, c.b].map((p, i) => {
                    const other = i === 0 ? c.b : c.a;
                    return (
                      <div key={p.id} className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="truncate font-medium">{p.name}</div>
                          <div className="text-xs text-muted">
                            #{p.id} · สต็อก {p.current_stock}{p.barcode ? ` · ${p.barcode}` : ''}{p.tiktokSkus.length ? ` · TikTok ${p.tiktokSkus.join(', ')}` : ''}
                          </div>
                        </div>
                        <button type="button" className="btn-secondary !h-9 !text-xs whitespace-nowrap" disabled={!!busy}
                          onClick={() => choose(p, other)}>ใช้ตัวนี้เป็นหลัก</button>
                      </div>
                    );
                  })}
                  <div className="text-right">
                    <button type="button" className="text-xs text-muted underline" onClick={() => hidePair(c)}>ไม่ใช่สินค้าซ้ำ · ซ่อน</button>
                  </div>
                </div>
              ))}
              {products && !visible.length && <div className="text-muted">ไม่พบคู่ที่น่าจะซ้ำ</div>}
            </div>
          </>
        )}

        {pick && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="rounded-lg border border-success/40 bg-success/5 p-2.5">
                <div className="text-xs text-muted">เก็บไว้ (สินค้าหลัก)</div>
                <div className="font-medium">{pick.keep.name}</div>
                <div className="text-xs text-muted">#{pick.keep.id} · สต็อก {preview?.keep?.stock ?? pick.keep.current_stock}</div>
              </div>
              <div className="rounded-lg border border-error/40 bg-error/5 p-2.5">
                <div className="text-xs text-muted">จะถูกรวมแล้วลบ</div>
                <div className="font-medium">{pick.dup.name}</div>
                <div className="text-xs text-muted">#{pick.dup.id} · สต็อก {preview?.dup?.stock ?? pick.dup.current_stock}</div>
              </div>
            </div>
            {busy === 'preview' && <div className="text-muted">กำลังตรวจข้อมูล…</div>}
            {preview && (
              <>
                <div className="rounded-lg bg-surface-soft p-2.5 space-y-0.5">
                  <div className="font-medium">ย้ายจากสินค้าซ้ำไปสินค้าหลัก</div>
                  <div>บิลขาย {preview.sale_lines} · รับเข้า {preview.receive_lines} · คืนสินค้า {preview.return_lines} · เคลมซัพ {preview.claim_lines} · ประวัติสต็อก {preview.movements} รายการ</div>
                  {preview.tiktok_skus?.length > 0 && <div>การผูก TikTok: {preview.tiktok_skus.join(', ')} → ย้ายไปสินค้าหลัก (กด sync สต็อก TikTok หลังรวม)</div>}
                  {preview.dup_bigseller && <div>BigSeller SKU ของตัวซ้ำ: {preview.dup_bigseller}{preview.keep_bigseller ? ` (ใช้ของตัวหลัก ${preview.keep_bigseller})` : ' → ย้ายไปตัวหลัก'}</div>}
                </div>
                <label className="block space-y-1">
                  <span className="font-medium">สต็อกสินค้าหลักหลังรวม</span>
                  <input type="number" inputMode="numeric" className="input w-40" value={finalStock} onChange={e => setFinalStock(e.target.value)}/>
                  <span className="block text-xs text-muted">
                    ค่าเริ่มต้น = รวมสองตัว ({preview.keep?.stock} + {preview.dup?.stock}). ถ้านับของจริงแล้ว ใส่จำนวนจริง
                    {Number.isInteger(Number(finalStock)) && stockDelta !== 0 && ` · จะบันทึกปรับสต็อก ${stockDelta > 0 ? '+' : ''}${stockDelta} (ส่งไป BigSeller ด้วย)`}
                  </span>
                </label>
                <label className="block space-y-1">
                  <span className="font-medium">เหตุผล</span>
                  <input className="input w-full" placeholder="เช่น พนักงานเพิ่มรุ่นซ้ำ" value={reason} onChange={e => setReason(e.target.value)}/>
                </label>
                <div className="text-xs text-error">ย้อนกลับไม่ได้ — สินค้าซ้ำจะถูกลบ (บันทึกประวัติไว้ในระบบ)</div>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
