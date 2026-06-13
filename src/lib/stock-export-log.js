// Stock CSV export audit log — write via RPC, read via RLS (super_admin only).

import { sb } from './supabase-client.js';

/**
 * Record a completed stock export. Non-fatal if this fails after download.
 * @returns {Promise<number|null>} new log id
 */
export async function logStockExport({
  exporterEmail,
  exporterName,
  scope,
  scopeLabel,
  rowCount,
  shopName,
  filename,
}) {
  const { data, error } = await sb.rpc('log_stock_export', {
    p_exporter_email: exporterEmail,
    p_exporter_name: exporterName || null,
    p_scope: scope,
    p_scope_label: scopeLabel,
    p_row_count: rowCount,
    p_shop_name: shopName || null,
    p_filename: filename,
  });
  if (error) throw error;
  return data ?? null;
}

/** Fetch recent export history — RLS allows super_admin only. */
export async function fetchStockExportLogs(limit = 50) {
  const cap = Math.max(1, Math.min(Number(limit) || 50, 200));
  const { data, error } = await sb
    .from('stock_export_logs')
    .select('id, exported_at, exporter_email, exporter_name, scope, scope_label, row_count, shop_name, filename')
    .order('exported_at', { ascending: false })
    .limit(cap);
  if (error) throw error;
  return data || [];
}
