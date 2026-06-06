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
 *   supplierTaxId, setSupplierTaxId  — Thai 13-digit tax ID for ภ.พ.30
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
  supplierTaxId, setSupplierTaxId,
  hasVat, setHasVat,
  returnReason, setReturnReason,
  errCls,
  // Receive only — supplier registry picker (props supplied by StockMovementForm).
  selectedSupplier, onOpenPicker, onClearSupplier,
}) {
  const supplierLabel = kind === 'receive' ? 'ผู้ขาย / Supplier' : 'บริษัทที่ส่งคืน';
  const invoiceLabel  = kind === 'receive' ? 'เลขบิล' : 'เลขเอกสารส่งคืน / Tracking';

  return (
    <>
      {kind === 'receive' ? (
        // Receive: pick from the saved supplier registry (full details for the
        // purchase document / ภ.พ.30) or type a name for petty/informal receives.
        <div className={"rounded-xl" + errCls('supplier')}>
          <label className="text-xs uppercase tracking-wider text-muted">{supplierLabel} <span className="text-error">*</span></label>
          {selectedSupplier ? (
            <div className="mt-1.5 flex items-center gap-2 p-3 rounded-lg border hairline bg-surface-soft">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{selectedSupplier.business_name}</div>
                <div className="text-xs text-muted-soft font-mono">
                  {selectedSupplier.tax_id || '—'} · {selectedSupplier.branch_type === 'branch' ? `สาขา ${selectedSupplier.branch_code || ''}` : 'สำนักงานใหญ่'}
                </div>
              </div>
              <button type="button" className="btn-secondary !py-1.5 !px-3 text-xs" onClick={onOpenPicker}>เปลี่ยน</button>
              <button type="button" className="btn-ghost !p-2" title="ล้าง" onClick={onClearSupplier}><Icon name="x" size={16}/></button>
            </div>
          ) : (
            <div className="mt-1.5 space-y-2">
              <button type="button" onClick={onOpenPicker}
                className="w-full py-2.5 px-3 rounded-lg text-sm font-medium border border-primary/40 text-primary bg-primary/5 hover:bg-primary/10 transition inline-flex items-center justify-center gap-1.5">
                <Icon name="search" size={15}/> เลือกผู้จำหน่ายจากทะเบียน
              </button>
              <input
                className="input !h-10"
                placeholder="หรือพิมพ์ชื่อผู้ขายเอง (รับเข้าเล็กๆ เช่น ถ่าน, สาย)"
                value={supplierName}
                onChange={e => setSupplierName(e.target.value)}
              />
            </div>
          )}
        </div>
      ) : (
        <div className={"rounded-xl" + errCls('supplier')}>
          <label className="text-xs uppercase tracking-wider text-muted">{supplierLabel} <span className="text-error">*</span></label>
          <div className="grid grid-cols-2 gap-2 mt-1.5">
            {SUPPLIERS.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setSupplierName(s)}
                className={"py-2.5 px-3 rounded-lg text-sm font-medium border transition-all text-center inline-flex items-center justify-center gap-1.5 " +
                  (supplierName === s
                    ? "btn-segment-active text-white"
                    : "glass-soft text-ink hover:bg-white/60 hover-lift")}
              >
                {supplierName === s && <Icon name="check" size={14} strokeWidth={2.5} />}
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

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

      {/* Supplier tax ID — Thai 13-digit. Required for ภ.พ.30 รายงานภาษีซื้อ
          CSV export but optional in DB so legacy/petty receipts still save. */}
      {kind === 'receive' && setSupplierTaxId && !selectedSupplier && (
        <div>
          <label className="text-xs uppercase tracking-wider text-muted">
            เลขประจำตัวผู้เสียภาษีของผู้ขาย <span className="text-muted-soft normal-case tracking-normal">(ไม่บังคับ · 13 หลัก · ใช้ออกรายงาน ภ.พ.30)</span>
          </label>
          <input
            className="input mt-1 !h-10 font-mono tabular-nums"
            placeholder="0-0000-00000-00-0"
            inputMode="numeric"
            maxLength={13}
            value={supplierTaxId || ''}
            onChange={e => setSupplierTaxId(e.target.value.replace(/\D/g, '').slice(0, 13))}
          />
        </div>
      )}

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
          {kind === 'receive' ? 'รวม VAT 7% (คำนวณบวกอัตโนมัติจากราคาก่อน VAT ด้านบน)' : 'รวม VAT 7% (คำนวณบวกอัตโนมัติ)'}
        </span>
      </label>
    </>
  );
}
