import { describe, it, expect } from 'vitest';
import { isUpdateAvailable } from '../src/lib/app-update.js';

describe('isUpdateAvailable', () => {
  it('returns false when remote is missing', () => {
    expect(isUpdateAvailable('abc123', null)).toBe(false);
    expect(isUpdateAvailable('abc123', '')).toBe(false);
  });

  it('returns true when local is missing but remote exists', () => {
    expect(isUpdateAvailable(null, 'def456')).toBe(true);
    expect(isUpdateAvailable('', 'def456')).toBe(true);
  });

  it('returns false when build ids match', () => {
    expect(isUpdateAvailable('same-id', 'same-id')).toBe(false);
  });

  it('returns true when build ids differ', () => {
    expect(isUpdateAvailable('old-build', 'new-build')).toBe(true);
  });
});
