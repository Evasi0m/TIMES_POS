import { describe, it, expect } from 'vitest';
import { buildRowFromAi } from '../src/lib/bill-materialize.js';

describe('buildRowFromAi barcode match', () => {
  const catalog = [
    { id: 42, name: 'GA-2100-1A1DR', barcode: '8851234567890', current_stock: 0 },
    { id: 99, name: 'GA-2100-1A1DR', barcode: '8859999999999', current_stock: 0 },
  ];

  it('auto-matches by barcode before fuzzy model code', () => {
    const row = buildRowFromAi({
      model_code: 'UNREADABLE-OCR',
      barcode: '8851234567890',
      quantity: 2,
      unit_cost: 1000,
      line_amount: 2000,
      needs_review: false,
    }, catalog);
    expect(row.status).toBe('auto');
    expect(row.product.id).toBe(42);
    expect(row.matchScore).toBe(1);
  });
});
