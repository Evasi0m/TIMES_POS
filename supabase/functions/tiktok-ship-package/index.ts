// TikTok Fulfillment — arrange shipment (RTS) for packages.
// For TikTok Shipping orders: ship via DROP_OFF/PICKUP handover.
// For seller self-ship: requires provider_id + tracking_number.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  apiGet,
  apiPost,
  getEnv,
  getValidAccessToken,
  serviceClient,
} from '../_shared/tiktok-client.ts';
import {
  extractPackageIds,
  fetchTikTokOrderDetail,
} from '../_shared/tiktok-order-import.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ShipResult {
  sale_order_id: number;
  tiktok_order_id: string;
  package_id?: string;
  tracking_number?: string;
  ok?: boolean;
  error?: string;
}

/** Resolve package_id from stored ids or live order detail (line_items). */
async function resolvePackages(
  supa: ReturnType<typeof serviceClient>,
  order: Record<string, unknown>,
): Promise<string[]> {
  const stored = order.tiktok_package_ids;
  if (Array.isArray(stored) && stored.length) return stored.map(String);
  const tiktokId = String(order.tiktok_order_id || '');
  if (!tiktokId) return [];
  const detail = await fetchTikTokOrderDetail(supa, tiktokId);
  const ids = extractPackageIds(detail);
  if (ids.length) {
    await supa.from('sale_orders').update({
      tiktok_package_ids: ids,
      updated_at: new Date().toISOString(),
    }).eq('id', order.id);
  }
  return ids;
}

async function shipPackage(
  packageId: string,
  accessToken: string,
  shopCipher: string,
  handoverMethod: string,
  selfShip?: { provider_id: string; tracking_number: string },
): Promise<void> {
  const pkg: Record<string, unknown> = { id: packageId };
  if (selfShip?.provider_id && selfShip?.tracking_number) {
    pkg.self_shipment = {
      tracking_number: selfShip.tracking_number,
      shipping_provider_id: selfShip.provider_id,
    };
  } else {
    pkg.handover_method = handoverMethod;
  }
  await apiPost(
    '/fulfillment/202309/packages/ship',
    {},
    accessToken,
    shopCipher,
    { packages: [pkg] },
  );
}

/** Read tracking back from the package detail after shipping. */
async function readTracking(
  packageId: string,
  accessToken: string,
  shopCipher: string,
): Promise<string> {
  try {
    const data = await apiGet(
      `/fulfillment/202309/packages/${packageId}`,
      {},
      accessToken,
      shopCipher,
    );
    return String(data?.tracking_number || '');
  } catch {
    return '';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const auth = req.headers.get('Authorization');
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { supabaseUrl } = getEnv();
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  const { data: isAdmin } = await userClient.rpc('is_admin');
  if (!isAdmin) {
    return new Response(JSON.stringify({ error: 'Admin only' }), {
      status: 403, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }

  const saleOrderIds = (body.sale_order_ids as number[]) || [];
  const handoverMethod = String(body.handover_method || 'DROP_OFF').toUpperCase();
  const selfShip = body.self_shipment as { provider_id: string; tracking_number: string } | undefined;

  if (!saleOrderIds.length) {
    return new Response(JSON.stringify({ error: 'sale_order_ids required' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const supa = serviceClient();
  const { accessToken, shopCipher } = await getValidAccessToken(supa);

  const { data: orders, error: fetchErr } = await supa.from('sale_orders')
    .select('id, tiktok_order_id, tiktok_shipping_type, tiktok_package_ids, tiktok_order_status, status')
    .in('id', saleOrderIds)
    .eq('channel', 'tiktok');

  if (fetchErr) {
    return new Response(JSON.stringify({ error: fetchErr.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const results: ShipResult[] = [];
  for (const order of orders || []) {
    const base: ShipResult = {
      sale_order_id: order.id,
      tiktok_order_id: String(order.tiktok_order_id || ''),
    };
    if (order.status === 'voided') {
      results.push({ ...base, error: 'ออเดอร์ถูกยกเลิก' });
      continue;
    }
    try {
      const pkgIds = await resolvePackages(supa, order);
      if (!pkgIds.length) {
        results.push({ ...base, error: 'ยังไม่มี package สำหรับออเดอร์นี้' });
        continue;
      }
      const packageId = pkgIds[0];
      try {
        await shipPackage(packageId, accessToken, shopCipher, handoverMethod, selfShip);
      } catch (e) {
        // Likely already shipped — proceed to refresh tracking instead of failing.
        const msg = e instanceof Error ? e.message : '';
        if (!/already|shipped|ship_status/i.test(msg)) throw e;
      }
      const tracking = await readTracking(packageId, accessToken, shopCipher);
      await supa.from('sale_orders').update({
        tiktok_package_ids: pkgIds,
        tracking_number: tracking || order.tracking_number || null,
        updated_at: new Date().toISOString(),
      }).eq('id', order.id);
      results.push({ ...base, package_id: packageId, tracking_number: tracking, ok: true });
    } catch (e) {
      results.push({ ...base, error: e instanceof Error ? e.message : 'ship_failed' });
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    shipped: results.filter(r => r.ok).length,
    failed: results.filter(r => r.error).length,
    results,
  }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
