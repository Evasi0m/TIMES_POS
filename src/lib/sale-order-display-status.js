/** Display status codes for sale order list badges (one badge per row). */
import {
  RESOLUTION_KIND,
  STOCK_RESOLUTION,
} from './tiktok-stock-resolution.js';

export const DISPLAY_STATUS = {
  CANCELLED: 'cancelled',
  CANCELLED_TIKTOK: 'cancelled_tiktok',
  TIKTOK_AWAITING_RETURN: 'tiktok_awaiting_return',
  TIKTOK_RETURNED: 'tiktok_returned',
  TIKTOK_RETURN_LOST: 'tiktok_return_lost',
  TIKTOK_CANCEL_PRE_SHIP: 'tiktok_cancel_pre_ship',
  PENDING_CONFIRM: 'pending_confirm',
  SUBSTITUTION: 'substitution',
  PENDING_PRICE: 'pending_price',
  EDITED: 'edited',
  NORMAL: 'normal',
};

function isTikTokChannel(order) {
  return order?.channel === 'tiktok' && order?.tiktok_order_id;
}

function resolveVoidedTikTokStatus(order) {
  const res = order.stock_resolution;
  const kind = order.tiktok_resolution_kind;

  if (res === STOCK_RESOLUTION.AWAITING) {
    const label = kind === RESOLUTION_KIND.CANCEL_PRE_SHIP
      ? 'ยกเลิกก่อนส่ง'
      : 'รอตีกลับ';
    return {
      code: DISPLAY_STATUS.TIKTOK_AWAITING_RETURN,
      label,
      title: 'รอยืนยันว่าได้รับสินค้าคืนหรือของหาย',
      tone: 'amber',
    };
  }

  if (res === STOCK_RESOLUTION.RESTOCKED) {
    if (kind === RESOLUTION_KIND.CANCEL_PRE_SHIP) {
      return {
        code: DISPLAY_STATUS.TIKTOK_CANCEL_PRE_SHIP,
        label: 'ยกเลิกก่อนส่ง',
        title: 'ยกเลิกก่อนส่ง — ได้รับของคืนแล้ว',
        tone: 'teal',
      };
    }
    return {
      code: DISPLAY_STATUS.TIKTOK_RETURNED,
      label: 'ได้ของคืนแล้ว',
      title: 'บันทึกรับคืนและบวกสต็อกแล้ว',
      tone: 'green',
    };
  }

  if (res === STOCK_RESOLUTION.LOST) {
    return {
      code: DISPLAY_STATUS.TIKTOK_RETURN_LOST,
      label: 'ตีกลับ (ของหาย)',
      title: 'บันทึกเงินคืนโดยไม่บวกสต็อก',
      tone: 'amber',
    };
  }

  const reason = String(order.void_reason || '').toLowerCase();
  const tiktokCancel = reason.includes('tiktok') && (
    reason.includes('cancel') || reason.includes('return')
  );
  return {
    code: tiktokCancel ? DISPLAY_STATUS.CANCELLED_TIKTOK : DISPLAY_STATUS.CANCELLED,
    label: tiktokCancel ? 'ยกเลิก TikTok' : 'ยกเลิก',
    title: order.void_reason || 'ยกเลิกแล้ว',
    tone: tiktokCancel ? 'tiktok_red' : 'red',
  };
}

/**
 * Resolve a single display status for a sale_orders row.
 * Priority: voided > pending > substitution > pending_price > edited > normal
 */
export function resolveSaleOrderDisplayStatus(order, opts = {}) {
  if (!order) return null;

  if (order.status === 'voided') {
    if (isTikTokChannel(order)) {
      return resolveVoidedTikTokStatus(order);
    }
    return {
      code: DISPLAY_STATUS.CANCELLED,
      label: 'ยกเลิก',
      title: order.void_reason || 'ยกเลิกแล้ว',
      tone: 'red',
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
