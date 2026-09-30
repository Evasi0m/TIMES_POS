import { describe, it, expect } from 'vitest';
import { receiveLineTotal } from '../src/components/movement/ReceiveLinesEditor.jsx';

// Values cross-checked against public.receive_line_total in
// supabase-migrations/083_edit_receive_order.sql on a real Postgres 16.
describe('receiveLineTotal (matches DB receive_line_total)', () => {
  it('plain qty × price', () => {
    expect(receiveLineTotal({ unit_price: 107, quantity: 12 })).toBe(1284);
  });
  it('percent discount', () => {
    expect(receiveLineTotal({ unit_price: 50, quantity: 3, discount1_value: 10, discount1_type: 'percent' })).toBe(135);
  });
  it('cascading baht then percent, never below zero', () => {
    expect(receiveLineTotal({ unit_price: 100, quantity: 2, discount1_value: 10, discount1_type: 'baht', discount2_value: 50, discount2_type: 'percent' })).toBe(90);
    expect(receiveLineTotal({ unit_price: 10, quantity: 5, discount1_value: 20, discount1_type: 'baht' })).toBe(0);
  });
  it('blank qty counts as 0', () => {
    expect(receiveLineTotal({ unit_price: 100, quantity: '' })).toBe(0);
  });
});
