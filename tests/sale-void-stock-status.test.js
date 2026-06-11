import { describe, it, expect } from 'vitest';
import {
  VOID_STOCK_STATUS,
  voidStockStatusLabel,
} from '../src/lib/sale-void-stock-status.js';

describe('voidStockStatusLabel', () => {
  it('labels restored state', () => {
    const l = voidStockStatusLabel(VOID_STOCK_STATUS.RESTORED);
    expect(l.text).toBe('สต็อกคืนแล้ว');
    expect(l.tone).toBe('success');
  });

  it('labels missing restore', () => {
    const l = voidStockStatusLabel(VOID_STOCK_STATUS.MISSING);
    expect(l.text).toBe('สต็อกยังไม่คืน');
    expect(l.tone).toBe('warning');
  });

  it('labels never cut', () => {
    const l = voidStockStatusLabel(VOID_STOCK_STATUS.NEVER_CUT);
    expect(l.text).toBe('ไม่เคยตัดสต็อก');
  });
});
