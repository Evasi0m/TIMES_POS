import React from 'react';
import Icon from '../../ui/Icon.jsx';
import { TikTokGlassBtn } from './glass/index.js';

export default function TikTokOrdersToolbar({
  singleId,
  onSingleIdChange,
  orderSearch = '',
  onOrderSearchChange,
  onSyncSingle,
  onSyncOrders,
  onRefresh,
  onPrintLabels,
  onShipPackages,
  loading,
  syncing,
  pullBusy,
  singleBusy,
  syncPct,
  labelBusy,
  shipBusy,
  selectedCount,
  activeFilteredCount,
}) {
  return (
    <div className="tt-glass__toolbar-surface" aria-label="เครื่องมือออเดอร์">
      <div className="tt-glass__toolbar-surface-head">
        <div>
          <div className="tt-glass__group-title">Order Tools</div>
          <p className="tt-glass__group-caption">ดึงออเดอร์รายตัว ซิงค์ข้อมูล และสั่งงาน label</p>
        </div>
      </div>
      <div className="tt-glass__toolbar">
        <div className="tt-glass__toolbar-row">
          <div className="flex flex-wrap items-stretch gap-2 flex-1 min-w-0">
            <input
              type="text"
              value={singleId}
              onChange={(e) => onSingleIdChange(e.target.value)}
              placeholder="TikTok Order ID (ดึงรายตัว)"
              className="tt-glass__input tt-glass__input--lg flex-1 min-w-[10rem]"
              onKeyDown={(e) => { if (e.key === 'Enter') onSyncSingle(); }}
            />
            <TikTokGlassBtn
              variant="outline"
              className="tt-glass__btn--lg shrink-0"
              onClick={onSyncSingle}
              disabled={singleBusy}
            >
              {singleBusy ? <span className="spinner"/> : <Icon name="download" size={16}/>}
              ดึงรายตัว
            </TikTokGlassBtn>
          </div>
          <div className="tt-glass__toolbar-actions">
            <TikTokGlassBtn
              variant="outline"
              className="tt-glass__btn--lg"
              onClick={onRefresh}
              disabled={loading || syncing || pullBusy}
            >
              {loading && !syncing ? <span className="spinner"/> : <Icon name="refresh" size={16}/>}
              รีเฟรช
            </TikTokGlassBtn>
            <TikTokGlassBtn
              variant="coral"
              className="tt-glass__btn--lg"
              onClick={onSyncOrders}
              disabled={syncing}
            >
              {syncing
                ? <span className="text-sm font-semibold tabular-nums min-w-[2ch]">{syncPct}%</span>
                : pullBusy
                  ? <span className="spinner"/>
                  : <Icon name="refresh" size={16}/>}
              อัปเดตข้อมูล TikTok
            </TikTokGlassBtn>
          </div>
        </div>

        <div className="tt-glass__toolbar-divider flex flex-col sm:flex-row sm:flex-wrap gap-2">
          <div className="flex flex-wrap items-stretch gap-2 flex-1 min-w-0">
            <input
              type="search"
              aria-label="ค้นหาออเดอร์ POS หรือ TikTok Order ID"
              value={orderSearch}
              onChange={(e) => onOrderSearchChange?.(e.target.value)}
              placeholder="ค้นหา POS # หรือ TikTok Order ID (ข้ามแท็บ)"
              className="tt-glass__input tt-glass__input--lg flex-1 min-w-[12rem]"
            />
          </div>
        </div>

        <div className="tt-glass__toolbar-divider flex flex-col sm:flex-row sm:flex-wrap gap-2">
          <TikTokGlassBtn
            variant="coral"
            className="tt-glass__btn--lg"
            disabled={labelBusy === 'bulk'}
            onClick={onPrintLabels}
          >
            {labelBusy === 'bulk' ? <span className="spinner"/> : <Icon name="printer" size={16}/>}
            {selectedCount ? `ปริ้น label (${selectedCount})` : 'ปริ้น label ทั้งหมด'}
          </TikTokGlassBtn>
          <TikTokGlassBtn
            variant="outline"
            className="tt-glass__btn--lg"
            disabled={shipBusy === 'bulk' || !selectedCount}
            onClick={onShipPackages}
          >
            {shipBusy === 'bulk' ? <span className="spinner"/> : <Icon name="truck" size={16}/>}
            เตรียมจัดส่ง{selectedCount ? ` (${selectedCount})` : ''}
          </TikTokGlassBtn>
          <p className="text-xs text-muted sm:ml-auto sm:self-center leading-snug">
            {selectedCount > 0
              ? `เลือกแล้ว ${selectedCount} ออเดอร์`
              : `เลือกจากรายการด้านล่าง · มี ${activeFilteredCount} ออเดอร์ที่เลือกได้`}
          </p>
        </div>
      </div>
    </div>
  );
}
