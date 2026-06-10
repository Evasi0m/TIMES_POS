import React, { forwardRef, useEffect, useRef } from 'react';
import Icon from '../ui/Icon.jsx';
import { getRowDisplayState, getRowStepperSku } from './bill-review-shared.js';

const BillItemsListCard = forwardRef(function BillItemsListCard({
  rows,
  activeUid,
  tiktokMirrorEnabled = false,
  onSelect,
  style,
}, ref) {
  const listRef = useRef(null);

  useEffect(() => {
    if (!activeUid) return;
    const el = listRef.current?.querySelector(`[data-bill-row="${activeUid}"]`);
    if (!el) return;
    const scrollParent = listRef.current;
    if (scrollParent && scrollParent.scrollHeight > scrollParent.clientHeight + 1) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeUid]);

  return (
    <div
      ref={ref}
      className={
        'air-bill-list-card ttc-bento rounded-2xl border' +
        (style?.height != null ? ' air-bill-list-card--synced' : '')
      }
      style={style}
    >
      <div className="air-bill-list-card__head">รายการในบิล</div>
      <div ref={listRef} className="air-bill-list-card__scroll">
        {rows.map((row, idx) => {
          const ds = getRowDisplayState(row, tiktokMirrorEnabled);
          const sku = getRowStepperSku(row);
          const isActive = row.uid === activeUid;
          return (
            <button
              key={row.uid}
              type="button"
              data-bill-row={row.uid}
              className={'air-bill-list-card__row' + (isActive ? ' is-active' : '')}
              onClick={() => onSelect?.(row.uid)}
              title={`#${idx + 1} · ${sku} · ${ds.label}`}
              aria-label={`รายการที่ ${idx + 1} ${sku} · ${ds.label}`}
              aria-current={isActive ? 'true' : undefined}
            >
              <span className="air-bill-list-card__sku">{sku || row.model_code || '—'}</span>
              <span className={'air-list-row__status-pill air-bill-list-card__pill ' + ds.pillCls}>
                <Icon name={ds.icon} size={10}/>
                <span>{ds.label}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
});

export default BillItemsListCard;
