import { describe, it, expect } from 'vitest';
import {
  findPendingTikTokOverlap,
  formatOverlapWarning,
} from '../src/lib/tiktok-checkout-guard.js';

describe('tiktok-checkout-guard', () => {
  const pending = [
    {
      id: 1,
      tiktok_order_id: 'TT-001',
      items: [{ product_id: 10 }, { product_id: 20 }],
    },
    {
      id: 2,
      tiktok_order_id: 'TT-002',
      items: [{ product_id: 99 }],
    },
    {
      id: 3,
      tiktok_order_id: 'TT-003',
      items: [{ product_id: null }],
    },
  ];

  it('finds overlap when cart shares product_id', () => {
    const cart = [{ product_id: 20 }, { product_id: 50 }];
    const hits = findPendingTikTokOverlap(pending, cart);
    expect(hits).toHaveLength(1);
    expect(hits[0].tiktok_order_id).toBe('TT-001');
  });

  it('returns empty when no overlap', () => {
    expect(findPendingTikTokOverlap(pending, [{ product_id: 777 }])).toEqual([]);
    expect(findPendingTikTokOverlap([], [{ product_id: 10 }])).toEqual([]);
    expect(findPendingTikTokOverlap(pending, [])).toEqual([]);
  });

  it('formatOverlapWarning lists order ids', () => {
    const msg = formatOverlapWarning([pending[0], pending[1]]);
    expect(msg).toContain('2 รายการ');
    expect(msg).toContain('TT-001');
    expect(msg).toContain('TT-002');
  });
});
