/** Cashier-facing Thai copy — ยืนยันการขาย TikTok (plain language). */

export const TTC_COPY = {
  badgeLabel: 'ออเดอร์ TikTok รอยืนยัน',
  modalConfirmTitle: 'ยืนยันการขาย TikTok',
  colTiktok: 'บน TikTok',
  colStore: 'ในร้าน',

  stock: (n) => `คงเหลือ ${n}`,
  stockUnknown: 'ไม่ทราบจำนวนคงเหลือ',

  confirmMatch: 'ยืนยันการจับคู่',
  substLong: 'ส่งจริงคนละรุ่น — ลูกค้าตกลงรับรุ่น/สีนี้',
  substLongHint: 'ไม่จำการเลือกไว้ · ตัดสต็อกตามสินค้าในร้าน',
  substShort: 'ส่งคนละรุ่น',

  badgeOk: 'รุ่นตรงกัน',
  badgeMismatch: 'รุ่นไม่ตรง',
  badgeMatchConfirmed: 'จับคู่ยืนยันแล้ว',
  badgeSubstOk: 'ส่งคนละรุ่น',

  matchCallout: 'เลือกสินค้าในร้านที่จะตัดสต็อกจริง — ถ้ารุ่นไม่ตรง ให้เลือกยืนยันจับคู่หรือส่งจริงคนละรุ่น',
  pickOneOption: 'เลือกอย่างใดอย่างหนึ่งด้านล่าง',
  orDivider: 'หรือ',
  resolutionHint: 'เลือก ยืนยันการจับคู่ (รุ่นเดียวกัน) หรือ ส่งจริงคนละรุ่น (ลูกค้าตกลงเปลี่ยนรุ่/สี)',

  suffixSameModel: 'รุ่นเดียวกัน (ต่างรหัสท้ายจากตัวแทน)',
  substReadyReview: 'ส่งจริงคนละรุ่น — พร้อมไปตรวจสอบ',
  matchConfirmedAutofill: 'จับคู่ยืนยันแล้ว — ออเดอร์ถัดไปจะเติมให้อัตโนมัติ',
  matchConfirmedGeneric: 'จับคู่ยืนยันแล้ว — ผูกกับตะกร้า TikTok นี้',
  matchConfirmedSimple: 'ยืนยันการจับคู่แล้ว',

  stockShortfall: (stock, need) => `สต็อกในร้านไม่พอ — คงเหลือ ${stock} ต้องการ ${need}`,
  changeProduct: 'เปลี่ยนสินค้า',
  changeProductToMatch: 'เปลี่ยนสินค้าให้ตรงรุ่นที่สั่ง',

  reviewSubstHint: 'ตัดสต็อกตามสินค้าในร้าน · ไม่จำการเลือกไว้',
  reviewStockShortfall: (stock, need) => `สต็อกในร้านไม่พอ — คงเหลือ ${stock} ต้องการ ${need}`,

  toastMatchSaved: 'บันทึกแล้ว — ออเดอร์ถัดไปจะเลือกสินค้าให้อัตโนมัติ',
  toastMatchFailed: 'บันทึกการจับคู่ไม่สำเร็จ',

  stepPickHint: 'เลือกสินค้าในร้านที่จะตัดสต็อก — ถ้ารุ่นไม่ตรง ให้เลือกด้านล่าง',
  stepResolutionHint: 'เลือก ยืนยันการจับคู่ (รุ่นเดียวกัน) หรือ ส่งจริงคนละรุ่น (ลูกค้าตกลงเปลี่ยนรุ่/สี)',
  stepReviewHint: 'ตรวจแต่ละรายการ — ถ้าส่งคนละรุ่น ติ๊กยืนยันด้านล่าง',
  stepStockHint: 'มีรายการสต็อกไม่พอ — เปลี่ยนสินค้าหรือยกเลิกบน TikTok',
  stepNetHint: 'กรอกยอดเงินที่ TikTok โอนเข้าร้าน (หรือใส่ทีหลัง)',
  stepReadyHint: 'พร้อมยืนยัน — กดปุ่มด้านล่างเพื่อตัดสต็อก',

  actionGoReview: 'กด "ถัดไป → ตรวจสอบ" ก่อนยืนยันขาย',
  actionPickAll: 'เลือกสินค้าในร้านให้ครบทุกรายการก่อน',
  actionConfirmSale: 'ยืนยันการขาย · ตัดสต็อก',
  actionFixFirst: 'แก้รายการด้านบนก่อนยืนยัน',

  navMatchItems: (n) => `เลือกสินค้า · ${n} รายการ`,
  navPendingResolution: 'รอเลือก: ยืนยันรุ่น หรือ ส่งคนละรุ่น',
  navSubstOk: 'ส่งคนละรุ่นแล้ว',
  navMatchOk: 'จับคู่แล้ว',
  navModelOk: (stock) => `รุ่นตรงกัน · คงเหลือ ${stock}`,
  navWaitingPick: 'รอเลือกสินค้า',
  navStockShort: (stock) => `คงเหลือ ${stock ?? '?'} · ไม่พอ`,

  reviewBlockedResolution: 'มีรายการที่ยังไม่เลือก — ยืนยันจับคู่หรือส่งจริงคนละรุ่น',
  reviewBlockedStock: 'สต็อกไม่พอ — เปลี่ยนสินค้า',
  reviewAllClear: 'ตรวจครบแล้ว — กรอกเงินด้านล่าง',
  reviewBackToMatch: 'เลือกสินค้า',

  pickerAutoMatch: 'แนะนำอัตโนมัติ',
  pickerSearchPlaceholder: 'พิมพ์ชื่อ / บาร์โค้ด สินค้าในร้าน',
  pickerSearchCompact: 'พิมพ์ชื่อ / บาร์โค้ด',

  genericNoModel: 'TikTok ไม่ระบุรุ่นชัด (ค่าเริ่มต้น) — เลือกว่ารุ่นในร้านถูก หรือลูกค้าตกลงรับคนละรุ่น',
  codeClose: 'รหัสสินค้าใกล้เคียง — ตรวจสอบหรือเลือกด้านล่าง',
  modelMismatch: 'รุ่นที่สั่งกับในร้านไม่ตรง — ติ๊ก "ส่งจริงคนละรุ่น" ด้านล่าง',

  orderMatchedAll: 'จับคู่ครบแล้ว',
  orderUnmatched: (n) => `ยังไม่เลือก ${n}`,
};

export const TTC_TIER_LABEL = {
  exact: 'ตรงกัน',
  suffix: 'รุ่นเดียวกัน (รหัสท้ายต่าง)',
  prefix: 'รหัสใกล้เคียง',
  fuzzy: 'ชื่อคล้ายกัน',
};

/** @deprecated use TTC_TIER_LABEL */
export const TIER_LABEL = TTC_TIER_LABEL;

const DISPLAY_SKU_LABELS = new Set(['DEFAULT', 'STANDARD']);

/** User-facing label for TikTok sku key (e.g. DEFAULT → ค่าเริ่มต้น). */
export function displayTiktokSkuLabel(key) {
  const k = String(key || '').trim().toUpperCase();
  if (DISPLAY_SKU_LABELS.has(k)) return 'ค่าเริ่มต้น';
  if (!k || k === '—') return '—';
  return key;
}
