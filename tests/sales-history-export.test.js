import { describe, expect, it } from 'vitest';
import {
  buildSalesHistorySheetData,
  buildSalesHistoryExportRows,
  defaultSalesHistoryExportColumns,
  normalizeSalesHistoryExportColumns,
  SALES_HISTORY_EXPORT_COLUMNS,
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
      'ยอดก่อน VAT': 934.58,
      กำไร: 320,
      'กำไรหลัง VAT': 320 / 1.07,
    });
  });

  it('includes detailed accounting and tax columns in the picker catalogue', () => {
    const keys = SALES_HISTORY_EXPORT_COLUMNS.map((column) => column.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'Platform',
        'เลขที่ใบกำกับภาษี',
        'เลขประจำตัวผู้เสียภาษีผู้ซื้อ',
        'สาขาผู้ซื้อ',
        'ที่อยู่ผู้ซื้อ',
        'ยอดก่อน VAT',
        'VAT',
        'ร้านได้รับจริง',
      ])
    );
  });

  it('projects only selected columns into the worksheet data', () => {
    expect(
      buildSalesHistorySheetData(
        [{ เลขที่บิล: 1, กำไร: 250, Platform: 'Shopee' }],
        ['เลขที่บิล', 'Platform']
      )
    ).toEqual({
      headers: ['เลขที่บิล', 'Platform'],
      lines: [
        ['เลขที่บิล', 'Platform'],
        [1, 'Shopee'],
        ['รวม', ''],
      ],
    });
  });

  it('adds a bottom total row for selected numeric columns', () => {
    expect(
      buildSalesHistorySheetData(
        [
          { ลำดับ: 1, 'จำนวนชิ้น': 2, ยอดขายรวม: 100, Platform: 'Shopee' },
          { ลำดับ: 2, 'จำนวนชิ้น': 3, ยอดขายรวม: 250, Platform: 'หน้าร้าน' },
        ],
        ['ลำดับ', 'จำนวนชิ้น', 'ยอดขายรวม', 'Platform']
      ).lines.at(-1)
    ).toEqual(['รวม', 5, 350, '']);
  });

  it('keeps the default column selection and removes unknown saved keys', () => {
    expect(defaultSalesHistoryExportColumns().length).toBeGreaterThan(0);
    expect(normalizeSalesHistoryExportColumns(['กำไร', 'unknown', 'กำไร'])).toEqual(['กำไร']);
    expect(normalizeSalesHistoryExportColumns([])).toEqual([]);
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
