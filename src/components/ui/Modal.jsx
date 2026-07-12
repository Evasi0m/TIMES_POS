import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import { useMountedToggle } from '../../lib/use-mounted-toggle.js';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), ' +
  'input:not([disabled]), select:not([disabled]), ' +
  '[tabindex]:not([tabindex="-1"])';

const isMobileViewport = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(max-width: 1023px)').matches;

export default function Modal({ open, onClose, title, children, footer, wide, extraWide }) {
  const { render, closing } = useMountedToggle(open, 280);
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!render || closing) return;
    previousFocusRef.current = document.activeElement;

    const t = setTimeout(() => {
      const root = dialogRef.current;
      if (!root) return;
      if (isMobileViewport()) { root.focus(); return; }
      const first = root.querySelector(FOCUSABLE_SELECTOR);
      (first || root).focus();
    }, 0);

    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current?.(); return; }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll(FOCUSABLE_SELECTOR);
      if (focusables.length === 0) { e.preventDefault(); return; }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);

    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      const prev = previousFocusRef.current;
      if (prev && document.contains(prev)) {
        try { prev.focus({ preventScroll: true }); } catch { /* ignore */ }
      }
    };
  }, [render, closing]);

  if (!render) return null;

  return createPortal(
    <div
      className={'fixed inset-0 modal-overlay z-[100] flex items-end lg:items-center justify-center lg:p-6 ' + (closing ? 'overlay-out' : 'overlay-in')}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={'bg-surface-strong rounded-t-2xl lg:rounded-lg shadow-2xl w-full ' + (extraWide ? 'lg:max-w-4xl' : wide ? 'lg:max-w-3xl' : 'lg:max-w-lg') + ' max-h-[92vh] flex flex-col ' + (closing ? 'sheet-out' : 'sheet-anim')}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b hairline flex items-center justify-between flex-shrink-0">
          <div className="font-display text-xl lg:text-2xl">{title}</div>
          <button className="btn-ghost icon-btn-44 lg:!p-2 lg:!w-auto lg:!h-auto" onClick={onClose} aria-label="ปิด">
            <Icon name="x" size={20}/>
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="px-5 py-4 border-t hairline flex flex-col-reverse lg:flex-row lg:justify-end gap-2 flex-shrink-0 pb-safe modal-footer-row">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
