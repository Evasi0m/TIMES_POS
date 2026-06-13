import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon.jsx';
import { useMountedToggle } from '../../../lib/use-mounted-toggle.js';
import MobileIconButton from './MobileIconButton.jsx';

/**
 * Compact footer for mobile modals: primary icon actions + optional overflow sheet.
 * actions: { id, icon, label, onClick, variant?: 'danger' | 'primary', disabled? }[]
 */
export default function MobileActionSheet({ actions = [], onClose, className = '' }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const { render: sheetRender, closing: sheetClosing } = useMountedToggle(moreOpen, 220);

  if (!actions.length) return null;

  const primary = actions.slice(0, 3);
  const overflow = actions.slice(3);

  return (
    <div className={'lg:hidden flex flex-col gap-2 w-full ' + className}>
      <div className="flex items-center justify-center gap-2 w-full">
        {primary.map((a) => (
          <MobileIconButton
            key={a.id}
            icon={a.icon}
            label={a.label}
            onClick={a.onClick}
            disabled={a.disabled}
            className={
              (a.variant === 'danger' ? '!border-error/40 !text-error ' : '') +
              (a.variant === 'primary' ? '!border-primary ' : '')
            }
            iconSize={22}
          />
        ))}
        {overflow.length > 0 && (
          <MobileIconButton
            icon="menu"
            label="เพิ่มเติม"
            onClick={() => setMoreOpen(true)}
          />
        )}
        {onClose && (
          <button type="button" className="btn-secondary flex-1 !py-2.5 !text-sm" onClick={onClose}>
            ปิด
          </button>
        )}
      </div>

      {sheetRender && createPortal(
        <div
          className={'fixed inset-0 z-[140] flex items-end ' + (sheetClosing ? 'overlay-out' : 'overlay-in')}
          onClick={() => setMoreOpen(false)}
        >
          <div className="absolute inset-0 modal-overlay" />
          <div
            className={'relative w-full glass-strong rounded-t-2xl border-t hairline p-4 pb-safe space-y-1 ' + (sheetClosing ? 'sheet-out' : 'sheet-in')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full bg-muted-soft/40 mx-auto mb-3" aria-hidden="true" />
            {overflow.map((a) => (
              <button
                key={a.id}
                type="button"
                className={
                  'w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left text-sm font-medium ' +
                  (a.variant === 'danger' ? 'text-error' : 'text-ink')
                }
                onClick={() => { a.onClick?.(); setMoreOpen(false); }}
                disabled={a.disabled}
              >
                <Icon name={a.icon} size={20} />
                {a.label}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
