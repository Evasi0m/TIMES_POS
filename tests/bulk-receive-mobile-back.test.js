import { describe, it, expect } from 'vitest';
import { resolveMobileBackAction } from '../src/components/ai/bulk-receive-mobile-back.js';

describe('resolveMobileBackAction', () => {
  it('pauses when on list step', () => {
    expect(resolveMobileBackAction({ macroStep: 'list', wizardCanBack: false })).toBe('pause');
    expect(resolveMobileBackAction({ macroStep: 'list', wizardCanBack: true })).toBe('pause');
  });

  it('goes to wizard back when work step can back', () => {
    expect(resolveMobileBackAction({ macroStep: 'work', wizardCanBack: true })).toBe('wizardBack');
  });

  it('goes to list when work step cannot back', () => {
    expect(resolveMobileBackAction({ macroStep: 'work', wizardCanBack: false })).toBe('goToList');
  });

  it('defaults to pause for unknown macro step', () => {
    expect(resolveMobileBackAction({ macroStep: 'other', wizardCanBack: false })).toBe('pause');
  });
});
