/** Liquid-glass badge tones — dot / square / pill for order status. */

const GLASS_BASE = {
  display: 'inline-block',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  textAlign: 'center',
  backdropFilter: 'blur(8px) saturate(140%)',
  WebkitBackdropFilter: 'blur(8px) saturate(140%)',
  lineHeight: 1.35,
};

const GLASS_TONES = {
  purple: {
    background:
      'radial-gradient(circle at 14% 8%, rgba(156,39,176,0.18), transparent 34%), ' +
      'radial-gradient(circle at 90% 18%, rgba(186,104,200,0.16), transparent 32%), ' +
      'radial-gradient(circle at 50% 105%, rgba(243,229,245,0.50), transparent 44%), ' +
      'linear-gradient(135deg, rgba(225,190,231,0.92), rgba(206,147,216,0.78))',
    border: '1px solid rgba(156,39,176,0.35)',
    color: '#6a1b9a',
    boxShadow:
      '0 1px 0 rgba(255,255,255,0.85) inset, ' +
      '0 -1px 0 rgba(156,39,176,0.10) inset, ' +
      '0 4px 14px -4px rgba(20,20,19,0.08)',
  },
  red: {
    background:
      'radial-gradient(circle at 14% 8%, rgba(199,70,70,0.18), transparent 34%), ' +
      'radial-gradient(circle at 90% 18%, rgba(229,115,115,0.16), transparent 32%), ' +
      'radial-gradient(circle at 50% 105%, rgba(255,235,238,0.50), transparent 44%), ' +
      'linear-gradient(135deg, rgba(255,205,210,0.92), rgba(239,154,154,0.78))',
    border: '1px solid rgba(199,70,70,0.35)',
    color: '#b71c1c',
    boxShadow:
      '0 1px 0 rgba(255,255,255,0.85) inset, ' +
      '0 -1px 0 rgba(199,70,70,0.10) inset, ' +
      '0 4px 14px -4px rgba(20,20,19,0.08)',
  },
  tiktok_red: {
    background:
      'radial-gradient(circle at 12% 10%, rgba(254,44,85,0.28), transparent 38%), ' +
      'radial-gradient(circle at 88% 20%, rgba(255,80,120,0.18), transparent 34%), ' +
      'radial-gradient(circle at 50% 105%, rgba(255,235,238,0.48), transparent 44%), ' +
      'linear-gradient(135deg, rgba(255,205,210,0.92), rgba(239,154,154,0.78))',
    border: '1px solid rgba(254,44,85,0.38)',
    color: '#c62828',
    boxShadow:
      '0 1px 0 rgba(255,255,255,0.85) inset, ' +
      '0 -1px 0 rgba(254,44,85,0.12) inset, ' +
      '0 4px 14px -4px rgba(254,44,85,0.14)',
  },
  green: {
    background:
      'radial-gradient(circle at 14% 8%, rgba(76,175,80,0.18), transparent 34%), ' +
      'radial-gradient(circle at 90% 18%, rgba(129,199,132,0.16), transparent 32%), ' +
      'radial-gradient(circle at 50% 105%, rgba(232,245,233,0.50), transparent 44%), ' +
      'linear-gradient(135deg, rgba(200,230,201,0.92), rgba(165,214,167,0.78))',
    border: '1px solid rgba(76,175,80,0.35)',
    color: '#1b5e20',
    boxShadow:
      '0 1px 0 rgba(255,255,255,0.85) inset, ' +
      '0 -1px 0 rgba(76,175,80,0.10) inset, ' +
      '0 4px 14px -4px rgba(20,20,19,0.08)',
  },
  amber: {
    background:
      'radial-gradient(circle at 14% 8%, rgba(196,133,41,0.18), transparent 34%), ' +
      'radial-gradient(circle at 90% 18%, rgba(255,213,79,0.16), transparent 32%), ' +
      'radial-gradient(circle at 50% 105%, rgba(255,248,225,0.50), transparent 44%), ' +
      'linear-gradient(135deg, rgba(255,236,179,0.92), rgba(255,224,130,0.78))',
    border: '1px solid rgba(196,133,41,0.35)',
    color: '#8a6500',
    boxShadow:
      '0 1px 0 rgba(255,255,255,0.85) inset, ' +
      '0 -1px 0 rgba(196,133,41,0.10) inset, ' +
      '0 4px 14px -4px rgba(20,20,19,0.08)',
  },
  orange: {
    background:
      'radial-gradient(circle at 14% 8%, rgba(255,152,0,0.18), transparent 34%), ' +
      'radial-gradient(circle at 90% 18%, rgba(255,183,77,0.16), transparent 32%), ' +
      'radial-gradient(circle at 50% 105%, rgba(255,243,224,0.50), transparent 44%), ' +
      'linear-gradient(135deg, rgba(255,224,178,0.92), rgba(255,204,128,0.78))',
    border: '1px solid rgba(255,152,0,0.35)',
    color: '#e65100',
    boxShadow:
      '0 1px 0 rgba(255,255,255,0.85) inset, ' +
      '0 -1px 0 rgba(255,152,0,0.10) inset, ' +
      '0 4px 14px -4px rgba(20,20,19,0.08)',
  },
  teal: {
    background:
      'radial-gradient(circle at 14% 8%, rgba(82,168,153,0.18), transparent 34%), ' +
      'radial-gradient(circle at 90% 18%, rgba(128,203,196,0.16), transparent 32%), ' +
      'radial-gradient(circle at 50% 105%, rgba(224,242,241,0.50), transparent 44%), ' +
      'linear-gradient(135deg, rgba(178,223,219,0.92), rgba(128,203,196,0.78))',
    border: '1px solid rgba(82,168,153,0.35)',
    color: '#00695c',
    boxShadow:
      '0 1px 0 rgba(255,255,255,0.85) inset, ' +
      '0 -1px 0 rgba(82,168,153,0.10) inset, ' +
      '0 4px 14px -4px rgba(20,20,19,0.08)',
  },
};

/**
 * @param {{ tone?: keyof typeof GLASS_TONES, compact?: boolean, shape?: 'dot'|'square'|'pill' }} opts
 */
export function orderStatusBadgeStyle({ tone = 'purple', compact = true, shape = 'dot' } = {}) {
  const recipe = GLASS_TONES[tone] || GLASS_TONES.purple;
  if (shape === 'dot') {
    return {
      ...GLASS_BASE,
      display: 'inline-flex',
      width: '12px',
      height: '12px',
      padding: 0,
      borderRadius: '50%',
      flexShrink: 0,
      cursor: 'default',
      ...recipe,
    };
  }
  return {
    ...GLASS_BASE,
    fontSize: compact ? '10px' : '12px',
    padding: compact ? '3px 6px' : '4px 10px',
    borderRadius: shape === 'pill' ? '9999px' : '6px',
    minWidth: shape === 'square' ? '52px' : undefined,
    ...recipe,
  };
}
