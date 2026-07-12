import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import TikTokListPagination from '../../ecommerce/tiktok/TikTokListPagination.jsx';
import TikTokReturnOrderRow from './TikTokReturnOrderRow.jsx';
import { useScrollFrostEdges } from '../../../hooks/useScrollFrostEdges.js';
import { SORT_OLDEST } from '../tiktok-confirm/helpers.js';
import { TTR_COPY } from './copy.js';

export default function TikTokReturnList({
  orders,
  sortOrder,
  onSortChange,
  onOpen,
  openingId,
  disabled,
}) {
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [sortOrder, pageSize]);

  const totalPages = Math.max(1, Math.ceil(orders.length / pageSize));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageOrders = useMemo(
    () => orders.slice((safePage - 1) * pageSize, safePage * pageSize),
    [orders, safePage, pageSize],
  );

  const { ref: scrollRef, edges: scrollEdges } = useScrollFrostEdges([
    pageOrders.length,
    safePage,
    pageSize,
  ]);

  return (
    <div className={
      'flex flex-col min-h-0 h-full ' +
      (disabled ? 'pointer-events-none select-none opacity-60 ' : '') +
      (openingId ? 'pointer-events-none select-none ' : '')
    }>
      <div className="px-4 py-2.5 ttc-list-toolbar bg-surface-soft/40 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <span className="text-xs text-muted tabular-nums">
          <span className="font-semibold text-[#d97706] text-sm">{orders.length.toLocaleString('th-TH')}</span> ออเดอร์
        </span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs text-muted-soft">เรียง</span>
            <select
              className="input !h-8 !rounded-lg !py-0 !px-2 !text-xs !w-auto"
              value={sortOrder}
              onChange={(e) => onSortChange(e.target.value)}
              aria-label="เรียงลำดับออเดอร์"
              disabled={disabled}
            >
              <option value={SORT_OLDEST}>เก่าก่อน</option>
              <option value="newest">ใหม่ก่อน</option>
            </select>
          </label>
        </div>
      </div>

      <div className="ttc-scroll-frost flex-1 min-h-0 bg-surface-cream-strong">
        <div ref={scrollRef} className="ttc-scroll-frost__viewport">
          <div className="ttc-scroll-frost__inner">
            {pageOrders.map((o) => (
              <TikTokReturnOrderRow
                key={o.id}
                order={o}
                onOpen={onOpen}
                opening={openingId === o.id}
              />
            ))}
            {!pageOrders.length && (
              <div className="p-10 text-center">
                <Icon name="package" size={32} className="text-muted mx-auto mb-3"/>
                <p className="text-sm text-muted">{TTR_COPY.empty}</p>
              </div>
            )}
          </div>
        </div>
        <div
          className={'ttc-scroll-frost__edge ttc-scroll-frost__edge--top' + (scrollEdges.top ? ' is-visible' : '')}
          aria-hidden="true"
        />
        <div
          className={'ttc-scroll-frost__edge ttc-scroll-frost__edge--bottom' + (scrollEdges.bottom ? ' is-visible' : '')}
          aria-hidden="true"
        />
      </div>

      <TikTokListPagination
        variant="modal"
        total={orders.length}
        page={safePage}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  );
}
