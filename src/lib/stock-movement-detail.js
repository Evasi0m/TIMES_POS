// Stock movement detail — resolve ref orders for product edit history cards.

import { sb } from './supabase-client.js';
import { fmtDateTime } from './date.js';
import { fmtTHB } from './money.js';
import { channelLabelForOrder, CHANNEL_LABELS } from './channel-badge-meta.js';
import { getPaymentMethodLabel } from './payment-method-label.js';
import { parseManualAdjustNotes } from './stock-manual-adjust.js';

export const STOCK_REASON_LABELS = {
  sale:                { label: '\u0e02\u0e32\u0e22',              tone: 'red'   },
  sale_void:           { label: '\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01\u0e02\u0e32\u0e22',         tone: 'green' },
  sale_edit:           { label: '\u0e41\u0e01\u0e49\u0e44\u0e02\u0e01\u0e32\u0e23\u0e02\u0e32\u0e22',       tone: 'gray'  },
  receive:             { label: '\u0e23\u0e31\u0e1a\u0e40\u0e02\u0e49\u0e32',           tone: 'green' },
  receive_void:        { label: '\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01\u0e23\u0e31\u0e1a\u0e40\u0e02\u0e49\u0e32',     tone: 'red'   },
  return_in:           { label: '\u0e04\u0e37\u0e19\u0e40\u0e02\u0e49\u0e32',           tone: 'green' },
  return_void:         { label: '\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01\u0e23\u0e31\u0e1a\u0e04\u0e37\u0e19',      tone: 'red'   },
  manual_adjust:       { label: '\u0e1b\u0e23\u0e31\u0e1a\u0e2a\u0e15\u0e47\u0e2d\u0e01 (\u0e21\u0e37\u0e2d)',   tone: 'gray'  },
  stock_reconcile:     { label: '\u0e1b\u0e23\u0e31\u0e1a\u0e2a\u0e15\u0e47\u0e2d\u0e01 TikTok', tone: 'gray'  },
  initial:             { label: '\u0e15\u0e31\u0e49\u0e07\u0e15\u0e49\u0e19',            tone: 'gray'  },
  supplier_claim:      { label: '\u0e2a\u0e48\u0e07\u0e40\u0e04\u0e25\u0e21/\u0e04\u0e37\u0e19\u0e1a\u0e23\u0e34\u0e29\u0e31\u0e17', tone: 'red'   },
  supplier_claim_void: { label: '\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01\u0e2a\u0e48\u0e07\u0e40\u0e04\u0e25\u0e21',     tone: 'green' },
};

const RECEIVE_VIA_LABELS = {
  manual: '\u0e23\u0e31\u0e1a\u0e40\u0e02\u0e49\u0e32\u0e14\u0e49\u0e27\u0e22\u0e21\u0e37\u0e2d',
  ai_cmg: 'AI scan',
  json_cmg: 'JSON import',
};

const EM_DASH = '\u2014';

function dash(v) {
  const s = v == null ? '' : String(v).trim();
  return s || EM_DASH;
}

function orderStatusLabel(order) {
  if (!order) return EM_DASH;
  if (order.voided_at) return '\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01\u0e41\u0e25\u0e49\u0e27';
  if (order.status === 'voided') return '\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01\u0e41\u0e25\u0e49\u0e27';
  if (order.status === 'pending') return '\u0e23\u0e2d\u0e14\u0e33\u0e40\u0e19\u0e34\u0e19\u0e01\u0e32\u0e23';
  return '\u0e1b\u0e01\u0e15\u0e34';
}

function lineQtyPrice(line) {
  if (!line) return null;
  const qty = Number(line.quantity);
  const price = line.unit_price ?? line.display_unit_price;
  if (!Number.isFinite(qty)) return null;
  const priceStr = price != null && Number.isFinite(Number(price)) ? fmtTHB(price) : EM_DASH;
  return `${qty.toLocaleString('th-TH')} \u0e0a\u0e34\u0e49\u0e19 @ ${priceStr}`;
}

/** @returns {'sale'|'receive'|'return'|'claim'|'manual'|'reconcile'|null} */
export function movementDetailKind(movement) {
  if (!movement) return null;
  const ref = movement.ref_table;
  const reason = movement.reason;

  if (reason === 'manual_adjust') return 'manual';
  if (reason === 'stock_reconcile' || ref === 'tiktok_stock_reconcile') return 'reconcile';

  if (ref === 'sale_orders' || ['sale', 'sale_void', 'sale_edit'].includes(reason)) {
    return movement.ref_id ? 'sale' : null;
  }
  if (ref === 'receive_orders' || ['receive', 'receive_void'].includes(reason)) {
    return movement.ref_id ? 'receive' : null;
  }
  if (ref === 'return_orders' || ['return_in', 'return_void'].includes(reason)) {
    return movement.ref_id ? 'return' : null;
  }
  if (ref === 'supplier_claim_orders' || ['supplier_claim', 'supplier_claim_void'].includes(reason)) {
    return movement.ref_id ? 'claim' : null;
  }
  return null;
}

export function canShowMovementDetail(movement) {
  return movementDetailKind(movement) != null;
}

export function movementReasonLabel(movement) {
  const meta = STOCK_REASON_LABELS[movement?.reason];
  return meta?.label || movement?.reason || EM_DASH;
}

async function fetchSaleDetail(refId, productId) {
  const [orderRes, lineRes] = await Promise.all([
    sb.from('sale_orders')
      .select('id, channel, payment_method, tiktok_order_id, confirmed_at, grand_total, sale_date, status, voided_at')
      .eq('id', refId)
      .maybeSingle(),
    sb.from('sale_order_items')
      .select('quantity, unit_price, display_unit_price')
      .eq('sale_order_id', refId)
      .eq('product_id', productId)
      .maybeSingle(),
  ]);
  if (orderRes.error) throw orderRes.error;
  return { order: orderRes.data, line: lineRes.data };
}

async function fetchReceiveDetail(refId, productId) {
  const [orderRes, lineRes] = await Promise.all([
    sb.from('receive_orders')
      .select('id, supplier_name, supplier_invoice_no, purchase_doc_no, created_via, receive_date, total_value, voided_at')
      .eq('id', refId)
      .maybeSingle(),
    sb.from('receive_order_items')
      .select('quantity, unit_price')
      .eq('receive_order_id', refId)
      .eq('product_id', productId)
      .maybeSingle(),
  ]);
  if (orderRes.error) throw orderRes.error;
  return { order: orderRes.data, line: lineRes.data };
}

async function fetchReturnDetail(refId, productId) {
  const [orderRes, lineRes] = await Promise.all([
    sb.from('return_orders')
      .select('id, channel, return_reason, original_sale_order_id, goods_returned, return_date, voided_at')
      .eq('id', refId)
      .maybeSingle(),
    sb.from('return_order_items')
      .select('quantity, unit_price')
      .eq('return_order_id', refId)
      .eq('product_id', productId)
      .maybeSingle(),
  ]);
  if (orderRes.error) throw orderRes.error;
  let origSale = null;
  const origId = orderRes.data?.original_sale_order_id;
  if (origId) {
    const { data } = await sb.from('sale_orders')
      .select('id, tiktok_order_id, channel')
      .eq('id', origId)
      .maybeSingle();
    origSale = data;
  }
  return { order: orderRes.data, line: lineRes.data, origSale };
}

async function fetchClaimDetail(refId, productId) {
  const [orderRes, lineRes] = await Promise.all([
    sb.from('supplier_claim_orders')
      .select('id, supplier_name, supplier_invoice_no, claim_reason, claim_doc_no, claim_date, voided_at')
      .eq('id', refId)
      .maybeSingle(),
    sb.from('supplier_claim_order_items')
      .select('quantity, unit_price')
      .eq('supplier_claim_order_id', refId)
      .eq('product_id', productId)
      .maybeSingle(),
  ]);
  if (orderRes.error) throw orderRes.error;
  return { order: orderRes.data, line: lineRes.data };
}

/** Lazy-load order context for a stock movement row. */
export async function fetchMovementDetail(movement, productId) {
  const kind = movementDetailKind(movement);
  if (!kind) return { kind: null, data: null };

  if (kind === 'manual' || kind === 'reconcile') {
    return { kind, data: { movement } };
  }

  const refId = movement.ref_id;
  if (!refId) return { kind, data: null };

  switch (kind) {
    case 'sale':
      return { kind, data: await fetchSaleDetail(refId, productId) };
    case 'receive':
      return { kind, data: await fetchReceiveDetail(refId, productId) };
    case 'return':
      return { kind, data: await fetchReturnDetail(refId, productId) };
    case 'claim':
      return { kind, data: await fetchClaimDetail(refId, productId) };
    default:
      return { kind: null, data: null };
  }
}

/**
 * @returns {{ label: string, value: string }[]}
 */
export function formatMovementDetailRows(kind, movement, payload) {
  const rows = [];
  const push = (label, value) => {
    if (value == null || value === '') return;
    rows.push({ label, value: String(value) });
  };

  push('\u0e1b\u0e23\u0e30\u0e40\u0e20\u0e17', movementReasonLabel(movement));
  push('\u0e27\u0e31\u0e19\u0e17\u0e35\u0e48', fmtDateTime(movement?.created_at));
  push('\u0e08\u0e33\u0e19\u0e27\u0e19', movement?.qty_delta != null
    ? `${movement.qty_delta > 0 ? '+' : ''}${movement.qty_delta}`
  : null);
  push('\u0e04\u0e07\u0e40\u0e2b\u0e25\u0e37\u0e2d\u0e2b\u0e25\u0e31\u0e07\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23', movement?.balance_after != null ? String(movement.balance_after) : null);

  if (kind === 'sale') {
    const { order, line } = payload || {};
    if (!order) {
      push('\u0e2b\u0e21\u0e32\u0e22\u0e40\u0e2b\u0e15\u0e38', '\u0e44\u0e21\u0e48\u0e1e\u0e1a\u0e1a\u0e34\u0e25\u0e02\u0e32\u0e22');
      return rows;
    }
    push('Platform', channelLabelForOrder(order));
    if (order.tiktok_order_id) push('\u0e40\u0e25\u0e02\u0e04\u0e33\u0e2a\u0e31\u0e48\u0e07 TikTok', order.tiktok_order_id);
    push('\u0e0a\u0e33\u0e23\u0e30\u0e42\u0e14\u0e22', getPaymentMethodLabel(order.payment_method));
    push('\u0e1a\u0e34\u0e25 POS', `#${order.id}`);
    push('\u0e22\u0e2d\u0e14\u0e1a\u0e34\u0e25', fmtTHB(order.grand_total));
    push('\u0e27\u0e31\u0e19\u0e17\u0e35\u0e02\u0e32\u0e22', fmtDateTime(order.sale_date));
    push('\u0e2a\u0e16\u0e32\u0e19\u0e30\u0e1a\u0e34\u0e25', orderStatusLabel(order));
    const lp = lineQtyPrice(line);
    if (lp) push('\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e43\u0e19\u0e1a\u0e34\u0e25\u0e19\u0e35\u0e49', lp);
    return rows;
  }

  if (kind === 'receive') {
    const { order, line } = payload || {};
    if (!order) {
      push('\u0e2b\u0e21\u0e32\u0e22\u0e40\u0e2b\u0e15\u0e38', '\u0e44\u0e21\u0e48\u0e1e\u0e1a\u0e1a\u0e34\u0e25\u0e23\u0e31\u0e1a\u0e40\u0e02\u0e49\u0e32');
      return rows;
    }
    push('\u0e1c\u0e39\u0e49\u0e08\u0e33\u0e2b\u0e19\u0e48\u0e32\u0e22', dash(order.supplier_name));
    push('\u0e40\u0e25\u0e02\u0e43\u0e1a\u0e41\u0e08\u0e49\u0e07\u0e2b\u0e19\u0e35\u0e49', dash(order.supplier_invoice_no));
    push('\u0e40\u0e25\u0e02\u0e40\u0e2d\u0e01\u0e2a\u0e32\u0e23\u0e0b\u0e37\u0e49', dash(order.purchase_doc_no));
    if (order.created_via) {
      push('\u0e0a\u0e48\u0e2d\u0e07\u0e17\u0e32\u0e07\u0e1a\u0e31\u0e19\u0e17\u0e36\u0e01', RECEIVE_VIA_LABELS[order.created_via] || order.created_via);
    }
    push('\u0e1a\u0e34\u0e25\u0e23\u0e31\u0e1a\u0e40\u0e02\u0e49\u0e32', `#${order.id}`);
    push('\u0e22\u0e2d\u0e14\u0e1a\u0e34\u0e25', fmtTHB(order.total_value));
    push('\u0e27\u0e31\u0e19\u0e17\u0e35\u0e23\u0e31\u0e1a', fmtDateTime(order.receive_date));
    push('\u0e2a\u0e16\u0e32\u0e19\u0e30\u0e1a\u0e34\u0e25', orderStatusLabel(order));
    const lp = lineQtyPrice(line);
    if (lp) push('\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e43\u0e19\u0e1a\u0e34\u0e25\u0e19\u0e35\u0e49', lp);
    return rows;
  }

  if (kind === 'return') {
    const { order, line, origSale } = payload || {};
    if (!order) {
      push('\u0e2b\u0e21\u0e32\u0e22\u0e40\u0e2b\u0e15\u0e38', '\u0e44\u0e21\u0e48\u0e1e\u0e1a\u0e1a\u0e34\u0e25\u0e23\u0e31\u0e1a\u0e04\u0e37\u0e19');
      return rows;
    }
    push('Platform', CHANNEL_LABELS[order.channel] || order.channel || EM_DASH);
    if (origSale?.tiktok_order_id) push('\u0e40\u0e25\u0e02\u0e04\u0e33\u0e2a\u0e31\u0e48\u0e07 TikTok (\u0e1a\u0e34\u0e25\u0e40\u0e14\u0e34\u0e21)', origSale.tiktok_order_id);
    else if (order.channel === 'tiktok') push('\u0e1a\u0e34\u0e25\u0e02\u0e32\u0e22\u0e40\u0e14\u0e34\u0e21', origSale?.id ? `#${origSale.id}` : EM_DASH);
    push('\u0e40\u0e2b\u0e15\u0e38\u0e1c\u0e25\u0e23\u0e31\u0e1a\u0e04\u0e37\u0e19', dash(order.return_reason));
    push('\u0e02\u0e2d\u0e07\u0e04\u0e37\u0e19\u0e40\u0e02\u0e49\u0e32\u0e2a\u0e15\u0e47\u0e2d\u0e01', order.goods_returned === false ? '\u0e44\u0e21\u0e48 (\u0e02\u0e2d\u0e07\u0e2b\u0e32\u0e22)' : '\u0e43\u0e0a\u0e48');
    push('\u0e1a\u0e34\u0e25\u0e23\u0e31\u0e1a\u0e04\u0e37\u0e19', `#${order.id}`);
    push('\u0e27\u0e31\u0e19\u0e17\u0e35\u0e23\u0e31\u0e1a\u0e04\u0e37\u0e19', fmtDateTime(order.return_date));
    push('\u0e2a\u0e16\u0e32\u0e19\u0e30\u0e1a\u0e34\u0e25', orderStatusLabel(order));
    const lp = lineQtyPrice(line);
    if (lp) push('\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e43\u0e19\u0e1a\u0e34\u0e25\u0e19\u0e35\u0e49', lp);
    return rows;
  }

  if (kind === 'claim') {
    const { order, line } = payload || {};
    if (!order) {
      push('\u0e2b\u0e21\u0e32\u0e22\u0e40\u0e2b\u0e15\u0e38', '\u0e44\u0e21\u0e48\u0e1e\u0e1a\u0e1a\u0e34\u0e25\u0e2a\u0e48\u0e07\u0e40\u0e04\u0e25\u0e21');
      return rows;
    }
    push('\u0e1c\u0e39\u0e49\u0e08\u0e33\u0e2b\u0e19\u0e48\u0e32\u0e22', dash(order.supplier_name));
    push('\u0e40\u0e25\u0e02\u0e43\u0e1a\u0e41\u0e08\u0e49\u0e07\u0e2b\u0e19\u0e35\u0e49', dash(order.supplier_invoice_no));
    push('\u0e40\u0e2b\u0e15\u0e38\u0e1c\u0e25\u0e40\u0e04\u0e25\u0e21', dash(order.claim_reason));
    push('\u0e40\u0e25\u0e02\u0e40\u0e2d\u0e01\u0e2a\u0e32\u0e23\u0e40\u0e04\u0e25\u0e21', dash(order.claim_doc_no));
    push('\u0e1a\u0e34\u0e25\u0e2a\u0e48\u0e07\u0e40\u0e04\u0e25\u0e21', `#${order.id}`);
    push('\u0e27\u0e31\u0e19\u0e17\u0e35\u0e2a\u0e48\u0e07\u0e40\u0e04\u0e25\u0e21', fmtDateTime(order.claim_date));
    push('\u0e2a\u0e16\u0e32\u0e19\u0e30\u0e1a\u0e34\u0e25', orderStatusLabel(order));
    const lp = lineQtyPrice(line);
    if (lp) push('\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e43\u0e19\u0e1a\u0e34\u0e25\u0e19\u0e35\u0e49', lp);
    return rows;
  }

  if (kind === 'manual') {
    const manual = parseManualAdjustNotes(movement?.notes);
    if (manual.subreasonLabel) push('\u0e40\u0e2b\u0e15\u0e38\u0e1c\u0e25', manual.subreasonLabel);
    if (manual.note) push('\u0e2b\u0e21\u0e32\u0e22\u0e40\u0e2b\u0e15\u0e38', manual.note);
    return rows;
  }

  if (kind === 'reconcile') {
    if (movement?.ref_id) push('\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23 reconcile', `#${movement.ref_id}`);
    if (movement?.notes) push('\u0e2b\u0e21\u0e32\u0e22\u0e40\u0e2b\u0e15\u0e38', movement.notes);
    return rows;
  }

  return rows;
}


const RECEIVE_VIA_META = {
  manual: { icon: 'store', label: '\u0e23\u0e31\u0e1a\u0e40\u0e02\u0e49\u0e32\u0e14\u0e49\u0e27\u0e22\u0e21\u0e37\u0e2d' },
  ai_cmg: { icon: 'camera', label: 'AI scan' },
  json_cmg: { icon: 'file', label: 'JSON import' },
};

const REASON_HERO_ICON = {
  sale: 'package-out',
  sale_void: 'package-in',
  sale_edit: 'edit',
  receive: 'package-in',
  receive_void: 'package-out',
  return_in: 'package-in',
  return_void: 'package-out',
  manual_adjust: 'bulk-adjust',
  stock_reconcile: 'tag',
  supplier_claim: 'package-out',
  supplier_claim_void: 'package-in',
};

function section(title, icon, rows) {
  const items = (rows || []).filter((r) => r && r.value != null && r.value !== '' && r.value !== EM_DASH);
  if (!items.length) return null;
  return { title, icon, rows: items };
}

function row(icon, label, value, { mono = false, emphasize = false } = {}) {
  if (value == null || value === '' || value === EM_DASH) return null;
  return { icon, label, value: String(value), mono, emphasize };
}

/**
 * Structured view model for the stock movement detail card UI.
 */
export function buildMovementDetailView(kind, movement, payload) {
  const reason = movement?.reason;
  const meta = STOCK_REASON_LABELS[reason] || { label: reason, tone: 'gray' };
  const qty = Number(movement?.qty_delta) || 0;
  const hero = {
    reasonLabel: movementReasonLabel(movement),
    reasonTone: meta.tone,
    heroIcon: REASON_HERO_ICON[reason] || 'box',
    qtyDelta: movement?.qty_delta,
    isPositive: qty > 0,
    isZero: qty === 0,
    dateTime: fmtDateTime(movement?.created_at),
    balanceAfter: movement?.balance_after,
  };

  const sections = [];
  let channelOrder = null;
  let channelProp = null;
  let highlight = null;
  let amount = null;
  let lineSummary = lineQtyPrice(payload?.line);
  let status = null;
  let note = null;

  if (kind === 'sale') {
    const { order, line } = payload || {};
    lineSummary = lineQtyPrice(line);
    if (!order) {
      note = '\u0e44\u0e21\u0e48\u0e1e\u0e1a\u0e1a\u0e34\u0e25\u0e02\u0e32\u0e22';
    } else {
      channelOrder = order;
      if (order.tiktok_order_id) {
        highlight = { label: 'TikTok', value: order.tiktok_order_id, brand: 'tiktok' };
      }
      amount = { label: '\u0e22\u0e2d\u0e14\u0e1a\u0e34\u0e25', value: fmtTHB(order.grand_total) };
      status = orderStatusLabel(order);
      sections.push(section('\u0e02\u0e32\u0e22', 'receipt', [
        row('credit-card', '\u0e0a\u0e33\u0e23\u0e30', getPaymentMethodLabel(order.payment_method)),
        row('receipt', '\u0e1a\u0e34\u0e25 POS', `#${order.id}`, { mono: true }),
        row('calendar', '\u0e27\u0e31\u0e19\u0e17\u0e35\u0e02\u0e32\u0e22', fmtDateTime(order.sale_date)),
        row('check', '\u0e2a\u0e16\u0e32\u0e19\u0e30', status),
        row('box', '\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23', lineSummary),
      ]));
    }
  }

  if (kind === 'receive') {
    const { order, line } = payload || {};
    lineSummary = lineQtyPrice(line);
    if (!order) {
      note = '\u0e44\u0e21\u0e48\u0e1e\u0e1a\u0e1a\u0e34\u0e25\u0e23\u0e31\u0e1a\u0e40\u0e02\u0e49\u0e32';
    } else {
      amount = { label: '\u0e22\u0e2d\u0e14\u0e1a\u0e34\u0e25', value: fmtTHB(order.total_value) };
      status = orderStatusLabel(order);
      const via = RECEIVE_VIA_META[order.created_via];
      sections.push(section('\u0e1c\u0e39\u0e49\u0e08\u0e33\u0e2b\u0e19\u0e48\u0e32\u0e22', 'shop-bag', [
        row('shop-bag', '\u0e0a\u0e37\u0e48\u0e2d', dash(order.supplier_name), { emphasize: true }),
      ]));
      sections.push(section('\u0e40\u0e2d\u0e01\u0e2a\u0e32\u0e23', 'file', [
        row('file', '\u0e43\u0e1a\u0e41\u0e08\u0e49\u0e07\u0e2b\u0e19\u0e35\u0e49', dash(order.supplier_invoice_no), { mono: true }),
        row('receipt', '\u0e40\u0e2d\u0e01\u0e2a\u0e32\u0e23\u0e0b\u0e37\u0e49', dash(order.purchase_doc_no), { mono: true }),
        row('receipt', '\u0e1a\u0e34\u0e25\u0e23\u0e31\u0e1a\u0e40\u0e02\u0e49\u0e32', `#${order.id}`, { mono: true }),
        row('calendar', '\u0e27\u0e31\u0e19\u0e17\u0e35\u0e23\u0e31\u0e1a', fmtDateTime(order.receive_date)),
        row(via?.icon || 'store', '\u0e0a\u0e48\u0e2d\u0e07\u0e17\u0e32\u0e07', via?.label || order.created_via),
        row('check', '\u0e2a\u0e16\u0e32\u0e19\u0e30', status),
        row('box', '\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23', lineSummary),
      ]));
    }
  }

  if (kind === 'return') {
    const { order, line, origSale } = payload || {};
    lineSummary = lineQtyPrice(line);
    if (!order) {
      note = '\u0e44\u0e21\u0e48\u0e1e\u0e1a\u0e1a\u0e34\u0e25\u0e23\u0e31\u0e1a\u0e04\u0e37\u0e19';
    } else {
      channelProp = order.channel;
      channelOrder = origSale || { channel: order.channel };
      if (origSale?.tiktok_order_id) {
        highlight = { label: 'TikTok', value: origSale.tiktok_order_id, brand: 'tiktok' };
      }
      status = orderStatusLabel(order);
      sections.push(section('\u0e23\u0e31\u0e1a\u0e04\u0e37\u0e19', 'package-in', [
        row('tag', '\u0e40\u0e2b\u0e15\u0e38\u0e1c\u0e25', dash(order.return_reason)),
        row('box', '\u0e02\u0e2d\u0e07\u0e04\u0e37\u0e19\u0e40\u0e02\u0e49\u0e32\u0e2a\u0e15\u0e47\u0e2d\u0e01', order.goods_returned === false ? '\u0e44\u0e21\u0e48 (\u0e02\u0e2d\u0e07\u0e2b\u0e32\u0e22)' : '\u0e43\u0e0a\u0e48'),
        row('receipt', '\u0e1a\u0e34\u0e25\u0e23\u0e31\u0e1a\u0e04\u0e37\u0e19', `#${order.id}`, { mono: true }),
        row('calendar', '\u0e27\u0e31\u0e19\u0e17\u0e35', fmtDateTime(order.return_date)),
        row('check', '\u0e2a\u0e16\u0e32\u0e19\u0e30', status),
        row('box', '\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23', lineSummary),
      ]));
    }
  }

  if (kind === 'claim') {
    const { order, line } = payload || {};
    lineSummary = lineQtyPrice(line);
    if (!order) {
      note = '\u0e44\u0e21\u0e48\u0e1e\u0e1a\u0e1a\u0e34\u0e25\u0e2a\u0e48\u0e07\u0e40\u0e04\u0e25\u0e21';
    } else {
      status = orderStatusLabel(order);
      sections.push(section('\u0e2a\u0e48\u0e07\u0e40\u0e04\u0e25\u0e21', 'package-out', [
        row('shop-bag', '\u0e1c\u0e39\u0e49\u0e08\u0e33\u0e2b\u0e19\u0e48\u0e32\u0e22', dash(order.supplier_name), { emphasize: true }),
        row('file', '\u0e43\u0e1a\u0e41\u0e08\u0e49\u0e07\u0e2b\u0e19\u0e35\u0e49', dash(order.supplier_invoice_no), { mono: true }),
        row('tag', '\u0e40\u0e2b\u0e15\u0e38\u0e1c\u0e25', dash(order.claim_reason)),
        row('receipt', '\u0e40\u0e2d\u0e01\u0e2a\u0e32\u0e23\u0e40\u0e04\u0e25\u0e21', dash(order.claim_doc_no), { mono: true }),
        row('receipt', '\u0e1a\u0e34\u0e25', `#${order.id}`, { mono: true }),
        row('calendar', '\u0e27\u0e31\u0e19\u0e17\u0e35', fmtDateTime(order.claim_date)),
        row('check', '\u0e2a\u0e16\u0e32\u0e19\u0e30', status),
        row('box', '\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23', lineSummary),
      ]));
    }
  }

  if (kind === 'manual') {
    const manual = parseManualAdjustNotes(movement?.notes);
    sections.push(section('\u0e1b\u0e23\u0e31\u0e1a\u0e2a\u0e15\u0e47\u0e2d\u0e01', 'bulk-adjust', [
      row('tag', '\u0e40\u0e2b\u0e15\u0e38\u0e1c\u0e25', manual.subreasonLabel),
      row('edit', '\u0e2b\u0e21\u0e32\u0e22\u0e40\u0e2b\u0e15\u0e38', manual.note),
    ]));
  }

  if (kind === 'reconcile') {
    sections.push(section('TikTok reconcile', 'tag', [
      row('receipt', 'Reconcile', movement?.ref_id ? `#${movement.ref_id}` : null, { mono: true }),
      row('edit', '\u0e2b\u0e21\u0e32\u0e22\u0e40\u0e2b\u0e15\u0e38', movement?.notes),
    ]));
  }

  return {
    hero,
    channelOrder,
    channelProp,
    highlight,
    amount,
    lineSummary,
    status,
    sections: sections.filter(Boolean),
    note,
  };
}


export const STOCK_HISTORY_UI = {
  panelTitle: '\u0e1b\u0e23\u0e30\u0e27\u0e31\u0e15\u0e34\u0e2a\u0e15\u0e47\u0e2d\u0e01',
  itemCountSuffix: '\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23',
  loading: '\u0e01\u0e33\u0e25\u0e31\u0e07\u0e42\u0e2b\u0e25\u0e14...',
  empty: '\u0e22\u0e31\u0e07\u0e44\u0e21\u0e48\u0e21\u0e35\u0e1b\u0e23\u0e30\u0e27\u0e31\u0e15\u0e34',
  viewDetail: '\u0e14\u0e39\u0e23\u0e32\u0e22\u0e25\u0e30\u0e40\u0e2d\u0e35\u0e22\u0e14',
};

export const STOCK_DETAIL_UI = {
  titlePrefix: '\u0e23\u0e32\u0e22\u0e25\u0e30\u0e40\u0e2d\u0e35\u0e22\u0e14',
  titleSep: '\u2014',
  close: '\u0e1b\u0e34\u0e14',
  loading: '\u0e01\u0e33\u0e25\u0e31\u0e07\u0e42\u0e2b\u0e25\u0e14\u0e23\u0e32\u0e22\u0e25\u0e30\u0e40\u0e2d\u0e35\u0e22\u0e14...',
  empty: '\u0e44\u0e21\u0e48\u0e21\u0e35\u0e23\u0e32\u0e22\u0e25\u0e30\u0e40\u0e2d\u0e35\u0e22\u0e14\u0e40\u0e1e\u0e34\u0e48\u0e21\u0e40\u0e15\u0e34\u0e21',
  loadError: '\u0e42\u0e2b\u0e25\u0e14\u0e23\u0e32\u0e22\u0e25\u0e30\u0e40\u0e2d\u0e35\u0e22\u0e14\u0e44\u0e21\u0e48\u0e2a\u0e33\u0e40\u0e23\u0e47\u0e08',
  balanceLabel: '\u0e04\u0e07\u0e40\u0e2b\u0e25\u0e37\u0e2d\u0e2b\u0e25\u0e31\u0e07',
};
