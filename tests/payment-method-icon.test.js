import { describe, it, expect } from 'vitest';
import { getPaymentMethodLabel, PAYMENT_METHOD_LABELS } from '../src/lib/payment-method-label.js';

describe('getPaymentMethodLabel', () => {
  it('maps transfer', () => {
    expect(getPaymentMethodLabel('transfer')).toBe('โอนเงิน');
  });

  it('maps card', () => {
    expect(getPaymentMethodLabel('card')).toBe('บัตร');
  });

  it('maps paylater', () => {
    expect(getPaymentMethodLabel('paylater')).toBe('paylater');
  });

  it('maps cod', () => {
    expect(getPaymentMethodLabel('cod')).toBe('เก็บปลายทาง');
  });

  it('returns em dash for empty', () => {
    expect(getPaymentMethodLabel(null)).toBe('—');
    expect(getPaymentMethodLabel('')).toBe('—');
  });

  it('falls back to raw method for unknown', () => {
    expect(getPaymentMethodLabel('crypto')).toBe('crypto');
  });

  it('exports all known keys', () => {
    expect(PAYMENT_METHOD_LABELS.cash).toBe('เงินสด');
  });
});
