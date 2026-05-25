import { describe, it, expect, vi } from 'vitest';
import { fetchAll, fetchAllFromTable } from '../src/lib/sb-paginate.js';

// Build a fake "Supabase select" that returns 1000-row chunks until the
// requested range exceeds `total` rows. Tracks how many requests it served
// so we can assert the loop stopped early when expected.
function makeFakeQuery(total) {
  const calls = [];
  const fn = (from, to) => {
    calls.push({ from, to });
    if (from >= total) return Promise.resolve({ data: [], error: null });
    const rows = Array.from(
      { length: Math.min(to - from + 1, total - from) },
      (_, i) => ({ id: from + i })
    );
    return Promise.resolve({ data: rows, error: null });
  };
  fn.calls = calls;
  return fn;
}

describe('fetchAll', () => {
  it('returns an empty array for an empty table without infinite-looping', async () => {
    const q = makeFakeQuery(0);
    const { data, error } = await fetchAll(q);
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(q.calls).toHaveLength(1);
  });

  it('returns a single short page in one request (no extra round trip)', async () => {
    const q = makeFakeQuery(42);
    const { data, error } = await fetchAll(q);
    expect(error).toBeNull();
    expect(data).toHaveLength(42);
    expect(q.calls).toHaveLength(1);
  });

  it('chunks across the 1000-row PostgREST cap', async () => {
    const q = makeFakeQuery(2500);
    const { data, error } = await fetchAll(q);
    expect(error).toBeNull();
    expect(data).toHaveLength(2500);
    // 1000 + 1000 + 500 = 3 calls
    expect(q.calls).toHaveLength(3);
    expect(q.calls[0]).toEqual({ from: 0, to: 999 });
    expect(q.calls[1]).toEqual({ from: 1000, to: 1999 });
    expect(q.calls[2]).toEqual({ from: 2000, to: 2999 });
  });

  it('stops as soon as a page returns fewer than pageSize rows', async () => {
    // Exactly 1000 rows: first page is full, second page is empty.
    // The loop should stop AFTER detecting the empty page (2 calls), not
    // pretend it was done at 1000.
    const q = makeFakeQuery(1000);
    const { data } = await fetchAll(q);
    expect(data).toHaveLength(1000);
    expect(q.calls).toHaveLength(2);
  });

  it('honours custom pageSize', async () => {
    const q = makeFakeQuery(250);
    const { data } = await fetchAll(q, { pageSize: 100 });
    expect(data).toHaveLength(250);
    expect(q.calls).toHaveLength(3);
    expect(q.calls[0]).toEqual({ from: 0, to: 99 });
  });

  it('returns partial data + error when the query fails mid-stream', async () => {
    let callIdx = 0;
    const q = (from, to) => {
      callIdx++;
      if (callIdx === 2) return Promise.resolve({ data: null, error: { message: 'boom' } });
      const rows = Array.from({ length: 1000 }, (_, i) => ({ id: from + i }));
      return Promise.resolve({ data: rows, error: null });
    };
    const { data, error } = await fetchAll(q);
    expect(error).toEqual({ message: 'boom' });
    expect(data).toHaveLength(1000); // first chunk preserved
  });

  it('refuses to load past hardCap and surfaces a synthetic error', async () => {
    // Pretend table has 10k rows, but cap at 2500.
    const q = makeFakeQuery(10000);
    const { data, error } = await fetchAll(q, { hardCap: 2500 });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/hardCap/);
    expect(data.length).toBeGreaterThan(0);
  });
});

describe('fetchAllFromTable', () => {
  it('builds an ordered select with chunked range()', async () => {
    // Hand-rolled spy chain — vitest's vi.fn() resolved-promise mocks were
    // crashing the worker when reused across the chunked loop.
    const calls = { from: [], select: [], order: [], range: [] };
    const sb = {
      from(table) {
        calls.from.push(table);
        return {
          select(cols) {
            calls.select.push(cols);
            return {
              order(col, opts) {
                calls.order.push([col, opts]);
                return {
                  range(a, b) {
                    calls.range.push([a, b]);
                    return Promise.resolve({ data: [{ id: 1 }, { id: 2 }], error: null });
                  },
                };
              },
            };
          },
        };
      },
    };

    const { data, error } = await fetchAllFromTable(sb, 'products', {
      select: 'id,name',
      orderColumn: 'created_at',
      ascending: true,
    });

    expect(error).toBeNull();
    expect(data).toEqual([{ id: 1 }, { id: 2 }]);
    expect(calls.from).toEqual(['products']);
    expect(calls.select).toEqual(['id,name']);
    expect(calls.order).toEqual([['created_at', { ascending: true }]]);
    expect(calls.range).toEqual([[0, 999]]);
  });
});
