// Simulated 0→90% progress while awaiting TikTok poll (no streaming API).
import { useCallback, useEffect, useRef, useState } from 'react';

export function useSimulatedSyncProgress() {
  const [pct, setPct] = useState(0);
  const timerRef = useRef(null);

  const stop = useCallback(() => {
    if (timerRef.current != null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    stop();
    setPct(0);
    let current = 0;
    timerRef.current = setInterval(() => {
      const step = Math.max(1, Math.ceil((90 - current) * 0.07));
      current = Math.min(90, current + step);
      setPct(current);
    }, 110);
  }, [stop]);

  const finish = useCallback(async (loadFn) => {
    stop();
    setPct(93);
    if (loadFn) await loadFn();
    setPct(100);
    await new Promise(r => setTimeout(r, 350));
  }, [stop]);

  const reset = useCallback(() => {
    stop();
    setPct(0);
  }, [stop]);

  useEffect(() => () => stop(), [stop]);

  return { pct, setPct, start, stop, finish, reset };
}
