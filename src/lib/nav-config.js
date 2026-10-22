// App navigation config + permission-based visibility.
//
// Each item needs one `view.*` permission (see ./permissions.js):
//   - with it      → shown and clickable
//   - without it   → shown greyed out with a lock, so people know the page
//                    exists (E-Commerce is hidden instead: `hideWithoutPerm`)
//
// The DB enforces the same permissions (has_perm in RPCs / RLS); this filter
// only keeps the UI tidy — never rely on it alone for security.
import { can } from './permissions.js';

export const NAV = [
  { k: 'pos',            label: 'ขาย',         labelLong: 'ขายสินค้า',        icon: 'cart',      perm: 'view.pos' },
  { k: 'products',       label: 'สินค้า',      labelLong: 'สินค้า',           icon: 'box',       perm: 'view.products' },
  { k: 'customer-price', label: 'ราคาลูกค้า',  labelLong: 'ราคาลูกค้า',       icon: 'price-tag', perm: 'view.customer_price' },
  { k: 'sales',          label: 'ประวัติ',     labelLong: 'ประวัติการขาย',    icon: 'receipt',   perm: 'view.sales' },
  { k: 'receive',        label: 'รับเข้า',     labelLong: 'รับสินค้าจากบริษัท', icon: 'arrow-up', perm: 'view.receive', ai: true },
  { k: 'return',         label: 'รับคืน',      labelLong: 'รับคืนจากลูกค้า',   icon: 'arrow-down', perm: 'view.return' },
  { k: 'dashboard',      label: 'ภาพรวม',      labelLong: 'แดชบอร์ด',         icon: 'dashboard', perm: 'view.dashboard' },
  { k: 'ecommerce',      label: 'E-Comm',      labelLong: 'E-Commerce',       icon: 'shop-bag',  perm: 'view.ecommerce', hideWithoutPerm: true },
  // P&L lives as a tab inside OverviewView ("กำไรขาดทุน").
];

/** True when the user may open this nav item. */
export const canNavigate = (perms, item) => can(perms, item?.perm);

/** Items left out of the menu entirely (not just locked). */
export const isNavHidden = (perms, item) => Boolean(item?.hideWithoutPerm) && !canNavigate(perms, item);

/** Items to render in the sidebar / tab bar (locked ones included). */
export const navForRole = (perms) => NAV.filter(it => !isNavHidden(perms, it));

/** First page the user may open — where login lands and where a blocked view redirects. */
export function landingView(perms) {
  const first = NAV.find(it => canNavigate(perms, it));
  return first ? first.k : 'products';
}
