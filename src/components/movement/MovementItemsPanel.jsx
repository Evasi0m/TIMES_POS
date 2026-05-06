import React from 'react';

/**
 * Per-line items list inside the right panel of StockMovementForm.
 * Pure presentational — parent owns `items` state and the update fns.
 *
 * Props:
 *   Icon, fmtTHB, applyDiscounts, UNITS
 *   items, kind, costPctEnabled, costPct
 *   onUpdItem(i, patch) / onUpdPrice(i, val) / onRemoveItem(i)
 *   showItemsError (Phase 2.3) — visual error glow when submit attempted
 *                                with no items
 */
export default function MovementItemsPanel({
  Icon, fmtTHB, applyDiscounts, UNITS,
  items, kind, costPctEnabled, costPct,
  onUpdItem, onUpdPrice, onRemoveItem,
  showItemsError = false,
}) {
  const empty = !items.length;
  return (
    <div
      className={
        "max-h-[40vh] lg:max-h-[42vh] overflow-y-auto p-3 transition-colors " +
        (empty && showItemsError ? "field-error-glow rounded-md" : "")
      }
    >
      {empty && (
        <div className={"p-6 text-center text-sm " + (showItemsError ? "text-error" : "text-muted")}>
          {showItemsError ? "กรุณาเพิ่มรายการอย่างน้อย 1 รายการ" : "ยังไม่มีรายการ"}
        </div>
      )}
      {items.map((l, i) => (
        <div key={l._uid || i} className="glass-soft rounded-lg p-3 mb-2 hover-lift fade-in">
          <div className="flex items-start justify-between gap-2">
            <div className="font-medium text-sm flex-1 truncate">{l.product_name}</div>
            <button
              className="text-muted-soft hover:text-error p-1"
              onClick={() => onRemoveItem(i)}
              aria-label="ลบรายการ"
            >
              <Icon name="trash" size={14} />
            </button>
          </div>
          <div className="grid grid-cols-12 gap-2 mt-2">
            <input
              type="number" inputMode="numeric" min="1"
              className="input !py-1.5 !text-xs col-span-3"
              value={l.quantity}
              onChange={e => onUpdItem(i, { quantity: Math.max(1, Number(e.target.value) || 1) })}
            />
            <select
              className="input !py-1.5 !text-xs col-span-3"
              value={l.unit}
              onChange={e => onUpdItem(i, { unit: e.target.value })}
            >
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <input
              type="number" inputMode="decimal"
              className="input !py-1.5 !text-xs col-span-6 text-right"
              value={l.unit_price}
              onChange={e => onUpdPrice(i, e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between mt-2">
            <div className="text-[10px] text-muted-soft">
              {l.manualPrice
                ? (Number(l.retail_price) > 0
                    ? `แก้เอง · ${(l.unit_price / l.retail_price * 100).toFixed(1)}% ของ ${fmtTHB(l.retail_price)}`
                    : 'แก้เอง')
                : (costPctEnabled && (kind === 'receive' || kind === 'claim'))
                  ? `ลด ${costPct}% จาก ${fmtTHB(l.retail_price)}`
                  : (Number(l.retail_price) > 0 ? `ราคาป้าย ${fmtTHB(l.retail_price)}` : '')}
            </div>
            <div className="text-sm font-medium">
              {fmtTHB(applyDiscounts(
                l.unit_price, l.quantity,
                l.discount1_value, l.discount1_type,
                l.discount2_value, l.discount2_type
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
