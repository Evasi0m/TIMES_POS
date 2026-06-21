import { describe, it, expect } from 'vitest';
import {
  collectBillAlerts,
  BILL_STATUS_LABELS,
  BILL_STATUS_CHIP_CLS,
} from '../src/components/ai/bill-card-alerts.js';

const THAI_RE = /[\u0E00-\u0E7F]/;

function expectThaiText(str) {
  expect(str).not.toMatch(/\?{3,}/);
  expect(THAI_RE.test(str)).toBe(true);
}

describe('collectBillAlerts', () => {
  const baseBill = {
    is_cmg_bill: true,
    rows: [
      { status: 'auto', product: { id: 1 }, quantity: 1, unit_cost: 100, needsReview: false },
    ],
    validation: { bill: { warnings: [] }, rows: [] },
    saveState: null,
    previewUrl: 'blob:test',
  };

  it('returns empty when bill is clean', () => {
    expect(collectBillAlerts(baseBill)).toEqual([]);
  });

  it('prioritizes duplicate invoice as error', () => {
    const alerts = collectBillAlerts(baseBill, {
      dup: { id: 42, date: '2026-01-01' },
    });
    expect(alerts[0].severity).toBe('error');
    expect(alerts[0].key).toBe('dup');
    expectThaiText(alerts[0].message);
  });

  it('flags unresolved rows', () => {
    const bill = {
      ...baseBill,
      rows: [{ status: 'none', quantity: 1, unit_cost: 100 }],
    };
    const alerts = collectBillAlerts(bill);
    expect(alerts.some((a) => a.key === 'unresolved')).toBe(true);
    expectThaiText(alerts.find((a) => a.key === 'unresolved').message);
  });

  it('exposes saveError on save-failed alert', () => {
    const bill = {
      ...baseBill,
      saveState: 'failed',
      saveError: 'network timeout',
    };
    const alert = collectBillAlerts(bill).find((a) => a.key === 'save-failed');
    expect(alert).toBeTruthy();
    expect(alert.saveError).toBe('network timeout');
    expectThaiText(alert.message);
  });

  it('exposes Thai status labels without corruption', () => {
    for (const label of Object.values(BILL_STATUS_LABELS)) {
      expectThaiText(label);
    }
    expect(BILL_STATUS_LABELS.ready).toBe('พร้อมบันทึก');
    expect(BILL_STATUS_LABELS.unresolved).toBe('ต้องจับคู่');
  });

  it('maps every status to a chip class', () => {
    for (const key of Object.keys(BILL_STATUS_LABELS)) {
      expect(BILL_STATUS_CHIP_CLS[key]).toMatch(/^brv-status-chip--/);
    }
  });

  it('exposes needs_review status label', () => {
    expectThaiText(BILL_STATUS_LABELS.needs_review);
    expect(BILL_STATUS_LABELS.needs_review).toBe('ตรวจอีกครั้ง');
    expect(BILL_STATUS_CHIP_CLS.needs_review).toBe('brv-status-chip--warn');
  });
});
