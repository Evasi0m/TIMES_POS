import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const THAI_RE = /[\u0E00-\u0E7F]/;
const GATE_SRC = readFileSync(
  join(process.cwd(), 'src/components/ui/AppUpdateGate.jsx'),
  'utf8',
);

describe('AppUpdateGate copy', () => {
  it('uses readable strings (English title, Thai body, no corrupted marks)', () => {
    expect(GATE_SRC).not.toMatch(/\?{4,}/);
    expect(THAI_RE.test(GATE_SRC)).toBe(true);
    expect(GATE_SRC).toContain('New Version');
    expect(GATE_SRC).toContain('\u0e2d\u0e31\u0e1b\u0e40\u0e14\u0e15\u0e40\u0e25\u0e22');
    expect(GATE_SRC).toContain('เวอร์ชันใหม่');
    expect(GATE_SRC).toContain('\u0e04\u0e34\u0e27\u0e2d\u0e2d\u0e1f\u0e44\u0e25\u0e19\u0e4c');
  });
});
