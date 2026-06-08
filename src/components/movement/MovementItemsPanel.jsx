import React from 'react';
import RecentReceiveBadge from './RecentReceiveBadge.jsx';
import { isTikTokLineReady } from '../../lib/tiktok-inventory-sync.js';
import { tiktokSkuDisplayLabel } from '../../lib/tiktok-mirror-helpers.js';

function TikTokLineBadge({ line, unresolved, onRematch }) {
  if (line.tiktok_skip) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-muted/15 text-muted border border-hairline hover:bg-muted/25 transition-colors"
        onClick={onRematch}
      >
        ไม่ sync
      </button>
    );
  }
  if (line.tiktok_sku) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-success/10 text-success border border-success/20 hover:bg-success/15 transition-colors"
        onClick={onRematch}
      >
        ✓ {tiktokSkuDisplayLabel(line.tiktok_sku)}
      </button>
    );
  }
  if (line.tiktok_mapping?.seller_sku) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-success/10 text-success border border-success/20 hover:bg-success/15 transition-colors"
        onClick={onRematch}
      >
        ✓ {line.tiktok_mapping.seller_sku}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border transition-colors ' +
        (unresolved
          ? 'bg-error/10 text-error border-error/30 hover:bg-error/15 animate-pulse'
          : 'bg-warning/10 text-warning border-warning/30 hover:bg-warning/15')
      }
      onClick={onRematch}
    >
      รอจับคู่
    </button>
  );
}

/**
 * Per-line items list inside the right panel of StockMovementForm.
 * Pure presentational — parent owns `items` state and the update fns.
 */
export default function MovementItemsPanel({
  Icon, fmtTHB, applyDiscounts, UNITS,
  items, kind, costPctEnabled, costPct,
  onUpdItem, onUpdPrice, onRemoveItem,
  showItemsError = false,
  recentReceivesMap = null,
  hasVat = true,
  totalNet = 0,
  vatAmount = 0,
  totalGross = 0,
  tiktokMirrorEnabled = false,
  showTiktokMatchError = false,
  onTiktokRematch,
}) {
  const empty = !items.length;
  const isReceiveOrClaim = kind === 'receive' || kind === 'claim';

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        className={
          "movement-items-scroll max-h-[40vh] lg:max-h-[42vh] overflow-y-auto p-3 transition-colors flex-1 " +
          (empty && showItemsError ? "field-error-glow rounded-md" : "")
        }
      >
        {empty && (
          <div className={"p-6 text-center text-sm " + (showItemsError ? "text-error" : "text-muted")}>
            {showItemsError ? "กรุณาเพิ่มรายการอย่างน้อย 1 รายการ" : "ยังไม่มีรายการ"}
          </div>
        )}
        {items.map((l, i) => {
          const recentInfo = (kind === 'receive' && recentReceivesMap && l.product_id)
            ? recentReceivesMap.get(l.product_id)
            : null;
          const showItemVat = isReceiveOrClaim && hasVat;
          const grossPerUnit = showItemVat ? (Number(l.unit_price) * 1.07) : Number(l.unit_price);
          const tiktokUnresolved = tiktokMirrorEnabled && !isTikTokLineReady(l);
          const tiktokErr = showTiktokMatchError && tiktokUnresolved;

          return (
          <div
            key={l._uid || i}
            className={
              'glass-soft rounded-lg p-3 mb-2 hover-lift fade-in ' +
              (tiktokErr ? 'ring-2 ring-error/40' : '')
            }
          >
            <div className="flex items-start justify-between gap-2">
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
            {recentInfo && (
              <div className="mt-1.5 -ml-0.5">
                <RecentReceiveBadge info={recentInfo} />
              </div>
            )}
            {tiktokMirrorEnabled && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="text-[10px] text-muted-soft uppercase tracking-wider">TikTok</span>
                <TikTokLineBadge
                  line={l}
                  unresolved={tiktokUnresolved}
                  onRematch={() => onTiktokRematch?.(i)}
                />
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
                className={
                  "input !py-1.5 !text-xs col-span-6 text-right " +
                  (kind === 'return' ? "!bg-canvas-soft !text-muted cursor-not-allowed" : "")
                }
                value={l.unit_price}
                onChange={e => onUpdPrice(i, e.target.value)}
                readOnly={kind === 'return'}
                tabIndex={kind === 'return' ? -1 : undefined}
                title={kind === 'return' ? 'ราคาคืนต้องเท่ากับราคาที่ขายในบิลต้นฉบับ' : undefined}
                onFocus={kind === 'return' ? (e) => e.target.blur() : undefined}
              />
            </div>
            <div className="flex items-center justify-between mt-2">
              <div className="text-[10px] text-muted-soft flex flex-col gap-0.5">
                {kind === 'return'
                  ? <span className="text-muted-soft">ราคาที่ขายจริงในบิล · ล็อกอัตโนมัติ</span>
                  : l.manualPrice
                    ? (Number(l.retail_price) > 0
                        ? `แก้เอง · ${(l.unit_price / l.retail_price * 100).toFixed(1)}% ของ ${fmtTHB(l.retail_price)}`
                        : 'แก้เอง')
                    : (costPctEnabled && (kind === 'receive' || kind === 'claim'))
                      ? `ลด ${costPct}% จาก ${fmtTHB(l.retail_price)}`
                      : (Number(l.retail_price) > 0 ? `ราคาป้าย ${fmtTHB(l.retail_price)}` : '')}
                {showItemVat && (
                  <span className="text-primary font-medium">
                    +VAT 7% (+{fmtTHB(Number(l.unit_price) * 0.07)}) → {fmtTHB(grossPerUnit)} / ชิ้น
                  </span>
                )}
              </div>
              <div className="text-sm font-medium text-right flex flex-col items-end">
                <span>
                  {fmtTHB(applyDiscounts(
                    l.unit_price, l.quantity,
                    l.discount1_value, l.discount1_type,
                    l.discount2_value, l.discount2_type
                  ))}
                </span>
                {showItemVat && (
                  <span className="text-[10px] text-primary">
                    รวม VAT: {fmtTHB(applyDiscounts(
                      grossPerUnit, l.quantity,
                      l.discount1_value, l.discount1_type,
                      l.discount2_value, l.discount2_type
                    ))}
                  </span>
                )}
              </div>
            </div>
          </div>
          );
        })}
      </div>

      {!empty && isReceiveOrClaim && hasVat && (
        <div className="px-4 py-3 mx-3 mb-2 rounded-xl bg-primary/5 border border-primary/10 space-y-1 text-xs">
          <div className="flex justify-between text-muted-soft">
            <span>รวมก่อน VAT (Net)</span>
            <span className="tabular-nums font-medium">{fmtTHB(totalNet)}</span>
          </div>
          <div className="flex justify-between text-primary">
            <span>VAT 7% (รวมทั้งบิล)</span>
            <span className="tabular-nums font-medium">+{fmtTHB(vatAmount)}</span>
          </div>
          <div className="flex justify-between text-sm text-ink font-semibold border-t border-dashed border-primary/20 pt-1 mt-1">
            <span>รวมสุทธิ (Gross)</span>
            <span className="tabular-nums font-bold text-primary">{fmtTHB(totalGross)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
