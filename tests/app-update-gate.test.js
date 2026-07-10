import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const THAI_RE = /[\u0E00-\u0E7F]/;
const GATE_SRC = readFileSync(
  join(process.cwd(), 'src/components/ui/AppUpdateGate.jsx'),
  'utf8',
);

describe('AppUpdateGate copy', () => {
  it('uses readable Thai strings (no corrupted question marks)', () => {
    expect(GATE_SRC).not.toMatch(/\?{4,}/);
    expect(THAI_RE.test(GATE_SRC)).toBe(true);
    expect(GATE_SRC).toContain('\u0e21\u0e35\u0e40\u0e27\u0e2d\u0e23\u0e0c\u0e0a\u0e31\u0e19\u0e43\u0e2b\u0e21\u0e48');
    expect(GATE_SRC).toContain('\u0e2d\u0e31\u0e1b\u0e40\u0e14\u0e15\u0e40\u0e25\u0e22');
    expect(GATE_SRC).toContain('\u0e15\u0e30\u0e01\u0e23\u0e49\u0e32');
    expect(GATE_SRC).toContain('\u0e04\u0e34\u0e27\u0e2d\u0e2d\u0e1f\u0e44\u0e25\u0e19\u0e4c');
  });
});
