import { describe, it, expect } from 'vitest';
import {
  saleLineSku,
  saleLineCartCaption,
  saleLineSearchText,
} from '../src/lib/sale-line-display.js';

describe('saleLineSku', () => {
  it('prefers seller_sku over product_name', () => {
    expect(saleLineSku({
      seller_sku: 'MTP-V004G',
      product_name: 'นาฬิกาข้อมือ CASIO รุ่น MTP-V004,...',
    })).toBe('MTP-V004G');
  });

  it('falls back to product_name for in-store sales', () => {
    expect(saleLineSku({ product_name: 'GA-2100WD-1ADR' })).toBe('GA-2100WD-1ADR');
  });

  it('returns em dash when empty', () => {
    expect(saleLineSku({})).toBe('—');
  });
});

describe('saleLineCartCaption', () => {
  it('returns cart title when seller_sku differs', () => {
    expect(saleLineCartCaption({
      seller_sku: 'MTP-V004G',
      product_name: 'นาฬิกาข้อมือ CASIO รุ่น MTP-V004',
    })).toBe('นาฬิกาข้อมือ CASIO รุ่น MTP-V004');
  });

  it('returns empty when no seller_sku', () => {
    expect(saleLineCartCaption({ product_name: 'GA-2100WD-1ADR' })).toBe('');
  });

  it('returns empty when cart equals sku', () => {
    expect(saleLineCartCaption({
      seller_sku: 'GA-2100',
      product_name: 'GA-2100',
    })).toBe('');
  });
});

describe('saleLineSearchText', () => {
  it('includes all name fields lowercase', () => {
    const t = saleLineSearchText({
      seller_sku: 'MTP-V004G',
      sku_name: 'Variant A',
      product_name: 'Casio Watch',
    });
    expect(t).toContain('mtp-v004g');
    expect(t).toContain('variant a');
    expect(t).toContain('casio watch');
  });
});
