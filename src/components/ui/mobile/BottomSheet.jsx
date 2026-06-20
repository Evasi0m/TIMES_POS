import React from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon.jsx';
import { useMountedToggle } from '../../../lib/use-mounted-toggle.js';

/**
 * Generic mobile bottom sheet (desktop: centered modal).
 */
export default function BottomSheet({
  open,
  onClose,
  title,
  children,
  className = '',
  maxHeight = '85vh',
}) {
  const { render, closing } = useMountedToggle(open, 220);
  if (!render) return null;

  return createPortal(
    <div
      className={'fixed inset-0 z-[130] flex items-end lg:items-center lg:justify-center ' + (closing ? 'overlay-out' : 'overlay-in')}
      onClick={onClose}
    >
      <div className="absolute inset-0 modal-overlay" aria-hidden="true"/>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title || '???'}
        className={
          'relative w-full lg:max-w-lg glass-strong rounded-t-2xl lg:rounded-2xl border-t lg:border hairline flex flex-col overflow-hidden ' +
          (closing ? 'sheet-out' : 'sheet-anim') +
          ' ' + className
        }
        style={{ maxHeight }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-b hairline-soft">
            <div className="font-display text-base font-semibold min-w-0 truncate">{title}</div>
            <button type="button" className="btn-ghost !py-1.5 !px-2 shrink-0" onClick={onClose} aria-label="???">
              <Icon name="x" size={18}/>
            </button>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
