// Shared constants/helpers for AI bill review (BillReviewPanel + ReceiveMatchPanel).

import { tiktokSkuImageUrl } from '../../lib/tiktok-mirror-helpers.js';
import { productImageUrl } from '../../lib/product-classify.js';
export const STATUS_META = {
  auto: {
    cls: 'ttc-rl--ok',
    listCls: 'air-list-row--ok',
    label: 'จับคู่แล้ว',
    icon: 'check',
    tone: 'text-[#0a7a43]',
  },
  new: {
    cls: 'ttc-rl--ok',
    listCls: 'air-list-row--ok',
    label: 'สินค้าใหม่',
    icon: 'plus',
    tone: 'text-[#0a7a43]',
  },
  suggestions: {
    cls: 'ttc-rl--subst',
    listCls: 'air-list-row--warn',
    label: 'เลือกรุ่น',
    icon: 'alert',
    tone: 'text-amber-700',
  },
  none: {
    cls: 'ttc-rl--stock',
    listCls: 'air-list-row--err',
    label: 'ไม่พบในระบบ',
    icon: 'alert',
    tone: 'text-[#b3261e]',
  },
};

export const SOFT_MATCH_FLOOR = 0.97;

/** Visual display states for list rows (distinct from raw match status). */
export const DISPLAY_STATE_META = {
  done: {
    key: 'done',
    cardCls: 'ttc-rl--ok',
    rowCls: 'air-list-row--done',
    badgeCls: 'air-list-row__badge--done',
    pillCls: 'air-list-row__status-pill--done',
    label: 'จับคู่แล้ว',
    icon: 'check',
    subline: null,
  },
  soft: {
    key: 'soft',
    cardCls: 'ttc-rl--subst-ok',
    rowCls: 'air-list-row--soft',
    badgeCls: 'air-list-row__badge--soft',
    pillCls: 'air-list-row__status-pill--soft',
    label: 'ตรวจความมั่นใจ',
    icon: 'alert',
    subline: 'ความมั่นใจต่ำ — ตรวจว่ารุ่นตรงไหม',
  },
  pick: {
    key: 'pick',
    cardCls: 'ttc-rl--subst',
    rowCls: 'air-list-row--pick',
    badgeCls: 'air-list-row__badge--pick',
    pillCls: 'air-list-row__status-pill--pick',
    label: 'เลือกรุ่น',
    icon: 'alert',
    subline: 'ใกล้เคียงในระบบ — โปรดเลือกรุ่น',
  },
  missing: {
    key: 'missing',
    cardCls: 'ttc-rl--stock',
    rowCls: 'air-list-row--missing',
    badgeCls: 'air-list-row__badge--missing',
    pillCls: 'air-list-row__status-pill--missing',
    label: 'ไม่พบในระบบ',
    icon: 'alert',
    subline: 'ไม่พบในระบบ — ค้นหา เพิ่มใหม่ หรือลบ',
  },
  incomplete: {
    key: 'incomplete',
    cardCls: 'ttc-rl--subst',
    rowCls: 'air-list-row--incomplete',
    badgeCls: 'air-list-row__badge--incomplete',
    pillCls: 'air-list-row__status-pill--incomplete',
    label: 'กรอกตัวเลข',
    icon: 'alert',
    subline: 'AI อ่าน จำนวน/ทุน ไม่ออก — กรอกให้ครบ',
  },
  tiktok: {
    key: 'tiktok',
    cardCls: 'ttc-rl--ok',
    rowCls: 'air-list-row--tiktok',
    badgeCls: 'air-list-row__badge--tiktok',
    pillCls: 'air-list-row__status-pill--tiktok',
    label: 'จับ TikTok',
    icon: 'store',
    subline: 'จับคู่ POS แล้ว — เหลือ TikTok SKU',
  },
};

function isResolved(row) {
  return row.status === 'auto' || row.status === 'new';
}

/** SKU for stepper chip tooltips — POS code when matched, else AI scan. */
export function getRowStepperSku(row) {
  if (!row) return '';
  if (row.product) {
    return row.product.model_code || row.product.name || row.model_code || '';
  }
  if (row.status === 'new' && row.newProduct?.name) {
    return row.newProduct.name;
  }
  return row.model_code || '';
}

/** True when row has an active TikTok SKU link (not skipped). */
export function isRowTiktokMatched(row) {
  if (!row || row.tiktok_skip) return false;
  return !!(row.tiktok_sku || row.tiktok_mapping);
}

/** Find a catalog SKU row by tiktok_sku_id or seller_sku (for image backfill). */
export function findTiktokCatalogSku(catalog, ref) {
  if (!catalog?.length || !ref) return null;
  const skuId = ref.tiktok_sku_id;
  if (skuId != null && skuId !== '') {
    const idStr = String(skuId);
    const byId = catalog.find((s) => String(s.tiktok_sku_id || s.id || '') === idStr);
    if (byId) return byId;
  }
  const seller = (ref.seller_sku || ref.tiktok_product_name || ref.name || '').trim();
  if (seller) {
    const exact = catalog.find((s) => (s.seller_sku || '').trim() === seller);
    if (exact) return exact;
    const lower = seller.toLowerCase();
    return catalog.find((s) => (s.seller_sku || s.product_name || '').trim().toLowerCase() === lower) || null;
  }
  return null;
}

/** Merge catalog image_url onto a DB mapping row when the mapping lacks one. */
export function enrichTiktokMappingFromCatalog(mapping, catalog = []) {
  if (!mapping) return mapping;
  if (tiktokSkuImageUrl(mapping)) return mapping;
  const url = tiktokSkuImageUrl(findTiktokCatalogSku(catalog, mapping));
  return url ? { ...mapping, image_url: url } : mapping;
}

/** TikTok product image URL for aside thumbnail (sku pick preferred over DB mapping). */
export function getRowTiktokImageUrl(row, catalog = []) {
  if (!row || row.tiktok_skip) return null;
  const ref = row.tiktok_sku || row.tiktok_mapping;
  if (!ref) return null;
  const direct = tiktokSkuImageUrl(ref);
  if (direct) return direct;
  return tiktokSkuImageUrl(findTiktokCatalogSku(catalog, ref));
}

/** Aside thumbnail URL: TikTok catalog first, then POS product_images (Products page source). */
export function getRowAsideImageUrl(row, { catalog = [], productImagesById = {} } = {}) {
  if (!row || row.tiktok_skip) return null;
  const tiktokUrl = getRowTiktokImageUrl(row, catalog);
  if (tiktokUrl) return tiktokUrl;
  const productId = row.product?.id;
  if (productId && productImagesById[productId]) {
    return productImageUrl({ _imageRow: productImagesById[productId] });
  }
  return null;
}

function isTiktokPending(row, tiktokMirrorEnabled) {
  return (
    tiktokMirrorEnabled &&
    (row.product || (row.status === 'new' && row.newProduct)) &&
    !row.tiktok_skip &&
    !row.tiktok_sku &&
    !row.tiktok_mapping
  );
}

function isSoftMatch(row) {
  return (
    row.status === 'auto' &&
    typeof row.matchScore === 'number' &&
    row.matchScore < SOFT_MATCH_FLOOR
  );
}

export function getRowDisplayState(row, tiktokMirrorEnabled = false) {
  if (!row) return DISPLAY_STATE_META.missing;

  if (row.status === 'none') return DISPLAY_STATE_META.missing;
  if (row.status === 'suggestions') return DISPLAY_STATE_META.pick;

  const costIncomplete = !(Number(row.unit_cost) > 0);
  const qtyIncomplete = !(Number(row.quantity) > 0);
  if (isResolved(row) && (costIncomplete || qtyIncomplete)) {
    return DISPLAY_STATE_META.incomplete;
  }

  if (isTiktokPending(row, tiktokMirrorEnabled)) {
    return DISPLAY_STATE_META.tiktok;
  }

  if (isSoftMatch(row)) return DISPLAY_STATE_META.soft;

  if (isResolved(row)) return DISPLAY_STATE_META.done;

  return DISPLAY_STATE_META.missing;
}

export function computeRowSummary(rows, tiktokMirrorEnabled = false) {
  let matched = 0;
  let attention = 0;
  let done = 0;
  for (const r of rows) {
    if (r.status === 'auto' || r.status === 'new') matched += 1;
    if (rowNeedsAttention(r, tiktokMirrorEnabled)) {
      attention += 1;
    } else {
      done += 1;
    }
  }
  return {
    total: rows.length,
    matched,
    attention,
    done,
    pct: rows.length ? Math.round((matched / rows.length) * 100) : 0,
  };
}

/** TikTok mirror progress — POS-resolved lines only. */
export function computeTiktokBillSummary(rows) {
  let total = 0;
  let ready = 0;
  for (const r of rows || []) {
    if (!isResolved(r)) continue;
    total += 1;
    if (r.tiktok_skip || r.tiktok_sku || r.tiktok_mapping) ready += 1;
  }
  return { total, ready };
}

export function rowNeedsAttention(row, tiktokMirrorEnabled = false) {
  if (!row) return false;
  const costIncomplete = !(Number(row.unit_cost) > 0);
  const qtyIncomplete = !(Number(row.quantity) > 0);
  const resolved = isResolved(row);
  return (
    !resolved ||
    qtyIncomplete ||
    costIncomplete ||
    row.needsReview ||
    isSoftMatch(row) ||
    isTiktokPending(row, tiktokMirrorEnabled)
  );
}

export function firstAttentionRowIndex(rows, tiktokMirrorEnabled = false) {
  return rows.findIndex((r) => rowNeedsAttention(r, tiktokMirrorEnabled));
}

export function nextAttentionRowIndex(rows, fromIndex, tiktokMirrorEnabled = false) {
  if (!rows.length) return -1;
  for (let i = fromIndex + 1; i < rows.length; i += 1) {
    if (rowNeedsAttention(rows[i], tiktokMirrorEnabled)) return i;
  }
  for (let i = 0; i < fromIndex; i += 1) {
    if (rowNeedsAttention(rows[i], tiktokMirrorEnabled)) return i;
  }
  return -1;
}

export function prevAttentionRowIndex(rows, fromIndex, tiktokMirrorEnabled = false) {
  if (!rows.length) return -1;
  for (let i = fromIndex - 1; i >= 0; i -= 1) {
    if (rowNeedsAttention(rows[i], tiktokMirrorEnabled)) return i;
  }
  for (let i = rows.length - 1; i > fromIndex; i -= 1) {
    if (rowNeedsAttention(rows[i], tiktokMirrorEnabled)) return i;
  }
  return -1;
}

/** Workspace mode: resolve (pick SKU) vs edit (qty/cost/tiktok). */
export function getWorkspaceMode(row, rematch = false) {
  if (!row) return 'empty';
  if (row.status === 'suggestions' || row.status === 'none' || rematch) {
    return 'resolve';
  }
  return 'edit';
}

/**
 * Sub-steps for the per-item wizard flow.
 * Returns ordered steps with done/disabled flags.
 */
export function getItemSteps(row, tiktokMirrorEnabled = false) {
  if (!row) return [];
  const hasPos = row.status === 'auto' || row.status === 'new';
  const matchDone = hasPos;
  const qtyCostDone = Number(row.quantity) > 0 && Number(row.unit_cost) > 0;
  const tiktokDone =
    !!row.tiktok_skip || !!row.tiktok_sku || !!row.tiktok_mapping;

  const steps = [
    {
      key: 'match',
      label: 'จับคู่รุ่น',
      icon: 'search',
      done: matchDone,
      disabled: false,
    },
    {
      key: 'qtycost',
      label: 'จำนวน/ทุน',
      icon: 'edit',
      done: matchDone && qtyCostDone,
      disabled: !hasPos,
    },
  ];

  if (tiktokMirrorEnabled) {
    steps.push({
      key: 'tiktok',
      label: 'TikTok',
      icon: 'store',
      done: hasPos && tiktokDone,
      disabled: !hasPos,
    });
  }

  return steps;
}

/** First step the user should focus on (first not-done enabled step). */
export function firstIncompleteStep(steps) {
  const target = steps.find((s) => !s.disabled && !s.done);
  if (target) return target.key;
  // All done (or all disabled) — focus the first enabled step.
  const firstEnabled = steps.find((s) => !s.disabled);
  return firstEnabled ? firstEnabled.key : (steps[0]?.key || 'match');
}
