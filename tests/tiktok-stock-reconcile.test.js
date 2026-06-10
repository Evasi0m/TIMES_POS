import { describe, it, expect } from 'vitest';
import {
  partitionRows,
  filterRows,
  defaultSelectedIds,
  isRowApplicable,
  rowToApplyItem,
  buildApplyPreview,
  diffChipClass,
  formatDiff,
  sourceLabel,
  formatApplyToast,
  FILTER_TABS,
} from '../src/lib/tiktok-stock-reconcile-helpers.js';

const sampleRows = [
  { product_id: 1, status: 'ok', sync_enabled: true, diff: 0, pos_stock: 5, tiktok_stock: 5, seller_sku: 'A' },
  { product_id: 2, status: 'ok', sync_enabled: true, diff: 2, pos_stock: 7, tiktok_stock: 5, seller_sku: 'B', tiktok_product_id: 'p1', tiktok_sku_id: 's1' },
  { product_id: 3, status: 'ok', sync_enabled: true, diff: -1, pos_stock: 4, tiktok_stock: 5, seller_sku: 'C', tiktok_product_id: 'p2', tiktok_sku_id: 's2' },
  { product_id: 4, status: 'missing_product_id', sync_enabled: true, diff: null, seller_sku: 'D' },
  { product_id: 5, status: 'sync_disabled', sync_enabled: false, diff: null, seller_sku: 'E' },
];

describe('partitionRows', () => {
  it('splits matched, mismatched, and problems', () => {
    const p = partitionRows(sampleRows);
    expect(p.matched).toHaveLength(1);
    expect(p.mismatched).toHaveLength(2);
    expect(p.problems).toHaveLength(2);
    expect(p.all).toHaveLength(5);
  });
});

describe('filterRows', () => {
  it('filters by tab', () => {
    expect(filterRows(sampleRows, { tab: FILTER_TABS.mismatched })).toHaveLength(2);
    expect(filterRows(sampleRows, { tab: FILTER_TABS.problems })).toHaveLength(2);
  });

  it('filters by search query', () => {
    const filtered = filterRows(sampleRows, { tab: FILTER_TABS.all, query: 'B' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].product_id).toBe(2);
  });
});

describe('isRowApplicable', () => {
  it('allows mismatched ok rows for pos source', () => {
    expect(isRowApplicable(sampleRows[1], 'pos')).toBe(true);
    expect(isRowApplicable(sampleRows[0], 'pos')).toBe(false);
    expect(isRowApplicable(sampleRows[3], 'pos')).toBe(false);
  });

  it('allows tiktok source when tiktok_stock present', () => {
    expect(isRowApplicable(sampleRows[2], 'tiktok')).toBe(true);
  });
});

describe('defaultSelectedIds', () => {
  it('selects only applicable mismatched rows', () => {
    const ids = defaultSelectedIds(sampleRows, 'pos');
    expect(ids.has(2)).toBe(true);
    expect(ids.has(3)).toBe(true);
    expect(ids.has(1)).toBe(false);
    expect(ids.has(4)).toBe(false);
  });
});

describe('rowToApplyItem', () => {
  it('builds pos source payload', () => {
    const item = rowToApplyItem(sampleRows[1], 'pos');
    expect(item.product_id).toBe(2);
    expect(item.pos_stock).toBe(7);
    expect(item.target_qty).toBeUndefined();
  });

  it('builds tiktok source payload with target_qty', () => {
    const item = rowToApplyItem(sampleRows[2], 'tiktok');
    expect(item.target_qty).toBe(5);
  });
});

describe('buildApplyPreview', () => {
  it('formats pos direction preview', () => {
    const lines = buildApplyPreview([sampleRows[1]], 'pos');
    expect(lines[0]).toContain('POS 7 → TikTok 7');
    expect(lines[0]).toContain('เดิม 5');
  });

  it('formats tiktok direction preview', () => {
    const lines = buildApplyPreview([sampleRows[2]], 'tiktok');
    expect(lines[0]).toContain('TikTok 5 → POS 5');
  });
});

describe('diffChipClass', () => {
  it('returns correct class for diff sign', () => {
    expect(diffChipClass(0)).toBe('tt-reconcile-chip--ok');
    expect(diffChipClass(3)).toBe('tt-reconcile-chip--pos-high');
    expect(diffChipClass(-2)).toBe('tt-reconcile-chip--pos-low');
  });
});

describe('formatDiff', () => {
  it('formats signed diff', () => {
    expect(formatDiff(0)).toBe('0');
    expect(formatDiff(2)).toBe('+2');
    expect(formatDiff(-1)).toBe('-1');
  });
});

describe('sourceLabel', () => {
  it('returns Thai direction labels', () => {
    expect(sourceLabel('pos')).toBe('POS → TikTok');
    expect(sourceLabel('tiktok')).toBe('TikTok → POS');
  });
});

describe('formatApplyToast', () => {
  it('summarizes apply results', () => {
    const msg = formatApplyToast({ success: 3, skipped: 1, failed: 0 }, 'pos');
    expect(msg).toContain('สำเร็จ 3');
    expect(msg).toContain('POS → TikTok');
  });

  it('shows failed count', () => {
    const msg = formatApplyToast({ success: 1, skipped: 0, failed: 2 }, 'tiktok');
    expect(msg).toContain('ผิดพลาด 2');
  });
});
