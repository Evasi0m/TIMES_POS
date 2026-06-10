import React, { useEffect, useMemo, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import TikTokOrderCard from './TikTokOrderCard.jsx';
import TikTokListPagination from './TikTokListPagination.jsx';
import { TikTokGlassSection, TikTokGlassBtn, TikTokGlassShell } from './glass/index.js';

function OrderSkeleton({ n = 5 }) {
  return (
    <TikTokGlassShell loading={false}>
      <div className="tt-glass__body-inner" role="status" aria-live="polite" aria-label="กำลังโหลดออเดอร์">
        {Array.from({ length: n }).map((_, i) => (
          <div key={i} className="tt-glass__pane mb-2 space-y-3 !p-4">
            <div className="skeleton h-4 w-48 tt-r-control"/>
            <div className="flex gap-3">
              <div className="skeleton w-14 h-14 tt-r-card shrink-0"/>
              <div className="flex-1 space-y-2">
                <div className="skeleton h-4 w-full tt-r-control"/>
                <div className="skeleton h-3 w-24 tt-r-control"/>
              </div>
            </div>
          </div>
        ))}
      </div>
    </TikTokGlassShell>
  );
}

export default function TikTokOrderList({
  loading,
  orders,
  ordersTruncated = false,
  ordersCap,
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
      <TikTokGlassSection title="รายการออเดอร์">
        <div className="tt-glass__empty">
          <div className="tt-glass__empty-icon">
            <Icon name="package" size={24}/>
          </div>
          <div className="text-muted text-sm mb-4 max-w-md mx-auto">
            {shipFilter === 'to_ship'
              ? 'ยังไม่มีออเดอร์ "ที่จะจัดส่ง" — ระบบกำลังดึงจาก TikTok อัตโนมัติ'
              : 'ยังไม่มีออเดอร์ในแท็บนี้ — รอซิงค์จาก TikTok หรือกดปุ่มด้านล่าง'}
          </div>
          <TikTokGlassBtn variant="coral" className="tt-glass__btn--lg" onClick={onSyncOrders} disabled={syncing}>
            {syncing
              ? <span className="text-sm font-semibold tabular-nums">{syncPct}%</span>
              : pullBusy
                ? <span className="spinner"/>
                : <Icon name="refresh" size={16}/>}
            อัปเดตข้อมูลจาก TikTok
          </TikTokGlassBtn>
          <p className="text-xs text-muted-soft mt-4 max-w-md mx-auto leading-relaxed">
            ซิงค์อัตโนมัติทุก {livePollSec} วินาที + cron ทุก 5 นาที —
            ครั้งแรกอาจใช้เวลาสักครู่ถ้ามีออเดอร์จำนวนมาก (ดึงทีละ ~60 รายการ)
          </p>
        </div>
      </TikTokGlassSection>
    );
  }

  return (
    <TikTokGlassSection title="รายการออเดอร์" bodyClassName="!pt-2">
      <div className="tt-glass__order-list-meta">
        <span>
          พบ <span className="font-medium text-ink tabular-nums">{orders.length.toLocaleString('th-TH')}</span> รายการ
        </span>
        {ordersTruncated && ordersCap && (
          <span className="text-warning">
            · แสดง {ordersCap.toLocaleString('th-TH')} ออเดอร์ล่าสุด
          </span>
        )}
        {orders.length > pageSize && (
          <span className="text-muted-soft tabular-nums">
            · หน้า {safePage}/{totalPages}
          </span>
        )}
      </div>

      <div className="tt-glass__order-list-head">
        <div>สินค้า</div>
        <div>สถานะ</div>
        <div>การจัดส่ง</div>
        <div className="text-right">ราคา</div>
        <div className="text-right">การดำเนินการ</div>
      </div>

      <div className="tt-glass__order-list-body">
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
    </TikTokGlassSection>
  );
}
