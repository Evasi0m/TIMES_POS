import React from 'react';
import Icon from '../../ui/Icon.jsx';
import TikTokReviewLineCard from './TikTokReviewLineCard.jsx';
import {
  orderHasSubstitutionBlock,
  orderHasStockIssue,
} from './helpers.js';

export default function TikTokOrderReviewPane({
  items,
  picks,
  catalog,
  substitutionMeta,
  disabled,
  onSubstitutionChange,
  onChangeProduct,
  onBackToMatch,
}) {
  const list = items || [];
  const substitutionBlocked = orderHasSubstitutionBlock(list, picks, substitutionMeta);
  const stockBlocked = orderHasStockIssue(list, picks, catalog);
  const blocked = substitutionBlocked || stockBlocked;

  return (
    <div className="ttc-review-pane flex flex-col h-full min-h-0">
      {/* แถบเครื่องมือบาง: สถานะรวม + กลับไปจับคู่ */}
      <div className="shrink-0 flex items-center gap-2 mb-2 min-w-0">
        <span className={'inline-flex items-center gap-1.5 text-xs font-semibold ' + (blocked ? 'text-amber-700' : 'text-[#0a7a43]')}>
          <Icon name={blocked ? 'alert' : 'check'} size={14}/>
          {blocked
            ? (substitutionBlocked ? 'มี SKU ไม่ตรง — ติ๊กส่งแทนหรือเปลี่ยนสินค้า' : 'สต็อกไม่พอ — เปลี่ยนสินค้า')
            : 'ตรวจครบแล้ว — กรอกเงินด้านล่าง'}
        </span>
        <span className="flex-1"/>
        {onBackToMatch && !disabled && (
          <button
            type="button"
            className="btn-secondary !py-1 !px-2.5 !text-[11px] shrink-0 whitespace-nowrap"
            onClick={onBackToMatch}
          >
            <Icon name="chevron-l" size={12}/> จับคู่
          </button>
        )}
      </div>

      {/* Bento grid — การ์ดยืด/ย่อเต็มพื้นที่ ไม่เหลือที่ว่าง */}
      <div className="ttc-review-bento flex-1 min-h-0">
        {list.map(it => (
          <TikTokReviewLineCard
            key={it.id}
            item={it}
            pick={picks[it.id]}
            catalog={catalog}
            substitutionMeta={substitutionMeta}
            disabled={disabled}
            onSubstitutionChange={onSubstitutionChange}
            onChangeProduct={onChangeProduct}
          />
        ))}
      </div>
    </div>
  );
}
