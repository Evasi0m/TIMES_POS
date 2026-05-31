import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../ui/Icon.jsx';

/**
 * Full-screen zoomable viewer for a scanned bill image. Lets the cashier
 * actually READ the paper bill while reviewing the AI-extracted rows
 * (previously the only view was a tiny thumbnail).
 *
 * Interactions: wheel / +– buttons / double-tap to zoom, drag to pan when
 * zoomed, two-finger pinch on touch, Esc or backdrop to close. Renders to
 * <body> so it escapes any transformed ancestor.
 *
 * Props: { src, alt, onClose }
 */
export default function BillImageLightbox({ src, alt, onClose }) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const drag = useRef(null);
  const pinch = useRef(null);

  const reset = useCallback(() => { setScale(1); setTx(0); setTy(0); }, []);
  const clamp = (s) => Math.min(5, Math.max(1, s));

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const zoomBy = useCallback((delta) => {
    setScale((s) => {
      const ns = clamp(s + delta);
      if (ns === 1) { setTx(0); setTy(0); }
      return ns;
    });
  }, []);

  const onWheel = (e) => { e.preventDefault(); zoomBy(-e.deltaY * 0.0022); };

  const toggleZoom = () => {
    setScale((s) => { if (s > 1) { setTx(0); setTy(0); return 1; } return 2.5; });
  };

  // ── drag-to-pan (single pointer, only when zoomed) ──
  const onPointerDown = (e) => {
    if (scale <= 1 || pinch.current) return;
    drag.current = { x: e.clientX, y: e.clientY, tx, ty };
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* noop */ }
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    setTx(drag.current.tx + (e.clientX - drag.current.x));
    setTy(drag.current.ty + (e.clientY - drag.current.y));
  };
  const endDrag = () => { drag.current = null; };

  // ── two-finger pinch (touch) ──
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const onTouchStart = (e) => {
    if (e.touches.length === 2) { pinch.current = { d: dist(e.touches), s: scale }; drag.current = null; }
  };
  const onTouchMove = (e) => {
    if (pinch.current && e.touches.length === 2) {
      e.preventDefault();
      const ratio = dist(e.touches) / (pinch.current.d || 1);
      setScale(clamp(pinch.current.s * ratio));
    }
  };
  const onTouchEnd = (e) => {
    if (e.touches.length < 2) pinch.current = null;
    if (scale <= 1) { setTx(0); setTy(0); }
  };

  if (!src) return null;

  const Btn = ({ label, onClick, children }) => (
    <button type="button" aria-label={label} onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="lightbox-btn">{children}</button>
  );

  return createPortal(
    <div className="fixed inset-0 z-[160] flex items-center justify-center overflow-hidden"
         onClick={() => onClose?.()}>
      <div className="absolute inset-0 holo-backdrop-in" style={{ background: 'rgba(8,6,5,0.86)' }} />

      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Btn label="ซูมออก" onClick={() => zoomBy(-0.5)}><span className="text-lg leading-none">−</span></Btn>
        <Btn label="รีเซ็ตซูม" onClick={reset}><span className="text-[11px] tabular-nums px-0.5">{Math.round(scale * 100)}%</span></Btn>
        <Btn label="ซูมเข้า" onClick={() => zoomBy(0.5)}><span className="text-lg leading-none">+</span></Btn>
        <Btn label="ปิด" onClick={() => onClose?.()}><Icon name="x" size={18} /></Btn>
      </div>

      <img
        src={src}
        alt={alt || 'บิล'}
        draggable={false}
        className="holo-card-in select-none"
        onClick={(e) => e.stopPropagation()}
        onWheel={onWheel}
        onDoubleClick={toggleZoom}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          maxWidth: '94vw', maxHeight: '88vh',
          borderRadius: 14,
          boxShadow: '0 24px 80px -20px rgba(0,0,0,0.7)',
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transition: drag.current || pinch.current ? 'none' : 'transform .18s ease',
          cursor: scale > 1 ? 'grab' : 'zoom-in',
          touchAction: 'none',
        }}
      />

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[11px] text-white/70 px-3 py-1 rounded-full"
           style={{ background: 'rgba(0,0,0,0.4)' }}>
        ดับเบิลแตะเพื่อซูม · ลากเพื่อเลื่อน · Esc เพื่อปิด
      </div>
    </div>,
    document.body
  );
}
