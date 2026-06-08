import React from 'react';
import Modal from '../ui/Modal.jsx';
import Icon from '../ui/Icon.jsx';

/** Ask whether to match TikTok SKU before adding a receive line. */
export default function TikTokMatchPromptModal({
  open,
  product,
  onMatch,
  onSkipSync,
  onClose,
}) {
  const name = product?.name || 'สินค้านี้';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="จับคู่ TikTok Shop"
      footer={(
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>ยกเลิก</button>
          <button type="button" className="btn-secondary" onClick={onSkipSync}>ไม่ sync</button>
          <button type="button" className="btn-primary" onClick={onMatch}>
            <Icon name="link" size={16}/> จับคู่ก่อน
          </button>
        </>
      )}
    >
      <div className="space-y-3 text-sm">
        <p className="leading-relaxed text-ink">
          ต้องการจับคู่ <span className="font-semibold">{name}</span> กับ TikTok Shop
          ก่อนเพิ่มเข้ารายการรับเข้าไหม?
        </p>
        {product?.barcode && (
          <p className="text-xs text-muted font-mono">Barcode: {product.barcode}</p>
        )}
        <p className="text-xs text-muted-soft leading-relaxed">
          เลือก <strong>จับคู่ก่อน</strong> เพื่อเลือก TikTok SKU แล้วค่อยเพิ่มเข้ารายการ
          หรือ <strong>ไม่ sync</strong> หากไม่ต้องการ mirror สต็อกรายการนี้
        </p>
      </div>
    </Modal>
  );
}
