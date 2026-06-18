import React from 'react';
import Icon from '../../ui/Icon.jsx';
import TikTokOrderConfirmPane from '../tiktok-confirm/TikTokOrderConfirmPane.jsx';
import WebPendingList from './WebPendingList.jsx';
import { fmtTHB, fmtTime } from '../tiktok-confirm/helpers.js';
import { WCC_COPY } from './copy.js';

const isMobileViewport = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(max-width: 1023px)').matches;

export default function WebPendingModal({
  closing,
  onClose,
  onBack,
  activeOrder,
  count,
  sortedOrders,
  sortOrder,
  onSortChange,
  onOpenOrder,
  saving,
  picks,
  setPicks,
  substitutionMeta,
  setSubstitutionMeta,
  matchConfirmed,
  setMatchConfirmed,
  net,
  setNet,
  deferNet,
  setDeferNet,
  allMatched,
  netOk,
  onConfirm,
  catalog,
  catalogLoading,
  catalogError,
  onRetryCatalog,
  toast,
}) {
  const isConfirmView = Boolean(activeOrder);
  const mobile = isMobileViewport();

  return (
    <div
      className={
        'fixed inset-0 z-[130] flex p-0 sm:p-4 ' +
        (mobile ? 'items-end justify-center ' : 'items-center justify-center p-3 ') +
        (closing ? 'overlay-out' : 'overlay-in')
      }
      onClick={onClose}
    >
      <div className={`absolute inset-0 modal-overlay ${closing ? 'holo-backdrop-out' : 'holo-backdrop-in'}`} />
      <div
        className={
          'wcc-pending-modal wcc-modal-card relative w-full glass-strong border hairline overflow-hidden flex flex-col ' +
          (mobile
            ? 'rounded-t-2xl rounded-b-none max-h-[92vh] pb-safe ' + (closing ? 'sheet-out' : 'sheet-anim')
            : 'rounded-3xl ' +
              (isConfirmView ? 'max-w-[min(96vw,900px)]' : 'max-w-[min(96vw,640px)]') +
              (isConfirmView ? ' max-h-[min(90vh,820px)] ' : ' h-[min(90vh,820px)] ') +
              (closing ? 'holo-card-out' : 'holo-card-in'))
        }
        onClick={e => e.stopPropagation()}
      >
        {mobile && (
          <div className="w-10 h-1 rounded-full bg-muted-soft/40 mx-auto mt-2 shrink-0" aria-hidden="true" />
        )}
        <div className="wcc-modal-header wcc-coral-frame relative flex items-center gap-2.5 px-4 py-3 border-b border-white/15 shrink-0">
          {isConfirmView ? (
            <button
              type="button"
              className="pnb-iconbtn -ml-1"
              onClick={onBack}
              aria-label="กลับไปรายการ"
              disabled={saving}
            >
              <Icon name="chevron-l" size={20}/>
            </button>
          ) : (
            <span className="pnb-bell-chip" style={{ background: '#e07a5f', color: '#fff' }}>
              <Icon name="shop-bag" size={15}/>
            </span>
          )}
          <div className="min-w-0 flex-1 wcc-modal-header__text">
            <div className="wcc-modal-header__title font-semibold text-[16px] leading-tight truncate">
              {isConfirmView ? WCC_COPY.modalConfirmTitle : WCC_COPY.modalListTitle}
            </div>
            <div className="wcc-modal-header__sub text-[12px] mt-0.5 tabular-nums truncate">
              {isConfirmView
                ? `${fmtTime(activeOrder.sale_date)} · ${fmtTHB(activeOrder.grand_total)}`
                : `${count} ออเดอร์รอยืนยัน`}
            </div>
          </div>
          <button type="button" className="pnb-iconbtn" onClick={onClose} aria-label="ปิด" disabled={saving || closing}>
            <Icon name="x" size={18}/>
          </button>
        </div>

        <div className="relative flex-1 min-h-0 flex flex-col">
          {isConfirmView ? (
            <TikTokOrderConfirmPane
              order={activeOrder}
              picks={picks}
              setPicks={setPicks}
              substitutionMeta={substitutionMeta}
              setSubstitutionMeta={setSubstitutionMeta}
              matchConfirmed={matchConfirmed}
              setMatchConfirmed={setMatchConfirmed}
              net={net}
              setNet={setNet}
              deferNet={deferNet}
              setDeferNet={setDeferNet}
              saving={saving}
              allMatched={allMatched}
              netOk={netOk}
              onConfirm={onConfirm}
              catalog={catalog}
              catalogLoading={catalogLoading}
              catalogError={catalogError}
              onRetryCatalog={onRetryCatalog}
              toast={toast}
              summaryVariant="web"
            />
          ) : (
            <WebPendingList
              orders={sortedOrders}
              sortOrder={sortOrder}
              onSortChange={onSortChange}
              onOpen={onOpenOrder}
              disabled={saving}
            />
          )}
        </div>
      </div>
    </div>
  );
}
