// Full tax invoice A4 (ใบกำกับภาษีแบบเต็มรูป ม.86/4)
import React from 'react';
import { fmtTHB } from '../../lib/format.js';
import { roundMoney } from '../../lib/money.js';
import { bahtText } from '../../lib/baht-text.js';

const PAYMENT_LABELS = {
  cash: 'เงินสด',
  transfer: 'โอนเงิน',
  card: 'บัตร',
  paylater: 'paylater',
  cod: 'เก็บปลายทาง',
};

const fmtDate = (s) =>
  s ? new Date(s).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '-';

function applyDiscounts(unitPrice, qty, d1v, d1t, d2v, d2t) {
  let s1 = roundMoney(unitPrice);
  if (d1t === 'percent') s1 = roundMoney(s1 * (1 - (Number(d1v) || 0) / 100));
  else if (d1t === 'baht') s1 = roundMoney(s1 - (Number(d1v) || 0));
  let s2 = s1;
  if (d2t === 'percent') s2 = roundMoney(s2 * (1 - (Number(d2v) || 0) / 100));
  else if (d2t === 'baht') s2 = roundMoney(s2 - (Number(d2v) || 0));
  return roundMoney(Math.max(0, s2) * (Number(qty) || 0));
}

/** Display name: cart title + SKU variant when available. */
export function lineDisplayName(item) {
  const cart = item.product_name || '';
  const sku = item.sku_name || '';
  if (sku && sku !== cart) return `${cart} (${sku})`;
  return cart || sku || '—';
}

export default function FullTaxInvoiceA4({ order, items, shop, copyLabel = 'ต้นฉบับ' }) {
  const exVat = Number(order.grand_total || 0) - Number(order.vat_amount || 0);
  const rows = (items || []).map(it => {
    const hasOverride = it.display_unit_price != null;
    const shownUnit = hasOverride ? Number(it.display_unit_price) : Number(it.unit_price);
    const shownTotal = hasOverride
      ? shownUnit * Number(it.quantity || 0)
      : applyDiscounts(
        it.unit_price, it.quantity,
        it.discount1_value, it.discount1_type,
        it.discount2_value, it.discount2_type,
      );
    return { ...it, shownUnit, shownTotal, displayName: lineDisplayName(it) };
  });
  const displayedSubtotal = rows.reduce((s, r) => s + r.shownTotal, 0);
  const displayedDiscount = Math.max(0, displayedSubtotal - Number(order.grand_total || 0));

  return (
    <div className="fulltax-a4">
      <div className="ft-head">
        <div className="ft-seller">
          <div className="ft-shop">{shop?.shop_name || 'TIMES'}</div>
          {shop?.shop_address && <div className="ft-line">{shop.shop_address}</div>}
          {shop?.shop_phone && <div className="ft-line">โทร {shop.shop_phone}</div>}
          <div className="ft-line">
            เลขประจำตัวผู้เสียภาษี {shop?.shop_tax_id || '-'}
            {shop?.shop_branch ? `  (${shop.shop_branch})` : ''}
          </div>
        </div>
        <div className="ft-title">
          <div className="ft-title-main">ใบกำกับภาษี</div>
          <div className="ft-title-sub">TAX INVOICE</div>
          <div className="ft-copy-mark">({copyLabel})</div>
        </div>
      </div>

      <div className="ft-meta">
        <div className="ft-buyer">
          <div className="ft-meta-label">ลูกค้า / ผู้ซื้อ</div>
          <div className="ft-buyer-name">{order.buyer_name || '—'}</div>
          {order.buyer_address && (
            <div className="ft-line ft-line-wrap">{order.buyer_address}</div>
          )}
          <div className="ft-line">
            {order.buyer_tax_id ? `เลขประจำตัวผู้เสียภาษี ${order.buyer_tax_id}` : ''}
            {order.buyer_branch ? `  (${order.buyer_branch})` : ''}
          </div>
        </div>
        <div className="ft-docinfo">
          <div className="ft-row"><span>เลขที่</span><b>{order.tax_invoice_no || '-'}</b></div>
          <div className="ft-row">
            <span>วันที่</span>
            <span>{fmtDate(order.tax_invoice_issued_at || order.sale_date)}</span>
          </div>
          <div className="ft-row"><span>อ้างอิงบิล</span><span>#{order.id}</span></div>
          {order.tiktok_order_id && (
            <div className="ft-row"><span>TikTok</span><span>{order.tiktok_order_id}</span></div>
          )}
          <div className="ft-row">
            <span>ชำระโดย</span>
            <span>{PAYMENT_LABELS[order.payment_method] || '—'}</span>
          </div>
        </div>
      </div>

      <table className="ft-table">
        <thead>
          <tr>
            <th className="ft-c-no">ลำดับ</th>
            <th className="ft-c-desc">รายการ</th>
            <th className="ft-c-qty">จำนวน</th>
            <th className="ft-c-price">ราคา/หน่วย</th>
            <th className="ft-c-amt">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || i}>
              <td className="ft-c-no">{i + 1}</td>
              <td className="ft-c-desc">{r.displayName}</td>
              <td className="ft-c-qty">{r.quantity}</td>
              <td className="ft-c-price">{fmtTHB(r.shownUnit)}</td>
              <td className="ft-c-amt">{fmtTHB(r.shownTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="ft-bottom">
        <div className="ft-words">
          <div className="ft-meta-label">จำนวนเงิน (ตัวอักษร)</div>
          <div className="ft-words-val">{bahtText(order.grand_total)}</div>
          {order.notes && <div className="ft-note">หมายเหตุ: {order.notes}</div>}
        </div>
        <div className="ft-summary">
          <div className="ft-row"><span>รวมเป็นเงิน</span><span>{fmtTHB(displayedSubtotal)}</span></div>
          {displayedDiscount > 0 && (
            <div className="ft-row"><span>ส่วนลด</span><span>−{fmtTHB(displayedDiscount)}</span></div>
          )}
          <div className="ft-row"><span>มูลค่าก่อนภาษี</span><span>{fmtTHB(exVat)}</span></div>
          <div className="ft-row">
            <span>ภาษีมูลค่าเพิ่ม {order.vat_rate || 7}%</span>
            <span>{fmtTHB(order.vat_amount)}</span>
          </div>
          <div className="ft-row ft-grand">
            <span>จำนวนเงินรวมทั้งสิ้น</span>
            <span>{fmtTHB(order.grand_total)}</span>
          </div>
        </div>
      </div>

      <div className="ft-signs">
        <div className="ft-sign"><div className="ft-sign-line"/>ผู้รับสินค้า / ผู้ซื้อ</div>
        <div className="ft-sign"><div className="ft-sign-line"/>ผู้รับเงิน / ผู้มีอำนาจ</div>
      </div>
    </div>
  );
}
