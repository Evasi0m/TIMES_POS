import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import TikTokListPagination from '../../ecommerce/tiktok/TikTokListPagination.jsx';
import WebPendingOrderRow from './WebPendingOrderRow.jsx';
import { SORT_OLDEST } from '../tiktok-confirm/helpers.js';

export default function WebPendingList({
  orders,
  sortOrder,
  onSortChange,
  onOpen,
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

  return (
    <div className={'flex flex-col min-h-0 h-full ' + (disabled ? 'pointer-events-none select-none opacity-60' : '')}>
      <div className="px-4 py-2.5 border-b hairline bg-surface-soft/40 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <span className="text-xs text-muted tabular-nums">
          <span className="font-semibold text-ink text-sm">{orders.length.toLocaleString('th-TH')}</span> ออเดอร์
        </span>
        <label className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-muted-soft">เรียง</span>
          <select
            className="input !h-8 !rounded-lg !py-0 !px-2 !text-xs !w-auto"
            value={sortOrder}
            onChange={e => onSortChange(e.target.value)}
            aria-label="เรียงลำดับออเดอร์"
            disabled={disabled}
          >
            <option value={SORT_OLDEST}>เก่าก่อน</option>
            <option value="newest">ใหม่ก่อน</option>
          </select>
        </label>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2.5 bg-surface-cream-strong">
        {pageOrders.map(o => (
          <WebPendingOrderRow key={o.id} order={o} onOpen={onOpen}/>
        ))}
        {!pageOrders.length && (
          <div className="p-10 text-center">
            <Icon name="package" size={32} className="text-muted mx-auto mb-3"/>
            <p className="text-sm text-muted">ไม่มีออเดอร์ในรายการ</p>
          </div>
        )}
      </div>

      <TikTokListPagination
        total={orders.length}
        page={safePage}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  );
}
