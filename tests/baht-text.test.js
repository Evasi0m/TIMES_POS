import { describe, it, expect } from 'vitest';
import { bahtText } from '../src/lib/baht-text.js';

describe('bahtText', () => {
  it('reads whole baht with ถ้วน', () => {
    expect(bahtText(1000)).toBe('หนึ่งพันบาทถ้วน');
    expect(bahtText(1070)).toBe('หนึ่งพันเจ็ดสิบบาทถ้วน');
  });
  it('includes satang when present', () => {
    expect(bahtText(100.50)).toBe('หนึ่งร้อยบาทห้าสิบสตางค์');
  });
  it('handles zero', () => {
    expect(bahtText(0)).toBe('ศูนย์บาทถ้วน');
  });
  it('uses absolute value', () => {
    expect(bahtText(-500)).toBe('ห้าร้อยบาทถ้วน');
  });
});
