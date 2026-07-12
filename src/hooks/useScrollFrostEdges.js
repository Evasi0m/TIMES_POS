import { useCallback, useEffect, useRef, useState } from 'react';

const SCROLL_EDGE_THRESHOLD = 4;

export function computeScrollEdges(el) {
  if (!el) return { top: false, bottom: false };
  const { scrollTop, scrollHeight, clientHeight } = el;
  const canScroll = scrollHeight > clientHeight + 1;
  return {
    top: canScroll && scrollTop > SCROLL_EDGE_THRESHOLD,
    bottom: canScroll && scrollTop + clientHeight < scrollHeight - SCROLL_EDGE_THRESHOLD,
  };
}

/** Tracks scroll position for frosted top/bottom edge overlays on a scroll viewport. */
export function useScrollFrostEdges(deps = []) {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  const update = useCallback(() => {
    const next = computeScrollEdges(ref.current);
    const prev = edgesRef.current;
    if (prev.top === next.top && prev.bottom === next.bottom) return;
    setEdges(next);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    update();
    el.addEventListener('scroll', update, { passive: true });

    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      ro.observe(el);
    }

    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update, ...deps]);

  return { ref, edges };
}
