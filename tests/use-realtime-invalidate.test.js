import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDebouncedInvalidate } from '../src/lib/use-realtime-invalidate.js';

describe('createDebouncedInvalidate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces rapid schedules into one fire', () => {
    const onInvalidate = vi.fn();
    const { schedule, dispose } = createDebouncedInvalidate({
      debounceMs: 300,
      onInvalidate,
    });

    schedule();
    schedule();
    schedule();
    expect(onInvalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(onInvalidate).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('minIntervalMs prevents consecutive fires within the window', () => {
    const onInvalidate = vi.fn();
    const { schedule, dispose } = createDebouncedInvalidate({
      debounceMs: 100,
      minIntervalMs: 2000,
      onInvalidate,
    });

    schedule();
    vi.advanceTimersByTime(100);
    expect(onInvalidate).toHaveBeenCalledTimes(1);

    schedule();
    vi.advanceTimersByTime(100);
    expect(onInvalidate).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1900);
    expect(onInvalidate).toHaveBeenCalledTimes(2);
    dispose();
  });
});
