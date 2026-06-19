import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import Icon from '../ui/Icon.jsx';
import {
  STOCK_ADJUST_SUBREASONS,
  validateManualStockAdjust,
  manualAdjustProductStock,
} from '../../lib/stock-manual-adjust.js';
import { verifyCurrentUserPassword } from '../../lib/export-auth.js';

export default function StockAdjustModal({
  open,
  onClose,
  product,
  userEmail,
  onSuccess,
  toast,
}) {
  const currentStock = Number(product?.current_stock) || 0;
  const [targetQtyStr, setTargetQtyStr] = useState('');
  const [subreason, setSubreason] = useState('recording_error');
  const [note, setNote] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState('form');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setTargetQtyStr(String(currentStock));
    setSubreason('recording_error');
    setNote('');
    setPassword('');
    setStep('form');
    setBusy(false);
    setErr('');
  }, [open, product?.id, currentStock]);

  const targetQty = targetQtyStr === '' ? NaN : Number(targetQtyStr);
  const delta = Number.isFinite(targetQty) ? targetQty - currentStock : null;

  const deltaPreview = useMemo(() => {
    if (delta == null || !Number.isInteger(targetQty) || targetQty < 0) return null;
    if (delta === 0) return { text: 'ยอดไม่เปลี่ยน', unchanged: true };
    const sign = delta > 0 ? '+' : '';
    return {
      text: `Δ ${sign}${delta} → ยอดใหม่ ${targetQty}`,
      unchanged: false,
    };
  }, [delta, targetQty]);

  const goConfirm = (e) => {
    e?.preventDefault();
    setErr('');
    const validationErr = validateManualStockAdjust({ targetQty, subreason, note });
    if (validationErr) {
      setErr(validationErr);
      return;
    }
    setStep('confirm');
  };

  const submit = async (e) => {
    e?.preventDefault();
    setErr('');
    if (!password) {
      setErr('กรุณากรอกรหัสผ่านเพื่อยืนยัน');
      return;
    }
    setBusy(true);
    const auth = await verifyCurrentUserPassword(password, userEmail);
    if (!auth.ok) {
      setBusy(false);
      setErr(auth.message);
      return;
    }
    const res = await manualAdjustProductStock({
      productId: product.id,
      targetQty,
      subreason,
      note,
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    if (res.data?.unchanged) {
      toast?.push('ยอดสต็อกเท่าเดิม — ไม่มีการเปลี่ยนแปลง', 'info');
    } else {
      toast?.push(
        `ปรับสต็อกแล้ว: ${res.data.stock_before} → ${res.data.stock_after}`,
        'success',
      );
    }
    setPassword('');
    onSuccess?.(res.data);
    onClose?.();
  };

  const subreasonLabel = STOCK_ADJUST_SUBREASONS.find((r) => r.value === subreason)?.label || subreason;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={step === 'form' ? 'ปรับจำนวนคงเหลือ' : 'ยืนยันการปรับสต็อก'}
      footer={
        step === 'form' ? (
          <>
            <button type="button" className="btn-secondary" onClick={onClose}>ยกเลิก</button>
            <button type="button" className="btn-primary" onClick={goConfirm}>
              ถัดไป
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-secondary" onClick={() => { setStep('form'); setErr(''); }} disabled={busy}>
              ย้อนกลับ
            </button>
            <button type="button" className="btn-primary" onClick={submit} disabled={busy || !password}>
              {busy ? <><span className="spinner"/> กำลังบันทึก...</> : 'ยืนยันปรับสต็อก'}
            </button>
          </>
        )
      }
    >
      {step === 'form' ? (
        <form className="space-y-4" onSubmit={goConfirm}>
          <div className="rounded-xl border hairline bg-surface-soft p-3 space-y-1">
            <div className="font-medium text-ink truncate">{product?.name}</div>
            {product?.barcode && (
              <div className="text-xs text-muted font-mono">{product.barcode}</div>
            )}
            <div className="text-sm text-muted pt-1">
              ยอดปัจจุบัน: <span className="font-display text-lg text-ink tabular-nums">{currentStock}</span>
            </div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-muted font-medium">ยอดที่ต้องการ *</label>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              className="input mt-1 !text-lg !font-display tabular-nums"
              value={targetQtyStr}
              onChange={(e) => setTargetQtyStr(e.target.value)}
            />
            {deltaPreview && (
              <div className={`text-xs mt-1.5 tabular-nums ${deltaPreview.unchanged ? 'text-muted' : delta > 0 ? 'text-success' : 'text-error'}`}>
                {deltaPreview.text}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-muted font-medium">เหตุผล *</label>
            <select className="input mt-1 w-full" value={subreason} onChange={(e) => setSubreason(e.target.value)}>
              {STOCK_ADJUST_SUBREASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-muted font-medium">หมายเหตุ *</label>
            <textarea
              className="input mt-1 w-full min-h-[88px] resize-y"
              placeholder={subreason === 'other' ? 'อธิบายเหตุผลอย่างน้อย 20 ตัวอักษร…' : 'อธิบายสั้นๆ ว่าทำไมต้องปรับยอด…'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {err && <div className="text-sm text-danger">{err}</div>}
        </form>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 space-y-2 text-sm">
            <div className="flex items-start gap-2 font-medium text-ink">
              <Icon name="alert" size={18} className="text-warning shrink-0 mt-0.5"/>
              <span>ตรวจสอบก่อนบันทึก — การปรับสต็อกจะถูกบันทึกถาวร</span>
            </div>
            <div className="text-muted space-y-1 pl-7">
              <div><span className="text-muted-soft">สินค้า:</span> {product?.name}</div>
              <div><span className="text-muted-soft">ยอดเดิม → ใหม่:</span> <span className="tabular-nums font-medium text-ink">{currentStock} → {targetQty}</span></div>
              <div><span className="text-muted-soft">เปลี่ยนแปลง:</span> <span className="tabular-nums font-medium">{delta > 0 ? '+' : ''}{delta}</span></div>
              <div><span className="text-muted-soft">เหตุผล:</span> {subreasonLabel}</div>
              <div><span className="text-muted-soft">หมายเหตุ:</span> {note}</div>
            </div>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider text-muted font-medium">รหัสผ่านยืนยัน *</label>
            <input
              type="password"
              autoComplete="current-password"
              className="input mt-1"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(e); }}
            />
            <div className="text-xs text-muted-soft mt-1">ยืนยันตัวตนก่อนปรับสต็อก (เฉพาะ Super Admin)</div>
          </div>

          {err && <div className="text-sm text-danger">{err}</div>}
        </form>
      )}
    </Modal>
  );
}
