import { describe, it, expect } from 'vitest';
import { shortStepLabel } from '../src/components/ai/ReceiveStepProgress.jsx';

const THAI_RE = /[\u0E00-\u0E7F]/;
const MATCH_SHORT = '\u0E08\u0E31\u0E1A\u0E04\u0E39\u0E48';
const QTYCOST_SHORT = '\u0E08\u0E33\u0E19\u0E27\u0E19/\u0E17\u0E38\u0E19';

describe('shortStepLabel', () => {
  it('maps match step by key', () => {
    const label = shortStepLabel({ key: 'match', label: 'match full' });
    expect(label).toBe(MATCH_SHORT);
    expect(THAI_RE.test(label)).toBe(true);
    expect(label).not.toMatch(/\?{3,}/);
  });

  it('maps qtycost step by key', () => {
    const label = shortStepLabel({ key: 'qtycost', label: 'qtycost full' });
    expect(label).toBe(QTYCOST_SHORT);
    expect(THAI_RE.test(label)).toBe(true);
  });

  it('falls back to step.label for other keys', () => {
    expect(shortStepLabel({ key: 'tiktok', label: 'TikTok' })).toBe('TikTok');
  });
});
