import { describe, expect, it } from 'vitest';
import {
  buildSalesHistoryExportRows,
  salesHistoryExportFilename,
} from '../src/lib/sales-history-export.js';

describe('sales-history-export', () => {
  it('builds one Excel row per visible bill and uses net received for e-commerce', () => {
    const rows = buildSalesHistoryExportRows(
      [
        {
          id: 42,
          sale_date: '2026-08-19T05:30:00.000Z',
          status: 'active',
          channel: 'shopee',
          payment_method: 'transfer',
          grand_total: 1000,
          net_received: 920,
          vat_amount: 65.42,
          tax_invoice_no: 'TAX-42',
          buyer_name: 'คุณลูกค้า',
        },
      ],
      {
        42: { productLabel: 'WATCH-01', itemCount: 2, profit: 320 },
      },
      {
        channelLabels: { shopee: 'Shopee' },
        paymentLabels: { transfer: 'โอนเงิน' },
      }
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      เลขที่บิล: 42,
      วันที่: '2026-08-19',
      Platform: 'Shopee',
      วิธีชำระ: 'โอนเงิน',
      รายการสินค้า: 'WATCH-01',
      ยอดขายรวม: 1000,
      VAT: 65.42,
      ร้านได้รับจริง: 920,
      กำไร: 320,
      'กำไรหลัง VAT': 320 / 1.07,
    });
  });

  it('creates a single xlsx filename that identifies selected platforms', () => {
    expect(
      salesHistoryExportFilename({
        from: '2026-08-01',
        to: '2026-08-31',
        channels: ['shopee', 'tiktok'],
      })
    ).toBe('ยอดขาย_2026-08-01_ถึง_2026-08-31_shopee-tiktok.xlsx');
  });
});
