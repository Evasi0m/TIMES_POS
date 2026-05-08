import React from 'react';

/**
 * SVG icon set (Lucide-inspired). Stroke colour follows the parent's
 * `currentColor` so icons inherit text colour without explicit theming.
 *
 * The `data-icon={name}` attribute is consumed by per-icon click + hover
 * animations defined in `src/styles.legacy.css` — e.g.
 *   `.nav-item.active svg[data-icon="cart"] → cart-roll keyframes`
 *   `button:hover > svg[data-icon="settings"] → gear-spin keyframes`
 *
 * Adding a new icon: pick a `kebab-case` name, add a `case` branch returning
 * an `<svg {...p}>…</svg>` block. Stick to the 24×24 viewBox and
 * stroke-only paths so colour inheritance keeps working.
 */
const Icon = ({ name, size = 20, className = '', strokeWidth = 1.75, color }) => {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color || 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
    'data-icon': name,
  };
  switch (name) {
    case 'cart':         return <svg {...p}><path d="M2 3h2.5l3 12h11l2.5-8H7"/><circle cx="10.5" cy="19.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="17.5" cy="19.5" r="1.5" fill="currentColor" stroke="none"/></svg>;
    case 'watch':        return <svg {...p}><rect x="6" y="5" width="12" height="14" rx="3"/><path d="M9 5V3h6v2M9 19v2h6v-2"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>;
    case 'box':          return <svg {...p}><rect x="2" y="8" width="20" height="13" rx="1"/><path d="M2 8 4 3h16l2 5"/><path d="M9 13h6"/></svg>;
    case 'receipt':      return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>;
    case 'package':      return <svg {...p}><path d="M12 3l9 5v10l-9 5-9-5V8l9-5z"/><path d="M12 12l9-5"/><path d="M12 12v10"/></svg>;
    case 'package-in':   return <svg {...p}><path d="M12 20V4"/><path d="M5 11l7-7 7 7"/></svg>;
    case 'package-out':  return <svg {...p}><path d="M12 4v16"/><path d="M19 13l-7 7-7-7"/></svg>;
    case 'dashboard':    return <svg {...p}><rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/></svg>;
    case 'search':       return <svg {...p}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>;
    case 'plus':         return <svg {...p}><path d="M12 5v14M5 12h14"/></svg>;
    case 'minus':        return <svg {...p}><path d="M5 12h14"/></svg>;
    case 'x':            return <svg {...p}><path d="M18 6 6 18M6 6l12 12"/></svg>;
    case 'trash':        return <svg {...p}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>;
    case 'logout':       return <svg {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>;
    case 'calendar':     return <svg {...p}><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M16 3v4M8 3v4M4 11h16"/></svg>;
    case 'tag':          return <svg {...p}><path d="M4 4h8l8 8-8 8-8-8V4z"/><circle cx="8" cy="8" r="1.5"/></svg>;
    case 'edit':         return <svg {...p}><path d="M12 20h9M16 3l5 5-9 9H7v-5l9-9z"/></svg>;
    case 'chevron-r':    return <svg {...p}><path d="m9 18 6-6-6-6"/></svg>;
    case 'chevron-d':    return <svg {...p}><path d="m6 9 6 6 6-6"/></svg>;
    case 'chevron-l':    return <svg {...p}><path d="m15 18-6-6 6-6"/></svg>;
    case 'chevron-u':    return <svg {...p}><path d="m6 15 6-6 6 6"/></svg>;
    case 'menu':         return <svg {...p}><path d="M3 6h18M3 12h18M3 18h18"/></svg>;
    case 'filter':       return <svg {...p}><path d="M4 4h16l-6 8v6l-4 2v-8L4 4z"/></svg>;
    case 'check':        return <svg {...p}><path d="m20 6-9 9-5-5"/></svg>;
    case 'alert':        return <svg {...p}><path d="M12 2 2 22h20L12 2z"/><path d="M12 9v6M12 17h.01"/></svg>;
    case 'barcode':      return <svg {...p}><path d="M4 7v10M7 7v10M10 7v10M14 7v10M17 7v10M20 7v10"/></svg>;
    case 'credit-card':  return <svg {...p}><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 11h20"/></svg>;
    case 'trend-up':     return <svg {...p}><polyline points="4 17 9 12 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>;
    case 'arrow-up':     return <svg {...p}><path d="M12 20V4"/><path d="M5 11l7-7 7 7"/></svg>;
    case 'arrow-down':   return <svg {...p}><path d="M12 4v16"/><path d="M19 13l-7 7-7-7"/></svg>;
    case 'store':        return <svg {...p}><path d="M4 4h16l-2 4H6L4 4z"/><path d="M4 8v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/></svg>;
    case 'file':         return <svg {...p}><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>;
    case 'camera':       return <svg {...p}><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3.5"/></svg>;
    case 'flashlight':   return <svg {...p}><path d="M18 6 6 18"/><path d="M14 4h6v6"/><path d="M10 20H4v-6"/><circle cx="12" cy="12" r="2"/></svg>;
    case 'flip-cam':     return <svg {...p}><path d="M3 7h4l2-3h6l2 3h4v12H3z"/><path d="m9 13 3-3 3 3"/><path d="M12 10v6"/></svg>;
    case 'zap':          return <svg {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
    case 'user':         return <svg {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/></svg>;
    case 'wallet':       return <svg {...p}><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M16 12h4"/><circle cx="17" cy="12" r="0.5" fill="currentColor"/></svg>;
    case 'settings':     return <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>;
    default: return null;
  }
};

export default Icon;
