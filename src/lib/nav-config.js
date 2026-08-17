// App navigation config + role-based visibility filter.
//
// Visibility model (3-tier):
//   super_admin → sees everything, all nav items enabled
//   admin       → sees everything, all nav items enabled (DB also allows it)
//   visitor     → sees nav items except E-Commerce (hidden); only `products`
//                 and `customer-price` are clickable — the rest render disabled
//
// `adminOnly` views (receive, dashboard) expose cost/profit data and
// supplier pricing — the DB also enforces this via RLS. The client filter
// here is just to keep the UI clean; never trust it alone for security.

export const NAV = [
  { k: 'pos',              label: 'ขาย',         labelLong: 'ขายสินค้า',        icon: 'cart' },
  { k: 'products',         label: 'สินค้า',      labelLong: 'สินค้า',           icon: 'box' },
  { k: 'customer-price',   label: 'ราคาลูกค้า',  labelLong: 'ราคาลูกค้า',       icon: 'tag' },
  { k: 'sales',            label: 'ประวัติ',     labelLong: 'ประวัติการขาย',    icon: 'receipt' },
  { k: 'receive',   label: 'รับเข้า', labelLong: 'รับสินค้าจากบริษัท', icon: 'arrow-up',  adminOnly: true, ai: true },
  { k: 'return',    label: 'รับคืน',  labelLong: 'รับคืนจากลูกค้า',   icon: 'arrow-down' },
  { k: 'dashboard', label: 'ภาพรวม',  labelLong: 'แดชบอร์ด',         icon: 'dashboard', adminOnly: true },
  { k: 'ecommerce', label: 'E-Comm',  labelLong: 'E-Commerce',       icon: 'shop-bag',  adminOnly: true },
  // P&L was previously a top-level nav entry; it now lives as a tab
  // inside OverviewView ("กำไรขาดทุน") so admins manage all reporting
  // from a single page.
];

// The single view a visitor is allowed to navigate to. Used both by the
// nav-disable logic below and by the App shell to redirect any other
// view back to safety.
export const VISITOR_VIEW = 'products';
export const VISITOR_VIEWS = ['products', 'customer-price'];

// True if role can navigate to this nav item.
// - admin/super_admin: every item allowed (DB enforces deeper)
// - visitor: products + customer-price (floor lookup, no cost shown);
//   adminOnly items (receive, dashboard) show locked; E-Commerce is hidden.
export const canNavigate = (role, item) => {
  if (role === 'super_admin' || role === 'admin') return true;
  if (item.adminOnly) return false;
  return VISITOR_VIEWS.includes(item.k);
};

// Returns the nav items the given role should *see* in the sidebar.
export const navForRole = (role) => {
  if (role === 'visitor') return NAV.filter(it => it.k !== 'ecommerce');
  return NAV.filter((it) => !it.adminOnly || role === 'admin' || role === 'super_admin');
};
