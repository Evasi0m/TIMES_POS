import { describe, it, expect } from 'vitest';
import {
  estimateNetReceivedPerUnit,
  estimateNetReceivedTotal,
} from '../src/lib/money.js';

// Reference example from the shop:
//   price 9700 (>8000) → tier1 −55% → 4365
//   ×1.37 → 5980.05 → ×1.11 → 6637.86 (C, >6000)
//   tier2 −10% → 5974.07 → −23.08% → 4595.24 → −1.07 → 4594.17
// Allow ±0.02 baht tolerance to accommodate rounding step choices.
describe('estimateNetReceivedPerUnit — shop spec example', () => {
  it('matches the worked example for price 9700', () => {
    const e = estimateNetReceivedPerUnit(9700);
    expect(Math.abs(e - 4594.17)).toBeLessThanOrEqual(0.02);
  });
});

describe('estimateNetReceivedPerUnit — tier1 boundaries', () => {
  // ≤3500 → 55%, 3500<p≤8000 → 58%, p>8000 → 55%
  it('uses 55% at exactly 3500 (≤3500 branch)', () => {
    // After tier1: 3500*0.45=1575; *1.37=2157.75; *1.11=2395.10 (≤2500 → 5%)
    // D=2275.35; *(1-.2308)-1.07 ≈ 2275.35*0.7692-1.07 ≈ 1750.21-1.07
    const e = estimateNetReceivedPerUnit(3500);
    expect(e).toBeGreaterThan(0);
    // Sanity: still positive; exact value not load-bearing here, just the
    // branch choice — we sanity-check by comparing with 3501.
    const ePlus1 = estimateNetReceivedPerUnit(3501);
    // 3501 should hit the −58% branch → strictly LESS net than 3500's 55%
    expect(ePlus1).toBeLessThan(e);
  });

  it('uses 58% just above 3500 (3501)', () => {
    const e = estimateNetReceivedPerUnit(3501);
    // Hand-calc: 3501*0.42=1470.42; *1.37=2014.48; *1.11=2236.07 (>0,≤2500 → 5%)
    // D=2124.27; *0.7692-1.07 ≈ 1634.30-1.07 ≈ 1633.23
    expect(e).toBeGreaterThan(1500);
    expect(e).toBeLessThan(1700);
  });

  it('uses 58% at exactly 8000 (≤8000 branch)', () => {
    // 8000*0.42=3360; *1.37=4603.20; *1.11=5109.55 (>2500 → 8%)
    // D=4700.79; *0.7692-1.07 ≈ 3615.85-1.07 ≈ 3614.78
    const e = estimateNetReceivedPerUnit(8000);
    expect(e).toBeGreaterThan(3500);
    expect(e).toBeLessThan(3700);
  });

  it('uses 55% just above 8000 (8001) — strictly higher than 8000', () => {
    const at8000 = estimateNetReceivedPerUnit(8000);
    const at8001 = estimateNetReceivedPerUnit(8001);
    // Switch from 58% to 55% markdown means the shop receives MORE.
    expect(at8001).toBeGreaterThan(at8000);
  });
});

describe('estimateNetReceivedPerUnit — tier2 boundaries', () => {
  it('returns 0 for non-positive prices', () => {
    expect(estimateNetReceivedPerUnit(0)).toBe(0);
    expect(estimateNetReceivedPerUnit(-100)).toBe(0);
    expect(estimateNetReceivedPerUnit(null)).toBe(0);
    expect(estimateNetReceivedPerUnit(undefined)).toBe(0);
    expect(estimateNetReceivedPerUnit('not a number')).toBe(0);
  });
});

describe('estimateNetReceivedTotal — cart aggregation', () => {
  it('returns 0 for empty cart', () => {
    expect(estimateNetReceivedTotal([])).toBe(0);
    expect(estimateNetReceivedTotal(null)).toBe(0);
    expect(estimateNetReceivedTotal(undefined)).toBe(0);
  });

  it('sums per-unit estimate × quantity per line', () => {
    const cart = [
      { unit_price: 9700, quantity: 1 },
      { unit_price: 9700, quantity: 2 },
    ];
    const single = estimateNetReceivedPerUnit(9700);
    const total = estimateNetReceivedTotal(cart);
    // 3× per-unit, allowing rounding of the sum
    expect(Math.abs(total - single * 3)).toBeLessThanOrEqual(0.02);
  });

  it('handles mixed prices (each line uses its own bracket)', () => {
    const cart = [
      { unit_price: 9700, quantity: 1 },
      { unit_price: 2000, quantity: 1 },
    ];
    const expected =
      estimateNetReceivedPerUnit(9700) +
      estimateNetReceivedPerUnit(2000);
    expect(Math.abs(estimateNetReceivedTotal(cart) - expected)).toBeLessThanOrEqual(0.02);
  });

  it('coerces non-numeric quantity to 0 (line ignored)', () => {
    const cart = [
      { unit_price: 9700, quantity: 1 },
      { unit_price: 5000, quantity: null },
    ];
    const expected = estimateNetReceivedPerUnit(9700);
    expect(Math.abs(estimateNetReceivedTotal(cart) - expected)).toBeLessThanOrEqual(0.02);
  });
});
