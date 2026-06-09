// TikTok fulfillment status badge — shared across Shop panel + Confirm panel.
import React from 'react';

export const TIKTOK_STATUS_BADGE = {
  AWAITING_SHIPMENT:   { label: 'รอจัดส่ง',    cls: 'bg-warning/10 text-warning border-warning/30' },
  AWAITING_COLLECTION: { label: 'รอเข้ารับ',   cls: 'bg-accent-teal/10 text-accent-teal border-accent-teal/30' },
  PARTIALLY_SHIPPING:  { label: 'ส่งบางส่วน',  cls: 'bg-warning/10 text-warning border-warning/30' },
  IN_TRANSIT:          { label: 'กำลังจัดส่ง', cls: 'bg-accent-teal/10 text-accent-teal border-accent-teal/30' },
  DELIVERED:           { label: 'จัดส่งแล้ว',  cls: 'bg-success/10 text-success border-success/20' },
  COMPLETED:           { label: 'สำเร็จ',       cls: 'bg-success/10 text-success border-success/20' },
  ON_HOLD:             { label: 'พักไว้',       cls: 'bg-muted/10 text-muted border-hairline' },
  CANCELLED:           { label: 'ยกเลิก',       cls: 'bg-error/10 text-error border-error/30' },
};

export default function TikTokStatusBadge({ status, className = '' }) {
  if (!status) return null;
  const key = String(status).toUpperCase();
  const b = TIKTOK_STATUS_BADGE[key]
    || { label: key.replace(/_/g, ' ').toLowerCase(), cls: 'bg-muted/10 text-muted border-hairline' };
  return (
    <span
      className={
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none ' +
        b.cls + ' ' + className
      }
    >
      {b.label}
    </span>
  );
}
