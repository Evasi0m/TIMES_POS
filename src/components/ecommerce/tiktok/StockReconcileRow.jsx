// Single row in TikTok ↔ POS stock reconcile table.
import React from 'react';
import Icon from '../../ui/Icon.jsx';
import { diffChipClass, formatDiff } from '../../../lib/tiktok-stock-reconcile-helpers.js';

const STATUS_META = {
  ok: { label: 'ตรงกัน', chip: 'tt-reconcile-chip--ok', icon: 'check' },
  sync_disabled: { label: 'sync ปิด', chip: 'tt-reconcile-chip--muted', icon: 'pause' },
  missing_product_id: { label: 'ขาด product id', chip: 'tt-reconcile-chip--warn', icon: 'alert' },
  tiktok_error: { label: 'อ่าน TikTok ไม่ได้', chip: 'tt-reconcile-chip--bad', icon: 'alert' },
};

function StatusBadge({ row }) {
  if (row.status === 'ok') {
    if (row.diff === 0) {
      return (
        <span className={'tt-reconcile-chip ' + STATUS_META.ok.chip}>
          <Icon name={STATUS_META.ok.icon} size={9}/>
          <span>{STATUS_META.ok.label}</span>
        </span>
      );
    }
    return (
      <span className={'tt-reconcile-chip ' + diffChipClass(row.diff)}>
        <Icon name="alert" size={9}/>
        <span>ไม่ตรง</span>
      </span>
    );
  }
  const meta = STATUS_META[row.status] || STATUS_META.tiktok_error;
  return (
    <span className={'tt-reconcile-chip ' + meta.chip} title={row.error || ''}>
      <Icon name={meta.icon} size={9}/>
      <span>{meta.label}</span>
    </span>
  );
}

export default function StockReconcileRow({
  row,
  selected,
  onToggle,
  disabled = false,
  selectable = true,
}) {
  const sku = row.seller_sku || row.barcode || '—';
  const canSelect = selectable && row.status === 'ok' && row.sync_enabled && row.diff !== 0;

  return (
    <div className={'tt-reconcile-row' + (selected ? ' tt-reconcile-row--selected' : '')}>
      <div className="tt-reconcile-row__check">
        {canSelect ? (
          <input
            type="checkbox"
            className="checkbox"
            checked={selected}
            disabled={disabled}
            onChange={() => onToggle(row.product_id)}
            aria-label={`เลือก ${sku}`}
          />
        ) : (
          <span className="w-4" aria-hidden="true"/>
        )}
      </div>

      <div className="tt-reconcile-row__sku min-w-0">
        <div className="font-mono text-sm font-semibold truncate">{sku}</div>
        <div className="text-xs text-muted truncate">{row.product_name}</div>
      </div>

      <div className="tt-reconcile-row__qty tabular-nums text-sm font-medium">
        {row.pos_stock ?? '—'}
      </div>

      <div className="tt-reconcile-row__qty tabular-nums text-sm font-medium">
        {row.tiktok_stock ?? '—'}
      </div>

      <div className="tt-reconcile-row__diff">
        {row.diff != null ? (
          <span className={'tt-reconcile-chip ' + diffChipClass(row.diff)}>
            <span>{formatDiff(row.diff)}</span>
          </span>
        ) : (
          <span className="text-muted text-xs">—</span>
        )}
      </div>

      <div className="tt-reconcile-row__status">
        <StatusBadge row={row}/>
      </div>
    </div>
  );
}
