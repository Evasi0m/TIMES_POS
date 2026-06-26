import { describe, it, expect } from 'vitest';
import { formatStockAdjustAlertText } from '../src/lib/stock-adjust-alert-format.js';
import { stockAdjustSubreasonLabel } from '../src/lib/stock-manual-adjust.js';

describe('formatStockAdjustAlertText', () => {
  it('formats single adjust row', () => {
    const text = formatStockAdjustAlertText([
      {
        product_name: 'MTP-1302D-7A2',
        stock_before: 5,
        stock_after: 12,
        qty_delta: 7,
        subreason: 'physical_count',
        note: 'count note',
      },
    ], 'owner@example.com');

    expect(text).toContain('owner@example.com');
    expect(text).toContain(stockAdjustSubreasonLabel('physical_count'));
    expect(text).toContain('MTP-1302D-7A2');
    expect(text).toContain('5 → 12 (+7)');
    expect(text).toContain('count note');
  });

  it('truncates bulk list to top 5 with remainder note', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
      product_name: `SKU-${i}`,
      stock_before: i,
      stock_after: i + 1,
      qty_delta: 1,
      subreason: 'recording_error',
      note: 'batch',
    }));
    const text = formatStockAdjustAlertText(rows, null);
    expect(text).toContain('SKU-0');
    expect(text).toContain('SKU-4');
    expect(text).not.toContain('SKU-5');
    expect(text).toContain('<i>');
  });
});
