// Daily settlement sync — update net_received for TikTok orders.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {
  apiPost,
  getValidAccessToken,
  roundMoney,
  serviceClient,
} from '../_shared/tiktok-client.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const supa = serviceClient();
  const updated: { id: number; net_received: number }[] = [];

  try {
    const { data: pending } = await supa.from('sale_orders')
      .select('id, tiktok_order_id, grand_total')
      .eq('channel', 'tiktok')
      .eq('status', 'active')
      .eq('net_received_pending', true)
      .not('tiktok_order_id', 'is', null)
      .limit(200);

    const sumFees = (txs: Record<string, unknown>[]): { net: number; fees: Record<string, number> } => {
      let net = 0;
      const fees: Record<string, number> = {};
      for (const tx of txs) {
        const amt = Number(tx.settlement_amount || tx.amount || 0);
        net += amt;
        const type = String(tx.type || tx.fee_type || tx.transaction_type || 'other');
        // Fees are negative components; settlement_amount line itself is positive.
        if (amt < 0) fees[type] = roundMoney((fees[type] || 0) + amt);
      }
      return { net: roundMoney(net), fees };
    };

    if (!pending?.length) {
      return new Response(JSON.stringify({ ok: true, updated: 0 }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const { accessToken, shopCipher } = await getValidAccessToken(supa);

    for (const row of pending) {
      const tid = row.tiktok_order_id;
      if (!tid) continue;
      try {
        const fin = await apiPost(
          '/finance/202309/orders/{order_id}/statement_transactions'.replace('{order_id}', tid),
          {},
          accessToken,
          shopCipher,
          {},
        );
        const txs = (fin?.transactions as Record<string, unknown>[]) || [];
        let { net, fees } = sumFees(txs);
        if (net === 0) {
          const orderFin = await apiPost(
            '/finance/202309/orders/settlements',
            {},
            accessToken,
            shopCipher,
            { order_ids: [tid] },
          );
          const settlements = (orderFin?.settlements as Record<string, unknown>[]) || [];
          for (const s of settlements) {
            net += Number(s.settlement_amount || s.net_amount || 0);
          }
          net = roundMoney(net);
        }
        if (net === 0) continue;

        const netReceived = roundMoney(net);
        const fee = roundMoney(Number(row.grand_total || 0) - netReceived);
        await supa.from('sale_orders').update({
          net_received: netReceived,
          net_received_pending: false,
          settlement_fee: fee,
          settlement_breakdown: Object.keys(fees).length ? fees : null,
          settlement_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', row.id);
        updated.push({ id: row.id, net_received: netReceived });
      } catch {
        // skip individual failures — retry next cron
      }
    }

    return new Response(JSON.stringify({ ok: true, updated: updated.length, rows: updated }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'settlement_failed';
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
