import { describe, it, expect } from 'vitest';
import { computeScrollEdges } from '../src/components/ai/BillItemsListCard.jsx';

describe('computeScrollEdges', () => {
  it('hides both edges when content fits', () => {
    const el = { scrollTop: 0, scrollHeight: 100, clientHeight: 100 };
    expect(computeScrollEdges(el)).toEqual({ top: false, bottom: false });
  });

  it('shows bottom edge at top of scrollable list', () => {
    const el = { scrollTop: 0, scrollHeight: 200, clientHeight: 100 };
    expect(computeScrollEdges(el)).toEqual({ top: false, bottom: true });
  });

  it('shows top edge near bottom of scrollable list', () => {
    const el = { scrollTop: 100, scrollHeight: 200, clientHeight: 100 };
    expect(computeScrollEdges(el)).toEqual({ top: true, bottom: false });
  });

  it('shows both edges in middle of scrollable list', () => {
    const el = { scrollTop: 50, scrollHeight: 200, clientHeight: 100 };
    expect(computeScrollEdges(el)).toEqual({ top: true, bottom: true });
  });

  it('returns false for null element', () => {
    expect(computeScrollEdges(null)).toEqual({ top: false, bottom: false });
  });
});
