import React from 'react';

/**
 * Supplier picker + invoice no + claim reason + VAT toggle.
 * Used by Receive (kind='receive') and Claim (kind='claim') forms.
 *
 * State is owned by parent (StockMovementForm) and passed as props.
 *
 * Props:
 *   Icon
 *   kind: 'receive' | 'claim'
 *   SUPPLIERS, CLAIM_REASONS — constant lists from main.jsx
 *   supplierName, setSupplierName
 *   supplierInvoiceNo, setSupplierInvoiceNo
 *   hasVat, setHasVat
 *   returnReason, setReturnReason  — used only when kind='claim'
 *   errCls(key)                    — fn returning ' field-error-glow'
 *                                     suffix or '' (Phase 2.3)
 */
export default function SupplierForm({
  Icon, kind,
  SUPPLIERS, CLAIM_REASONS,
  supplierName, setSupplierName,
  supplierInvoiceNo, setSupplierInvoiceNo,
  hasVat, setHasVat,
  returnReason, setReturnReason,
  errCls,
}) {
  const supplierLabel = kind === 'receive' ? 'ผู้ขาย / Supplier' : 'บริษัทที่ส่งคืน';
  const invoiceLabel  = kind === 'receive' ? 'เลขบิล' : 'เลขเอกสารส่งคืน / Tracking';

  return (
    <>
      <div className={"rounded-xl" + errCls('supplier')}>
        <label className="text-xs uppercase tracking-wider text-muted">{supplierLabel} <span className="text-error">*</span></label>
        <div className="grid grid-cols-2 gap-2 mt-1.5">
          {SUPPLIERS.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setSupplierName(s)}
              className={"py-2.5 px-3 rounded-lg text-sm font-medium border transition-all text-center " +
                (supplierName === s
                  ? "bg-primary text-on-primary border-primary shadow-md"
                  : "glass-soft text-ink hover:bg-white/60 hover-lift")}
            >
              {supplierName === s && <Icon name="check" size={14} className="inline mr-1.5" strokeWidth={2.5} />}
              {s}
            </button>
          ))}
        </div>
      </div>

      {kind === 'claim' && (
        <div className={"rounded-xl" + errCls('claimReason')}>
          <label className="text-xs uppercase tracking-wider text-muted">เหตุผลที่ส่งคืน <span className="text-error">*</span></label>
          <select
            className="input mt-1 !h-10"
            value={returnReason}
            onChange={e => setReturnReason(e.target.value)}
          >
            <option value="">— เลือก —</option>
            {CLAIM_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      )}

      <div>
        <label className="text-xs uppercase tracking-wider text-muted">
          {invoiceLabel} <span className="text-muted-soft normal-case tracking-normal">(ไม่บังคับ — ไม่กรอกจะใช้วันเวลาเป็นเลขบิล)</span>
        </label>
        <input
          className="input mt-1 !h-10 font-mono"
          placeholder={kind === 'receive' ? "เว้นว่างเพื่อสร้างอัตโนมัติ" : "เช่น CLM-2026-0001 หรือ Tracking no."}
          value={supplierInvoiceNo}
          onChange={e => setSupplierInvoiceNo(e.target.value)}
        />
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <span className={"relative flex items-center justify-center w-5 h-5 rounded border transition-colors " + (hasVat ? "bg-primary border-primary" : "bg-canvas border-hairline")}>
          <input
            type="checkbox" className="sr-only"
            checked={hasVat}
            onChange={e => setHasVat(e.target.checked)}
          />
          {hasVat && <Icon name="check" size={13} className="text-white" strokeWidth={2.5} />}
        </span>
        <span className="text-sm">
          {kind === 'receive' ? 'รวม VAT 7% (มี input VAT เคลมได้)' : 'รวม VAT 7% (กลับรายการ input VAT)'}
        </span>
      </label>
    </>
  );
}
