// App navigation config + role-based visibility filter.
//
// `adminOnly` views are hidden from cashiers (P&L exposes cost/profit
// margins, dashboard exposes channel revenue, receive captures supplier
// pricing). The DB also enforces this via RLS — see
// `supabase-migrations/005_user_roles.sql`. The client filter is just to
// keep the UI clean; never trust it alone for authorization.

export const NAV = [
  { k: 'pos',       label: 'ขาย',     labelLong: 'ขายสินค้า',        icon: 'cart' },
  { k: 'products',  label: 'สินค้า',  labelLong: 'สินค้า',           icon: 'box' },
  { k: 'sales',     label: 'ประวัติ', labelLong: 'ประวัติการขาย',    icon: 'receipt' },
  { k: 'receive',   label: 'รับเข้า', labelLong: 'รับสินค้าจากบริษัท', icon: 'arrow-up',  adminOnly: true },
  { k: 'return',    label: 'รับคืน',  labelLong: 'รับคืนจากลูกค้า',   icon: 'arrow-down' },
  { k: 'dashboard', label: 'ภาพรวม',  labelLong: 'แดชบอร์ด',         icon: 'dashboard', adminOnly: true },
  { k: 'pnl',       label: 'กำไร',    labelLong: 'กำไร / ขาดทุน',    icon: 'trend-up',  adminOnly: true },
];

export const navForRole = (role) =>
  NAV.filter((it) => !it.adminOnly || role === 'admin');
