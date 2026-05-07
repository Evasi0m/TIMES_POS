import React from 'react';

/**
 * Original-sale picker shown only on the customer-Return form.
 * Caller drives data fetching and selection state — this component is
 * purely presentational.
 *
 * Props:
 *   Icon, fmtTHB, fmtThaiDateShort
 *   CHANNEL_LABELS
 *   items                          — current cart items (used to gate manual mode)
 *   origSaleMode, setOrigSaleMode  — 'search' | 'manual'
 *   selectedSale,
 *   saleSearch, setSaleSearch
 *   saleResults, saleSearching
 *   origSaleId, setOrigSaleId
 *   onSelectSale(sale)
 *   onClearSale()
 *   onWantManualButNoItems()       — fired when user taps "manual" but cart empty
 */
export default function SalePickerForReturn({
  Icon, fmtTHB, fmtThaiDateShort,
  CHANNEL_LABELS,
  items,
  origSaleMode, setOrigSaleMode,
  selectedSale,
  saleSearch, setSaleSearch,
  saleResults, saleSearching,
  origSaleId, setOrigSaleId,
  onSelectSale, onClearSale,
  onWantManualButNoItems,
}) {
  const goManual = () => {
    if (items.length === 0) {
      onWantManualButNoItems?.();
      return;
    }
    setOrigSaleMode('manual');
    onClearSale();
  };

  return (
    <div>
      <label className="text-xs uppercase tracking-wider text-muted mb-1.5 block">บิลขายต้นฉบับ</label>
      <div className="flex gap-1 mb-2">
        <button
          type="button"
          onClick={() => { setOrigSaleMode('search'); onClearSale(); }}
          className={"flex-1 py-2 px-3 rounded-lg text-xs font-medium border transition-all inline-flex items-center justify-center gap-1 " +
            (origSaleMode === 'search' ? "text-white" : "glass-soft text-muted hover:text-ink")}
          style={origSaleMode === 'search' ? { background: 'linear-gradient(180deg, rgba(204,120,92,0.85) 0%, rgba(184,100,72,0.92) 100%)', borderColor: 'rgba(255,255,255,0.18)', boxShadow: '0 2px 8px rgba(184,100,72,0.35), 0 1px 0 rgba(255,255,255,0.18) inset' } : {}}
        >
          <Icon name="search" size={13} />ค้นหาบิล
        </button>
        <button
          type="button"
          onClick={goManual}
          className={"flex-1 py-2 px-3 rounded-lg text-xs font-medium border transition-all inline-flex items-center justify-center gap-1 " +
            (origSaleMode === 'manual' ? "text-white" : "glass-soft text-muted hover:text-ink")}
          style={origSaleMode === 'manual' ? { background: 'linear-gradient(180deg, rgba(204,120,92,0.85) 0%, rgba(184,100,72,0.92) 100%)', borderColor: 'rgba(255,255,255,0.18)', boxShadow: '0 2px 8px rgba(184,100,72,0.35), 0 1px 0 rgba(255,255,255,0.18) inset' } : {}}
        >
          <Icon name="edit" size={13} />กรอกเองหรือไม่ทราบเลขบิล
        </button>
      </div>

      {origSaleMode === 'search' && !selectedSale && (
        <div>
          <input
            className="input !h-10 font-mono"
            placeholder="พิมพ์เลขบิล เช่น 60590"
            value={saleSearch}
            onChange={e => setSaleSearch(e.target.value)}
            autoFocus
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
        </div>
      )}

      {origSaleMode === 'search' && selectedSale && (
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
              <Icon name="check" size={11} />วันที่และช่องทางถูกกรอกอัตโนมัติแล้ว
            </div>
          </div>
          <button
            type="button"
            onClick={onClearSale}
            className="btn-ghost !p-2.5 !min-h-0 text-muted hover:text-error mt-0.5"
            title="ล้างบิลที่เลือก"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      )}

      {origSaleMode === 'manual' && (
        <div className="flex items-center gap-2">
          <input
            className="input !h-10 font-mono flex-1"
            placeholder="เลขบิล (ไม่บังคับ)"
            inputMode="numeric"
            value={origSaleId}
            onChange={e => setOrigSaleId(e.target.value.replace(/\D/g, ''))}
          />
          {origSaleId && (
            <button
              type="button"
              onClick={() => setOrigSaleId("")}
              className="btn-ghost !p-2.5 !min-h-0 text-muted"
              aria-label="ล้างเลขบิล"
            >
              <Icon name="x" size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
