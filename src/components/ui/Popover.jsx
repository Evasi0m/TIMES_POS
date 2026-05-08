import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * Floating <Popover/> primitive.
 *
 * Renders the panel into `document.body` via React portal so it escapes any
 * ancestor that has `overflow: hidden` / `clip-path` / `transform` (which
 * would otherwise clip an `position:absolute` panel — see the
 * CostPercentToggle "?" tooltip getting cut off by `card-cream
 * overflow-hidden` for the original bug report).
 *
 * Position is computed from the trigger's `getBoundingClientRect()`. The
 * panel's left edge aligns with the trigger; if that would overflow the
 * viewport on the right, it shifts left to stay within an 8px margin. We
 * re-anchor on scroll (capture phase) and resize so it stays glued during
 * page interactions.
 *
 * Outside-click + Escape both close the panel. Both the trigger and the
 * panel are excluded from outside-click detection so clicking the trigger
 * again toggles closed cleanly.
 *
 * Usage:
 *   <Popover
 *     trigger={({ ref, onClick, isOpen }) => (
 *       <button ref={ref} onClick={onClick} aria-expanded={isOpen}>?</button>
 *     )}
 *   >
 *     <div className="…">tooltip body</div>
 *   </Popover>
 *
 * Props:
 *   - trigger: render-prop ({ ref, onClick, isOpen, close }) => ReactNode
 *   - children: panel contents (must accept className via wrapper, OR you
 *               style your own outer div). The component wraps children in
 *               a positioned div with the supplied `panelClassName`.
 *   - panelClassName: classes for the floating panel wrapper. Default
 *               provides a sensible glass-card look matching the app theme.
 *   - width:    panel width in px (used for edge-flip math). Default 280.
 *   - placement: 'bottom-start' (default) | 'bottom-end'. The panel always
 *               opens BELOW the trigger; `start`=left-aligned, `end`=right.
 *   - offset:   distance below trigger in px. Default 8.
 *   - onOpenChange(open): optional callback when open state flips.
 */
export default function Popover({
  trigger,
  children,
  panelClassName = 'glass-soft rounded-lg shadow-xl border hairline p-3 text-xs leading-relaxed text-ink fade-in',
  width = 280,
  placement = 'bottom-start',
  offset = 8,
  onOpenChange,
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const close = useCallback(() => {
    setOpen(false);
    onOpenChange?.(false);
  }, [onOpenChange]);

  const toggle = useCallback(() => {
    setOpen((o) => {
      const next = !o;
      onOpenChange?.(next);
      return next;
    });
  }, [onOpenChange]);

  // Place the panel relative to the trigger's viewport rect, shifting left
  // if it would overflow the right edge of the viewport.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const margin = 8;
      let left = placement === 'bottom-end' ? r.right - width : r.left;
      if (left + width + margin > window.innerWidth) {
        left = Math.max(margin, window.innerWidth - width - margin);
      }
      if (left < margin) left = margin;
      setPos({ top: r.bottom + offset, left });
    };
    place();
    const onDoc = (e) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target) &&
        triggerRef.current && !triggerRef.current.contains(e.target)
      ) close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, width, placement, offset, close]);

  return (
    <>
      {trigger({ ref: triggerRef, onClick: toggle, isOpen: open, close })}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="tooltip"
            className={'fixed z-[60] max-w-[calc(100vw-16px)] ' + panelClassName}
            style={{ top: pos.top, left: pos.left, width }}
          >
            {children}
          </div>,
          document.body
        )}
    </>
  );
}
