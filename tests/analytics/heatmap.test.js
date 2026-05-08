import { describe, it, expect } from 'vitest';
import { buildHeatmap, peakCell, WEEKDAY_LABELS_TH } from '../../src/lib/analytics/heatmap.js';

// Bangkok is UTC+7. Pick unambiguous UTC timestamps and compute expected
// Bangkok wall-clock cells by hand.
//
// 2025-05-05T00:00:00Z = 07:00 Bangkok Monday
// 2025-05-05T12:00:00Z = 19:00 Bangkok Monday
// 2025-05-10T18:00:00Z = 01:00 Bangkok Sunday
// 2025-05-11T17:30:00Z = 00:30 Bangkok Monday (next week)

describe('buildHeatmap', () => {
  it('buckets into Bangkok-local dow+hour cells', () => {
    const rows = [
      { sale_date: '2025-05-05T00:00:00Z', revenue: 100 }, // Mon 07:00
      { sale_date: '2025-05-05T12:00:00Z', revenue: 200 }, // Mon 19:00
      { sale_date: '2025-05-10T18:00:00Z', revenue: 300 }, // Sat 18:00 UTC = Sun 01:00 BKK
    ];
    const { matrix, maxCell, total } = buildHeatmap(rows);
    expect(matrix[0][7]).toBe(100);    // Mon 07:00
    expect(matrix[0][19]).toBe(200);   // Mon 19:00
    expect(matrix[6][1]).toBe(300);    // Sun 01:00
    expect(maxCell).toBe(300);
    expect(total).toBe(600);
  });

  it('accumulates multiple rows into the same cell', () => {
    const rows = [
      { sale_date: '2025-05-05T12:00:00Z', revenue: 100 }, // Mon 19:00
      { sale_date: '2025-05-05T12:30:00Z', revenue: 50 },  // Mon 19:00
      { sale_date: '2025-05-05T12:59:00Z', revenue: 25 },  // Mon 19:00
    ];
    const { matrix } = buildHeatmap(rows);
    expect(matrix[0][19]).toBe(175);
  });

  it('ignores invalid / missing dates', () => {
    const rows = [
      { sale_date: 'not-a-date', revenue: 100 },
      { sale_date: null, revenue: 50 },
      { sale_date: '2025-05-05T12:00:00Z', revenue: 200 },
    ];
    const { matrix, total } = buildHeatmap(rows);
    expect(total).toBe(200);
    expect(matrix[0][19]).toBe(200);
  });

  it('returns an all-zero matrix for empty input', () => {
    const { matrix, maxCell, total } = buildHeatmap([]);
    expect(matrix.length).toBe(7);
    expect(matrix[0].length).toBe(24);
    expect(maxCell).toBe(0);
    expect(total).toBe(0);
  });

  it('weekday labels are in Thai', () => {
    expect(WEEKDAY_LABELS_TH[0]).toBe('จันทร์');
    expect(WEEKDAY_LABELS_TH[6]).toBe('อาทิตย์');
  });
});

describe('peakCell', () => {
  it('returns the busiest cell', () => {
    const { matrix } = buildHeatmap([
      { sale_date: '2025-05-05T12:00:00Z', revenue: 500 }, // Mon 19:00
      { sale_date: '2025-05-06T12:00:00Z', revenue: 200 }, // Tue 19:00
    ]);
    const peak = peakCell({ matrix });
    expect(peak).toEqual({ dow: 0, hour: 19, revenue: 500 });
  });

  it('returns null when the matrix is empty', () => {
    expect(peakCell(buildHeatmap([]))).toBeNull();
  });
});
