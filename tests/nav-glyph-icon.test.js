import { describe, it, expect } from 'vitest';
import { NAV } from '../src/lib/nav-config.js';
import { NAV_GLYPH_TONE } from '../src/components/ui/NavGlyphIcon.jsx';

describe('NavGlyphIcon tones', () => {
  it('has a tone for every nav icon key', () => {
    for (const item of NAV) {
      expect(NAV_GLYPH_TONE[item.icon], item.icon).toBeTruthy();
    }
  });
});
