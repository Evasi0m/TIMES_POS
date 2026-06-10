import React from 'react';
import Icon from '../../ui/Icon.jsx';
import { TikTokGlassBtn } from './glass/index.js';

export default function TikTokBulkActionBar({
  selectedCount,
  onPrint,
  onShip,
  labelBusy,
  shipBusy,
}) {
  if (!selectedCount) return null;
  return (
    <div className="tt-glass__sticky-bar flex flex-wrap items-center gap-3">
      <span className="tt-glass__sticky-bar__label">
        เลือกแล้ว {selectedCount} ออเดอร์
      </span>
      <div className="flex flex-wrap gap-2 ml-auto">
        <TikTokGlassBtn
          variant="coral"
          className="tt-glass__btn--lg"
          disabled={labelBusy === 'bulk'}
          onClick={onPrint}
        >
          {labelBusy === 'bulk' ? <span className="spinner"/> : <Icon name="printer" size={16}/>}
          ปริ้น label
        </TikTokGlassBtn>
        <TikTokGlassBtn
          variant="hero"
          className="tt-glass__btn--lg"
          disabled={shipBusy === 'bulk'}
          onClick={onShip}
        >
          {shipBusy === 'bulk' ? <span className="spinner"/> : <Icon name="truck" size={16}/>}
          เตรียมจัดส่ง
        </TikTokGlassBtn>
      </div>
    </div>
  );
}
