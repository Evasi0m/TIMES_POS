import { describe, it, expect } from 'vitest';
import {
  validateManualStockAdjust,
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
