import React from 'react';
import Icon from '../../ui/Icon.jsx';

const STEPS = [
  { id: 1, label: 'จับคู่สินค้า' },
  { id: 2, label: 'กรอกเงิน' },
  { id: 3, label: 'ยืนยัน' },
];

export default function TikTokStepProgress({ allMatched, netOk }) {
  const current = !allMatched ? 1 : !netOk ? 2 : 3;

  const hint =
    current === 1 ? 'เลือกสินค้า POS ให้ตรงกับรายการ TikTok'
      : current === 2 ? 'กรอกยอดเงินที่ TikTok โอนเข้าร้าน (หรือใส่ทีหลัง)'
        : 'ตรวจสอบครบแล้ว — กดยืนยันเพื่อตัดสต็อก';

  return (
    <div className="ttc-step-bar shrink-0 px-4 py-2 border-b hairline flex items-center gap-3">
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
        {STEPS.map((s, i) => {
          const done = s.id < current;
          const active = s.id === current;
          return (
            <React.Fragment key={s.id}>
              {i > 0 && (
                <div className={'h-0.5 w-3 sm:w-5 rounded-full ' + (done ? 'bg-[#0a7a43]/50' : 'bg-hairline')}/>
              )}
              <div className={'flex items-center gap-1.5 shrink-0 ' + (active ? '' : done ? 'opacity-95' : 'opacity-45')}>
                <span className={
                  'flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold shrink-0 ' +
                  (done ? 'bg-[#0a7a43] text-white' : active ? 'bg-primary text-white ring-2 ring-primary/25' : 'bg-surface-soft border hairline text-muted')
                }>
                  {done ? <Icon name="check" size={13}/> : s.id}
                </span>
                <span className={'text-[11px] font-medium hidden sm:inline ' + (active ? 'text-ink font-semibold' : done ? 'text-[#0a7a43]' : 'text-muted')}>
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
