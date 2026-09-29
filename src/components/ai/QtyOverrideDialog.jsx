import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../ui/Icon.jsx';
import { sb } from '../../lib/supabase-client.js';
import { verifyCurrentUserPassword, exporterDisplayName } from '../../lib/export-auth.js';

/**
 * Password gate for saving a row whose quantity/cost no longer matches the
 * printed CMG bill (e.g. supplier over-billed and a corrected bill is on the
 * way). On success calls onApproved({ by, at }).
 */
export default function QtyOverrideDialog({ open, row, billQty, onApproved, onClose }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setErr('');
    setBusy(false);
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [open]);

  if (!open || !row) return null;

  const submit = async (e) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr('');
    const { data } = await sb.auth.getUser();
    const user = data?.user;
    const auth = await verifyCurrentUserPassword(password, user?.email);
    if (!auth.ok) {
      setBusy(false);
      setErr(auth.message);
      return;
    }
    setBusy(false);
    onApproved({ by: exporterDisplayName(user), at: new Date().toISOString() });
  };

  const label = row.product?.name || row.newProduct?.name || row.model_code || 'รายการนี้';

  return createPortal(
    <div className="fixed inset-0 z-[160] flex items-end lg:items-center justify-center p-0 lg:p-4 overlay-in" onClick={onClose}>
      <div className="absolute inset-0 modal-overlay" aria-hidden="true"/>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full lg:max-w-md glass-strong rounded-t-2xl lg:rounded-2xl border hairline p-5 space-y-4 sheet-anim"
        role="dialog"
        aria-modal="true"
        aria-label="ยืนยันจำนวนต่างจากบิล"
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-warning/15 text-warning flex items-center justify-center shrink-0">
            <Icon name="lock" size={18}/>
          </div>
          <div className="min-w-0">
            <div className="font-display text-base font-semibold">บันทึกจำนวนต่างจากบิล</div>
            <div className="text-xs text-muted mt-0.5">ใช้เมื่อบริษัทออกบิลผิดและกำลังส่งบิลแก้ไขมา</div>
          </div>
        </div>

        <div className="rounded-xl border hairline bg-surface-soft/60 p-3 text-sm space-y-1.5">
          <div className="font-mono font-semibold truncate" title={label}>{label}</div>
          <div className="flex items-center justify-between tabular-nums">
            <span className="text-muted">ในบิล</span>
            <span>{billQty != null ? `${billQty} ชิ้น` : '—'}</span>
          </div>
          <div className="flex items-center justify-between tabular-nums">
            <span className="text-muted">รับเข้าจริง</span>
            <span className="font-semibold text-warning">{Number(row.quantity) || 0} ชิ้น</span>
          </div>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted">ใส่รหัสผ่านของบัญชีที่ login อยู่เพื่อยืนยัน</span>
          <input
            ref={inputRef}
            type="password"
            className="input w-full"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="รหัสผ่าน"
            disabled={busy}
          />
        </label>
        {err && <div className="text-xs text-error">{err}</div>}

        <div className="flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button type="submit" className="btn-primary flex-1" disabled={busy || !password}>
            {busy ? <><span className="spinner"/> กำลังตรวจ…</> : <><Icon name="check" size={15}/> ยืนยัน</>}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
