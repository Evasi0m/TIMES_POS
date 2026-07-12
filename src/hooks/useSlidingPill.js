import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * Measures the active tab button and returns a sliding-pill rect
 * relative to the track. Re-measures on resize / font load / key change.
 */
export default function useSlidingPill(activeKey) {
  const trackRef = useRef(null);
  const btnRefs = useRef(new Map());
  const [pill, setPill] = useState({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    ready: false,
  });

  const setBtnRef = useCallback((key) => (el) => {
    if (el) btnRefs.current.set(key, el);
    else btnRefs.current.delete(key);
  }, []);

  const update = useCallback(() => {
    const track = trackRef.current;
    const btn = btnRefs.current.get(activeKey);
    if (!track || !btn) return;
    const tr = track.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    setPill({
      left: br.left - tr.left + track.scrollLeft,
      top: br.top - tr.top + track.scrollTop,
      width: br.width,
      height: br.height,
      ready: true,
    });
  }, [activeKey]);

  useLayoutEffect(() => {
    update();
    const track = trackRef.current;
    if (!track) return undefined;

    const ro = new ResizeObserver(() => update());
    ro.observe(track);
    btnRefs.current.forEach((el) => { if (el) ro.observe(el); });

    window.addEventListener('resize', update);
    // Fonts settling can change button widths after first paint.
    document.fonts?.ready?.then?.(() => update());

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [update, activeKey]);

  return { trackRef, setBtnRef, pill };
}
