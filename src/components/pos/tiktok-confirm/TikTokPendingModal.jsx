import React from 'react';
import Icon from '../../ui/Icon.jsx';
import TikTokSyncOverlay from '../../ui/TikTokSyncOverlay.jsx';
import TikTokPendingList from './TikTokPendingList.jsx';
import TikTokOrderConfirmPane from './TikTokOrderConfirmPane.jsx';
import { fmtTHB, fmtTime } from './helpers.js';

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
  refreshing,
  syncPct,
  onSync,
  saving,
  picks,
  setPicks,
  substitutionMeta,
  setSubstitutionMeta,
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
}) {
  const isConfirmView = Boolean(activeOrder);

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center p-3 sm:p-4"
      onClick={onClose}
    >
      <div className={`absolute inset-0 modal-overlay ${closing ? 'holo-backdrop-out' : 'holo-backdrop-in'}`} />
      <div
        className={
          'ttc-pending-modal ttc-modal-card relative w-full glass-strong rounded-3xl border hairline overflow-hidden flex flex-col ' +
          (isConfirmView ? 'max-w-[min(96vw,900px)]' : 'max-w-[min(96vw,640px)]') +
          ' h-[min(90vh,820px)] ' +
          (closing ? 'holo-card-out' : 'holo-card-in')
        }
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="ttc-modal-header ttc-brown-frame relative flex items-center gap-2.5 px-4 py-3 border-b border-white/15 shrink-0">
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
            <span className="pnb-bell-chip" style={{ background: '#fe2c55', color: '#fff' }}>
              <Icon name="cart" size={15}/>
            </span>
          )}
          <div className="min-w-0 flex-1 ttc-modal-header__text">
            <div className="ttc-modal-header__title font-semibold text-[16px] leading-tight truncate">
              {isConfirmView ? 'ยืนยันการขาย TikTok' : 'Order TikTok รอยืนยัน'}
            </div>
            <div className="ttc-modal-header__sub text-[12px] mt-0.5 tabular-nums truncate">
              {isConfirmView
                ? `${fmtTime(activeOrder.sale_date)} · ${fmtTHB(activeOrder.grand_total)}`
                : `${count} ออเดอร์รอยืนยัน`}
            </div>
          </div>
          <button type="button" className="pnb-iconbtn" onClick={onClose} aria-label="ปิด" disabled={saving || closing}>
            <Icon name="x" size={18}/>
          </button>
        </div>

        {/* Body — list OR confirm (ไม่ split) */}
        <div className="relative flex-1 min-h-0 flex flex-col">
          {refreshing && !isConfirmView && (
            <TikTokSyncOverlay
              pct={syncPct}
              phase={refreshing ? 'in' : 'out'}
              className="rounded-none"
            />
          )}

          {isConfirmView ? (
            <TikTokOrderConfirmPane
              order={activeOrder}
              picks={picks}
              setPicks={setPicks}
              substitutionMeta={substitutionMeta}
              setSubstitutionMeta={setSubstitutionMeta}
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
            />
          ) : (
            <TikTokPendingList
              orders={sortedOrders}
              sortOrder={sortOrder}
              onSortChange={onSortChange}
              onOpen={onOpenOrder}
              disabled={refreshing}
              onSync={onSync}
              refreshing={refreshing}
            />
          )}
        </div>
      </div>
    </div>
  );
}
