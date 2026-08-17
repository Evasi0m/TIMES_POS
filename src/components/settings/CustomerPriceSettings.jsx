import React from 'react';
import Icon from '../ui/Icon.jsx';
import { BRAND_RULES } from '../../lib/product-classify.js';
import { mergeCustomerPriceConfig } from '../../lib/customer-price.js';

const ROUND_OPTS = [
  { id: 'down', label: 'ปัดลง' },
  { id: 'up', label: 'ปัดขึ้น' },
  { id: 'nearest', label: 'ใกล้สุด' },
];

export default function CustomerPriceSettings({ draft, onChange, onSave, onReset, busy }) {
  const cfg = mergeCustomerPriceConfig(draft);

  const setField = (key, value) => {
    onChange({ ...cfg, [key]: value });
  };
  const setBrand = (id, value) => {
    onChange({
      ...cfg,
      brands: { ...cfg.brands, [id]: value },
    });
  };

  return (
    <div className="space-y-5">
      <div className="text-xs text-muted-soft bg-surface-soft rounded-lg px-3.5 py-2.5 border hairline">
        ราคาขายในแท็บ «ราคาลูกค้า» = ทุนล่าสุด + % ตามแบรนด์ แล้วปัดให้ลงท้ายด้วยเลขที่ตั้ง
        (ค่าเริ่มต้น +30% ปัดลงเป็น xx90) ไม่แก้ราคาป้ายในสินค้า และไม่ใส่ลงบิลขาย
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-semibold text-muted-soft block mb-1">% สำรอง</label>
          <input
            className="input tabular-nums"
            type="number"
            min="0"
            max="500"
            inputMode="decimal"
            value={cfg.default_markup_pct}
            onChange={(e) => setField('default_markup_pct', e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-soft block mb-1">ลงท้ายด้วย</label>
          <input
            className="input tabular-nums"
            type="number"
            min="0"
            max="99"
            inputMode="numeric"
            value={cfg.ending}
            onChange={(e) => setField('ending', e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-soft block mb-1">ทิศทางปัด</label>
          <select
            className="input"
            value={cfg.round}
            onChange={(e) => setField('round', e.target.value)}
          >
            {ROUND_OPTS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <div className="text-sm font-medium text-ink mb-2">% เพิ่มต่อแบรนด์</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {BRAND_RULES.map((b) => (
            <div key={b.id}>
              <label className="text-xs font-semibold text-muted-soft block mb-1">{b.label}</label>
              <input
                className="input tabular-nums"
                type="number"
                min="0"
                max="500"
                inputMode="decimal"
                value={cfg.brands[b.id]}
                onChange={(e) => setBrand(b.id, e.target.value)}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" className="btn-secondary !py-2 !px-3 text-sm" onClick={onReset} disabled={busy}>
          คืนค่าเริ่มต้น
        </button>
        <button type="button" className="btn-primary !py-2 !px-3 text-sm" onClick={onSave} disabled={busy}>
          {busy ? <span className="spinner"/> : <Icon name="check" size={14}/>}
          บันทึกสูตรราคา
        </button>
      </div>
    </div>
  );
}
