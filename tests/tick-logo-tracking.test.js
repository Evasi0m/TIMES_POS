import { describe, expect, it } from 'vitest';
import { computeTilt } from '../src/hooks/useMouseFollowTilt.js';
import { computePupilOffset } from '../src/hooks/useEyeTracking.js';

describe('computeTilt', () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 };

  it('returns zero at center', () => {
    const tilt = computeTilt(50, 50, rect);
    expect(tilt.rotateX).toBeCloseTo(0);
    expect(tilt.rotateY).toBeCloseTo(0);
  });

  it('tilts toward pointer', () => {
    const right = computeTilt(100, 50, rect, 12);
    expect(right.rotateY).toBeCloseTo(12);
    expect(right.rotateX).toBeCloseTo(0);

    const up = computeTilt(50, 0, rect, 12);
    expect(up.rotateX).toBeCloseTo(12);
  });

  it('clamps to max degrees', () => {
    const far = computeTilt(500, 500, rect, 12);
    expect(Math.abs(far.rotateX)).toBeLessThanOrEqual(12);
    expect(Math.abs(far.rotateY)).toBeLessThanOrEqual(12);
  });
});

describe('computePupilOffset', () => {
  const eye = { cx: 200, cy: 250, maxOffset: 14 };

  it('returns zero when pointer is at eye center', () => {
    expect(computePupilOffset(200, 250, eye)).toEqual({ x: 0, y: 0 });
  });

  it('offsets toward pointer within max', () => {
    const off = computePupilOffset(300, 250, eye);
    expect(off.x).toBeGreaterThan(0);
    expect(off.y).toBeCloseTo(0);
    expect(Math.hypot(off.x, off.y)).toBeLessThanOrEqual(14);
  });
});
