import React, { useMemo, useRef, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import Icon from '../ui/Icon.jsx';
import { sb } from '../../lib/supabase-client.js';
import { searchProducts } from '../../lib/product-search.js';
import { enrichProduct } from '../../lib/product-classify.js';
import {
  STOCK_ADJUST_SUBREASONS,
  validateBulkManualStockAdjust,
  bulkManualAdjustProductStock,
  countBulkAdjustChanges,
  formatBulkAdjustToast,
  notifyStockAdjustTelegram,
} from '../../lib/stock-manual-adjust.js';
import { verifyCurrentUserPassword } from '../../lib/export-auth.js';
import {
  fetchTikTokMappings,
  mirrorStockAfterManualAdjust,
} from '../../lib/tiktok-inventory-sync.js';

function emptyRow() {
  return { key: Date.now() + Math.random(), product: null, targetQtyStr: '' };
}

/** Keep one trailing empty row; return next rows + key to focus for search/pick. */
function withTrailingEmptyRow(rows) {
  const last = rows[rows.length - 1];
  if (last && !last.product?.id) {
    return { rows, activeKey: last.key };
  }
  const newRow = emptyRow();
  return { rows: [...rows, newRow], activeKey: newRow.key };
}

export default function BulkStockAdjustView({
  open,
  onClose,
  userEmail,
  toast,
  onSuccess,
}) {
  const [rows, setRows] = useState([emptyRow()]);
  const [searchQ, setSearchQ] = useState('');
  const [searchHits, setSearchHits] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [activeRowKey, setActiveRowKey] = useState(null);
  const [subreason, setSubreason] = useState('physical_count');
  const [note, setNote] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState('edit');
  const [busy, setBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [err, setErr] = useState('');
  const [applyResult, setApplyResult] = useState(null);
  const [tiktokMappedIds, setTiktokMappedIds] = useState(new Set());
  const applyLockRef = useRef(false);

  const reset = () => {
    setRows([emptyRow()]);
    setSearchQ('');
    setSearchHits([]);
    setActiveRowKey(null);
    setSubreason('physical_count');
    setNote('');
    setPassword('');
    setStep('edit');
    setBusy(false);
    setSyncBusy(false);
    setErr('');
    setApplyResult(null);
    setTiktokMappedIds(new Set());
  };

  const handleClose = () => {
    reset();
    onClose?.();
  };

  const filledRows = useMemo(() => rows.filter((r) => r.product?.id), [rows]);

  const adjustItems = useMemo(() => filledRows.map((r) => ({
    productId: r.product.id,
    targetQty: r.targetQtyStr === '' ? NaN : Number(r.targetQtyStr),
    currentStock: Number(r.product.current_stock) || 0,
    name: r.product.name,
  })), [filledRows]);

  const changeCount = useMemo(
    () => countBulkAdjustChanges(adjustItems),
    [adjustItems],
  );

  const runSearch = async (q) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setSearchHits([]);
      return;
    }
    setSearchBusy(true);
    const { data, error } = await searchProducts(sb, trimmed);
    setSearchBusy(false);
    if (error) {
      toast?.push('ค้นหาไม่สำเร็จ: ' + error.message, 'error');
      return;
    }
    setSearchHits((data || []).map(enrichProduct));
  };

  const pickProduct = (product) => {
    if (!activeRowKey || !product?.id) return;
    if (filledRows.some((r) => r.key !== activeRowKey && r.product?.id === product.id)) {
      toast?.push('สินค้านี้มีในรายการแล้ว', 'warning');
      return;
    }
    const pickedKey = activeRowKey;
    const updated = rows.map((r) => (
      r.key === pickedKey
        ? { ...r, product, targetQtyStr: String(product.current_stock ?? 0) }
        : r
    ));
    const { rows: nextRows, activeKey } = withTrailingEmptyRow(updated);
    setRows(nextRows);
    setSearchQ('');
    setSearchHits([]);
    setActiveRowKey(activeKey);
  };

  const addRow = () => {
    const { rows: nextRows, activeKey } = withTrailingEmptyRow(rows);
    setRows(nextRows);
    setActiveRowKey(activeKey);
  };

  const removeRow = (key) => {
    const next = rows.filter((r) => r.key !== key);
    const base = next.length ? next : [emptyRow()];
    const { rows: nextRows, activeKey } = withTrailingEmptyRow(base);
    setRows(nextRows);
    setActiveRowKey(activeKey);
  };

  const goConfirm = () => {
    setErr('');
    const validationErr = validateBulkManualStockAdjust({ items: adjustItems, subreason, note });
    if (validationErr) {
      setErr(validationErr);
      return;
    }
    if (changeCount === 0) {
      setErr('ไม่มีรายการที่เปลี่ยนยอด — กรุณาแก้ยอดที่ต้องการก่อน');
      return;
    }
    setStep('confirm');
  };

  const submit = async () => {
    if (applyLockRef.current) return;
    setErr('');
    if (!password) {
      setErr('กรุณากรอกรหัสผ่านเพื่อยืนยัน');
      return;
    }
    applyLockRef.current = true;
    setBusy(true);
    const auth = await verifyCurrentUserPassword(password, userEmail);
    if (!auth.ok) {
      setBusy(false);
      applyLockRef.current = false;
      setErr(auth.message);
      return;
    }

    const batchId = Date.now();
    const res = await bulkManualAdjustProductStock({
      batchId,
      items: adjustItems,
      subreason,
      note,
    });
    setBusy(false);
    applyLockRef.current = false;

    if (!res.ok) {
      setErr(res.message);
      return;
    }

    const { msg, type } = formatBulkAdjustToast(res.data);
    toast?.push(msg, type);

    if ((res.data?.applied ?? 0) > 0) {
      notifyStockAdjustTelegram({ batchId: res.data.batch_id ?? batchId });
    }

    const changedIds = adjustItems
      .filter((it) => it.targetQty !== it.currentStock)
      .map((it) => it.productId);
    const errorIds = new Set(
      (res.data?.errors || []).map((e) => e.product_id).filter((id) => id != null),
    );
    const successIds = changedIds.filter((id) => !errorIds.has(id));
    if (successIds.length) {
      fetchTikTokMappings(successIds)
        .then((maps) => {
          const ids = new Set(
            (maps || [])
              .filter((m) => m.sync_enabled !== false && m.tiktok_sku_id && m.tiktok_product_id)
              .map((m) => m.product_id),
          );
          setTiktokMappedIds(ids);
        })
        .catch(() => setTiktokMappedIds(new Set()));
    }

    setApplyResult({ ...res.data, batchId: res.data.batch_id ?? batchId });
    setPassword('');
    onSuccess?.(res.data);
    setStep('done');
  };

  const runTikTokSyncAll = async () => {
    if (!applyResult?.batchId) return;
    const ids = [...tiktokMappedIds];
    if (!ids.length) {
      toast?.push('ไม่มี mapping TikTok ที่พร้อม sync', 'info');
      return;
    }
    setSyncBusy(true);
    try {
      await mirrorStockAfterManualAdjust({
        batchId: applyResult.batchId,
        productIds: ids,
        toast,
      });
    } catch (e) {
      toast?.push('Sync TikTok ไม่สำเร็จ: ' + (e?.message || e), 'error');
    } finally {
      setSyncBusy(false);
    }
  };

  const subreasonLabel = STOCK_ADJUST_SUBREASONS.find((r) => r.value === subreason)?.label || subreason;

  const title = step === 'edit'
    ? 'ปรับสต็อกกลุ่ม'
    : step === 'confirm'
      ? 'ยืนยันการปรับสต็อกกลุ่ม'
      : 'ปรับสต็อกกลุ่มสำเร็จ';

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title}
      wide
      footer={
        step === 'edit' ? (
          <>
            <button type="button" className="btn-secondary" onClick={handleClose}>ยกเลิก</button>
            <button type="button" className="btn-primary" onClick={goConfirm} disabled={changeCount === 0}>
              ถัดไป ({changeCount} รายการ)
            </button>
          </>
        ) : step === 'confirm' ? (
          <>
            <button type="button" className="btn-secondary" onClick={() => { setStep('edit'); setErr(''); }} disabled={busy}>
              ย้อนกลับ
            </button>
            <button type="button" className="btn-primary" onClick={submit} disabled={busy || !password}>
              {busy ? <><span className="spinner"/> กำลังบันทึก...</> : 'ยืนยันปรับสต็อกกลุ่ม'}
            </button>
          </>
        ) : (
          <>
            {tiktokMappedIds.size > 0 && (
              <button type="button" className="btn-secondary" onClick={runTikTokSyncAll} disabled={syncBusy}>
                {syncBusy ? <><span className="spinner"/> กำลัง sync...</> : `Sync TikTok (${tiktokMappedIds.size})`}
              </button>
            )}
            <button type="button" className="btn-primary" onClick={handleClose}>ปิด</button>
          </>
        )
      }
    >
      {step === 'edit' && (
        <div className="space-y-4">
          <div className="rounded-xl border hairline bg-surface-soft p-3 space-y-2">
            <div className="text-xs uppercase tracking-wider text-muted font-medium">ค้นหาสินค้า</div>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="ชื่อ, รหัส, บาร์โค้ด…"
                value={searchQ}
                onChange={(e) => {
                  setSearchQ(e.target.value);
                  runSearch(e.target.value);
                }}
                onFocus={() => {
                  if (!activeRowKey && rows.length) setActiveRowKey(rows[rows.length - 1].key);
                }}
              />
            </div>
            {searchBusy && <div className="text-xs text-muted flex items-center gap-2"><span className="spinner"/> กำลังค้นหา…</div>}
            {searchHits.length > 0 && (
              <div className="border hairline rounded-lg max-h-40 overflow-y-auto divide-y hairline-soft">
                {searchHits.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-surface-strong text-sm"
                    onClick={() => pickProduct(p)}
                  >
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted tabular-nums">
                      คงเหลือ {p.current_stock ?? 0}
                      {p.barcode ? ` · ${p.barcode}` : ''}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wider text-muted font-medium">รายการ ({filledRows.length})</div>
              <button type="button" className="btn-secondary !text-xs !py-1 !px-2" onClick={addRow}>
                <Icon name="plus" size={14}/> เพิ่มแถว
              </button>
            </div>
            {rows.map((row, idx) => (
              <div key={row.key} className="flex gap-2 items-start border hairline rounded-lg p-2">
                <div className="flex-1 min-w-0 space-y-1">
                  {row.product ? (
                    <>
                      <div className="font-medium text-sm truncate">{row.product.name}</div>
                      <div className="text-xs text-muted tabular-nums">
                        คงเหลือ: {row.product.current_stock ?? 0}
                      </div>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="text-sm text-muted hover:text-ink"
                      onClick={() => setActiveRowKey(row.key)}
                    >
                      เลือกสินค้า (ค้นหาด้านบน)
                    </button>
                  )}
                </div>
                <div className="w-24 shrink-0">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="input !text-sm tabular-nums"
                    placeholder="ยอด"
                    value={row.targetQtyStr}
                    disabled={!row.product}
                    onChange={(e) => setRows((prev) => prev.map((r) => (
                      r.key === row.key ? { ...r, targetQtyStr: e.target.value } : r
                    )))}
                  />
                </div>
                <button type="button" className="btn-secondary !p-2 shrink-0" onClick={() => removeRow(row.key)} aria-label={`ลบแถว ${idx + 1}`}>
                  <Icon name="trash" size={16}/>
                </button>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-wider text-muted font-medium">เหตุผล (ใช้ร่วมทั้ง batch) *</label>
              <select className="input mt-1 w-full" value={subreason} onChange={(e) => setSubreason(e.target.value)}>
                {STOCK_ADJUST_SUBREASONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-muted font-medium">
                หมายเหตุ (ใช้ร่วมทั้ง batch){subreason === 'other' ? ' *' : ''}
              </label>
              <textarea
                className="input mt-1 w-full min-h-[72px] resize-y"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  subreason === 'other'
                    ? 'อธิบายเหตุผลอย่างน้อย 20 ตัวอักษร…'
                    : 'ไม่บังคับ — เพิ่มรายละเอียดได้ถ้าต้องการ'
                }
              />
            </div>
          </div>

          {err && <div className="text-sm text-danger">{err}</div>}
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm space-y-2">
            <div className="font-medium text-ink">กำลังปรับสต็อก — {changeCount} รายการจะเปลี่ยน</div>
            <div className="text-muted">เหตุผล: {subreasonLabel}</div>
            {note.trim() && <div className="text-muted">หมายเหตุ: {note.trim()}</div>}
          </div>
          <div className="max-h-48 overflow-y-auto border hairline rounded-lg divide-y hairline-soft text-sm">
            {adjustItems.filter((it) => it.targetQty !== it.currentStock).map((it) => (
              <div key={it.productId} className="px-3 py-2 flex justify-between gap-2">
                <span className="truncate">{it.name}</span>
                <span className="tabular-nums shrink-0 text-muted">
                  {it.currentStock} → {it.targetQty}
                </span>
              </div>
            ))}
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-muted font-medium">รหัสผ่านยืนยัน *</label>
            <input
              type="password"
              autoComplete="current-password"
              className="input mt-1"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="text-xs text-muted-soft mt-1">ยืนยันตัวตนก่อนปรับสต็อก (เฉพาะ Super Admin)</div>
          </div>
          {err && <div className="text-sm text-danger">{err}</div>}
        </div>
      )}

      {step === 'done' && applyResult && (
        <div className="space-y-4 text-sm">
          <div className="rounded-xl border border-success/30 bg-success/5 p-4 space-y-1">
            <div className="font-medium text-ink">บันทึกเรียบร้อย</div>
            <div className="text-muted tabular-nums">
              สำเร็จ {applyResult.applied ?? 0}
              {(applyResult.unchanged ?? 0) > 0 && ` · ไม่เปลี่ยน ${applyResult.unchanged}`}
              {Array.isArray(applyResult.errors) && applyResult.errors.length > 0 && (
                <> · ผิดพลาด {applyResult.errors.length}</>
              )}
            </div>
          </div>
          {Array.isArray(applyResult.errors) && applyResult.errors.length > 0 && (
            <div className="border hairline rounded-lg max-h-32 overflow-y-auto divide-y hairline-soft">
              {applyResult.errors.map((e, i) => (
                <div key={i} className="px-3 py-2 text-danger text-xs">
                  ID {e.product_id}: {e.error}
                </div>
              ))}
            </div>
          )}
          {tiktokMappedIds.size > 0 && (
            <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 flex items-start gap-2">
              <Icon name="shop-bag" size={16} className="text-warning shrink-0 mt-0.5"/>
              <span className="text-muted">
                มี {tiktokMappedIds.size} รายการเชื่อม TikTok — POS เปลี่ยนแล้ว แต่ Sync ไป TikTok Shop ต้องกดปุ่มด้านล่าง
              </span>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
