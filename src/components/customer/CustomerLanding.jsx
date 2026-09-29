import React from 'react';
import Icon from '../ui/Icon.jsx';
import { BRAND_RULES, PRICE_PRESETS } from '../../lib/product-classify.js';

/**
 * Zero-typing entry screen for the customer price board.
 * Big brand tiles + price-range tiles so a customer can browse
 * without knowing a model code. Picking one seeds the catalog browse.
 */
export default function CustomerLanding({ onPickBrand, onPickPrice, onScan }) {
  const brands = BRAND_RULES.filter((b) => b.id !== 'other');

  return (
    <div className="customer-landing glass rounded-3xl">
      <button type="button" className="customer-landing__scan lg-tile-primary" onClick={onScan}>
        <span className="customer-landing__scan-icon"><Icon name="barcode" size={26} /></span>
        <span className="customer-landing__scan-text">
          <span className="customer-landing__scan-title">สแกนบาร์โค้ดที่กล่อง</span>
          <span className="customer-landing__scan-sub">เล็งกล้องที่บาร์โค้ดเพื่อดูราคาทันที</span>
        </span>
        <Icon name="chevron-r" size={20} className="opacity-40" />
      </button>

      <div className="customer-landing__label">เลือกยี่ห้อ</div>
      <div className="customer-landing__brands">
        {brands.map((b) => (
          <button
            key={b.id}
            type="button"
            className="customer-landing__brand lg-tile"
            onClick={() => onPickBrand(b.id)}
          >
            <span className="customer-landing__brand-name">{b.label}</span>
            <Icon name="chevron-r" size={16} className="customer-landing__brand-arrow" />
          </button>
        ))}
      </div>

      <div className="customer-landing__label">ช่วงราคา</div>
      <div className="customer-landing__prices">
        {PRICE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="customer-landing__price lg-tile"
            onClick={() => onPickPrice(p)}
          >
            <Icon name="price-tag" size={15} className="opacity-60" />
            {p.label}
          </button>
        ))}
      </div>

      <div className="customer-landing__hint">
        หรือพิมพ์ชื่อรุ่นในช่องค้นหาด้านบน
      </div>
    </div>
  );
}
