import React from 'react';
import Icon from '../../ui/Icon.jsx';
import { TTC_COPY } from './copy.js';

const STEPS = [
  { id: 1, label: 'เลือกสินค้า' },
  { id: 2, label: 'ตรวจสอบ' },
  { id: 3, label: 'กรอกเงิน' },
  { id: 4, label: 'ยืนยัน' },
];

function resolveStep({ allMatched, viewMode, resolutionBlocked, stockBlocked, netOk }) {
  if (!allMatched || viewMode === 'match' || resolutionBlocked) return 1;
  if (stockBlocked) return 2;
  if (!netOk) return 3;
  return 4;
}

function resolveHint(step, { stockBlocked, resolutionBlocked }) {
  switch (step) {
    case 1:
      if (resolutionBlocked) return TTC_COPY.stepResolutionHint;
      return TTC_COPY.stepPickHint;
    case 2:
      if (stockBlocked) return TTC_COPY.stepStockHint;
      return TTC_COPY.stepReviewHint;
    case 3:
      return TTC_COPY.stepNetHint;
    default:
      return TTC_COPY.stepReadyHint;
  }
}

export default function TikTokStepProgress({
  allMatched,
  viewMode,
  netOk,
  stockBlocked,
  resolutionBlocked,
}) {
  const current = resolveStep({
    allMatched,
    viewMode,
    resolutionBlocked,
    stockBlocked,
    netOk,
  });
  const hint = resolveHint(current, { stockBlocked, resolutionBlocked });

  return (
    <div className="ttc-step-bar shrink-0 px-4 py-2 border-b hairline flex items-center gap-3">
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 overflow-x-auto">
        {STEPS.map((s, i) => {
          const done = s.id < current;
          const active = s.id === current;
          return (
            <React.Fragment key={s.id}>
              {i > 0 && (
                <div className={'h-0.5 w-2 sm:w-4 rounded-full shrink-0 ' + (done ? 'bg-[#0a7a43]/50' : 'bg-hairline')}/>
              )}
              <div className={'flex items-center gap-1 shrink-0 ' + (active ? '' : done ? 'opacity-95' : 'opacity-45')}>
                <span className={
                  'flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold shrink-0 ' +
                  (done ? 'bg-[#0a7a43] text-white' : active ? 'bg-[#f42f68] text-white ring-2 ring-[#f42f68]/25' : 'bg-surface-soft border hairline text-muted')
                }>
                  {done ? <Icon name="check" size={13}/> : s.id}
                </span>
                <span className={'text-[10px] font-medium hidden md:inline ' + (active ? 'text-ink font-semibold' : done ? 'text-[#0a7a43]' : 'text-muted')}>
                  {s.label}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
      <div className="h-4 w-px bg-hairline shrink-0 hidden sm:block"/>
      <p className="text-[11px] text-muted leading-snug truncate min-w-0">{hint}</p>
    </div>
  );
}
