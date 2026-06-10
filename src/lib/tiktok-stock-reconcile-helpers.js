// Pure helpers for TikTok ↔ POS stock reconciliation (no Supabase import).

export const FILTER_TABS = {
  all: 'all',
  mismatched: 'mismatched',
  matched: 'matched',
  problems: 'problems',
};

export function partitionRows(rows = []) {
  const ok = rows.filter(r => r.status === 'ok');
  return {
    all: rows,
    matched: ok.filter(r => r.diff === 0),
    mismatched: ok.filter(r => r.diff !== 0),
    problems: rows.filter(r => r.status !== 'ok'),
    ok,
  };
}

export function filterRows(rows, { tab = FILTER_TABS.all, query = '' } = {}) {
  const parts = partitionRows(rows);
  let list = tab === FILTER_TABS.matched ? parts.matched
    : tab === FILTER_TABS.mismatched ? parts.mismatched
      : tab === FILTER_TABS.problems ? parts.problems
        : parts.all;

  const q = query.trim().toLowerCase();
  if (!q) return list;

  return list.filter(r => {
    const hay = [
      r.seller_sku,
      r.barcode,
      r.product_name,
      r.tiktok_sku_id,
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
}

export function isRowApplicable(row, source) {
  if (!row || row.status !== 'ok' || !row.sync_enabled) return false;
  if (row.diff === 0) return false;
  if (source === 'pos') {
    return !!(row.tiktok_product_id && row.tiktok_sku_id);
  }
  return row.tiktok_stock != null;
}

export function defaultSelectedIds(rows, source = 'pos') {
  return new Set(
    partitionRows(rows).mismatched
      .filter(r => isRowApplicable(r, source))
      .map(r => r.product_id),
  );
}

export function rowToApplyItem(row, source) {
  const base = {
    product_id: row.product_id,
    tiktok_sku_id: row.tiktok_sku_id,
    tiktok_product_id: row.tiktok_product_id,
    warehouse_id: row.warehouse_id,
    pos_stock: row.pos_stock,
    tiktok_stock: row.tiktok_stock,
    seller_sku: row.seller_sku,
  };
  if (source === 'tiktok') {
    return { ...base, target_qty: row.tiktok_stock };
  }
  return base;
}

export function buildApplyPreview(items, source) {
  return items.map(row => {
    const sku = row.seller_sku || row.barcode || row.product_name || `#${row.product_id}`;
    if (source === 'pos') {
      return `${sku}  POS ${row.pos_stock} → TikTok ${row.pos_stock} (เดิม ${row.tiktok_stock})`;
    }
    return `${sku}  TikTok ${row.tiktok_stock} → POS ${row.tiktok_stock} (เดิม ${row.pos_stock})`;
  });
}

export function diffChipClass(diff) {
  if (diff === 0) return 'tt-reconcile-chip--ok';
  if (diff > 0) return 'tt-reconcile-chip--pos-high';
  return 'tt-reconcile-chip--pos-low';
}

export function formatDiff(diff) {
  if (diff === 0) return '0';
  return diff > 0 ? `+${diff}` : String(diff);
}

export function sourceLabel(source) {
  return source === 'tiktok' ? 'TikTok → POS' : 'POS → TikTok';
}

export function sourceHint(source) {
  return source === 'tiktok'
    ? 'ปรับสต็อก POS ให้เท่ากับ TikTok Shop ปัจจุบัน'
    : 'ปรับสต็อก TikTok Shop ให้เท่ากับ POS ปัจจุบัน';
}

export function formatApplyToast(summary, source) {
  const dir = sourceLabel(source);
  const { success = 0, skipped = 0, failed = 0 } = summary || {};
  if (failed > 0) {
    return `ปรับสต็อก (${dir}) — สำเร็จ ${success} · ข้าม ${skipped} · ผิดพลาด ${failed}`;
  }
  return `ปรับสต็อก (${dir}) เรียบร้อย — สำเร็จ ${success}${skipped ? ` · ข้าม ${skipped}` : ''}`;
}
