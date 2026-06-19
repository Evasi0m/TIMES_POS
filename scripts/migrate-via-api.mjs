#!/usr/bin/env node
/**
 * Copy all public tables OLD ? NEW via Supabase service-role REST (no pg_dump).
 * Requires NEW project to already have matching schema (run migrate-full-public.sh first).
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(resolve(root, '.env.migrate'), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const oldSb = createClient(env.OLD_SUPABASE_URL, env.OLD_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const newSb = createClient(env.NEW_SUPABASE_URL, env.NEW_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TABLES = [
  'brands', 'categories', 'suppliers', 'shop_settings', 'shop_secrets',
  'tax_invoice_counters', 'credit_note_counters', 'purchase_doc_counters',
  'products', 'product_images', 'product_image_jobs', 'ai_api_keys',
  'receive_orders', 'receive_order_items',
  'sale_orders', 'sale_order_items', 'sale_order_edits',
  'return_orders', 'return_order_items',
  'stock_movements', 'stock_export_logs', 'stock_manual_adjustments',
  'shop_expenses', 'tiktok_tokens', 'tiktok_product_mappings',
  'tiktok_return_orders', 'tiktok_inventory_sync_log', 'tiktok_invoice_requests',
  'storefront_products', 'supplier_claim_orders', 'supplier_claim_order_items',
  'ai_usage_log', 'deletion_audit', 'web_order_idempotency',
];

const PAGE = 500;

async function fetchAll(sb, table) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from(table).select('*').range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} read: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function insertBatch(table, batch) {
  const { error } = await newSb.from(table).upsert(batch, { onConflict: 'id' });
  if (error) throw new Error(`${table} write: ${error.message}`);
}

async function copyTable(table) {
  process.stdout.write(`? ${table} … `);
  const rows = await fetchAll(oldSb, table);
  for (let i = 0; i < rows.length; i += PAGE) {
    await insertBatch(table, rows.slice(i, i + PAGE));
  }
  console.log(`${rows.length} rows`);
}

async function main() {
  for (const t of TABLES) {
    try {
      await copyTable(t);
    } catch (e) {
      console.error(`\n? ${e.message}`);
      process.exit(1);
    }
  }
  console.log('? API copy complete');
}

main();
