import { useCallback, useEffect, useRef, useState } from 'react';

const ZERO_OFFSETS = [{ x: 0, y: 0 }, { x: 0, y: 0 }];

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Convert viewport coordinates to SVG user space. */
export function clientToSvg(clientX, clientY, svgEl) {
  if (!svgEl?.createSVGPoint) return { x: 0, y: 0 };
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const pt = svgEl.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const svgPt = pt.matrixTransform(ctm.inverse());
  return { x: svgPt.x, y: svgPt.y };
}

/** Compute pupil offset within the eye socket (SVG units). */
export function computePupilOffset(mouseSvgX, mouseSvgY, eye, maxOffset) {
  const limit = maxOffset ?? eye.maxOffset ?? 14;
  if (limit <= 0) return { x: 0, y: 0 };

  const dx = mouseSvgX - eye.cx;
  const dy = mouseSvgY - eye.cy;
  const angle = Math.atan2(dy, dx);
  const dist = Math.min(limit, Math.hypot(dx, dy) * 0.25);
  return {
    x: Math.cos(angle) * dist,
    y: Math.sin(angle) * dist,
  };
}

function offsetsForEyes(mouseSvgX, mouseSvgY, eyes) {
  if (!eyes?.length) return ZERO_OFFSETS;
  return eyes.map((eye) => computePupilOffset(mouseSvgX, mouseSvgY, eye, eye.maxOffset));
}

function lerpOffsets(current, target, factor) {
  return target.map((t, i) => {
    const c = current[i] ?? { x: 0, y: 0 };
    return {
      x: c.x + (t.x - c.x) * factor,
      y: c.y + (t.y - c.y) * factor,
    };
  });
}

function offsetsSettled(current, target) {
  return target.every((t, i) => {
    const c = current[i] ?? { x: 0, y: 0 };
    return Math.hypot(t.x - c.x, t.y - c.y) < 0.05;
  });
}

/**
 * Track pointer against SVG eye centers; returns smoothed pupil offsets.
 */
export function useEyeTracking(containerRef, svgRef, eyes, { lerp = 0.2 } = {}) {
  const eyeCount = eyes?.length ?? 0;
  const initial = eyeCount === 0
    ? []
    : Array.from({ length: eyeCount }, () => ({ x: 0, y: 0 }));

  const [offsets, setOffsets] = useState(initial);
  const targetRef = useRef(initial);
  const currentRef = useRef(initial);
  const rafRef = useRef(0);
  const activeRef = useRef(false);
  const pointerRef = useRef({ x: 0, y: 0, inside: false });

  // Reset when eye config changes (mood switch).
  useEffect(() => {
    const next = eyeCount === 0
      ? []
      : Array.from({ length: eyeCount }, () => ({ x: 0, y: 0 }));
    targetRef.current = next;
    currentRef.current = next;
    setOffsets(next);
  }, [eyeCount, eyes]);

  const tick = useCallback(() => {
    const tgt = targetRef.current;
    const next = lerpOffsets(currentRef.current, tgt, lerp);
    currentRef.current = next;
    setOffsets(next);

    if (activeRef.current || !offsetsSettled(next, tgt)) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [lerp]);

  const ensureLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const updateTargetFromPointer = useCallback(() => {
    if (!eyes?.length) return;
    const svgEl = svgRef.current;
    const container = containerRef.current;
    if (!svgEl || !container) return;

    const { x, y, inside } = pointerRef.current;
    if (!inside) {
      targetRef.current = eyes.map(() => ({ x: 0, y: 0 }));
    } else {
      const svgPt = clientToSvg(x, y, svgEl);
      targetRef.current = offsetsForEyes(svgPt.x, svgPt.y, eyes);
    }
    activeRef.current = true;
    ensureLoop();
  }, [containerRef, svgRef, eyes, ensureLoop]);

  const handlePointerMove = useCallback((e) => {
    if (prefersReducedMotion() || !eyes?.length) return;
    pointerRef.current = { x: e.clientX, y: e.clientY, inside: true };
    updateTargetFromPointer();
  }, [eyes, updateTargetFromPointer]);

  const handlePointerLeave = useCallback(() => {
    if (prefersReducedMotion() || !eyes?.length) return;
    pointerRef.current = { ...pointerRef.current, inside: false };
    updateTargetFromPointer();
  }, [eyes, updateTargetFromPointer]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !eyes?.length || prefersReducedMotion()) return undefined;

    el.addEventListener('pointermove', handlePointerMove);
    el.addEventListener('pointerleave', handlePointerLeave);

    return () => {
      el.removeEventListener('pointermove', handlePointerMove);
      el.removeEventListener('pointerleave', handlePointerLeave);
      cancelAnimationFrame(rafRef.current);
    };
  }, [containerRef, eyes, handlePointerMove, handlePointerLeave]);

  if (prefersReducedMotion() || !eyes?.length) {
    return { offsets: eyeCount === 0 ? [] : initial };
  }

  return { offsets };
}
