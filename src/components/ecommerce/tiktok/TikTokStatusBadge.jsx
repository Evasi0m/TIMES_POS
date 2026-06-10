// TikTok fulfillment status badge — shared across Shop panel + Confirm panel.
import React from 'react';
import { TikTokGlassBadge } from './glass/index.js';

export const TIKTOK_STATUS_BADGE = {
  AWAITING_SHIPMENT:   { label: 'รอจัดส่ง',    tone: 'warn' },
  AWAITING_COLLECTION: { label: 'รอเข้ารับ',   tone: 'ok' },
  PARTIALLY_SHIPPING:  { label: 'ส่งบางส่วน',  tone: 'warn' },
  IN_TRANSIT:          { label: 'กำลังจัดส่ง', tone: 'ok' },
  DELIVERED:           { label: 'จัดส่งแล้ว',  tone: 'ok' },
  COMPLETED:           { label: 'สำเร็จ',       tone: 'ok' },
  ON_HOLD:             { label: 'พักไว้',       tone: 'idle' },
  CANCELLED:           { label: 'ยกเลิก',       tone: 'bad' },
};

export default function TikTokStatusBadge({ status, className = '', context = 'surface' }) {
  if (!status) return null;
  const key = String(status).toUpperCase();
  const b = TIKTOK_STATUS_BADGE[key]
    || { label: key.replace(/_/g, ' ').toLowerCase(), tone: 'idle' };
  return (
    <TikTokGlassBadge tone={b.tone} context={context} className={className}>
      {b.label}
    </TikTokGlassBadge>
  );
}
