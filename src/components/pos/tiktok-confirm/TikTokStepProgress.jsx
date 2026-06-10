import React from 'react';
import Icon from '../../ui/Icon.jsx';

const STEPS = [
  { id: 1, label: 'จับคู่' },
  { id: 2, label: 'ตรวจสอบ' },
  { id: 3, label: 'กรอกเงิน' },
  { id: 4, label: 'ยืนยัน' },
];

function resolveStep({ allMatched, viewMode, substitutionBlocked, stockBlocked, netOk }) {
  if (!allMatched || viewMode === 'match') return 1;
  const reviewClear = !substitutionBlocked && !stockBlocked;
  if (!reviewClear) return 2;
  if (!netOk) return 3;
  return 4;
}

function resolveHint(step, { substitutionBlocked, stockBlocked }) {
  switch (step) {
    case 1:
      return 'เลือกสินค้า POS ที่จะตัดสต็อก — ไม่ต้องตรง TikTok ก็ได้ (ตรวจในขั้นถัดไป)';
    case 2:
      if (stockBlocked && substitutionBlocked) {
        return 'แก้สต็อกและติ๊กส่งแทนที่รายการสีเหลือง';
      }
      if (substitutionBlocked) {
        return 'ติ๊ก "ส่งจริงคนละรุ่น" ที่รายการ SKU ไม่ตรง — หรือเปลี่ยนสินค้าให้ตรง';
      }
      if (stockBlocked) {
        return 'มีรายการสต็อกไม่พอ — เปลี่ยนสินค้าหรือยกเลิกบน TikTok';
      }
      return 'ตรวจ SKU แต่ละบรรทัด — ถ้าลูกค้าขอเปลี่ยนรุ่น ติ๊กส่งแทน';
    case 3:
      return 'กรอกยอดเงินที่ TikTok โอนเข้าร้าน (หรือใส่ทีหลัง)';
    default:
      return 'พร้อมยืนยัน — กดปุ่มด้านล่างเพื่อตัดสต็อก';
  }
}

export default function TikTokStepProgress({
  allMatched,
  viewMode,
  netOk,
  stockBlocked,
  substitutionBlocked,
}) {
  const current = resolveStep({
    allMatched,
    viewMode,
    substitutionBlocked,
    stockBlocked,
    netOk,
  });
  const hint = resolveHint(current, { substitutionBlocked, stockBlocked });

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
                  (done ? 'bg-[#0a7a43] text-white' : active ? 'bg-primary text-white ring-2 ring-primary/25' : 'bg-surface-soft border hairline text-muted')
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
