import React from 'react';
import { voidStockStatusLabel } from '../../lib/sale-void-stock-status.js';

export default function VoidStockStatusBadge({ status, className = '', showHint = false }) {
  const info = voidStockStatusLabel(status);
  if (!info) return null;

  const toneClass = info.tone === 'success'
    ? '!bg-success/10 !text-success'
    : info.tone === 'warning'
      ? '!bg-warning/15 !text-[#8a6500]'
      : '!bg-surface-strong !text-muted';

  return (
    <span className={className}>
      <span
        className={`badge-pill !text-[10px] ${toneClass}`}
        title={info.hint}
      >
        {info.text}
      </span>
      {showHint && (
        <span className="block text-[10px] text-muted-soft mt-0.5 leading-snug">{info.hint}</span>
      )}
    </span>
  );
}
