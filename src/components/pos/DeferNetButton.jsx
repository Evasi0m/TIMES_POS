import React from 'react';
import Icon from '../ui/Icon.jsx';

/**
 * Toggle "ใส่ทีหลัง" — defer net_received until the platform pays out.
 * Uses btn-tiffany-premium (gold) — same as POS cart checkout.
 */
export default function DeferNetButton({ active, onToggle, disabled, className = '' }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      disabled={disabled}
      title="บันทึกตอนนี้โดยยังไม่ใส่ยอดที่ร้านได้รับ แล้วมากรอกทีหลังผ่านปุ่มกระดิ่ง"
      className={'btn-tiffany-premium inline-flex items-center gap-1.5' + (active ? ' active' : '') + (className ? ` ${className}` : '')}
    >
      <Icon name={active ? 'check' : 'calendar'} size={14}/>
      <span>ใส่ทีหลัง</span>
    </button>
  );
}
