import React, { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../ui/Icon.jsx';
import { getRowDisplayState, getRowStepperSku } from './bill-review-shared.js';

const SCROLL_EDGE_THRESHOLD = 4;

function computeScrollEdges(el) {
  if (!el) return { top: false, bottom: false };
  const { scrollTop, scrollHeight, clientHeight } = el;
  const canScroll = scrollHeight > clientHeight + 1;
  return {
    top: canScroll && scrollTop > SCROLL_EDGE_THRESHOLD,
    bottom: canScroll && scrollTop + clientHeight < scrollHeight - SCROLL_EDGE_THRESHOLD,
  };
}

const BillItemsListCard = forwardRef(function BillItemsListCard({
  rows,
  activeUid,
  tiktokMirrorEnabled = false,
  onSelect,
  style,
  variant = 'sidebar',
  className = '',
}, ref) {
  const listRef = useRef(null);
  const [scrollEdges, setScrollEdges] = useState({ top: false, bottom: false });

  const updateScrollEdges = useCallback(() => {
    setScrollEdges(computeScrollEdges(listRef.current));
  }, []);

  useEffect(() => {
    if (!activeUid) return;
    const el = listRef.current?.querySelector(`[data-bill-row="${activeUid}"]`);
    if (!el) return;
    const scrollParent = listRef.current;
    if (scrollParent && scrollParent.scrollHeight > scrollParent.clientHeight + 1) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeUid]);

  const isSheet = variant === 'sheet';

  useEffect(() => {
    if (!isSheet) return undefined;
    const el = listRef.current;
    if (!el) return undefined;

    updateScrollEdges();
    el.addEventListener('scroll', updateScrollEdges, { passive: true });

    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(updateScrollEdges);
      ro.observe(el);
    }

    return () => {
      el.removeEventListener('scroll', updateScrollEdges);
      ro?.disconnect();
    };
  }, [isSheet, rows.length, updateScrollEdges]);

  const sheetRows = rows.map((row, idx) => {
    const ds = getRowDisplayState(row, tiktokMirrorEnabled);
    const sku = getRowStepperSku(row);
    const isActive = row.uid === activeUid;
    const isDone = ds.key === 'done';
    return (
      <button
        key={row.uid}
        type="button"
        data-bill-row={row.uid}
        className={
          'rrm-item-list__row card-canvas p-3.5 flex items-center gap-3 pressable' +
          (isActive ? ' is-active' : '') +
          (isDone ? ' is-done' : '')
        }
        onClick={() => onSelect?.(row.uid)}
        title={`#${idx + 1} · ${sku} · ${ds.label}`}
        aria-label={`รายการที่ ${idx + 1} ${sku} · ${ds.label}`}
        aria-current={isActive ? 'true' : undefined}
      >
        <span className="rrm-item-list__idx tabular-nums" aria-hidden="true">{idx + 1}</span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[15px] font-mono truncate text-ink">{sku || row.model_code || '—'}</div>
        </div>
        <span className={'air-status-chip ' + ds.pillCls}>
          <Icon name={ds.icon} size={9}/>
          <span>{ds.label}</span>
        </span>
      </button>
    );
  });

  if (isSheet) {
    return (
      <div
        ref={ref}
        className={'rrm-item-list-wrap mrs-list__card ' + (className || '')}
      >
        <div
          ref={listRef}
          className="rrm-item-list__viewport overflow-y-auto overscroll-contain"
        >
          <div className="rrm-item-list__inner space-y-2">
            {sheetRows}
          </div>
        </div>
        <div
          className={'rrm-item-list__edge rrm-item-list__edge--top' + (scrollEdges.top ? ' is-visible' : '')}
          aria-hidden="true"
        />
        <div
          className={'rrm-item-list__edge rrm-item-list__edge--bottom' + (scrollEdges.bottom ? ' is-visible' : '')}
          aria-hidden="true"
        />
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={
        'air-bill-list-card ttc-bento border rounded-2xl' +
        (style?.height != null ? ' air-bill-list-card--synced' : '') +
        (className ? ' ' + className : '')
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
              <div className="air-bill-list-card__row-head">
                <span className="air-bill-list-card__idx" aria-hidden="true">{idx + 1}</span>
                <span className="air-bill-list-card__sku">{sku || row.model_code || '—'}</span>
                <span className={'air-status-chip air-bill-list-card__chip ' + ds.pillCls}>
                  <Icon name={ds.icon} size={9}/>
                  <span>{ds.label}</span>
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
});

export { computeScrollEdges };
export default BillItemsListCard;
