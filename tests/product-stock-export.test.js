import { describe, it, expect } from 'vitest';
import { enrichProduct } from '../src/lib/product-classify.js';
import {
  EXPORT_BRAND_OPTIONS,
  filterByExportScope,
  buildStockExportLines,
  stockExportFilename,
  exportScopeLabel,
} from '../src/lib/product-stock-export.js';

const sampleProducts = [
  enrichProduct({ id: 1, name: 'SRPC91K1', barcode: '111', cost_price: 5000, retail_price: 8900, current_stock: 2 }),
  enrichProduct({ id: 2, name: 'MTP-1302D-7A2', barcode: '222', cost_price: 800, retail_price: 1290, current_stock: 5 }),
  enrichProduct({ id: 3, name: 'EW2294-61L', barcode: '333', cost_price: 3000, retail_price: 5500, current_stock: 1 }),
  enrichProduct({ id: 4, name: 'AH7Q24X1', barcode: '444', cost_price: 1200, retail_price: 1990, current_stock: 0 }),
  enrichProduct({ id: 5, name: 'ORIENT-XYZ', barcode: '555', cost_price: 2000, retail_price: 3500, current_stock: 3 }),
].map((p) => ({ ...p, _brand: p._brand }));

describe('EXPORT_BRAND_OPTIONS', () => {
  it('includes all and named brands only', () => {
    expect(EXPORT_BRAND_OPTIONS.map((o) => o.id)).toEqual(['all', 'seiko', 'alba', 'citizen', 'casio']);
  });
});

describe('filterByExportScope', () => {
  it('returns all known brands when scope is all', () => {
    const rows = filterByExportScope(sampleProducts, 'all');
    expect(rows).toHaveLength(5);
    expect(rows.map((p) => p._brand).sort()).toEqual(['alba', 'casio', 'citizen', 'other', 'seiko']);
  });

  it('filters to a single brand', () => {
    const rows = filterByExportScope(sampleProducts, 'casio');
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('MTP-1302D-7A2');
  });

  it('returns empty for brand with no products', () => {
    expect(filterByExportScope(sampleProducts, 'seiko')).toHaveLength(1);
    expect(filterByExportScope([], 'casio')).toHaveLength(0);
  });
});

describe('buildStockExportLines', () => {
  it('includes metadata and column headers', () => {
    const lines = buildStockExportLines({
      products: sampleProducts,
      scope: 'casio',
      shopName: 'TIMES TEST',
      exportedAt: new Date('2026-06-12T14:30:00+07:00'),
    });
    expect(lines[0][0]).toBe('รายงานสต็อกสินค้า');
    expect(lines[1][0]).toBe('ร้าน: TIMES TEST');
    expect(lines[2][0]).toMatch(/^วันที่ Export:/);
    expect(lines[3][0]).toBe('ขอบเขต: Casio');
    expect(lines.some((row) => row[0] === 'ลำดับ' && row[1] === 'ชื่อรุ่น')).toBe(true);
  });

  it('embeds exporter info when provided', () => {
    const lines = buildStockExportLines({
      products: sampleProducts,
      scope: 'casio',
      exporter: { email: 'ex@test.com', name: 'Tester' },
    });
    expect(lines.some((row) => row[0] === 'ผู้ Export: ex@test.com')).toBe(true);
    expect(lines.some((row) => row[0] === 'ชื่อผู้ใช้: Tester')).toBe(true);
  });

  it('fills Casio facet columns for casio products', () => {
    const lines = buildStockExportLines({
      products: sampleProducts,
      scope: 'casio',
    });
    const dataRow = lines.find((row) => row[1] === 'MTP-1302D-7A2');
    expect(dataRow).toBeTruthy();
    expect(dataRow[3]).toBeTruthy(); // Series
    expect(dataRow[4]).toBe('สแตนเลส'); // Material D
    expect(dataRow[5]).toBe('ขาว/เงิน'); // Color 7
    expect(dataRow[6]).toBe('800.00'); // catalog cost
    expect(dataRow[7]).toBe('1290.00'); // retail
    expect(dataRow[9]).toBe('6450.00'); // retail * stock = 1290 * 5
    expect(dataRow[10]).toBe('4000.00'); // cost * stock = 800 * 5
  });

  it('groups by brand with subtotals when scope is all', () => {
    const lines = buildStockExportLines({
      products: sampleProducts,
      scope: 'all',
    });
    const banners = lines.filter((row) => String(row[0]).startsWith('【 '));
    expect(banners.length).toBe(5);
    expect(banners.map((row) => row[0])).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/SEIKO/),
        expect.stringMatching(/ALBA/),
        expect.stringMatching(/CITIZEN/),
        expect.stringMatching(/CASIO/),
        expect.stringMatching(/อื่น ๆ/),
      ]),
    );
    const subtotals = lines.filter((row) => String(row[0]).startsWith('สรุป '));
    expect(subtotals.length).toBe(5);
    expect(lines.some((row) => row[0] === 'สรุปรวมทั้งหมด')).toBe(true);
  });

  it('computes seiko subtotal correctly', () => {
    const lines = buildStockExportLines({
      products: sampleProducts,
      scope: 'seiko',
    });
    const subtotal = lines.find((row) => row[0] === 'สรุป Seiko');
    expect(subtotal[9]).toMatch(/มูลค่าป้าย 17,800\.00/); // 8900 * 2
    expect(subtotal[9]).toMatch(/มูลค่าทุน 10,000\.00/); // 5000 * 2
    expect(subtotal[9]).toMatch(/สต็อก 2 ชิ้น/);
  });

  it('skips empty brand sections', () => {
    const onlyCasio = sampleProducts.filter((p) => p._brand === 'casio');
    const lines = buildStockExportLines({ products: onlyCasio, scope: 'all' });
    const banners = lines.filter((row) => String(row[0]).startsWith('【 '));
    expect(banners).toHaveLength(1);
    expect(banners[0][0]).toMatch(/CASIO/);
    expect(lines.some((row) => row[0] === 'สรุปรวมทั้งหมด')).toBe(false);
  });
});

describe('exportScopeLabel', () => {
  it('returns Thai label for known scopes', () => {
    expect(exportScopeLabel('all')).toBe('ทั้งหมด');
    expect(exportScopeLabel('casio')).toBe('Casio');
  });
});

describe('stockExportFilename', () => {
  it('builds dated filename', () => {
    expect(stockExportFilename('casio', new Date('2026-06-12T12:00:00+07:00'))).toBe('stock-casio-2026-06-12.csv');
    expect(stockExportFilename('all', new Date('2026-06-12T12:00:00+07:00'))).toBe('stock-all-2026-06-12.csv');
  });
});
