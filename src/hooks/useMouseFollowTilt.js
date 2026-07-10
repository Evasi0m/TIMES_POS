import { useCallback, useEffect, useRef, useState } from 'react';

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Map pointer position to tilt angles (degrees). */
export function computeTilt(clientX, clientY, rect, maxDeg = 12) {
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return { rotateX: 0, rotateY: 0 };
  }
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = Math.max(-1, Math.min(1, (clientX - centerX) / (rect.width / 2)));
  const dy = Math.max(-1, Math.min(1, (clientY - centerY) / (rect.height / 2)));
  return {
    rotateX: -dy * maxDeg,
    rotateY: dx * maxDeg,
  };
}

/**
 * Smooth head tilt from pointer position relative to a container.
 * Uses pointer events (mouse + touch) and RAF lerp.
 */
export function useMouseFollowTilt(containerRef, { maxDeg = 12, lerp = 0.12 } = {}) {
  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0 });
  const targetRef = useRef({ rotateX: 0, rotateY: 0 });
  const currentRef = useRef({ rotateX: 0, rotateY: 0 });
  const rafRef = useRef(0);
  const activeRef = useRef(false);

  const tick = useCallback(() => {
    const cur = currentRef.current;
    const tgt = targetRef.current;
    const nextX = cur.rotateX + (tgt.rotateX - cur.rotateX) * lerp;
    const nextY = cur.rotateY + (tgt.rotateY - cur.rotateY) * lerp;
    currentRef.current = { rotateX: nextX, rotateY: nextY };
    setTilt({ rotateX: nextX, rotateY: nextY });

    const settled = Math.abs(tgt.rotateX - nextX) < 0.02
      && Math.abs(tgt.rotateY - nextY) < 0.02;
    if (activeRef.current || !settled) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [lerp]);

  const ensureLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const handlePointerMove = useCallback((e) => {
    if (prefersReducedMotion()) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    targetRef.current = computeTilt(e.clientX, e.clientY, rect, maxDeg);
    activeRef.current = true;
    ensureLoop();
  }, [containerRef, maxDeg, ensureLoop]);

  const handlePointerLeave = useCallback(() => {
    targetRef.current = { rotateX: 0, rotateY: 0 };
    activeRef.current = true;
    ensureLoop();
  }, [ensureLoop]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || prefersReducedMotion()) return undefined;

    el.addEventListener('pointermove', handlePointerMove);
    el.addEventListener('pointerleave', handlePointerLeave);

    return () => {
      el.removeEventListener('pointermove', handlePointerMove);
      el.removeEventListener('pointerleave', handlePointerLeave);
      cancelAnimationFrame(rafRef.current);
    };
  }, [containerRef, handlePointerMove, handlePointerLeave]);

  if (prefersReducedMotion()) {
    return { rotateX: 0, rotateY: 0 };
  }

  return tilt;
}
