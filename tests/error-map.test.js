import { describe, it, expect } from 'vitest';
import { mapError } from '../src/lib/error-map.js';

describe('mapError', () => {
  it('returns Thai text for Postgres unique violation', () => {
    expect(mapError({ code: '23505', message: 'duplicate key value violates unique constraint' }))
      .toBe('ข้อมูลซ้ำกับที่มีอยู่ในระบบ');
  });
  it('singles out barcode duplicates with a more useful hint', () => {
    expect(mapError({ code: '23505', message: 'duplicate key on products_barcode_idx' }))
      .toBe('บาร์โค้ดนี้ถูกใช้แล้วกับสินค้าอื่น');
  });
  it('handles RLS denial (42501)', () => {
    expect(mapError({ code: '42501' })).toBe('ไม่มีสิทธิ์ทำรายการนี้ (admin only)');
  });
  it('handles auth JWT expiry', () => {
    expect(mapError({ message: 'JWT expired' })).toBe('เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่');
  });
  it('handles login failure', () => {
    expect(mapError({ message: 'Invalid login credentials' })).toBe('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  });
  it('handles network errors', () => {
    expect(mapError({ message: 'Failed to fetch' }))
      .toMatch(/เน็ตไม่ตอบสนอง/);
  });
  it('handles RPC raise() messages (insufficient stock)', () => {
    expect(mapError({ message: 'insufficient stock for product 42' })).toBe('สต็อกไม่พอ');
  });
  it('falls back to err.message for unknown errors', () => {
    expect(mapError({ message: 'something weird happened' })).toBe('something weird happened');
  });
  it('handles null / undefined defensively', () => {
    expect(mapError(null)).toBe('เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ');
    expect(mapError(undefined)).toBe('เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ');
  });
  it('passes strings through', () => {
    expect(mapError('hello')).toBe('hello');
  });
});
