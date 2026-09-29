import { useEffect, useRef } from 'react';

/**
 * Fire `onIdle` after `timeoutMs` of no user interaction. Any pointer,
 * touch, key, or scroll activity resets the countdown. Used on the
 * customer-facing price screen so the next customer starts clean.
 *
 * @param {number} timeoutMs
 * @param {() => void} onIdle
 * @param {boolean} enabled
 */
export function useIdleReset(timeoutMs, onIdle, enabled = true) {
  const cb = useRef(onIdle);
  useEffect(() => { cb.current = onIdle; }, [onIdle]);

  useEffect(() => {
    if (!enabled || !timeoutMs) return undefined;
    let timer = 0;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => cb.current?.(), timeoutMs);
    };
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'mousemove'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [timeoutMs, enabled]);
}
