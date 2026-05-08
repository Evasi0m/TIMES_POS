import React from 'react';
import Popover from '../ui/Popover.jsx';

const PRESETS = [30, 40, 50, 58];

/**
 * "คำนวณทุนจากราคาป้าย" toggle for Receive / Claim screens.
 *
 * Phase 2.2 additions:
 *   - "?" info popover explaining the formula
 *   - preset chips (30 / 40 / 50 / 58 + custom)
 *   - live preview "ราคาป้าย X → ทุน Y" (uses first item's retail price,
 *     falls back to a generic 1,000 example)
 *
 * State (enabled / value / mode) is owned by the parent so the chooser
 * modal and form-reset logic continue to live in StockMovementForm.
 *
 * Props:
 *   Icon, fmtTHB
 *   enabled, value, mode             — current state
 *   onToggleOff()                    — fired when user disables toggle
 *   onOpenChooser()                  — fired when enabling (opens once/persist modal)
 *   onChangeValue(pct:number)        — fired when % changes (preset or input)
 *   sampleRetailPrice (number|null)  — used for live preview
 */
export default function CostPercentToggle({
  Icon, fmtTHB,
  enabled, value, mode,
  onToggleOff, onOpenChooser, onChangeValue,
  sampleRetailPrice,
}) {
  const sample = Number(sampleRetailPrice) > 0 ? Number(sampleRetailPrice) : 1000;
  const previewCost = Math.round((sample * (100 - (Number(value) || 0))) / 100);
  const isExample = !(Number(sampleRetailPrice) > 0);

  return (
    <div className="px-4 lg:px-5 py-3 border-b hairline bg-white/40">
      <div className="flex items-center justify-between gap-3 select-none">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => {
              if (enabled) onToggleOff();
              else onOpenChooser();
            }}
          >
            <span className={"relative flex items-center justify-center w-5 h-5 rounded border transition-colors " + (enabled ? "bg-primary border-primary" : "bg-canvas border-hairline")}>
              {enabled && <Icon name="check" size={13} className="text-white" strokeWidth={2.5} />}
            </span>
            <span className="text-sm font-medium">คำนวณทุนจากราคาป้าย</span>
            {enabled && mode === 'persist' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">เปิดตลอด</span>
            )}
          </button>
          <Popover
            trigger={({ ref, onClick, isOpen }) => (
              <button
                ref={ref}
                type="button"
                aria-label="ดูคำอธิบายสูตร"
                aria-expanded={isOpen}
                onClick={onClick}
                className={"flex items-center justify-center w-5 h-5 rounded-full border text-[11px] font-semibold transition-colors " +
                  (isOpen ? "bg-primary text-on-primary border-primary" : "border-hairline text-muted hover:text-ink hover:border-muted")}
              >?</button>
            )}
          >
            <div className="font-medium mb-1">สูตรคำนวณทุน</div>
            <div className="font-mono text-[11px] bg-white/60 rounded px-2 py-1 mb-1.5">ทุน = ราคาป้าย × (100 − %) ÷ 100</div>
            <div className="text-muted">
              เช่น ราคาป้าย ฿1,000 ที่ 58% → ทุน ฿420
              <br />ใช้สำหรับเติมราคาทุนของรายการที่เพิ่มใหม่อัตโนมัติ — รายการที่แก้ราคาเองจะคงค่าเดิม
            </div>
          </Popover>
        </div>
        {enabled && (
          <span className="flex items-center gap-1.5">
            <input
              type="number" min="1" max="100" inputMode="numeric"
              className="input !h-9 !w-20 !rounded-lg !py-1 !text-sm text-right"
              value={value}
              onChange={e => {
                const v = Number(e.target.value) || 0;
                onChangeValue(Math.max(1, Math.min(100, v)));
              }}
            />
            <span className="text-sm text-muted">%</span>
          </span>
        )}
      </div>

      {enabled && (
        <>
          <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
            <span className="text-[11px] text-muted mr-1">ค่าที่ใช้บ่อย:</span>
            {PRESETS.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => onChangeValue(p)}
                className={"px-2.5 py-1 rounded-md text-xs font-medium border transition-all " +
                  (Number(value) === p
                    ? "bg-primary text-on-primary border-primary shadow-sm"
                    : "bg-white/70 text-ink border-hairline hover:border-muted hover:bg-white")}
              >
                {p}%
              </button>
            ))}
          </div>
          <div className="text-[11px] text-muted mt-2 flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/70 border hairline tabular-nums">
              ราคาป้าย {fmtTHB(sample)} <span className="text-muted-soft">→</span> ทุน <span className="font-medium text-ink">{fmtTHB(previewCost)}</span>
            </span>
            {isExample
              ? <span className="text-muted-soft">(ตัวอย่าง — เพิ่มสินค้าเพื่อดูค่าจริง)</span>
              : <span className="text-muted-soft">(จากรายการแรกในบิล)</span>}
          </div>
        </>
      )}
    </div>
  );
}
