import { describe, it, expect } from 'vitest';
import {
  dateISOBangkok,
  startOfDayBangkok,
  endOfDayBangkok,
  bangkokDateKey,
  addDaysBangkok,
  prevMonthRangeBangkok,
  fmtThaiDateShort,
  fmtTimeBangkok,
  hourBangkok,
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

describe('bangkokDateKey', () => {
  it('returns Bangkok calendar date, not UTC prefix', () => {
    // 2026-05-05 00:30 Bangkok = 2026-05-04T17:30:00Z
    expect(bangkokDateKey('2026-05-04T17:30:00Z')).toBe('2026-05-05');
  });
  it('returns empty for falsy input', () => {
    expect(bangkokDateKey(null)).toBe('');
    expect(bangkokDateKey('')).toBe('');
  });
});

describe('addDaysBangkok', () => {
  it('steps calendar days in Bangkok', () => {
    expect(addDaysBangkok('2026-05-04', 1)).toBe('2026-05-05');
    expect(addDaysBangkok('2026-05-04', -1)).toBe('2026-05-03');
  });
});

describe('prevMonthRangeBangkok', () => {
  it('returns full previous month', () => {
    expect(prevMonthRangeBangkok('2026-05-15')).toEqual({
      from: '2026-04-01',
      to: '2026-04-30',
    });
  });
});

describe('fmtThaiDateShort', () => {
  it('formats from timestamptz via Bangkok key', () => {
    expect(fmtThaiDateShort('2026-05-04T17:30:00Z')).toMatch(/5 พ\.ค\. 2569/);
  });
});

describe('fmtTimeBangkok / hourBangkok', () => {
  it('reads Bangkok wall clock from UTC instant', () => {
    // 2026-05-04T17:30:00Z = 00:30 Bangkok next day
    expect(hourBangkok('2026-05-04T17:30:00Z')).toBe(0);
    const t = fmtTimeBangkok('2026-05-04T16:30:00Z'); // 23:30 Bangkok same day
    expect(t).toMatch(/23/);
  });
});
