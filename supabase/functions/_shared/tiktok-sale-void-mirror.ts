// Fire-and-forget sale_void mirror after TikTok auto-cancel void.
import { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

type MirrorTarget = {
  product_id: number;
  tiktok_product_id: string;
  tiktok_sku_id: string;
  seller_sku?: string;
  tiktok_product_name?: string;
};

/** Queue POS stock mirror to TikTok after voiding a confirmed sale. */
export async function queueSaleVoidMirror(
  supa: SupabaseClient,
  saleOrderId: number,
): Promise<void> {
  try {
    const { data: targets, error } = await supa.rpc('get_tiktok_sale_mirror_targets', {
      p_sale_order_id: saleOrderId,
      p_product_ids: null,
    });
    if (error) {
      console.warn('[tiktok-sale-void-mirror] targets failed:', error.message);
      return;
    }
    const list = (targets || []) as MirrorTarget[];
    if (!list.length) return;

    const productIds = list.map((t) => t.product_id);
    const { data: products } = await supa
      .from('products')
      .select('id, current_stock')
      .in('id', productIds);
    const stockMap = Object.fromEntries(
      (products || []).map((p: { id: number; current_stock: number }) => [p.id, p.current_stock ?? 0]),
    );

    const items = list.map((t) => ({
      product_id: t.product_id,
      receive_order_id: saleOrderId,
      tiktok_product_id: t.tiktok_product_id,
      tiktok_sku_id: t.tiktok_sku_id,
      pos_stock_after: stockMap[t.product_id] ?? 0,
      seller_sku: t.seller_sku,
      tiktok_product_name: t.tiktok_product_name,
      sync_operation: 'sale_void',
    }));

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) {
      console.warn('[tiktok-sale-void-mirror] missing env');
      return;
    }

    const resp = await fetch(`${supabaseUrl}/functions/v1/tiktok-inventory-update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ items }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.warn('[tiktok-sale-void-mirror] invoke failed:', resp.status, body);
    }
  } catch (e) {
    console.warn('[tiktok-sale-void-mirror] error:', e instanceof Error ? e.message : e);
  }
}
