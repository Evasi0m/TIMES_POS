import React from 'react';
import RecentReceiveBadge from './RecentReceiveBadge.jsx';

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
 *   recentReceivesMap — Map<product_id, {lastDate,supplier,invoice}> from
 *                      useRecentReceivesMap(). When provided AND kind ===
 *                      'receive', a small amber "พึ่งรับ X วันก่อน" badge
 *                      shows next to any product line that matches.
 *                      Designed to prevent the user from entering the
 *                      same supplier bill twice within a week.
 */
export default function MovementItemsPanel({
  Icon, fmtTHB, applyDiscounts, UNITS,
  items, kind, costPctEnabled, costPct,
  onUpdItem, onUpdPrice, onRemoveItem,
  showItemsError = false,
  recentReceivesMap = null,
}) {
  const empty = !items.length;
  return (
    <div
      className={
        "movement-items-scroll max-h-[40vh] lg:max-h-[42vh] overflow-y-auto p-3 transition-colors " +
        (empty && showItemsError ? "field-error-glow rounded-md" : "")
      }
    >
      {empty && (
        <div className={"p-6 text-center text-sm " + (showItemsError ? "text-error" : "text-muted")}>
          {showItemsError ? "กรุณาเพิ่มรายการอย่างน้อย 1 รายการ" : "ยังไม่มีรายการ"}
        </div>
      )}
      {items.map((l, i) => {
        // Only flag on the receive form — claim/return don't add stock
        // from a supplier bill, so a "พึ่งรับ" badge would be confusing.
        const recentInfo = (kind === 'receive' && recentReceivesMap && l.product_id)
          ? recentReceivesMap.get(l.product_id)
          : null;
        return (
        <div key={l._uid || i} className="glass-soft rounded-lg p-3 mb-2 hover-lift fade-in">
          <div className="flex items-start justify-between gap-2">
            {/* Big index — 24px bold terra-cotta numeral that matches
                `.btn-add-product`'s palette. Purely decorative (the
                item identity is the product_name) so aria-hidden, but
                invaluable when the user is verifying 10+ bills and
                wants to quickly say "row 3 wrong". */}
            <span className="movement-item-index" aria-hidden="true">
              {i + 1}
            </span>
            <div className="font-medium text-sm flex-1 truncate">{l.product_name}</div>
            <button
              className="text-muted-soft hover:text-error p-1"
              onClick={() => onRemoveItem(i)}
              aria-label="ลบรายการ"
            >
              <Icon name="trash" size={14} />
            </button>
          </div>
          {/* Duplicate-bill guard — shows when this product was already
              received within the last 7 days. Placed on its own row so
              long product names don't get pushed around. */}
          {recentInfo && (
            <div className="mt-1.5 -ml-0.5">
              <RecentReceiveBadge info={recentInfo} />
            </div>
          )}
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
        );
      })}
    </div>
  );
}
