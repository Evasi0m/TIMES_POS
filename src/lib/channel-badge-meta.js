import { isApiImportedOrder } from './ecommerce-channels.js';

export const CHANNEL_LABELS = {
  store: 'หน้าร้าน',
  tiktok: 'TikTok',
  web: 'Web Shop',
  shopee: 'Shopee',
  lazada: 'Lazada',
  facebook: 'Facebook',
};

/** Resolve channel key for badge / icon display. */
export function channelKeyForOrder(order) {
  if (!order) return 'store';
  if (isApiImportedOrder(order)) return 'tiktok_api';
  return order.channel || 'store';
}

export function channelTitleForOrder(order) {
  if (isApiImportedOrder(order)) {
    return 'ดึงอัตโนมัติจาก TikTok Shop API — ไม่ต้องบันทึกซ้ำ';
  }
  const ch = order?.channel || 'store';
  return CHANNEL_LABELS[ch] || ch;
}

export function channelLabelForOrder(order) {
  if (isApiImportedOrder(order)) return 'TikTok API';
  const ch = order?.channel || 'store';
  return CHANNEL_LABELS[ch] || ch || '—';
}

/** Text pill styles (desktop / fallback). */
export function channelBadgeStyle(ch) {
  const base = {
    display: 'inline-block',
    fontSize: '12px',
    fontWeight: 500,
    padding: '4px 12px',
    borderRadius: '9999px',
    whiteSpace: 'nowrap',
    textAlign: 'center',
    minWidth: '80px',
    backdropFilter: 'blur(8px) saturate(140%)',
    WebkitBackdropFilter: 'blur(8px) saturate(140%)',
    lineHeight: 1.4,
  };
  const recipes = {
    store: {
      background: 'radial-gradient(circle at 14% 8%, rgba(76,175,80,0.18), transparent 34%), radial-gradient(circle at 90% 18%, rgba(129,199,132,0.16), transparent 32%), radial-gradient(circle at 50% 105%, rgba(232,245,233,0.50), transparent 44%), linear-gradient(135deg, rgba(200,230,201,0.92), rgba(165,214,167,0.78))',
      border: '1px solid rgba(76,175,80,0.35)',
      color: '#1b5e20',
      boxShadow: '0 1px 0 rgba(255,255,255,0.85) inset, 0 -1px 0 rgba(76,175,80,0.10) inset, 0 4px 14px -4px rgba(20,20,19,0.08)',
    },
    shopee: {
      background: 'radial-gradient(circle at 14% 8%, rgba(255,152,0,0.18), transparent 34%), radial-gradient(circle at 90% 18%, rgba(255,183,77,0.16), transparent 32%), radial-gradient(circle at 50% 105%, rgba(255,243,224,0.50), transparent 44%), linear-gradient(135deg, rgba(255,224,178,0.92), rgba(255,204,128,0.78))',
      border: '1px solid rgba(255,152,0,0.35)',
      color: '#e65100',
      boxShadow: '0 1px 0 rgba(255,255,255,0.85) inset, 0 -1px 0 rgba(255,152,0,0.10) inset, 0 4px 14px -4px rgba(20,20,19,0.08)',
    },
    lazada: {
      background: 'radial-gradient(circle at 14% 8%, rgba(63,81,181,0.18), transparent 34%), radial-gradient(circle at 90% 18%, rgba(121,134,203,0.16), transparent 32%), radial-gradient(circle at 50% 105%, rgba(232,234,246,0.50), transparent 44%), linear-gradient(135deg, rgba(197,202,233,0.92), rgba(159,168,218,0.78))',
      border: '1px solid rgba(63,81,181,0.35)',
      color: '#283593',
      boxShadow: '0 1px 0 rgba(255,255,255,0.85) inset, 0 -1px 0 rgba(63,81,181,0.10) inset, 0 4px 14px -4px rgba(20,20,19,0.08)',
    },
    tiktok: {
      background: 'radial-gradient(circle at 14% 8%, rgba(255,255,255,0.08), transparent 34%), radial-gradient(circle at 90% 18%, rgba(255,64,129,0.12), transparent 32%), radial-gradient(circle at 50% 105%, rgba(30,30,30,0.50), transparent 44%), linear-gradient(135deg, rgba(45,45,45,0.92), rgba(25,25,25,0.88))',
      border: '1px solid rgba(255,255,255,0.18)',
      color: '#ffffff',
      boxShadow: '0 1px 0 rgba(255,255,255,0.15) inset, 0 -1px 0 rgba(0,0,0,0.25) inset, 0 4px 14px -4px rgba(0,0,0,0.20)',
    },
    tiktok_api: {
      background: 'radial-gradient(circle at 12% 10%, rgba(254,44,85,0.38), transparent 38%), radial-gradient(circle at 88% 20%, rgba(255,80,120,0.22), transparent 34%), radial-gradient(circle at 50% 105%, rgba(30,30,30,0.52), transparent 44%), linear-gradient(135deg, rgba(58,28,36,0.94), rgba(28,22,26,0.90))',
      border: '1px solid rgba(254,44,85,0.42)',
      color: '#ffffff',
      boxShadow: '0 1px 0 rgba(255,255,255,0.14) inset, 0 -1px 0 rgba(254,44,85,0.22) inset, 0 4px 14px -4px rgba(254,44,85,0.28)',
    },
    web: {
      background: 'radial-gradient(circle at 14% 8%, rgba(224,122,95,0.20), transparent 34%), radial-gradient(circle at 90% 18%, rgba(244,194,178,0.18), transparent 32%), radial-gradient(circle at 50% 105%, rgba(255,248,243,0.52), transparent 44%), linear-gradient(135deg, rgba(255,235,228,0.94), rgba(250,210,195,0.82))',
      border: '1px solid rgba(224,122,95,0.38)',
      color: '#8b3a28',
      boxShadow: '0 1px 0 rgba(255,255,255,0.85) inset, 0 -1px 0 rgba(224,122,95,0.12) inset, 0 4px 14px -4px rgba(20,20,19,0.08)',
    },
    facebook: {
      background: 'radial-gradient(circle at 14% 8%, rgba(33,150,243,0.18), transparent 34%), radial-gradient(circle at 90% 18%, rgba(100,181,246,0.16), transparent 32%), radial-gradient(circle at 50% 105%, rgba(227,242,253,0.50), transparent 44%), linear-gradient(135deg, rgba(187,222,251,0.92), rgba(144,202,249,0.78))',
      border: '1px solid rgba(33,150,243,0.35)',
      color: '#1565c0',
      boxShadow: '0 1px 0 rgba(255,255,255,0.85) inset, 0 -1px 0 rgba(33,150,243,0.10) inset, 0 4px 14px -4px rgba(20,20,19,0.08)',
    },
  };
  return { ...base, ...(recipes[ch] || recipes.store) };
}
