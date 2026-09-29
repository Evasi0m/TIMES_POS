import { describe, it, expect } from 'vitest';
import { formatCopyPrice } from '../src/lib/copy-text.js';

describe('formatCopyPrice', () => {
  it('adds thousands separators', () => {
    expect(formatCopyPrice(1200)).toBe('1,200');
    expect(formatCopyPrice(1234567)).toBe('1,234,567');
  });
  it('drops decimals', () => {
    expect(formatCopyPrice(690.4)).toBe('690');
    expect(formatCopyPrice('4390.00')).toBe('4,390');
  });
  it('handles missing values', () => {
    expect(formatCopyPrice(null)).toBe('0');
  });
});
