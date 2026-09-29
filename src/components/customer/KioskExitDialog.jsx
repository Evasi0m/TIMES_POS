import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../ui/Icon.jsx';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];

/**
 * Numeric PIN pad to leave customer (kiosk) mode. The PIN is whatever
 * staff set when entering kiosk mode; on match it calls `onUnlock`.
 */
export default function KioskExitDialog({ open, expectedPin, onUnlock, onClose }) {
  const [entry, setEntry] = useState('');
  const [error, setError] = useState(false);

  if (!open) return null;

  const submit = (pin) => {
    if (pin === expectedPin) {
      setEntry('');
      setError(false);
      onUnlock();
    } else {
      setError(true);
      setEntry('');
    }
  };

  const press = (k) => {
    setError(false);
    if (k === 'clear') { setEntry(''); return; }
    if (k === 'back') { setEntry((e) => e.slice(0, -1)); return; }
    setEntry((e) => {
      const next = (e + k).slice(0, 8);
      if (next.length >= expectedPin.length && next.length >= 4) {
        // Auto-submit once it could match the stored PIN length.
        if (next.length === expectedPin.length) setTimeout(() => submit(next), 60);
      }
      return next;
    });
  };

  return createPortal(
    <div className="kiosk-pin-overlay" onClick={onClose} role="presentation">
      <div className="kiosk-pin-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="ออกจากโหมดลูกค้า">
        <div className="kiosk-pin-icon"><Icon name="lock" size={22} /></div>
        <div className="kiosk-pin-title">ใส่ PIN เพื่อออกจากโหมดลูกค้า</div>
        <div className={'kiosk-pin-dots' + (error ? ' kiosk-pin-dots--error' : '')}>
          {Array.from({ length: Math.max(expectedPin.length, entry.length, 4) }).map((_, i) => (
            <span key={i} className={'kiosk-pin-dot' + (i < entry.length ? ' is-filled' : '')} />
          ))}
        </div>
        {error && <div className="kiosk-pin-error">PIN ไม่ถูกต้อง</div>}
        <div className="kiosk-pin-pad">
          {KEYS.map((k) => (
            <button
              key={k}
              type="button"
              className={'kiosk-pin-key' + (k === 'clear' || k === 'back' ? ' kiosk-pin-key--fn' : '')}
              onClick={() => press(k)}
            >
              {k === 'back' ? <Icon name="chevron-l" size={18} /> : k === 'clear' ? 'C' : k}
            </button>
          ))}
        </div>
        <button type="button" className="kiosk-pin-cancel" onClick={onClose}>ยกเลิก</button>
      </div>
    </div>,
    document.body,
  );
}
