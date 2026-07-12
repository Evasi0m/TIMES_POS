import React from 'react';
import Icon from '../../ui/Icon.jsx';
import TikTokReturnList from './TikTokReturnList.jsx';
import TikTokReturnConfirmPane from './TikTokReturnConfirmPane.jsx';
import { fmtTHB, fmtTime } from '../tiktok-confirm/helpers.js';
import { TTR_COPY } from './copy.js';

const isMobileViewport = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(max-width: 1023px)').matches;

export default function TikTokReturnModal(props) {
  const {
    closing, onClose, onBack, activeOrder, count, sortedOrders, sortOrder, onSortChange,
    onOpenOrder, openingId, saving, goodsReturned, setGoodsReturned, notes, setNotes,
    onConfirm, canConfirm,
  } = props;
  const isConfirmView = Boolean(activeOrder);
  const mobile = isMobileViewport();
  const countLabel = count > 99 ? '99+' : count;

  return (
    <div className={'fixed inset-0 z-[130] flex p-0 sm:p-4 ' + (mobile ? 'items-end justify-center ' : 'items-center justify-center p-3 ')} onClick={onClose}>
      <div className={`absolute inset-0 modal-overlay ${closing ? 'holo-backdrop-out' : 'holo-backdrop-in'}`} />
      <div className={'ttc-return-modal ttc-modal-card relative w-full glass-strong border hairline overflow-hidden flex flex-col ' + (mobile ? 'rounded-t-2xl rounded-b-none max-h-[92vh] pb-safe ' + (closing ? 'sheet-out' : 'sheet-anim') : 'rounded-3xl ttc-modal-card--' + (isConfirmView ? 'confirm' : 'list') + ' ' + (closing ? 'holo-card-out' : 'holo-card-in'))} onClick={(e) => e.stopPropagation()}>
        <div key={isConfirmView ? 'confirm-header' : 'list-header'} className={'ttc-modal-header ttc-amber-header ttc-header-enter relative shrink-0 ' + (mobile ? 'ttc-modal-header--sheet' : 'flex items-center gap-2.5 px-4 py-3')}>
          {mobile && <div className="ttc-sheet-grab w-10 h-1 rounded-full mx-auto mt-2.5 shrink-0" aria-hidden="true" />}
          <div className={mobile ? 'flex items-center gap-2.5 px-4 pb-3 pt-1' : 'contents'}>
            {isConfirmView ? (
              <button type="button" className="pnb-iconbtn -ml-1" onClick={onBack} aria-label="กลับไปรายการ" disabled={saving}><Icon name="chevron-l" size={20}/></button>
            ) : (
              <span className="ttc-amber-mesh-chip ttc-amber-mesh-chip--header"><span className="ttc-return-badge__count-num">{countLabel}</span></span>
            )}
            <div className="min-w-0 flex-1 ttc-modal-header__text">
              <div className="ttc-modal-header__title font-semibold text-[16px] leading-tight truncate">{isConfirmView ? TTR_COPY.modalTitle : TTR_COPY.badgeLabel}</div>
              <div className="ttc-modal-header__sub text-[12px] mt-0.5 tabular-nums truncate">{isConfirmView ? `${fmtTime(activeOrder.sale_date)} · ${fmtTHB(activeOrder.grand_total)}` : `${count} ออเดอร์`}</div>
            </div>
            <button type="button" className="pnb-iconbtn" onClick={onClose} aria-label="ปิด" disabled={saving || closing}><Icon name="x" size={18}/></button>
          </div>
        </div>
        <div className="relative flex-1 min-h-0 flex flex-col">
          <div key={isConfirmView ? 'confirm' : 'list'} className="ttc-view-stage flex-1 min-h-0 flex flex-col">
            {isConfirmView ? (
              <div className="ttc-view-enter ttc-view-enter--forward flex flex-col flex-1 min-h-0">
                <TikTokReturnConfirmPane order={activeOrder} goodsReturned={goodsReturned} setGoodsReturned={setGoodsReturned} notes={notes} setNotes={setNotes} saving={saving} />
                <div className="p-4 border-t hairline shrink-0">
                  <button type="button" className="btn-primary w-full !py-3" disabled={saving || !canConfirm} onClick={onConfirm}>{saving ? 'กำลังบันทึก...' : TTR_COPY.confirmBtn}</button>
                </div>
              </div>
            ) : (
              <div className="ttc-view-enter ttc-view-enter--back flex flex-col flex-1 min-h-0">
                <TikTokReturnList orders={sortedOrders} sortOrder={sortOrder} onSortChange={onSortChange} onOpen={onOpenOrder} openingId={openingId} disabled={false} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
