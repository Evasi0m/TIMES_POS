import { ECOMMERCE_CHANNELS } from './ecommerce-channels.js';

/**
 * Per-channel platform fee summary over active bills.
 * fee = grand_total − net_received, only for bills that have net_received.
 * Bills still missing net_received are counted separately (`missingNet`).
 * @returns {Array<{channel, orders, withNet, missingNet, gross, net, fee, feePct}>}
 */
export function platformFeeSummary(rows) {
  const by = new Map();
  for (const r of rows || []) {
    if (!ECOMMERCE_CHANNELS.has(r.channel)) continue;
    let e = by.get(r.channel);
    if (!e) {
      e = { channel: r.channel, orders: 0, withNet: 0, missingNet: 0, gross: 0, net: 0, fee: 0, feePct: null };
      by.set(r.channel, e);
    }
    e.orders += 1;
    if (r.net_received == null) { e.missingNet += 1; continue; }
    const g = Number(r.grand_total) || 0;
    const n = Number(r.net_received) || 0;
    e.withNet += 1;
    e.gross += g;
    e.net += n;
    e.fee += g - n;
  }
  const out = [...by.values()];
  for (const e of out) e.feePct = e.gross > 0 ? (e.fee / e.gross) * 100 : null;
  return out.sort((a, b) => b.gross - a.gross);
}
