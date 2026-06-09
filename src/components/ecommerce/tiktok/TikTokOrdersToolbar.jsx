import React from 'react';
import Icon from '../../ui/Icon.jsx';

export default function TikTokOrdersToolbar({
  singleId,
  onSingleIdChange,
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
    <div className="card-canvas rounded-xl overflow-hidden p-4 lg:p-5 space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
        <div className="flex flex-wrap items-stretch gap-2 flex-1 min-w-0">
          <input
            type="text"
            value={singleId}
            onChange={(e) => onSingleIdChange(e.target.value)}
            placeholder="TikTok Order ID (ดึงรายตัว)"
            className="input !h-11 !min-h-11 !rounded-lg !py-0 !px-3 !text-sm flex-1 min-w-[10rem]"
            onKeyDown={(e) => { if (e.key === 'Enter') onSyncSingle(); }}
          />
          <button
            type="button"
            className="btn-secondary !h-11 !min-h-11 !py-0 !px-4 !text-sm shrink-0"
            onClick={onSyncSingle}
            disabled={singleBusy}
          >
            {singleBusy ? <span className="spinner"/> : <Icon name="download" size={16}/>}
            ดึงรายตัว
          </button>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            className="btn-secondary !h-11 !py-0 !px-4 !text-sm"
            onClick={onRefresh}
            disabled={loading || syncing || pullBusy}
          >
            {loading && !syncing ? <span className="spinner"/> : <Icon name="refresh" size={16}/>}
            รีเฟรช
          </button>
          <button
            type="button"
            className="btn-primary !h-11 !py-0 !px-4 !text-sm"
            onClick={onSyncOrders}
            disabled={syncing}
          >
            {syncing
              ? <span className="text-sm font-semibold tabular-nums min-w-[2ch]">{syncPct}%</span>
              : pullBusy
                ? <span className="spinner"/>
                : <Icon name="refresh" size={16}/>}
            อัปเดตข้อมูล TikTok
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 pt-3 border-t hairline">
        <button
          type="button"
          className="btn-primary !h-11 !py-0 !px-4 !text-sm min-h-[44px]"
          disabled={labelBusy === 'bulk'}
          onClick={onPrintLabels}
        >
          {labelBusy === 'bulk' ? <span className="spinner"/> : <Icon name="printer" size={16}/>}
          {selectedCount ? `ปริ้น label (${selectedCount})` : 'ปริ้น label ทั้งหมด'}
        </button>
        <button
          type="button"
          className="btn-secondary !h-11 !py-0 !px-4 !text-sm min-h-[44px]"
          disabled={shipBusy === 'bulk' || !selectedCount}
          onClick={onShipPackages}
        >
          {shipBusy === 'bulk' ? <span className="spinner"/> : <Icon name="truck" size={16}/>}
          เตรียมจัดส่ง{selectedCount ? ` (${selectedCount})` : ''}
        </button>
        <p className="text-xs text-muted sm:ml-auto sm:self-center leading-snug">
          {selectedCount > 0
            ? `เลือกแล้ว ${selectedCount} ออเดอร์`
            : `เลือกจากรายการด้านล่าง · มี ${activeFilteredCount} ออเดอร์ที่เลือกได้`}
        </p>
      </div>
    </div>
  );
}
