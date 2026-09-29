import { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = () =>
  typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Animate a number from 0 → target over `duration` ms (ease-out).
 * Respects prefers-reduced-motion (snaps straight to target).
 *
 * @param {number} target
 * @param {number} duration ms
 * @param {any} trigger  changing this restarts the animation
 */
export function useCountUp(target, duration = 420, trigger = null) {
  const end = Number(target) || 0;
  const [value, setValue] = useState(end);
  const rafRef = useRef(0);

  useEffect(() => {
    if (prefersReducedMotion() || duration <= 0 || end <= 0) {
      setValue(end);
      return undefined;
    }
    const start = performance.now();
    const from = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setValue(Math.round(from + (end - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    setValue(0);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end, duration, trigger]);

  return value;
}
