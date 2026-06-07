// TikTok official shipping label — fetch doc_url via Fulfillment API.
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

interface LabelResult {
  sale_order_id: number;
  tiktok_order_id: string;
  package_id?: string;
  doc_url?: string;
  error?: string;
}

async function getShippingDocument(
  packageId: string,
  accessToken: string,
  shopCipher: string,
  documentType = 'SHIPPING_LABEL',
  documentSize = 'A6',
): Promise<string> {
  const path = `/fulfillment/202309/packages/${packageId}/shipping_documents`;
  const data = await apiGet(
    path,
    { document_type: documentType, document_size: documentSize },
    accessToken,
    shopCipher,
  );
  const docUrl = String(
    data?.doc_url || (data?.shipping_document as Record<string, unknown>)?.doc_url || '',
  );
  if (!docUrl) throw new Error('TikTok did not return doc_url');
  return docUrl;
}

async function tryShipPackage(
  packageId: string,
  accessToken: string,
  shopCipher: string,
): Promise<void> {
  try {
    await apiPost(
      '/fulfillment/202309/packages/ship',
      {},
      accessToken,
      shopCipher,
      {
        packages: [{ id: packageId, handover_method: 'DROP_OFF' }],
      },
    );
  } catch {
    // Ship may fail if already shipped — caller continues to fetch document
  }
}

async function resolvePackageId(
  supa: ReturnType<typeof serviceClient>,
  saleOrder: Record<string, unknown>,
  accessToken: string,
  shopCipher: string,
): Promise<string | null> {
  const stored = saleOrder.tiktok_package_ids;
  if (Array.isArray(stored) && stored.length) {
    return String(stored[0]);
  }
  const tiktokId = String(saleOrder.tiktok_order_id || '');
  if (!tiktokId) return null;
  const order = await fetchTikTokOrderDetail(supa, tiktokId);
  const ids = extractPackageIds(order);
  if (ids.length) {
    await supa.from('sale_orders').update({
      tiktok_package_ids: ids,
      updated_at: new Date().toISOString(),
    }).eq('id', saleOrder.id);
    return ids[0];
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const auth = req.headers.get('Authorization');
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { supabaseUrl, serviceRole } = getEnv();
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  const { data: isAdmin } = await userClient.rpc('is_admin');
  if (!isAdmin) {
    return new Response(JSON.stringify({ error: 'Admin only' }), {
      status: 403,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch { /* empty */ }

  const saleOrderIds = (body.sale_order_ids as number[]) || [];
  const documentType = String(body.document_type || 'SHIPPING_LABEL');
  const documentSize = String(body.document_size || 'A6');

  if (!saleOrderIds.length) {
    return new Response(JSON.stringify({ error: 'sale_order_ids required' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const supa = serviceClient();
  const { accessToken, shopCipher } = await getValidAccessToken(supa);
  const labels: LabelResult[] = [];

  const { data: orders, error: fetchErr } = await supa.from('sale_orders')
    .select('id, tiktok_order_id, tiktok_shipping_type, tiktok_package_ids, tiktok_order_status, status')
    .in('id', saleOrderIds)
    .eq('channel', 'tiktok');

  if (fetchErr) {
    return new Response(JSON.stringify({ error: fetchErr.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  for (const order of orders || []) {
    const base: LabelResult = {
      sale_order_id: order.id,
      tiktok_order_id: String(order.tiktok_order_id || ''),
    };
    if (order.status === 'voided') {
      labels.push({ ...base, error: 'ออเดอร์ถูกยกเลิก' });
      continue;
    }
    const shipType = String(order.tiktok_shipping_type || '').toUpperCase();
    if (shipType === 'SELLER') {
      labels.push({ ...base, error: 'ออเดอร์จัดส่งเอง (SELLER) — ไม่มี official label จาก TikTok' });
      continue;
    }
    try {
      let packageId = await resolvePackageId(supa, order, accessToken, shopCipher);
      if (!packageId) {
        labels.push({
          ...base,
          error: 'ยังไม่มี package — กรุณา arrange shipment ใน TikTok Seller Center ก่อน',
        });
        continue;
      }
      let docUrl: string;
      try {
        docUrl = await getShippingDocument(packageId, accessToken, shopCipher, documentType, documentSize);
      } catch {
        await tryShipPackage(packageId, accessToken, shopCipher);
        docUrl = await getShippingDocument(packageId, accessToken, shopCipher, documentType, documentSize);
      }
      labels.push({ ...base, package_id: packageId, doc_url: docUrl });
    } catch (e) {
      labels.push({
        ...base,
        error: e instanceof Error ? e.message : 'label_fetch_failed',
      });
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    labels,
  }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
