import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/supabase-client.js', () => ({
  sb: { from: vi.fn() },
}));

vi.mock('../src/lib/date.js', () => ({
  fmtDateTime: (s) => (s ? `DT:${s}` : '\u2014'),
}));

vi.mock('../src/lib/money.js', () => ({
  fmtTHB: (n) => `THB:${n}`,
}));

import {
  movementDetailKind,
  canShowMovementDetail,
  formatMovementDetailRows,
  buildMovementDetailView,
} from '../src/lib/stock-movement-detail.js';

describe('movementDetailKind', () => {
  it('maps sale movements via ref_table', () => {
    expect(movementDetailKind({ reason: 'sale', ref_table: 'sale_orders', ref_id: 1 })).toBe('sale');
    expect(movementDetailKind({ reason: 'sale_edit', ref_table: 'sale_orders', ref_id: 2 })).toBe('sale');
  });

  it('maps receive movements', () => {
    expect(movementDetailKind({ reason: 'receive', ref_table: 'receive_orders', ref_id: 3 })).toBe('receive');
  });

  it('maps manual and reconcile without ref_id requirement for kind', () => {
    expect(movementDetailKind({ reason: 'manual_adjust' })).toBe('manual');
    expect(movementDetailKind({ reason: 'stock_reconcile', ref_id: 9 })).toBe('reconcile');
  });

  it('returns null for initial', () => {
    expect(movementDetailKind({ reason: 'initial' })).toBe(null);
  });
});

describe('canShowMovementDetail', () => {
  it('hides initial movements', () => {
    expect(canShowMovementDetail({ reason: 'initial' })).toBe(false);
  });

  it('shows sale with ref', () => {
    expect(canShowMovementDetail({ reason: 'sale', ref_table: 'sale_orders', ref_id: 1 })).toBe(true);
  });
});

describe('formatMovementDetailRows', () => {
  it('includes TikTok order for sale', () => {
    const rows = formatMovementDetailRows('sale', {
      reason: 'sale',
      qty_delta: -1,
      balance_after: 4,
      created_at: '2026-07-11T00:00:00Z',
    }, {
      order: {
        id: 10,
        channel: 'tiktok',
        payment_method: 'cod',
        tiktok_order_id: '5761234567890',
        grand_total: 1500,
        sale_date: '2026-07-11T00:00:00Z',
        status: 'active',
      },
      line: { quantity: 1, unit_price: 1500 },
    });
    expect(rows.some((r) => r.value === '5761234567890')).toBe(true);
    expect(rows.find((r) => r.label === 'Platform')?.value).toBe('TikTok');
    expect(rows.find((r) => r.label === 'Platform')).toBeTruthy();
  });

  it('includes receive supplier fields', () => {
    const rows = formatMovementDetailRows('receive', {
      reason: 'receive',
      qty_delta: 2,
      balance_after: 6,
      created_at: '2026-07-11T00:00:00Z',
    }, {
      order: {
        id: 20,
        supplier_name: 'CMG',
        supplier_invoice_no: 'INV-99',
        purchase_doc_no: 'RC26070001',
        created_via: 'ai_cmg',
        total_value: 5000,
        receive_date: '2026-07-11T00:00:00Z',
      },
      line: { quantity: 2, unit_price: 2500 },
    });
    expect(rows.some((r) => r.value === 'CMG')).toBe(true);
    expect(rows.some((r) => r.value === 'AI scan')).toBe(true);
    expect(rows.some((r) => r.value === 'INV-99')).toBe(true);
  });

  it('formats manual adjust subreason', () => {
    const rows = formatMovementDetailRows('manual', {
      reason: 'manual_adjust',
      notes: '[physical_count] counted mismatch',
      qty_delta: -1,
      balance_after: 3,
      created_at: '2026-07-11T00:00:00Z',
    }, { movement: {} });
    expect(rows.some((r) => r.value.includes('counted mismatch'))).toBe(true);
    expect(rows.length).toBeGreaterThan(2);
  });
});

describe('buildMovementDetailView', () => {
  it('builds hero and receive sections', () => {
    const view = buildMovementDetailView('receive', {
      reason: 'receive',
      qty_delta: 10,
      balance_after: 10,
      created_at: '2026-07-11T00:00:00Z',
    }, {
      order: {
        id: 5895,
        supplier_name: 'CMG',
        supplier_invoice_no: 'INV-1',
        purchase_doc_no: 'RC001',
        created_via: 'manual',
        total_value: 20159.98,
        receive_date: '2026-07-11T00:00:00Z',
      },
      line: { quantity: 10, unit_price: 2000 },
    });
    expect(view.hero.qtyDelta).toBe(10);
    expect(view.hero.isPositive).toBe(true);
    expect(view.amount?.value).toContain('THB:');
    expect(view.sections.length).toBeGreaterThan(0);
  });

  it('includes tiktok highlight for sale', () => {
    const view = buildMovementDetailView('sale', {
      reason: 'sale',
      qty_delta: -1,
      balance_after: 0,
      created_at: '2026-07-11T00:00:00Z',
    }, {
      order: {
        id: 1,
        channel: 'tiktok',
        tiktok_order_id: '576123',
        payment_method: 'cod',
        grand_total: 1000,
        sale_date: '2026-07-11T00:00:00Z',
        status: 'active',
      },
      line: { quantity: 1, unit_price: 1000 },
    });
    expect(view.highlight?.value).toBe('576123');
    expect(view.channelOrder).toBeTruthy();
  });
});
