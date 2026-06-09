import React from 'react';
import TikTokSettings from '../../settings/TikTokSettings.jsx';

export default function TikTokConnectionStrip({ toast, livePollSec, liveLabel, pullBusy }) {
  return (
    <div className="card-canvas rounded-xl overflow-hidden">
      <div className="p-4 lg:p-5 space-y-3">
        <TikTokSettings toast={toast} compact />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-soft pt-1 border-t hairline">
          <span>ซิงค์อัตโนมัติทุก {livePollSec} วินาทีขณะเปิดหน้านี้</span>
          {liveLabel && (
            <span className="tabular-nums">อัปเดตล่าสุด {liveLabel}</span>
          )}
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className={'w-2 h-2 rounded-full ' + (pullBusy ? 'bg-amber-500 animate-pulse' : 'bg-success animate-pulse')}/>
            {pullBusy ? 'กำลังซิงค์…' : 'Live'}
          </span>
        </div>
      </div>
    </div>
  );
}
