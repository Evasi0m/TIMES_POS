import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import TikTokOrderCard from './TikTokOrderCard.jsx';
import TikTokListPagination from './TikTokListPagination.jsx';

function OrderSkeleton({ n = 5 }) {
  return (
    <div className="card-canvas overflow-hidden rounded-xl">
      <div className="p-4 space-y-3" role="status" aria-live="polite" aria-label="กำลังโหลดออเดอร์">
        {Array.from({ length: n }).map((_, i) => (
          <div key={i} className="space-y-3 py-3 border-b hairline last:border-0">
            <div className="skeleton h-4 w-48 rounded"/>
            <div className="flex gap-3">
              <div className="skeleton w-14 h-14 rounded-lg shrink-0"/>
              <div className="flex-1 space-y-2">
                <div className="skeleton h-4 w-full rounded"/>
                <div className="skeleton h-3 w-24 rounded"/>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TikTokOrderList({
  loading,
  orders,
  itemsByOrder,
  imageByProduct,
  selected,
  shipFilter,
  canShipFn,
  labelBusy,
  shipBusy,
  lineTitle,
  shippingLabel,
  paymentLabel,
  fmtDateTime,
  livePollSec,
  syncing,
  pullBusy,
  syncPct,
  onToggleSelect,
  onShip,
  onPrintLabel,
  onPrintPackingSlip,
  onSyncOrders,
}) {
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [shipFilter, pageSize]);

  const totalPages = Math.max(1, Math.ceil(orders.length / pageSize));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageOrders = useMemo(
    () => orders.slice((safePage - 1) * pageSize, safePage * pageSize),
    [orders, safePage, pageSize],
  );

  if (loading) {
    return <OrderSkeleton n={5}/>;
  }

  if (!orders.length) {
    return (
      <div className="card-canvas overflow-hidden rounded-xl">
        <div className="p-10 text-center">
          <div className="w-12 h-12 rounded-xl bg-surface-soft border hairline flex items-center justify-center mx-auto mb-4 text-muted">
            <Icon name="package" size={24}/>
          </div>
          <div className="text-muted text-sm mb-4 max-w-md mx-auto">
            {shipFilter === 'to_ship'
              ? 'ยังไม่มีออเดอร์ "ที่จะจัดส่ง" — ระบบกำลังดึงจาก TikTok อัตโนมัติ'
              : 'ยังไม่มีออเดอร์ในแท็บนี้ — รอซิงค์จาก TikTok หรือกดปุ่มด้านล่าง'}
          </div>
          <button type="button" className="btn-primary !h-11 !text-sm min-h-[44px]" onClick={onSyncOrders} disabled={syncing}>
            {syncing
              ? <span className="text-sm font-semibold tabular-nums">{syncPct}%</span>
              : pullBusy
                ? <span className="spinner"/>
                : <Icon name="refresh" size={16}/>}
            อัปเดตข้อมูลจาก TikTok
          </button>
          <p className="text-xs text-muted-soft mt-4 max-w-md mx-auto leading-relaxed">
            ซิงค์อัตโนมัติทุก {livePollSec} วินาที + cron ทุก 5 นาที —
            ครั้งแรกอาจใช้เวลาสักครู่ถ้ามีออเดอร์จำนวนมาก (ดึงทีละ ~60 รายการ)
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card-canvas overflow-hidden rounded-xl flex flex-col min-h-0">
      <div className="px-4 py-2.5 border-b hairline bg-surface-soft/50 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>
          พบ <span className="font-medium text-ink tabular-nums">{orders.length.toLocaleString('th-TH')}</span> รายการ
        </span>
        {orders.length > pageSize && (
          <span className="text-muted-soft tabular-nums">
            · หน้า {safePage}/{totalPages}
          </span>
        )}
      </div>

      <div className="hidden lg:grid grid-cols-[minmax(0,2.2fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.1fr)] gap-3 px-4 py-2 bg-surface-soft border-b hairline text-xs text-muted font-medium uppercase tracking-wider">
        <div>สินค้า</div>
        <div>สถานะ</div>
        <div>การจัดส่ง</div>
        <div className="text-right">ราคา</div>
        <div className="text-right">การดำเนินการ</div>
      </div>

      <div className="divide-y hairline">
        {pageOrders.map((o, idx) => {
          const lines = itemsByOrder[o.id] || [];
          return (
            <TikTokOrderCard
              key={o.id}
              order={o}
              lines={lines}
              imageByProduct={imageByProduct}
              isSelected={selected.has(o.id)}
              canShip={canShipFn(o)}
              labelBusy={labelBusy}
              shipBusy={shipBusy}
              lineTitle={lineTitle}
              shippingLabelText={shippingLabel(o)}
              paymentLabel={paymentLabel(o)}
              fmtDateTime={fmtDateTime}
              staggerIndex={idx}
              embedded
              onToggleSelect={() => onToggleSelect(o.id)}
              onShip={() => onShip([o.id])}
              onPrintLabel={() => onPrintLabel(o.id)}
              onPrintPackingSlip={() => onPrintPackingSlip(o.id, 'PACKING_SLIP')}
            />
          );
        })}
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
