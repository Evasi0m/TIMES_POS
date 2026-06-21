import { describe, it, expect } from 'vitest';
import {
  validateManualStockAdjust,
  validateBulkManualStockAdjust,
  countBulkAdjustChanges,
  formatBulkAdjustToast,
  parseManualAdjustNotes,
  stockAdjustSubreasonLabel,
} from '../src/lib/stock-manual-adjust.js';

describe('validateManualStockAdjust', () => {
  it('accepts valid payload', () => {
    expect(validateManualStockAdjust({
      targetQty: 0,
      subreason: 'recording_error',
      note: 'แก้ยอดซ้ำ',
    })).toBeNull();
  });

  it('rejects negative target', () => {
    expect(validateManualStockAdjust({
      targetQty: -1,
      subreason: 'recording_error',
      note: 'x',
    })).toMatch(/0/);
  });

  it('rejects empty note', () => {
    expect(validateManualStockAdjust({
      targetQty: 0,
      subreason: 'recording_error',
      note: '   ',
    })).toMatch(/หมายเหตุ/);
  });

  it('requires longer note for other', () => {
    expect(validateManualStockAdjust({
      targetQty: 1,
      subreason: 'other',
      note: 'สั้นไป',
    })).toMatch(/20/);
  });
});

describe('parseManualAdjustNotes', () => {
  it('parses subreason prefix', () => {
    const parsed = parseManualAdjustNotes('[recording_error] บันทึกซ้ำ');
    expect(parsed.subreason).toBe('recording_error');
    expect(parsed.subreasonLabel).toBe(stockAdjustSubreasonLabel('recording_error'));
    expect(parsed.note).toBe('บันทึกซ้ำ');
  });

  it('returns raw text when no prefix', () => {
    const parsed = parseManualAdjustNotes('plain note');
    expect(parsed.subreason).toBeNull();
    expect(parsed.note).toBe('plain note');
  });
});

describe('validateBulkManualStockAdjust', () => {
  const base = {
    subreason: 'physical_count',
    note: 'นับสต็อกประจำเดือน',
  };

  it('accepts valid bulk payload', () => {
    expect(validateBulkManualStockAdjust({
      ...base,
      items: [
        { productId: 1, targetQty: 5, currentStock: 3 },
        { productId: 2, targetQty: 0, currentStock: 1 },
      ],
    })).toBeNull();
  });

  it('rejects empty items', () => {
    expect(validateBulkManualStockAdjust({ ...base, items: [] })).toMatch(/อย่างน้อย/);
  });

  it('rejects duplicate product_id', () => {
    expect(validateBulkManualStockAdjust({
      ...base,
      items: [
        { productId: 1, targetQty: 5 },
        { productId: 1, targetQty: 6 },
      ],
    })).toMatch(/ซ้ำ/);
  });
});

describe('countBulkAdjustChanges', () => {
  it('counts rows where target differs from current', () => {
    expect(countBulkAdjustChanges([
      { targetQty: 5, currentStock: 3 },
      { targetQty: 2, currentStock: 2 },
      { targetQty: 0, currentStock: 1 },
    ])).toBe(2);
  });
});

describe('formatBulkAdjustToast', () => {
  it('formats success summary', () => {
    const { msg, type } = formatBulkAdjustToast({ applied: 3, unchanged: 1, errors: [] });
    expect(msg).toMatch(/สำเร็จ 3/);
    expect(type).toBe('success');
  });

  it('formats partial error summary', () => {
    const { type } = formatBulkAdjustToast({
      applied: 1,
      unchanged: 0,
      errors: [{ product_id: 9, error: 'fail' }],
    });
    expect(type).toBe('warning');
  });
});
