/** Display status codes for sale order list badges (one badge per row). */
export const DISPLAY_STATUS = {
  CANCELLED: 'cancelled',
  CANCELLED_TIKTOK: 'cancelled_tiktok',
  PENDING_CONFIRM: 'pending_confirm',
  SUBSTITUTION: 'substitution',
  PENDING_PRICE: 'pending_price',
  EDITED: 'edited',
  NORMAL: 'normal',
};

function isTikTokCancelVoid(order) {
  return order.channel === 'tiktok'
    && String(order.void_reason || '').toLowerCase().includes('cancel');
}

/**
 * Resolve a single display status for a sale_orders row.
 * Priority: voided > pending > substitution > pending_price > edited > normal
 *
 * @param {object|null} order — sale_orders row (may include has_substitution, has_edits)
 * @param {{ hasSubstitution?: boolean }} [opts] — fallback when DB column not yet deployed
 */
export function resolveSaleOrderDisplayStatus(order, opts = {}) {
  if (!order) return null;

  if (order.status === 'voided') {
    const tiktok = isTikTokCancelVoid(order);
    return {
      code: tiktok ? DISPLAY_STATUS.CANCELLED_TIKTOK : DISPLAY_STATUS.CANCELLED,
      label: tiktok ? 'ยกเลิก TikTok' : 'ยกเลิก',
      title: order.void_reason || 'ยกเลิกแล้ว',
      tone: tiktok ? 'tiktok_red' : 'red',
    };
  }

  if (order.status === 'pending') {
    return {
      code: DISPLAY_STATUS.PENDING_CONFIRM,
      label: 'รอยืนยัน',
      title: 'รอแคชเชียร์ยืนยันออเดอร์ TikTok',
      tone: 'amber',
    };
  }

  const hasSubstitution = order.has_substitution ?? opts.hasSubstitution ?? false;
  if (hasSubstitution) {
    return {
      code: DISPLAY_STATUS.SUBSTITUTION,
      label: 'ส่งคนละรุ่น',
      title: 'มีรายการส่งคนละรุ่นกับที่สั่งบน TikTok',
      tone: 'purple',
    };
  }

  if (order.net_received_pending) {
    return {
      code: DISPLAY_STATUS.PENDING_PRICE,
      label: 'รอใส่ราคา',
      title: 'ยังไม่ได้บันทึกเงินที่ร้านได้รับ',
      tone: 'orange',
    };
  }

  if (order.has_edits) {
    return {
      code: DISPLAY_STATUS.EDITED,
      label: 'แก้ไขแล้ว',
      title: 'บิลนี้เคยถูกแก้ไขหลังขาย',
      tone: 'teal',
    };
  }

  return {
    code: DISPLAY_STATUS.NORMAL,
    label: 'ปกติ',
    title: 'คำสั่งซื้อปกติ',
    tone: 'green',
  };
}
