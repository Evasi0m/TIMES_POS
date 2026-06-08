import React from 'react';
import EcommerceBrandIcon from './EcommerceBrandIcon.jsx';
import { tiktokSkuDisplayLabel } from '../../lib/tiktok-mirror-helpers.js';

/** TikTok Shop mark — product already linked in tiktok_product_mappings. */
export default function TikTokLinkedBadge({ mapping, className = '', size = 18 }) {
  if (!mapping) return null;
  const label = tiktokSkuDisplayLabel(mapping);
  const tip = label ? `เชื่อมต่อ TikTok: ${label}` : 'เชื่อมต่อ TikTok SKU แล้ว';
  return (
    <span
      className={'inline-flex flex-shrink-0 ' + className}
      title={tip}
      aria-label={tip}
    >
      <EcommerceBrandIcon brand="tiktok" size={size} />
    </span>
  );
}
