// requestAnimationFrame-driven number tween. Animates the displayed value
// from its previous reading to the new `value` over `durationMs`, useful for
// totals that would otherwise jump (e.g. ฿0 → ฿1,500 when a line is added).
//
// No external deps — keep bundle flat. Honors `prefers-reduced-motion` by
// short-circuiting to the final value immediately.

import { useEffect, useRef, useState } from 'react';

const easeOut = (t) => 1 - Math.pow(1 - t, 3); // cubic ease-out, matches CSS feel

export function useNumberTween(value, durationMs = 250) {
  const target = Number(value) || 0;
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef(0);

  useEffect(() => {
    // Respect reduced-motion users — snap to value, skip animation.
    if (typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(target);
      fromRef.current = target;
      return;
    }
    cancelAnimationFrame(rafRef.current);
    const start = performance.now();
    const from = fromRef.current;
    const delta = target - from;
    if (delta === 0) { setDisplay(target); return; }

    const step = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      const v = from + delta * easeOut(t);
      setDisplay(v);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else { fromRef.current = target; setDisplay(target); }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, durationMs]);

  return display;
}
