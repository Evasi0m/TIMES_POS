import { describe, it, expect } from 'vitest';
import {
  DISPLAY_STATUS,
  resolveSaleOrderDisplayStatus,
} from '../src/lib/sale-order-display-status.js';
import { orderStatusBadgeStyle } from '../src/lib/order-status-badge-style.js';

describe('resolveSaleOrderDisplayStatus', () => {
  it('voided → ยกเลิก', () => {
    const r = resolveSaleOrderDisplayStatus({ status: 'voided', void_reason: 'manual void' });
    expect(r.code).toBe(DISPLAY_STATUS.CANCELLED);
    expect(r.label).toBe('ยกเลิก');
    expect(r.tone).toBe('red');
  });

  it('voided TikTok cancel → ยกเลิก TikTok', () => {
    const r = resolveSaleOrderDisplayStatus({
      status: 'voided',
      channel: 'tiktok',
      void_reason: 'TikTok order cancelled',
    });
    expect(r.code).toBe(DISPLAY_STATUS.CANCELLED_TIKTOK);
    expect(r.label).toBe('ยกเลิก TikTok');
    expect(r.tone).toBe('tiktok_red');
  });

  it('pending → รอยืนยัน', () => {
    const r = resolveSaleOrderDisplayStatus({ status: 'pending' });
    expect(r.code).toBe(DISPLAY_STATUS.PENDING_CONFIRM);
    expect(r.label).toBe('รอยืนยัน');
  });

  it('active + substitution → ส่งคนละรุ่น (DB flag)', () => {
    const r = resolveSaleOrderDisplayStatus({
      status: 'active',
      has_substitution: true,
      net_received_pending: true,
      has_edits: true,
    });
    expect(r.code).toBe(DISPLAY_STATUS.SUBSTITUTION);
    expect(r.label).toBe('ส่งคนละรุ่น');
  });

  it('active + substitution fallback from opts', () => {
    const r = resolveSaleOrderDisplayStatus(
      { status: 'active' },
      { hasSubstitution: true },
    );
    expect(r.code).toBe(DISPLAY_STATUS.SUBSTITUTION);
  });

  it('active + net_received_pending → รอใส่ราคา', () => {
    const r = resolveSaleOrderDisplayStatus({
      status: 'active',
      net_received_pending: true,
      has_edits: true,
    });
    expect(r.code).toBe(DISPLAY_STATUS.PENDING_PRICE);
    expect(r.label).toBe('รอใส่ราคา');
  });

  it('active + has_edits → แก้ไขแล้ว', () => {
    const r = resolveSaleOrderDisplayStatus({
      status: 'active',
      has_edits: true,
    });
    expect(r.code).toBe(DISPLAY_STATUS.EDITED);
    expect(r.label).toBe('แก้ไขแล้ว');
    expect(r.tone).toBe('teal');
  });

  it('active default → ปกติ', () => {
    const r = resolveSaleOrderDisplayStatus({ status: 'active' });
    expect(r.code).toBe(DISPLAY_STATUS.NORMAL);
    expect(r.label).toBe('ปกติ');
    expect(r.tone).toBe('green');
  });

  it('returns null for missing order', () => {
    expect(resolveSaleOrderDisplayStatus(null)).toBeNull();
  });
});

describe('orderStatusBadgeStyle', () => {
  it('uses circle dot by default', () => {
    const s = orderStatusBadgeStyle({ tone: 'purple' });
    expect(s.borderRadius).toBe('50%');
    expect(s.width).toBe('12px');
    expect(s.height).toBe('12px');
  });

  it('square shape when requested', () => {
    const s = orderStatusBadgeStyle({ tone: 'purple', shape: 'square' });
    expect(s.borderRadius).toBe('6px');
    expect(s.minWidth).toBe('52px');
  });

  it('pill shape when requested', () => {
    const s = orderStatusBadgeStyle({ tone: 'purple', shape: 'pill' });
    expect(s.borderRadius).toBe('9999px');
  });
});
