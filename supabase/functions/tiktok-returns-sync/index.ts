// TikTok Return & Refund sync — pulls returns and upserts to tiktok_return_orders.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { apiPost, getValidAccessToken, serviceClient } from '../_shared/tiktok-client.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ReturnRecord {
  tiktok_return_id: string;
  tiktok_order_id: string;
  return_type: string;
  return_status: string;
  refund_amount: string;
  currency: string;
  reason: string;
  raw: Record<string, unknown>;
}

function mapReturn(r: Record<string, unknown>): ReturnRecord {
  const refund = (r.refund_amount || r.refund_total || {}) as Record<string, unknown>;
  return {
    tiktok_return_id: String(r.return_id || r.reverse_order_id || r.id || ''),
    tiktok_order_id: String(r.order_id || r.orderId || ''),
    return_type: String(r.return_type || r.reverse_type || ''),
    return_status: String(r.return_status || r.reverse_status || r.status || ''),
    refund_amount: String(
      r.refund_total_amount ?? refund.refund_total ?? refund.amount ?? r.refund_amount ?? '',
    ),
    currency: String(refund.currency || r.currency || 'THB'),
    reason: String(r.return_reason_text || r.return_reason || r.reason || ''),
    raw: r,
  };
}

async function searchReturns(
  accessToken: string,
  shopCipher: string,
  hours: number,
): Promise<Record<string, unknown>[]> {
  const timeGe = Math.floor((Date.now() - hours * 3600 * 1000) / 1000);
  const out: Record<string, unknown>[] = [];
  let pageToken = '';
  for (let page = 0; page < 30; page++) {
    const query: Record<string, string | number> = { page_size: 50 };
    if (pageToken) query.page_token = pageToken;
    const data = await apiPost(
      '/return_refund/202309/returns/search',
      query,
      accessToken,
      shopCipher,
      { create_time_ge: timeGe },
    );
    const list = (data?.return_orders || data?.returns || data?.return_list || []) as Record<string, unknown>[];
    out.push(...list);
    pageToken = String(data?.next_page_token || '');
    if (!pageToken || !list.length) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const supa = serviceClient();
  let hours = 168;
  try {
    const body = await req.json();
    if (body?.hours != null) hours = Math.min(Math.max(Number(body.hours) || 168, 1), 720);
  } catch { /* empty */ }

  try {
    const { accessToken, shopCipher } = await getValidAccessToken(supa);
    const records = await searchReturns(accessToken, shopCipher, hours);
    let upserted = 0;
    const errors: string[] = [];
    for (const raw of records) {
      const rec = mapReturn(raw);
      if (!rec.tiktok_return_id) continue;
      const { error } = await supa.rpc('upsert_tiktok_return', { p: rec });
      if (error) errors.push(`${rec.tiktok_return_id}: ${error.message}`);
      else upserted++;
    }
    return new Response(JSON.stringify({
      ok: true, scanned: records.length, upserted, errors,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'returns_sync_failed';
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
