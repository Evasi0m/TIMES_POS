// RecentReceiveBadge — small amber pill warning that the product on
// this line was already received within the last 7 days. Purpose: stop
// users from accidentally entering the same supplier bill twice.
//
// Rendered inline next to the product name in both:
//   - MovementItemsPanel (manual รับเข้า)
//   - BillReviewPanel.RowCard (AI รับเข้า ×10)
//
// Props:
//   info: { lastDate, supplier, invoice } | undefined
//         When undefined → renders nothing (caller-side gating keeps
//         the JSX terse: `{info && <RecentReceiveBadge info={info}/>}`)

import React from 'react';
import Icon from '../ui/Icon.jsx';
import { daysAgoFrom } from '../../lib/recent-receives.js';

export default function RecentReceiveBadge({ info }) {
  if (!info) return null;
  const days = daysAgoFrom(info.lastDate);
  if (days == null || days > 7) return null;

  // Human label: "พึ่งรับวันนี้" / "พึ่งรับเมื่อวาน" / "พึ่งรับ N วันก่อน"
  const label =
    days === 0 ? 'พึ่งรับวันนี้' :
    days === 1 ? 'พึ่งรับเมื่อวาน' :
    `พึ่งรับ ${days} วันก่อน`;

  // Tooltip exposes the supplier + invoice so the user can cross-check
  // against the paper bill in hand. Falls back to a generic notice when
  // the previous receive had no invoice number recorded.
  const tooltip = (() => {
    const parts = [];
    if (info.supplier) parts.push(`ผู้ขาย: ${info.supplier}`);
    if (info.invoice)  parts.push(`เลขบิล: ${info.invoice}`);
    if (!parts.length) return 'ตรวจสอบว่าไม่ใช่บิลซ้ำ';
    return parts.join(' · ') + ' — ตรวจสอบว่าไม่ใช่บิลซ้ำ';
  })();

  return (
    <span className="recent-receive-badge" title={tooltip}>
      <Icon name="alert" size={10}/>
      {label}
    </span>
  );
}
