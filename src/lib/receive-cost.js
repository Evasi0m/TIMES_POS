// Receive-cost helpers — thin client over get_product_latest_receive_costs /
// get_receive_cost_timeline RPCs (see migration 071).

const ID_CHUNK = 500;

/** Build latestCostMap shape used by ProductsView / stock export. */
export function buildLatestCostMap(rows) {
  const map = {};
  for (const r of rows || []) {
    if (!r?.product_id) continue;
    const receive_date = r.receive_date;
    map[r.product_id] = {
      unit_price: Number(r.unit_price) || 0,
      receive_date,
      ts: receive_date ? new Date(receive_date).getTime() : 0,
    };
  }
  return map;
}

/** Per-product sorted receive timeline for as-of-sale cost in reports. */
export function buildReceiveCostTimeline(rows) {
  const map = {};
  for (const r of rows || []) {
    if (!r?.product_id || !r.receive_date) continue;
    (map[r.product_id] ||= []).push({
      date: new Date(r.receive_date).getTime(),
      unit_price: Number(r.unit_price) || 0,
    });
  }
  for (const arr of Object.values(map)) {
    arr.sort((a, b) => b.date - a.date);
  }
  return map;
}

/** Latest active receive cost per catalog SKU (~6k rows, single RPC). */
export async function fetchLatestReceiveCostMap(sb) {
  const { data, error } = await sb.rpc('get_product_latest_receive_costs');
  if (error) return { map: {}, error };
  return { map: buildLatestCostMap(data), error: null };
}

/** Receive timeline for report product ids (chunked .in() on the RPC arg). */
export async function fetchReceiveCostTimeline(sb, productIds, beforeIso = null) {
  const ids = [...new Set((productIds || []).filter(Boolean))];
  if (!ids.length) return { map: {}, error: null };

  const merged = {};
  let lastError = null;

  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const { data, error } = await sb.rpc('get_receive_cost_timeline', {
      p_product_ids: chunk,
      p_before: beforeIso || null,
    });
    if (error) {
      lastError = error;
      break;
    }
    Object.assign(merged, buildReceiveCostTimeline(data));
  }

  return { map: merged, error: lastError };
}
