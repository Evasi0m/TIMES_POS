import React from 'react';
import Icon from '../../ui/Icon.jsx';

export default function TikTokBulkActionBar({
  selectedCount,
  onPrint,
  onShip,
  labelBusy,
  shipBusy,
}) {
  if (!selectedCount) return null;
  return (
    <div className="sticky top-0 z-10 glass-soft rounded-xl px-4 py-3 flex flex-wrap items-center gap-3 ring-1 ring-hairline shadow-sm">
      <span className="text-sm font-medium text-ink tabular-nums">
        เลือกแล้ว {selectedCount} ออเดอร์
      </span>
      <div className="flex flex-wrap gap-2 ml-auto">
        <button
          type="button"
          className="btn-primary !h-11 !py-0 !px-4 !text-sm min-h-[44px]"
          disabled={labelBusy === 'bulk'}
          onClick={onPrint}
        >
          {labelBusy === 'bulk' ? <span className="spinner"/> : <Icon name="printer" size={16}/>}
          ปริ้น label
        </button>
        <button
          type="button"
          className="btn-secondary !h-11 !py-0 !px-4 !text-sm min-h-[44px]"
          disabled={shipBusy === 'bulk'}
          onClick={onShip}
        >
          {shipBusy === 'bulk' ? <span className="spinner"/> : <Icon name="truck" size={16}/>}
          เตรียมจัดส่ง
        </button>
      </div>
    </div>
  );
}
