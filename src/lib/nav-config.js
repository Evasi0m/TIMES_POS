// App navigation config + role-based visibility filter.
//
// Visibility model (3-tier):
//   super_admin → sees everything, all nav items enabled
//   admin       → sees everything, all nav items enabled (DB also allows it)
//   visitor     → sees ALL nav items, but only `products` is clickable;
//                 the rest render disabled (greyed out, click is a no-op)
//
// `adminOnly` views (receive, dashboard) expose cost/profit data and
// supplier pricing — the DB also enforces this via RLS. The client filter
// here is just to keep the UI clean; never trust it alone for security.

export const NAV = [
  { k: 'pos',       label: 'ขาย',     labelLong: 'ขายสินค้า',        icon: 'cart' },
  { k: 'products',  label: 'สินค้า',  labelLong: 'สินค้า',           icon: 'box' },
  { k: 'sales',     label: 'ประวัติ', labelLong: 'ประวัติการขาย',    icon: 'receipt' },
  { k: 'receive',   label: 'รับเข้า', labelLong: 'รับสินค้าจากบริษัท', icon: 'arrow-up',  adminOnly: true },
  { k: 'return',    label: 'รับคืน',  labelLong: 'รับคืนจากลูกค้า',   icon: 'arrow-down' },
  { k: 'dashboard', label: 'ภาพรวม',  labelLong: 'แดชบอร์ด',         icon: 'dashboard', adminOnly: true },
  // P&L was previously a top-level nav entry; it now lives as a tab
  // inside OverviewView ("กำไรขาดทุน") so admins manage all reporting
  // from a single page.
];

// The single view a visitor is allowed to navigate to. Used both by the
// nav-disable logic below and by the App shell to redirect any other
// view back to safety.
export const VISITOR_VIEW = 'products';

// True if role can navigate to this nav item.
// - admin/super_admin: every item allowed (DB enforces deeper)
// - visitor: only the `VISITOR_VIEW` item; everything else is shown
//   in the bar but renders disabled (greyed, click no-ops) so the
//   visitor still sees the menu shape, just can't enter.
export const canNavigate = (role, item) => {
  if (role === 'super_admin' || role === 'admin') return true;
  return item.k === VISITOR_VIEW;
};

// Returns the nav items the given role should *see* in the sidebar.
// Visitor sees the full list (so the UI conveys "these exist but are
// locked"), but `canNavigate` decides which ones are interactive.
export const navForRole = (role) => {
  if (role === 'visitor') return NAV;
  // admin / super_admin — every item (no filtering needed since the
  // current NAV's adminOnly items are all admin+ accessible).
  return NAV.filter((it) => !it.adminOnly || role === 'admin' || role === 'super_admin');
};
