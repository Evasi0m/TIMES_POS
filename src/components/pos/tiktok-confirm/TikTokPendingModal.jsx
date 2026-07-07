import React from 'react';
import Icon from '../../ui/Icon.jsx';
import TikTokSyncOverlay from '../../ui/TikTokSyncOverlay.jsx';
import TikTokPendingList from './TikTokPendingList.jsx';
import TikTokOrderConfirmPane from './TikTokOrderConfirmPane.jsx';
import { fmtTHB, fmtTime } from './helpers.js';
import { TTC_COPY } from './copy.js';

const isMobileViewport = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(max-width: 1023px)').matches;

export default function TikTokPendingModal({
  closing,
  onClose,
  onBack,
  activeOrder,
  count,
  sortedOrders,
  sortOrder,
  onSortChange,
  onOpenOrder,
  openingId,
  refreshing,
  syncPct,
  onSync,
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
  const countLabel = count > 99 ? '99+' : count;

  return (
    <div
      className={
        'fixed inset-0 z-[130] flex p-0 sm:p-4 ' +
        (mobile ? 'items-end justify-center ' : 'items-center justify-center p-3 ')
      }
      onClick={onClose}
    >
      <div className={`absolute inset-0 modal-overlay ${closing ? 'holo-backdrop-out' : 'holo-backdrop-in'}`} />
      <div
        className={
          'ttc-pending-modal ttc-modal-card relative w-full glass-strong border hairline overflow-hidden flex flex-col ' +
          (mobile
            ? 'rounded-t-2xl rounded-b-none max-h-[92vh] pb-safe ' + (closing ? 'sheet-out' : 'sheet-anim')
            : 'rounded-3xl ttc-modal-card--' + (isConfirmView ? 'confirm' : 'list') + ' ' +
              (closing ? 'holo-card-out' : 'holo-card-in'))
        }
        onClick={e => e.stopPropagation()}
      >
        {/* Header — grab handle lives inside coral header on mobile */}
        <div
          key={isConfirmView ? 'confirm-header' : 'list-header'}
          className={
            'ttc-modal-header ttc-coral-header ttc-header-enter relative shrink-0 ' +
            (mobile
              ? 'ttc-modal-header--sheet'
              : 'flex items-center gap-2.5 px-4 py-3')
          }
        >
          {mobile && (
            <div className="ttc-sheet-grab w-10 h-1 rounded-full mx-auto mt-2.5 shrink-0" aria-hidden="true" />
          )}
          <div className={mobile ? 'flex items-center gap-2.5 px-4 pb-3 pt-1' : 'contents'}>
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
            <span className="ttc-coral-mesh-chip ttc-coral-mesh-chip--header">
              <span className="ttc-pending-badge__count-num">{countLabel}</span>
            </span>
          )}
          <div className="min-w-0 flex-1 ttc-modal-header__text">
            <div className="ttc-modal-header__title font-semibold text-[16px] leading-tight truncate">
              {isConfirmView ? TTC_COPY.modalConfirmTitle : TTC_COPY.badgeLabel}
            </div>
            <div className="ttc-modal-header__sub text-[12px] mt-0.5 tabular-nums truncate">
              {isConfirmView
                ? `${fmtTime(activeOrder.sale_date)} · ${fmtTHB(activeOrder.grand_total)}`
                : `${count} ออเดอร์`}
            </div>
          </div>
          <button type="button" className="pnb-iconbtn" onClick={onClose} aria-label="ปิด" disabled={saving || closing}>
            <Icon name="x" size={18}/>
          </button>
          </div>
        </div>

        {/* Body — list OR confirm (drill-in transition) */}
        <div className="relative flex-1 min-h-0 flex flex-col">
          {refreshing && !isConfirmView && (
            <TikTokSyncOverlay
              pct={syncPct}
              phase={refreshing ? 'in' : 'out'}
              className="rounded-none"
            />
          )}

          <div
            key={isConfirmView ? 'confirm' : 'list'}
            className="ttc-view-stage flex-1 min-h-0 flex flex-col"
          >
            {isConfirmView ? (
              <div className="ttc-view-enter ttc-view-enter--forward flex flex-col flex-1 min-h-0">
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
                />
              </div>
            ) : (
              <div className="ttc-view-enter ttc-view-enter--back flex flex-col flex-1 min-h-0">
                <TikTokPendingList
                  orders={sortedOrders}
                  sortOrder={sortOrder}
                  onSortChange={onSortChange}
                  onOpen={onOpenOrder}
                  openingId={openingId}
                  disabled={refreshing}
                  onSync={onSync}
                  refreshing={refreshing}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
