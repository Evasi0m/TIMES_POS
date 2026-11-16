// Role-based permissions — the single catalog the app and the DB share.
//
// Model:
//   super_admin → everything, always. Not editable (the owner can never
//                 lock themself out). Also the only role that manages users
//                 and edits this table.
//   admin / staff / visitor → a set of permission keys, editable by the
//                 super admin in "การตั้งค่า user → สิทธิ์ตามบทบาท".
//                 Stored in public.role_permissions (migration 086).
//
// The DB enforces the same keys through public.has_perm() — in RPC guards,
// RLS policies and edge functions — so hiding a button here is UX only;
// the server refuses the action anyway.
//
// Pure module (no React / Supabase) so it is unit-testable.

/** Roles whose permissions can be edited. super_admin is implicit "all". */
export const EDITABLE_ROLES = ['admin', 'staff', 'visitor'];

export const ROLE_META = {
  super_admin: { label: 'Super Admin', tone: 'text-warning',
    hint: 'ทำได้ทุกอย่าง + จัดการผู้ใช้และสิทธิ์ (แก้ไขไม่ได้)' },
  admin: { label: 'Admin', tone: 'text-primary',
    hint: 'ดูแลร้าน — สิทธิ์ปรับได้ในแท็บ "สิทธิ์ตามบทบาท"' },
  staff: { label: 'พนักงาน', tone: 'text-success',
    hint: 'ค่าเริ่มต้น: ดูข้อมูลขาย/ออเดอร์ได้ แก้ไขหรือยืนยันอะไรไม่ได้' },
  visitor: { label: 'Visitor', tone: 'text-muted-soft',
    hint: 'ค่าเริ่มต้น: ดูสินค้าและราคาลูกค้าได้อย่างเดียว' },
};

export const ROLE_IDS = ['super_admin', ...EDITABLE_ROLES];

/**
 * Permission catalog, grouped for the editor. `key` must match the keys the
 * DB checks (has_perm) — see supabase-migrations/086_role_permissions.sql.
 */
export const PERMISSION_GROUPS = [
  {
    id: 'view', label: 'หน้าที่เข้าได้',
    perms: [
      { key: 'view.pos',            label: 'หน้าขาย (POS)', hint: 'เห็นหน้าขายและคิวออเดอร์ TikTok รอยืนยัน' },
      { key: 'view.products',       label: 'หน้าสินค้า' },
      { key: 'view.customer_price', label: 'หน้าราคาลูกค้า' },
      { key: 'view.sales',          label: 'ประวัติการขาย' },
      { key: 'view.receive',        label: 'หน้ารับเข้า', hint: 'รวมประวัติรับเข้าและเคลม — มีราคาทุนจากบริษัท' },
      { key: 'view.return',         label: 'หน้ารับคืน' },
      { key: 'view.dashboard',      label: 'ภาพรวม / กำไรขาดทุน / ภาษี', hint: 'มียอดขาย ต้นทุน และกำไร' },
      { key: 'view.ecommerce',      label: 'E-Commerce (ออเดอร์ TikTok)' },
    ],
  },
  {
    id: 'pos', viewKey: 'view.pos', label: 'การขาย',
    perms: [
      { key: 'pos.sell',            label: 'ขายสินค้า / ออกบิล' },
      { key: 'pos.tiktok_confirm',  label: 'ยืนยันออเดอร์ TikTok', hint: 'ตัดสต็อก ออกเลขใบกำกับ และจับคู่ SKU ตอนยืนยัน' },
      { key: 'pos.tiktok_resolve',  label: 'ยืนยันของตีกลับ TikTok', hint: 'เลือกว่าของกลับเข้าร้านหรือหาย' },
    ],
  },
  {
    id: 'sales', viewKey: 'view.sales', label: 'ประวัติการขาย',
    perms: [
      { key: 'sales.edit',          label: 'แก้ไขบิลขาย' },
      { key: 'sales.void',          label: 'ยกเลิกบิลขาย' },
      { key: 'sales.tax_invoice',   label: 'ออกใบกำกับภาษี' },
      { key: 'sales.net_received',  label: 'ใส่ยอดเงินที่ได้รับจริง', hint: 'บิล e-commerce / paylater ที่รอยอด' },
    ],
  },
  {
    id: 'products', viewKey: 'view.products', label: 'สินค้า',
    perms: [
      { key: 'products.view_cost',      label: 'เห็นราคาทุน / กำไร' },
      { key: 'products.edit',           label: 'เพิ่ม / แก้ไขสินค้า', hint: 'หน้าแก้ไขสินค้าแสดงราคาทุนด้วย' },
      { key: 'products.delete',         label: 'ลบสินค้า' },
      { key: 'products.stock_adjust',   label: 'ปรับสต็อกเอง' },
      { key: 'products.export',         label: 'ดาวน์โหลด CSV สต็อก' },
      { key: 'products.tiktok_mapping', label: 'เปลี่ยน / ยกเลิกจับคู่ TikTok' },
    ],
  },
  {
    id: 'receive', viewKey: 'view.receive', label: 'รับเข้า',
    perms: [
      { key: 'receive.create', label: 'รับสินค้า / เคลมคืนบริษัท', hint: 'รวม AI สแกนบิลและสร้างสินค้าใหม่ตอนรับเข้า' },
      { key: 'receive.void',   label: 'ยกเลิกบิลรับเข้า / เคลม' },
      { key: 'receive.edit',   label: 'แก้ไขบิลรับเข้าทั้งใบ / ลบรายการ', hint: 'สต็อกปรับตามส่วนต่างและ sync ไป TikTok' },
      { key: 'receive.claim_edit', label: 'แก้ไขหัวบิลเคลม', hint: 'วันที่ ผู้ขาย เลขบิล เหตุผล หมายเหตุ' },
      { key: 'receive.docs',   label: 'ออกเอกสารรับเข้า / ใบเคลม' },
    ],
  },
  {
    id: 'return', viewKey: 'view.return', label: 'รับคืน',
    perms: [
      { key: 'return.create',      label: 'รับคืนจากลูกค้า' },
      { key: 'return.edit',        label: 'แก้ไขหัวบิลรับคืน', hint: 'วันที่ ช่องทาง เหตุผล บิลขายเดิม หมายเหตุ' },
      { key: 'return.void',        label: 'ยกเลิกบิลรับคืน' },
      { key: 'return.credit_note', label: 'ออกใบลดหนี้' },
    ],
  },
  {
    id: 'dashboard', viewKey: 'view.dashboard', label: 'ภาพรวม',
    perms: [
      { key: 'dashboard.expenses',  label: 'แก้ค่าใช้จ่ายร้าน' },
      { key: 'dashboard.anomalies', label: 'แท็บรายการผิดปกติ' },
    ],
  },
  {
    id: 'ecommerce', viewKey: 'view.ecommerce', label: 'E-Commerce',
    perms: [
      { key: 'ecommerce.sync',            label: 'ดึงออเดอร์ใหม่ / sync' },
      { key: 'ecommerce.ship',            label: 'จัดส่ง / พิมพ์ใบปะหน้า' },
      { key: 'ecommerce.invoices',        label: 'ออกใบกำกับภาษีหลายบิล' },
      { key: 'ecommerce.returns',         label: 'คืนสินค้า / ใบลดหนี้ TikTok' },
      { key: 'ecommerce.matching',        label: 'จับคู่สินค้า TikTok' },
      { key: 'ecommerce.stock_reconcile', label: 'เช็ค / ปรับสต็อก TikTok' },
    ],
  },
  {
    id: 'settings', label: 'ตั้งค่า',
    perms: [
      { key: 'settings.shop',           label: 'ข้อมูลร้าน' },
      { key: 'settings.paylater',       label: 'สูตรคำนวณ paylater / COD' },
      { key: 'settings.customer_price', label: 'สูตรราคาลูกค้า' },
      { key: 'settings.ai',             label: 'AI สแกนบิล / ดึงรูปสินค้า' },
      { key: 'settings.telegram',       label: 'Telegram' },
      { key: 'settings.tiktok',         label: 'เชื่อมต่อ / ซ่อม TikTok' },
      { key: 'audit.view',              label: 'ดูประวัติระบบ', hint: 'ประวัติ export, ปรับสต็อก, ลบ และแก้บิล' },
    ],
  },
];

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap(g => g.perms.map(p => p.key));
const KNOWN = new Set(ALL_PERMISSIONS);

const allTrue = (except = []) => Object.fromEntries(
  ALL_PERMISSIONS.map(k => [k, !except.includes(k)]),
);
const only = (keys) => Object.fromEntries(ALL_PERMISSIONS.map(k => [k, keys.includes(k)]));

/**
 * Defaults = what each role could do before roles became editable, so the
 * switch changes nothing for existing users. Mirrored in migration 086.
 */
export const DEFAULT_ROLE_PERMISSIONS = Object.freeze({
  admin: allTrue([
    // super_admin-only before 086
    'products.delete', 'products.stock_adjust', 'receive.edit',
    'ecommerce.matching', 'ecommerce.stock_reconcile', 'dashboard.anomalies',
    'settings.telegram', 'settings.ai', 'settings.paylater',
    'settings.customer_price', 'audit.view',
  ]),
  staff: only([
    'view.pos', 'view.products', 'view.customer_price', 'view.sales',
    'view.return', 'view.ecommerce',
  ]),
  visitor: only(['view.products', 'view.customer_price']),
});

/** Keep only known keys with boolean values; missing keys → false. */
export function normalizePermissions(raw) {
  const out = {};
  for (const k of ALL_PERMISSIONS) out[k] = raw?.[k] === true;
  return out;
}

/**
 * Effective permission map for a user.
 * `rolePerms` is the row from role_permissions (or null when not loaded →
 * fall back to the role's defaults so the UI never flashes everything on).
 */
export function effectivePermissions(role, rolePerms) {
  if (role === 'super_admin') return allTrue();
  if (!EDITABLE_ROLES.includes(role)) return normalizePermissions(null);
  return normalizePermissions(rolePerms ?? DEFAULT_ROLE_PERMISSIONS[role]);
}

/**
 * `can(perms, 'a')` or `can(perms, 'a|b')` (any of). Unknown keys are false
 * so a typo fails closed.
 */
export function can(perms, keys) {
  if (!perms || !keys) return false;
  return String(keys).split('|').some(k => KNOWN.has(k) && perms[k] === true);
}

export function isKnownPermission(key) {
  return KNOWN.has(key);
}

/**
 * Groups whose actions are switched on while the page they live on is off —
 * those actions can't be reached in the app. For the editor's warnings.
 */
export function groupsMissingView(perms) {
  return PERMISSION_GROUPS.filter(g =>
    g.viewKey
    && perms?.[g.viewKey] !== true
    && g.perms.some(p => perms?.[p.key] === true),
  ).map(g => g.id);
}

/** Label of a permission key, for messages. */
export function permissionLabel(key) {
  for (const g of PERMISSION_GROUPS) {
    const p = g.perms.find(x => x.key === key);
    if (p) return p.label;
  }
  return key;
}
