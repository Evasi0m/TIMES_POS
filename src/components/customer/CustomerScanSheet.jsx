import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../ui/Icon.jsx';
import { useMountedToggle } from '../../lib/use-mounted-toggle.js';
import {
  useBarcodeScanner,
  getPreferredFacing,
  setPreferredFacing,
} from '../../lib/use-barcode-scanner.js';

/**
 * Compact camera barcode scanner for the customer price screen.
 * On a successful decode it calls `onScan(code)` and closes.
 */
export default function CustomerScanSheet({ open, onClose, onScan }) {
  const { render, closing } = useMountedToggle(open, 220);
  const videoRef = useRef(null);
  const [facing, setFacing] = useState(getPreferredFacing());
  const onScanRef = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  const { status, torchSupported, torchOn, toggleTorch } = useBarcodeScanner({
    videoRef,
    enabled: render && !closing,
    facing,
    onDetect: (code) => {
      onScanRef.current?.(code);
    },
  });

  if (!render) return null;

  const flipFacing = () => {
    const next = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    setPreferredFacing(next);
  };

  return createPortal(
    <div
      className={'fixed inset-0 z-[140] flex flex-col bg-black ' + (closing ? 'overlay-out' : 'overlay-in')}
    >
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          playsInline
          muted
        />
        <div className="scanner-reticle" aria-hidden="true" />

        <div className="absolute top-0 inset-x-0 flex items-center justify-between p-3 text-white">
          <div className="font-display text-base font-semibold drop-shadow">สแกนบาร์โค้ด</div>
          <div className="flex items-center gap-2">
            {torchSupported && (
              <button
                type="button"
                onClick={toggleTorch}
                className={'scanner-icon-btn' + (torchOn ? ' is-on' : '')}
                aria-label="ไฟฉาย"
              >
                <Icon name="zap" size={18} />
              </button>
            )}
            <button type="button" onClick={flipFacing} className="scanner-icon-btn" aria-label="สลับกล้อง">
              <Icon name="flip-cam" size={18} />
            </button>
            <button type="button" onClick={onClose} className="scanner-icon-btn" aria-label="ปิด">
              <Icon name="x" size={18} />
            </button>
          </div>
        </div>

        {status !== 'running' && (
          <div className="scanner-status">
            {status === 'starting' && (<><span className="spinner" /> กำลังเปิดกล้อง…</>)}
            {status === 'denied' && (
              <div className="text-center px-6">
                <div className="mb-2"><Icon name="camera" size={36} /></div>
                <div className="font-display text-lg mb-1">ไม่ได้รับสิทธิ์ใช้กล้อง</div>
                <div className="text-sm opacity-80">เปิดสิทธิ์กล้องในเบราว์เซอร์ แล้วลองใหม่</div>
              </div>
            )}
            {status === 'unsupported' && (
              <div className="text-center px-6">
                <div className="mb-2"><Icon name="alert" size={32} /></div>
                <div className="font-display text-lg mb-1">เบราว์เซอร์ไม่รองรับ</div>
                <div className="text-sm opacity-80">ลองใช้ Chrome / Safari รุ่นใหม่บนมือถือ</div>
              </div>
            )}
            {status === 'error' && (
              <div className="text-center px-6">
                <div className="mb-2"><Icon name="alert" size={32} /></div>
                <div className="font-display text-lg mb-1">เปิดกล้องไม่สำเร็จ</div>
                <div className="text-sm opacity-80">ตรวจสอบกล้องแล้วลองใหม่</div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-black/70 px-4 py-3 text-xs text-white/80 text-center flex-shrink-0">
        วางบาร์โค้ดที่กล่องนาฬิกาในกรอบ — กล้องจะอ่านให้อัตโนมัติ
      </div>
    </div>,
    document.body,
  );
}
