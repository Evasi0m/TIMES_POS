// Map raw Supabase / Postgres errors to friendly Thai text shown in toasts.
// We always return SOMETHING readable — if we can't classify the error we
// fall back to err.message so a sysadmin reading the screenshot can still
// debug it. Never just say "Error" with no detail.
//
// Pattern: each rule either matches against the postgres error code
// (`23505` for unique violation, `23503` for FK, `42501` for permission
// denied / RLS, etc.) or a substring of err.message. Order matters —
// more-specific rules go first.

const RULES = [
  // === RLS / auth =========================================================
  { match: (e) => e?.code === '42501' || /row-level security/i.test(e?.message || ''),
    text: 'ไม่มีสิทธิ์ทำรายการนี้ (admin only)' },
  { match: (e) => /JWT expired|invalid JWT|jwt is expired/i.test(e?.message || ''),
    text: 'เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่' },
  { match: (e) => /Invalid login credentials/i.test(e?.message || ''),
    text: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' },
  { match: (e) => /User already registered/i.test(e?.message || ''),
    text: 'อีเมลนี้ถูกใช้แล้ว' },
  { match: (e) => /Password should be at least/i.test(e?.message || ''),
    text: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' },

  // === Network ============================================================
  { match: (e) => /Failed to fetch|NetworkError|TypeError.*fetch/i.test(e?.message || ''),
    text: 'เน็ตไม่ตอบสนอง — บิลถูกบันทึกในคิวออฟไลน์แล้ว' },

  // === Postgres data integrity ============================================
  { match: (e) => e?.code === '23505',
    text: (e) => /barcode/i.test(e?.message || '')
      ? 'บาร์โค้ดนี้ถูกใช้แล้วกับสินค้าอื่น'
      : 'ข้อมูลซ้ำกับที่มีอยู่ในระบบ' },
  { match: (e) => e?.code === '23503',
    text: 'ไม่สามารถลบได้ — มีรายการอื่นอ้างถึงข้อมูลนี้' },
  { match: (e) => e?.code === '23502',
    text: 'กรอกข้อมูลไม่ครบ' },
  { match: (e) => e?.code === '23514',
    text: 'ค่าที่กรอกไม่ผ่านการตรวจสอบ' },

  // === Custom RPCs raise() ================================================
  { match: (e) => /insufficient stock/i.test(e?.message || ''),
    text: 'สต็อกไม่พอ' },
  { match: (e) => /sale already voided/i.test(e?.message || ''),
    text: 'บิลนี้ถูกยกเลิกไปแล้ว' },
];

/**
 * @param {Error|{code?:string,message?:string}|string} err
 * @returns {string} a Thai user-facing message
 */
export function mapError(err) {
  if (!err) return 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
  if (typeof err === 'string') return err;
  for (const rule of RULES) {
    if (rule.match(err)) {
      return typeof rule.text === 'function' ? rule.text(err) : rule.text;
    }
  }
  return err.message || String(err);
}
