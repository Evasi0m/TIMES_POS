import { describe, it, expect } from 'vitest';
import { findLostMovements, uncarriedUnresolved, addNets } from '../src/lib/bigseller-export.js';

// Mirrors production on 2026-11-20 (batches 1–4, trimmed).
const batches = [
  { id: 1, from_movement_id: 17390, to_movement_id: 17390, created_at: '2026-11-16T15:48:35Z', unresolved: [] },
  { id: 2, from_movement_id: 17390, to_movement_id: 17490, created_at: '2026-11-17T15:12:23Z', unresolved: [] },
  { id: 3, from_movement_id: 17576, to_movement_id: 17576, created_at: '2026-11-18T09:37:48Z', unresolved: [] }, // reset
  { id: 4, from_movement_id: 17576, to_movement_id: 17649, created_at: '2026-11-19T06:22:04Z', unresolved: [{ product_id: 9, net: -1 }] },
  { id: 5, from_movement_id: 17649, to_movement_id: 17702, created_at: '2026-11-19T15:30:38Z', unresolved: [{ product_id: 8, net: -2 }] },
];
const mv = (id, reason, channel, qty = -1, product_id = 1) => ({ id, reason, channel, qty_delta: qty, product_id });

describe('findLostMovements', () => {
  it('finds legacy online sales and the reset gap (AE-1200WHL-5A case)', () => {
    const moves = [
      mv(17473, 'sale', 'shopee'),   // batch 2, old rule skipped → lost
      mv(17480, 'sale', 'store'),    // batch 2, store was exported → ok
      mv(17515, 'sale', 'tiktok'),   // gap → lost
      mv(17545, 'sale', 'shopee'),   // gap → lost
      mv(17550, 'receive', null, 5), // gap → lost (any reason)
      mv(17606, 'sale', 'tiktok'),   // batch 4, new rule → ok
      mv(17800, 'sale', 'shopee'),   // after last batch → not catch-up
    ];
    const { lost, gap, legacy } = findLostMovements(moves, batches);
    expect(lost.map(m => m.id)).toEqual([17473, 17515, 17545, 17550]);
    expect(gap).toBe(3);
    expect(legacy).toBe(1);
  });
  it('ignores catch-up batches and handles no batches', () => {
    expect(findLostMovements([mv(5, 'sale', 'shopee')], []).lost).toEqual([]);
    const withCatchup = [...batches, { id: 6, kind: 'catchup', from_movement_id: 17390, to_movement_id: 17702, created_at: '2026-11-20T00:00:00Z' }];
    expect(findLostMovements([mv(17515, 'sale', 'tiktok')], withCatchup).lost).toHaveLength(1);
  });
});

describe('uncarriedUnresolved', () => {
  it('takes every normal batch except the latest, minus carried ones', () => {
    expect(uncarriedUnresolved(batches)).toEqual([{ product_id: 9, net: -1 }]);
    const later = [...batches, { id: 7, carried_from: 5, unresolved: [] }];
    expect(uncarriedUnresolved(later)).toEqual([{ product_id: 9, net: -1 }]);
    const carried4 = [...batches.map(b => (b.id === 5 ? { ...b, carried_from: 4 } : b))];
    expect(uncarriedUnresolved(carried4)).toEqual([]);
  });
});

describe('addNets', () => {
  it('merges items into a net map', () => {
    const out = addNets(new Map([[1, -1]]), [{ product_id: 1, net: -2 }, { product_id: 2, net: 3 }, { product_id: 3, net: 0 }]);
    expect([...out]).toEqual([[1, -3], [2, 3]]);
  });
});
