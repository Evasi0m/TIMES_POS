import React, { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import {
  onUpdateStateChange,
  applyAppUpdate,
  snoozeUpdate,
} from '../../lib/app-update.js';

export default function AppUpdateBanner() {
  const [state, setState] = useState({
    status: 'idle',
    remoteBuildId: null,
    error: null,
  });

  useEffect(() => onUpdateStateChange(setState), []);

  const { status, error } = state;

  if (status === 'idle') return null;

  const isApplying = status === 'applying';
  const isError = status === 'error';

  const handleApply = () => {
    applyAppUpdate({ manualReset: window._manualReset }).catch(() => {});
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        'sticky top-0 z-[79] w-full px-4 py-2.5 flex items-center justify-center gap-3 flex-wrap ' +
        'border-b border-primary/15 shadow-sm ' +
        (isError
          ? 'bg-error/10 text-error'
          : 'bg-surface-cream-strong text-ink')
      }
    >
      {!isError && (
        <span className="inline-block w-2 h-2 rounded-full bg-primary shrink-0" aria-hidden />
      )}
      {isError && <Icon name="alert" size={16} className="shrink-0 text-error" />}

      <span className="text-sm font-medium text-center">
        {isApplying && 'กำลังอัปเดตแอป… รอสักครู่'}
        {isError && (error || 'อัปเดตไม่สำเร็จ — ลองอีกครั้งหรือรีเซ็ตขั้นสูงในการตั้งค่า')}
        {!isApplying && !isError && 'มีเวอร์ชันใหม่ — อัปเดตเพื่อใช้ฟีเจอร์ล่าสุด'}
      </span>

      {!isApplying && (
        <div className="flex items-center gap-2 shrink-0">
          {!isError && (
            <button
              type="button"
              className="btn-primary !py-1.5 !px-3 text-xs"
              onClick={handleApply}
            >
              อัปเดตเลย
            </button>
          )}
          {isError && (
            <button
              type="button"
              className="btn-primary !py-1.5 !px-3 text-xs"
              onClick={handleApply}
            >
              ลองอีกครั้ง
            </button>
          )}
          {!isError && (
            <button
              type="button"
              className="btn-secondary !py-1.5 !px-3 text-xs"
              onClick={snoozeUpdate}
            >
              ไว้ทีหลัง
            </button>
          )}
        </div>
      )}
    </div>
  );
}
