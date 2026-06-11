import React from 'react';
import { resolveSaleOrderDisplayStatus } from '../../lib/sale-order-display-status.js';
import { orderStatusBadgeStyle } from '../../lib/order-status-badge-style.js';

function StatusDot({ tone, className = '', size = 'md' }) {
  const dim = size === 'sm' ? '10px' : '12px';
  return (
    <span
      className={className}
      style={{
        ...orderStatusBadgeStyle({ tone, shape: 'dot' }),
        width: dim,
        height: dim,
        flexShrink: 0,
      }}
      aria-hidden="true"
    />
  );
}

export default function OrderStatusBadge({ order, hasSubstitution, className = '' }) {
  const info = resolveSaleOrderDisplayStatus(order, { hasSubstitution });
  if (!info) return null;

  const tipText = info.title && info.title !== info.label
    ? `${info.label} — ${info.title}`
    : info.label;

  return (
    <span
      className={'glass-hover-tip order-status-dot ' + className}
      role="img"
      aria-label={info.label}
      title={tipText}
    >
      <StatusDot tone={info.tone} className="order-status-dot__mark" />
      <span className="glass-hover-tip__bubble" aria-hidden="true">
        <span className="glass-hover-tip__row">
          <StatusDot tone={info.tone} size="sm" className="order-status-dot__tip-mark" />
          <span className="glass-hover-tip__label">{info.label}</span>
        </span>
      </span>
    </span>
  );
}
