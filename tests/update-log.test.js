import { describe, it, expect } from 'vitest';
import { getPatchesSince } from '../src/lib/update-log.js';

const log = {
  patches: [
    { id: 'patch-c', title: 'C' },
    { id: 'patch-b', title: 'B' },
    { id: 'patch-a', title: 'A' },
  ],
};

describe('getPatchesSince', () => {
  it('returns headline patch when local id is unknown', () => {
    expect(getPatchesSince(log, 'missing', 'patch-c').map((p) => p.id)).toEqual(['patch-c']);
  });

  it('returns all patches newer than local', () => {
    expect(getPatchesSince(log, 'patch-a', null).map((p) => p.id)).toEqual(['patch-c', 'patch-b']);
  });

  it('returns single patch when local is already latest entry (hotfix rebuild)', () => {
    expect(getPatchesSince(log, 'patch-c', 'patch-c').map((p) => p.id)).toEqual(['patch-c']);
  });

  it('returns first patch when local is empty', () => {
    expect(getPatchesSince(log, '', 'patch-b').map((p) => p.id)).toEqual(['patch-b']);
  });

  it('returns empty array for empty log', () => {
    expect(getPatchesSince({ patches: [] }, 'patch-a')).toEqual([]);
  });
});
