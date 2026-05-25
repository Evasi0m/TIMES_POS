import { describe, it, expect } from 'vitest';
import {
  dateISOBangkok,
  startOfDayBangkok,
  endOfDayBangkok,
} from '../src/lib/date.js';

describe('dateISOBangkok', () => {
  it('formats YYYY-MM-DD', () => {
    expect(dateISOBangkok(new Date('2026-05-04T10:00:00Z'))).toBe('2026-05-04');
  });
  it('rolls forward when UTC has not crossed midnight but Bangkok has', () => {
    // 2026-05-04T17:30:00Z = 2026-05-05T00:30:00 in Bangkok (UTC+7)
    expect(dateISOBangkok(new Date('2026-05-04T17:30:00Z'))).toBe('2026-05-05');
  });
  it('does NOT roll back for early-morning Bangkok times', () => {
    // 2026-05-04T23:30:00 Bangkok  =  2026-05-04T16:30:00Z
    expect(dateISOBangkok(new Date('2026-05-04T16:30:00Z'))).toBe('2026-05-04');
  });
  it('defaults to today (just runs without throwing)', () => {
    const v = dateISOBangkok();
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('startOfDayBangkok / endOfDayBangkok', () => {
  it('appends explicit +07:00 offsets', () => {
    expect(startOfDayBangkok('2026-05-04')).toBe('2026-05-04T00:00:00+07:00');
    expect(endOfDayBangkok('2026-05-04')).toBe('2026-05-04T23:59:59.999+07:00');
  });
  it('produces a string Postgres timestamptz can parse correctly', () => {
    // start-of-day Bangkok = 17:00 UTC the previous day
    const d = new Date(startOfDayBangkok('2026-05-04'));
    expect(d.toISOString()).toBe('2026-05-03T17:00:00.000Z');
  });
});
