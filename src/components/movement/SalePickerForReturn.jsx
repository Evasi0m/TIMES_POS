import React from 'react';

/**
 * Original-sale picker shown only on the customer-Return form.
 *
 * Bill is always required for a return — there is no "manual entry / unknown
 * bill" escape hatch anymore. There are two ways to land on a selected sale:
 *   1) Search by bill ID directly (this component's search box).
 *   2) Add a product to the cart first → caller opens BillPickerPopup which
 *      shows bills containing that product. That flow is owned by the caller;
 *      this component only displays the resulting `selectedSale` (if any).
 *
 * Props:
 *   Icon, fmtTHB, fmtThaiDateShort
 *   CHANNEL_LABELS
 *   selectedSale                   — non-null once a bill is locked
 *   saleSearch, setSaleSearch
 *   saleResults, saleSearching     — caller-fetched recent-sale list
 *   onSelectSale(sale)
 *   onClearSale()
 *   showError                      — turn input ring red on submit attempt
 */
export default function SalePickerForReturn({
  Icon, fmtTHB, fmtThaiDateShort,
  CHANNEL_LABELS,
  selectedSale,
  saleSearch, setSaleSearch,
  saleResults, saleSearching,
  onSelectSale, onClearSale,
  showError,
}) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wider text-muted mb-1.5 block">
        บิลขายต้นฉบับ <span className="text-error">*</span>
      </label>

      {!selectedSale && (
        <div className={showError ? 'field-error-glow rounded-xl' : ''}>
          <input
            className="input font-mono"
            placeholder="พิมพ์เลขบิล เช่น 60590"
            value={saleSearch}
            onChange={e => setSaleSearch(e.target.value)}
          />
          {saleSearching && (
            <div className="p-3 text-sm text-muted flex gap-2"><span className="spinner" />กำลังโหลด...</div>
          )}
          {!saleSearching && (
            <div className="mt-1 card-canvas overflow-hidden max-h-52 overflow-y-auto">
              {saleResults.length === 0 && (
                <div className="p-4 text-sm text-muted text-center">ไม่พบบิล</div>
              )}
              {saleResults.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSelectSale(s)}
                  className="w-full text-left px-3 py-2.5 border-b hairline last:border-0 hover:bg-white/50 transition-colors flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="font-mono text-sm font-semibold">#{s.id}</div>
                    <div className="text-xs text-muted mt-0.5">{CHANNEL_LABELS[s.channel] || s.channel}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-medium tabular-nums">{fmtTHB(s.grand_total)}</div>
                    <div className="text-xs text-muted">{fmtThaiDateShort(s.sale_date?.slice(0, 10))}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
          <div className="text-[11px] text-muted-soft mt-1.5">
            หรือเลือกสินค้าด้านบน — ระบบจะแสดงบิลที่มีสินค้านั้นให้เลือกอัตโนมัติ
          </div>
        </div>
      )}

      {selectedSale && (
        <div className="flex items-start gap-2">
          <div className="flex-1 card-canvas p-3 rounded-xl">
            <div className="flex justify-between items-center">
              <span className="font-mono text-sm font-semibold text-ink">บิล #{selectedSale.id}</span>
              <span className="text-xs text-muted">{fmtThaiDateShort(selectedSale.sale_date?.slice(0, 10))}</span>
            </div>
            <div className="text-xs text-muted mt-0.5">
              {CHANNEL_LABELS[selectedSale.channel] || selectedSale.channel} · {fmtTHB(selectedSale.grand_total)}
            </div>
            <div className="text-[10px] text-primary mt-1 flex items-center gap-1">
              <Icon name="check" size={11} />วันที่และช่องทางถูกกรอกอัตโนมัติแล้ว · สินค้าที่เพิ่มต้องอยู่ในบิลนี้
            </div>
          </div>
          <button
            type="button"
            onClick={onClearSale}
            className="btn-ghost !p-2.5 !min-h-0 text-muted hover:text-error mt-0.5"
            title="ล้างบิลที่เลือก (จะลบสินค้าทั้งหมดออกจากรายการ)"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
