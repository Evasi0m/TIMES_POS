import React, { useSyncExternalStore } from 'react';
import EcommerceBrandIcon from './EcommerceBrandIcon.jsx';
import { tiktokSkuDisplayLabel } from '../../lib/tiktok-mirror-helpers.js';
import {
  canOpenTikTokMappingEditor,
  openTikTokMappingEditor,
  subscribeTikTokMappingEditor,
} from '../../lib/tiktok-mapping-editor-bus.js';

/**
 * TikTok Shop mark — product already linked in tiktok_product_mappings.
 * For admin / super_admin it is tappable and opens the shared pairing editor
 * (เปลี่ยนรุ่นจับคู่ / ยกเลิกจับคู่). It often sits inside a clickable row
 * (POS search result, product card), so it stops the click from bubbling and
 * is a span, not a nested <button>.
 */
export default function TikTokLinkedBadge({ mapping, productId, className = '', size = 18 }) {
  const editable = useSyncExternalStore(subscribeTikTokMappingEditor, canOpenTikTokMappingEditor);
  if (!mapping) return null;
  const label = tiktokSkuDisplayLabel(mapping);
  const pid = productId ?? mapping.product_id;
  const canEdit = editable && pid != null;
  const tip = (label ? `เชื่อมต่อ TikTok: ${label}` : 'เชื่อมต่อ TikTok SKU แล้ว')
    + (canEdit ? ' · แตะเพื่อเปลี่ยนรุ่นจับคู่' : '');

  if (!canEdit) {
    return (
      <span className={'inline-flex flex-shrink-0 ' + className} title={tip} aria-label={tip}>
        <EcommerceBrandIcon brand="tiktok" size={size} />
      </span>
    );
  }

  const open = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openTikTokMappingEditor(pid);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      className={'inline-flex flex-shrink-0 cursor-pointer ' + className}
      title={tip}
      aria-label={tip}
      onClick={open}
      onPointerDown={e => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') open(e); }}
    >
      <EcommerceBrandIcon brand="tiktok" size={size} />
    </span>
  );
}
