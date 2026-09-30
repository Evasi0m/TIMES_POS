import React, { useEffect, useRef, useState } from 'react';
import Icon from '../ui/Icon.jsx';
import { sb } from '../../lib/supabase-client.js';
import { searchProducts } from '../../lib/product-search.js';
import { fmtTHB } from '../../lib/format.js';

/** Same cascade the DB uses (receive_line_total) and the app's applyDiscounts. */
export function receiveLineTotal(l) {
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  let s = r2(l.unit_price);
  if (l.discount1_type === 'percent') s = r2(s * (1 - (Number(l.discount1_value) || 0) / 100));
  else if (l.discount1_type === 'baht') s = r2(s - (Number(l.discount1_value) || 0));
  if (l.discount2_type === 'percent') s = r2(s * (1 - (Number(l.discount2_value) || 0) / 100));
  else if (l.discount2_type === 'baht') s = r2(s - (Number(l.discount2_value) || 0));
  return r2(Math.max(0, s) * (Number(l.quantity) || 0));
}

/**
 * Editable line list for a receive bill (super admin).
 * `lines` items: { key, id?, product_id, product_name, quantity, unit, unit_price,
 *                  discount1_value, discount1_type, discount2_value, discount2_type,
 *                  _origQty?, _origPrice? }
 * unit_price is the stored per-piece price (VAT-inclusive when the bill has VAT).
 */
export default function ReceiveLinesEditor({ lines, onChange, vatRate = 0, disabled = false }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); setSearching(false); return undefined; }
    const my = ++seq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      const { data } = await searchProducts(sb, q, { limit: 8 });
      if (my !== seq.current) return;
      setResults(data || []);
      setSearching(false);
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  const patch = (key, p) => onChange(lines.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const remove = (key) => onChange(lines.filter((l) => l.key !== key));
  const add = (p) => {
    if (lines.some((l) => l.product_id === p.id)) {
      setQuery('');
      setResults([]);
      return;
    }
    onChange([...lines, {
      key: 'new-' + p.id + '-' + Date.now(),
      product_id: p.id,
      product_name: p.name,
      quantity: 1,
      unit: 'เรือน',
      unit_price: Number(p.cost_price) || 0,
      discount1_value: 0, discount1_type: null,
      discount2_value: 0, discount2_type: null,
      _isNew: true,
    }]);
    setQuery('');
    setResults([]);
  };

  const total = lines.reduce((s, l) => s + receiveLineTotal(l), 0);
  const vat = vatRate > 0 ? Math.round(total * vatRate / (100 + vatRate) * 100) / 100 : 0;

  return (
    <div className="rle">
      <div className="rle__head">
        <span>สินค้า</span>
        <span className="text-right">จำนวน</span>
        <span className="text-right">ราคา/ชิ้น{vatRate > 0 ? ' (รวม VAT)' : ''}</span>
        <span className="text-right">รวม</span>
        <span/>
      </div>

      {lines.map((l) => {
        const qtyChanged = l._origQty != null && Number(l.quantity) !== l._origQty;
        const priceChanged = l._origPrice != null && Number(l.unit_price) !== l._origPrice;
        return (
          <div key={l.key} className={'rle__row' + (l._isNew ? ' is-new' : '')}>
            <div className="rle__name" title={l.product_name}>
              <span className="truncate">{l.product_name}</span>
              {l._isNew && <span className="rle__tag rle__tag--new">ใหม่</span>}
              {qtyChanged && <span className="rle__tag">เดิม {l._origQty}</span>}
              {priceChanged && <span className="rle__tag">เดิม {fmtTHB(l._origPrice)}</span>}
            </div>
            <input
              type="number" inputMode="numeric" min="1" step="1"
              className={'input rle__num' + (qtyChanged ? ' is-changed' : '')}
              value={l.quantity}
              onChange={(e) => patch(l.key, { quantity: e.target.value === '' ? '' : Math.max(0, Math.round(Number(e.target.value))) })}
              disabled={disabled}
              aria-label={`จำนวน ${l.product_name}`}
            />
            <input
              type="number" inputMode="decimal" min="0" step="0.01"
              className={'input rle__num' + (priceChanged ? ' is-changed' : '')}
              value={l.unit_price}
              onChange={(e) => patch(l.key, { unit_price: e.target.value === '' ? '' : Number(e.target.value) })}
              disabled={disabled}
              aria-label={`ราคาต่อชิ้น ${l.product_name}`}
            />
            <div className="rle__total tabular-nums">{fmtTHB(receiveLineTotal(l))}</div>
            <button
              type="button"
              className="btn-ghost !p-1.5 !text-error"
              onClick={() => remove(l.key)}
              disabled={disabled || lines.length <= 1}
              title={lines.length <= 1 ? 'บิลต้องมีอย่างน้อย 1 รายการ — ถ้าจะลบทั้งบิลให้ใช้ยกเลิกบิล' : 'เอารายการนี้ออก'}
              aria-label={`เอา ${l.product_name} ออก`}
            >
              <Icon name="trash" size={15}/>
            </button>
          </div>
        );
      })}

      <div className="rle__add">
        <div className="relative">
          <Icon name="plus" size={15} className="rle__add-icon"/>
          <input
            className="input w-full !pl-9"
            placeholder="เพิ่มสินค้า — พิมพ์ชื่อรุ่นหรือบาร์โค้ด"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={disabled}
          />
        </div>
        {(searching || results.length > 0) && (
          <div className="rle__results">
            {searching && <div className="p-2.5 text-xs text-muted flex items-center gap-2"><span className="spinner"/>กำลังค้นหา…</div>}
            {!searching && results.map((p) => {
              const inBill = lines.some((l) => l.product_id === p.id);
              return (
                <button key={p.id} type="button" className="rle__result" onClick={() => add(p)} disabled={inBill}>
                  <span className="font-mono truncate">{p.name}</span>
                  <span className="text-xs text-muted-soft shrink-0">
                    {inBill ? 'อยู่ในบิลแล้ว' : `สต็อก ${p.current_stock ?? 0}`}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="rle__sum">
        <span>รวม{vatRate > 0 ? ` (VAT ${fmtTHB(vat)})` : ''}</span>
        <span className="tabular-nums font-semibold">{fmtTHB(total)}</span>
      </div>
    </div>
  );
}
