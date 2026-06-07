// E-Commerce navigation — platform group (sidebar) + TikTok section pages.

export const ECOMMERCE_PLATFORMS = [
  { k: 'tiktok', label: 'TikTok', brand: 'tiktok', defaultView: 'ecommerce-tiktok-orders' },
  { k: 'shopee', label: 'Shopee', brand: 'shopee', defaultView: 'ecommerce-shopee' },
  { k: 'lazada', label: 'Lazada', brand: 'lazada', defaultView: 'ecommerce-lazada' },
];

export const TIKTOK_SECTIONS = [
  { k: 'orders',   label: 'ออเดอร์ & Label',    view: 'ecommerce-tiktok-orders' },
  { k: 'invoices', label: 'ใบกำกับภาษี',         view: 'ecommerce-tiktok-invoices' },
  { k: 'returns',  label: 'คืนเงิน/คืนสินค้า',   view: 'ecommerce-tiktok-returns' },
  { k: 'matching', label: 'จับคู่สินค้า',        view: 'ecommerce-tiktok-matching', superAdminOnly: true },
];

/** TikTok sub-tabs visible for the current role. */
export function tiktokSectionsForRole(isSuperAdmin) {
  return TIKTOK_SECTIONS.filter(s => !s.superAdminOnly || isSuperAdmin);
}

export const ECOMMERCE_VIEWS = [
  ...TIKTOK_SECTIONS.map((s) => s.view),
  'ecommerce-shopee',
  'ecommerce-lazada',
];

export const ECOMMERCE_DEFAULT_VIEW = 'ecommerce-tiktok-orders';

export function isEcommerceView(view) {
  return view === 'ecommerce' || ECOMMERCE_VIEWS.includes(view);
}

export function parseEcommerceView(view) {
  if (view === 'ecommerce-shopee') return { platform: 'shopee', section: null };
  if (view === 'ecommerce-lazada') return { platform: 'lazada', section: null };
  if (view === 'ecommerce' || view === 'ecommerce-tiktok') {
    return { platform: 'tiktok', section: 'orders' };
  }
  if (view.startsWith('ecommerce-tiktok-')) {
    return { platform: 'tiktok', section: view.slice('ecommerce-tiktok-'.length) || 'orders' };
  }
  return { platform: 'tiktok', section: 'orders' };
}

export function ecommercePlatformActive(view, platformKey) {
  return parseEcommerceView(view).platform === platformKey;
}

export function ecommercePageMeta(view) {
  const { platform, section } = parseEcommerceView(view);
  if (platform === 'shopee') return { title: 'Shopee', subtitle: 'E-Commerce' };
  if (platform === 'lazada') return { title: 'Lazada', subtitle: 'E-Commerce' };
  const sec = TIKTOK_SECTIONS.find((s) => s.k === section);
  return { title: 'TikTok Shop', subtitle: sec?.label ?? 'ออเดอร์ & Label' };
}

/** All routable view keys for a role's nav (includes E-Commerce sub-pages). */
export function routableViews(role, navItems) {
  return navItems.flatMap((it) => (
    it.k === 'ecommerce' ? ECOMMERCE_VIEWS : [it.k]
  ));
}
