import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock('../src/lib/supabase-client.js', () => ({
  sb: {
    rpc: (...args) => rpcMock(...args),
    from: (...args) => fromMock(...args),
  },
}));

import { logStockExport, fetchStockExportLogs } from '../src/lib/stock-export-log.js';

describe('logStockExport', () => {
  beforeEach(() => rpcMock.mockReset());

  it('calls log_stock_export RPC with payload', async () => {
    rpcMock.mockResolvedValue({ data: 42, error: null });
    const id = await logStockExport({
      exporterEmail: 'a@b.com',
      exporterName: 'Tester',
      scope: 'casio',
      scopeLabel: 'Casio',
      rowCount: 10,
      shopName: 'TIMES',
      filename: 'stock-casio-2026-06-12.csv',
    });
    expect(id).toBe(42);
    expect(rpcMock).toHaveBeenCalledWith('log_stock_export', {
      p_exporter_email: 'a@b.com',
      p_exporter_name: 'Tester',
      p_scope: 'casio',
      p_scope_label: 'Casio',
      p_row_count: 10,
      p_shop_name: 'TIMES',
      p_filename: 'stock-casio-2026-06-12.csv',
    });
  });
});

describe('fetchStockExportLogs', () => {
  beforeEach(() => fromMock.mockReset());

  it('queries stock_export_logs ordered by exported_at desc', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [{ id: 1 }], error: null });
    const order = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ order }));
    fromMock.mockReturnValue({ select });

    const rows = await fetchStockExportLogs(25);
    expect(fromMock).toHaveBeenCalledWith('stock_export_logs');
    expect(select).toHaveBeenCalled();
    expect(order).toHaveBeenCalledWith('exported_at', { ascending: false });
    expect(limit).toHaveBeenCalledWith(25);
    expect(rows).toEqual([{ id: 1 }]);
  });
});
