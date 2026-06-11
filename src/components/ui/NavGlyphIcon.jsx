import React, { useId } from 'react';

/** Semantic aura tone per nav icon key. */
export const NAV_GLYPH_TONE = {
  cart: 'coral',
  box: 'orange',
  receipt: 'teal',
  'arrow-up': 'green',
  'arrow-down': 'orange',
  dashboard: 'purple',
  'shop-bag': 'teal',
};

/** Visual boost — SVG draws larger inside a fixed layout slot so nav rows stay the same height. */
const NAV_GLYPH_VISUAL_SCALE = 1.2;

function svgProps(size) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 48 48',
    className: 'nav-glyph-icon__svg',
    'aria-hidden': true,
  };
}

/** Stacked cardboard boxes — ref: สินค้า tab */
function CardboardBox({ id, x, y, w, h, lid = 5 }) {
  const cx = x + w / 2;
  return (
    <g>
      <rect x={x} y={y - lid} width={w} height={lid} rx={1.2} fill={`url(#${id}-lid)`} />
      <rect x={x} y={y} width={w} height={h} rx={1.5} fill={`url(#${id}-face)`} />
      <rect x={cx - 1.6} y={y - lid} width={3.2} height={h + lid} rx={0.6} fill={`url(#${id}-tape)`} />
      <rect x={x + 1.5} y={y + h - 4.5} width={4.2} height={2.8} rx={0.6} fill="#d1c4e9" opacity="0.95" />
      <path d={`M${x + w - 4.5} ${y + h - 3.2}h2.2M${x + w - 4.5} ${y + h - 1.4}h3.2`} stroke="#5d4037" strokeWidth="0.9" strokeLinecap="round" opacity="0.55" />
    </g>
  );
}

function cardboardDefs(id) {
  return (
    <defs>
      <linearGradient id={`${id}-lid`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#f5c882" />
        <stop offset="100%" stopColor="#e89545" />
      </linearGradient>
      <linearGradient id={`${id}-face`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#e89545" />
        <stop offset="100%" stopColor="#b8652a" />
      </linearGradient>
      <linearGradient id={`${id}-tape`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffe082" />
        <stop offset="100%" stopColor="#ffb300" />
      </linearGradient>
    </defs>
  );
}

export function NavGlyphSvg({ name, size = 30, ai = false }) {
  const id = useId().replace(/:/g, '');
  const p = svgProps(size);

  switch (name) {
    case 'cart':
      return (
        <svg {...p}>
          <defs>
            <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f4a088" />
              <stop offset="100%" stopColor="#b84a38" />
            </linearGradient>
            <linearGradient id={`${id}-handle`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ffd6cc" />
              <stop offset="100%" stopColor="#c45c4a" />
            </linearGradient>
          </defs>
          <path d="M10 16h4l3 18h20l3-14H15l-1-4z" fill={`url(#${id}-body)`} />
          <path d="M14 16h20" stroke="#d4745f" strokeWidth="2" strokeLinecap="round" opacity="0.75" />
          <path d="M16 16V10.5c0-2.5 2.8-4.5 8-4.5s8 2 8 4.5V16" fill="none" stroke={`url(#${id}-handle)`} strokeWidth="3" strokeLinecap="round" />
          <rect x="20" y="21" width="9" height="7" rx="1.5" fill="#ffe0d6" stroke="#a63d2f" strokeWidth="0.9" />
          <circle cx="17" cy="36" r="3.6" fill="#5c2e26" />
          <circle cx="17" cy="36" r="1.3" fill="#ffe8e4" />
          <circle cx="31" cy="36" r="3.6" fill="#5c2e26" />
          <circle cx="31" cy="36" r="1.3" fill="#ffe8e4" />
        </svg>
      );
    case 'box':
      return (
        <svg {...p}>
          {cardboardDefs(id)}
          <CardboardBox id={id} x={4} y={31} w={14} h={10} lid={4.5} />
          <CardboardBox id={id} x={20} y={31} w={14} h={10} lid={4.5} />
          <CardboardBox id={id} x={12} y={14} w={16} h={12} lid={5} />
        </svg>
      );
    case 'receipt':
      return (
        <svg {...p}>
          <defs>
            <linearGradient id={`${id}-paper`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#80deea" />
              <stop offset="100%" stopColor="#00838f" />
            </linearGradient>
          </defs>
          <path d="M14 6h20v36l-4-2.5-4 2.5-4-2.5-4 2.5-4-2.5V6z" fill={`url(#${id}-paper)`} />
          <path d="M18 14h12M18 20h12M18 26h8" stroke="#e0f7fa" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="24" cy="33" r="3" fill="#004d40" opacity="0.35" />
        </svg>
      );
    case 'arrow-up':
      return (
        <svg {...p}>
          <defs>
            <linearGradient id={`${id}-box`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#9bd86f" />
              <stop offset="100%" stopColor="#388e3c" />
            </linearGradient>
            {ai && (
              <linearGradient id={`${id}-ai`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#f97316" />
                <stop offset="55%" stopColor="#dc2626" />
                <stop offset="100%" stopColor="#7c3aed" />
              </linearGradient>
            )}
          </defs>
          <rect x="8" y="14" width="32" height="26" rx="5" fill={`url(#${id}-box)`} />
          <path d="M24 34V18M18 24l6-6 6 6" fill="none" stroke="#e8f5e9" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {ai && (
            <>
              <circle cx="36" cy="12" r="7" fill={`url(#${id}-ai)`} stroke="#fff" strokeWidth="1.2" />
              <path d="M36 9v4M34 11h4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
            </>
          )}
        </svg>
      );
    case 'arrow-down':
      return (
        <svg {...p}>
          <defs>
            <linearGradient id={`${id}-box`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffb74d" />
              <stop offset="100%" stopColor="#e65100" />
            </linearGradient>
          </defs>
          <rect x="8" y="8" width="32" height="26" rx="5" fill={`url(#${id}-box)`} />
          <path d="M24 14v16M18 24l6 6 6-6" fill="none" stroke="#fff3e0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'dashboard':
      return (
        <svg {...p}>
          <defs>
            <linearGradient id={`${id}-a`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ce93d8" />
              <stop offset="100%" stopColor="#7b1fa2" />
            </linearGradient>
            <linearGradient id={`${id}-b`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#b39ddb" />
              <stop offset="100%" stopColor="#512da8" />
            </linearGradient>
          </defs>
          <rect x="6" y="6" width="16" height="18" rx="4" fill={`url(#${id}-a)`} />
          <rect x="26" y="6" width="16" height="11" rx="3.5" fill={`url(#${id}-b)`} opacity="0.9" />
          <rect x="26" y="21" width="16" height="21" rx="3.5" fill={`url(#${id}-b)`} />
          <rect x="6" y="28" width="16" height="14" rx="3.5" fill={`url(#${id}-a)`} opacity="0.85" />
        </svg>
      );
    case 'shop-bag':
      return (
        <svg {...p}>
          <defs>
            <linearGradient id={`${id}-bag`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4dd0e1" />
              <stop offset="100%" stopColor="#00838f" />
            </linearGradient>
            <linearGradient id={`${id}-band`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#80deea" />
              <stop offset="100%" stopColor="#00acc1" />
            </linearGradient>
            <linearGradient id={`${id}-handle`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e0f7fa" />
              <stop offset="100%" stopColor="#26c6da" />
            </linearGradient>
          </defs>
          {/* Lucide shop-bag silhouette (Icon.jsx) scaled 2× — same as TikTok Shop card */}
          <path d="M12 4 6 12v28a4 4 0 0 0 4 4h28a4 4 0 0 0 4-4V12l-6-8Z" fill={`url(#${id}-bag)`} />
          <rect x="6" y="11" width="36" height="3" rx="0.8" fill={`url(#${id}-band)`} />
          <path d="M32 20a8 8 0 0 1-16 0" fill="none" stroke={`url(#${id}-handle)`} strokeWidth="3.5" strokeLinecap="round" />
          <ellipse cx="17" cy="22" rx="3" ry="5" fill="#e0f7fa" opacity="0.28" />
        </svg>
      );
    default:
      return (
        <svg {...p}>
          <circle cx="24" cy="24" r="14" fill="#bdbdbd" />
        </svg>
      );
  }
}

export default function NavGlyphIcon({ name, size = 30, ai = false, active = false, className = '' }) {
  const tone = NAV_GLYPH_TONE[name] || 'indigo';
  const slot = size;
  const renderSize = Math.round(size * NAV_GLYPH_VISUAL_SCALE);
  return (
    <span
      className={`nav-glyph-icon nav-glyph-icon--${tone}${active ? ' nav-glyph-icon--lit' : ''} shrink-0 ${className}`}
      style={{ width: slot, height: slot, minWidth: slot, minHeight: slot }}
    >
      <span className="nav-glyph-icon__glyph">
        <NavGlyphSvg name={name} size={renderSize} ai={ai} />
      </span>
    </span>
  );
}
