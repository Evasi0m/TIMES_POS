import React, { useId } from 'react';
import { getPaymentMethodLabel } from '../../lib/payment-method-label.js';

/** Colourful frameless payment glyphs with per-tone edge aura. */
const METHOD_TONE = {
  transfer: 'green',
  card: 'indigo',
  paylater: 'green',
  cod: 'orange',
  cash: 'green',
};

function PaymentMethodSvg({ method, size = 26 }) {
  const id = useId().replace(/:/g, '');
  const common = { width: size, height: size, viewBox: '0 0 48 48', className: 'payment-method-icon__svg' };

  switch (method) {
    case 'transfer':
      return (
        <svg {...common} aria-hidden="true">
          <defs>
            <linearGradient id={`${id}-bill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#9bd86f" />
              <stop offset="100%" stopColor="#5fb24a" />
            </linearGradient>
          </defs>
          <rect x="3" y="12" width="42" height="24" rx="5" fill={`url(#${id}-bill)`} />
          <rect x="7" y="16" width="34" height="16" rx="3" fill="none" stroke="#3f7d33" strokeWidth="2" opacity="0.85" />
          <circle cx="24" cy="24" r="6.5" fill="#3f7d33" />
          <path d="M24 20v8M26 21.4c-.7-.7-3.4-1-3.4 1s3.4 1 3.4 2.6c0 1.8-2.7 1.5-3.4.8" fill="none" stroke="#eaffd8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="24" r="2" fill="#3f7d33" />
          <circle cx="36" cy="24" r="2" fill="#3f7d33" />
        </svg>
      );
    case 'card':
      return (
        <svg {...common} aria-hidden="true">
          <defs>
            <linearGradient id={`${id}-card`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#7c84b8" />
              <stop offset="55%" stopColor="#5d6499" />
              <stop offset="100%" stopColor="#474d80" />
            </linearGradient>
            <linearGradient id={`${id}-chip`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffd76b" />
              <stop offset="100%" stopColor="#e8a93a" />
            </linearGradient>
          </defs>
          <rect x="3" y="9" width="42" height="30" rx="5" fill={`url(#${id}-card)`} />
          <rect x="8" y="16" width="8" height="6.5" rx="1.6" fill={`url(#${id}-chip)`} />
          <path d="M11 16v6.5M8 19.2h8" stroke="#b9842a" strokeWidth="0.7" opacity="0.7" />
          <path d="M34 16.5c1.4 1 1.4 4 0 5M37 14.5c2.6 2 2.6 7 0 9" fill="none" stroke="#e6e9ff" strokeWidth="1.5" strokeLinecap="round" opacity="0.85" />
          <path d="M8 29h12M24 29h6M33 29h4" stroke="#e6e9ff" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
        </svg>
      );
    case 'paylater':
      return (
        <svg {...common} aria-hidden="true">
          <defs>
            <linearGradient id={`${id}-bill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#9bd86f" />
              <stop offset="100%" stopColor="#5fb24a" />
            </linearGradient>
            <linearGradient id={`${id}-clock`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffe28a" />
              <stop offset="100%" stopColor="#f5c542" />
            </linearGradient>
          </defs>
          <rect x="3" y="11" width="34" height="22" rx="4.5" fill={`url(#${id}-bill)`} />
          <circle cx="20" cy="22" r="4.5" fill="#3f7d33" />
          <path d="M20 19v6M21.5 20c-.6-.5-2.6-.8-2.6.8s2.6.8 2.6 2c0 1.4-2 1.2-2.6.6" fill="none" stroke="#eaffd8" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9 18h2.5M28.5 18h2.5" stroke="#3f7d33" strokeWidth="2" strokeLinecap="round" />
          <circle cx="34" cy="33" r="9" fill={`url(#${id}-clock)`} stroke="#fff7e0" strokeWidth="1.5" />
          <path d="M34 28v5l3 2" fill="none" stroke="#7a5a12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'cash':
      return (
        <svg {...common} aria-hidden="true">
          <defs>
            <linearGradient id={`${id}-cash`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#9bd86f" />
              <stop offset="100%" stopColor="#388e3c" />
            </linearGradient>
          </defs>
          <rect x="4" y="10" width="40" height="22" rx="4" fill={`url(#${id}-cash)`} />
          <circle cx="24" cy="21" r="7" fill="#2e7d32" opacity="0.35" />
          <text x="24" y="24.5" textAnchor="middle" fontSize="10" fontWeight="800" fontFamily="system-ui, sans-serif" fill="#e8f5e9">฿</text>
        </svg>
      );
    case 'cod':
      return (
        <svg {...common} aria-hidden="true">
          <defs>
            <linearGradient id={`${id}-box`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffb74d" />
              <stop offset="100%" stopColor="#e65100" />
            </linearGradient>
          </defs>
          <rect x="3" y="14" width="26" height="18" rx="3" fill={`url(#${id}-box)`} />
          <path d="M29 19h6.5l5.5 6v7H29z" fill="#f5f5f4" />
          <path d="M33 20.5h2.4l3 3.3H33z" fill="#ffe0b2" />
          <text x="16" y="27.5" textAnchor="middle" fontSize="9" fontWeight="800" fontFamily="system-ui, sans-serif" fill="#bf360c">COD</text>
          <circle cx="13" cy="35" r="3.4" fill="#3a3540" />
          <circle cx="13" cy="35" r="1.3" fill="#cfd2dc" />
          <circle cx="34" cy="35" r="3.4" fill="#3a3540" />
          <circle cx="34" cy="35" r="1.3" fill="#cfd2dc" />
        </svg>
      );
    default:
      return (
        <svg {...common} aria-hidden="true">
          <defs>
            <linearGradient id={`${id}-card`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#7c84b8" />
              <stop offset="100%" stopColor="#474d80" />
            </linearGradient>
          </defs>
          <rect x="3" y="9" width="42" height="30" rx="5" fill={`url(#${id}-card)`} />
          <path d="M8 29h12" stroke="#e6e9ff" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
        </svg>
      );
  }
}

function PaymentGlyph({ method, size }) {
  return (
    <span className="payment-method-icon__glyph">
      <PaymentMethodSvg method={method} size={size} />
    </span>
  );
}

export default function PaymentMethodIcon({ method, size = 34, className = '' }) {
  const label = getPaymentMethodLabel(method);
  if (!method) {
    return <span className={'payment-method-icon payment-method-icon--empty ' + className}>—</span>;
  }

  const tone = METHOD_TONE[method] || 'indigo';

  return (
    <span
      className={`glass-hover-tip payment-method-icon payment-method-icon--${tone} ${className}`}
      role="img"
      aria-label={label}
      title={label}
    >
      <PaymentGlyph method={method} size={size} />
      <span className="glass-hover-tip__bubble" aria-hidden="true">
        <span className="glass-hover-tip__row">
          <span className={`payment-method-icon payment-method-icon--${tone}`}>
            <PaymentGlyph method={method} size={22} />
          </span>
          <span className="glass-hover-tip__label">{label}</span>
        </span>
      </span>
    </span>
  );
}
