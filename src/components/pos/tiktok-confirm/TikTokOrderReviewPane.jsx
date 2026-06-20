import React from 'react';
import Icon from '../../ui/Icon.jsx';
import TikTokReviewLineCard from './TikTokReviewLineCard.jsx';
import {
  orderHasStockIssue,
  orderNeedsResolutionAck,
} from './helpers.js';
import { TTC_COPY } from './copy.js';

export default function TikTokOrderReviewPane({
  items,
  picks,
  orderCtx,
  catalog,
  substitutionMeta,
  matchConfirmed,
  disabled,
  onSubstitutionChange,
  onChangeProduct,
  onBackToMatch,
}) {
  const list = items || [];
  const resolutionBlocked = orderNeedsResolutionAck(list, picks, substitutionMeta, matchConfirmed);
  const stockBlocked = orderHasStockIssue(list, picks, catalog);
  const blocked = resolutionBlocked || stockBlocked;

  return (
    <div className="ttc-review-pane flex flex-col h-full min-h-0">
      {/* แถบเครื่องมือบาง: สถานะรวม + กลับไปจับคู่ */}
      <div className="shrink-0 flex items-center gap-2 mb-2 min-w-0">
        <span className={'inline-flex items-center gap-1.5 text-xs font-semibold ' + (blocked ? 'text-amber-700' : 'text-[#0a7a43]')}>
          <Icon name={blocked ? 'alert' : 'check'} size={14}/>
          {blocked
            ? (resolutionBlocked
              ? TTC_COPY.reviewBlockedResolution
              : TTC_COPY.reviewBlockedStock)
            : TTC_COPY.reviewAllClear}
        </span>
        <span className="flex-1"/>
        {onBackToMatch && !disabled && (
          <button
            type="button"
            className="btn-secondary !py-1 !px-2.5 !text-[11px] shrink-0 whitespace-nowrap"
            onClick={onBackToMatch}
          >
            <Icon name="chevron-l" size={12}/> {TTC_COPY.reviewBackToMatch}
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
            orderCtx={orderCtx}
            substitutionMeta={substitutionMeta}
            matchConfirmed={matchConfirmed}
            disabled={disabled}
            onSubstitutionChange={onSubstitutionChange}
            onChangeProduct={onChangeProduct}
          />
        ))}
      </div>
    </div>
  );
}
