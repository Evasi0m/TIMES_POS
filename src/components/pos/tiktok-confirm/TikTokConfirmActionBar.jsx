import React from 'react';
import Icon from '../../ui/Icon.jsx';
import DeferNetButton from '../DeferNetButton.jsx';
import { TTC_COPY } from './copy.js';

function NetReceivedCard({ showNet, deferNet, setDeferNet, net, setNet, saving }) {
  return (
    <div
      className={
        'ttc-net-card relative overflow-hidden rounded-xl px-3 py-2.5 ' +
        (!showNet ? 'opacity-55 pointer-events-none select-none' : '')
      }
    >
      <div className="relative min-w-0">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ttc-net-card__label">
            <Icon name="store" size={11}/> เงินที่ร้านได้รับ
            <span className="text-muted-soft ml-0.5 font-normal normal-case tracking-normal">(TikTok)</span>
          </div>
        </div>

        {!showNet ? (
          <div className="text-xs text-muted leading-relaxed">
            ตรวจสอบรายการให้ครบก่อน แล้วค่อยกรอกยอดเงิน
          </div>
        ) : deferNet ? (
          <div className="flex flex-col gap-2 min-w-0">
            <div className="flex items-center gap-2 h-10 px-3 rounded-xl bg-surface-soft/70 border hairline text-muted text-xs min-w-0">
              <Icon name="bell" size={14} className="shrink-0"/>
              <span className="truncate">จะกรอกยอดจริงภายหลังผ่านปุ่มกระดิ่ง</span>
            </div>
            <DeferNetButton
              active={deferNet}
              disabled={saving}
              className="w-full justify-center !py-2 !text-xs"
              onToggle={() => {
                setDeferNet(v => {
                  const next = !v;
                  if (next) setNet('');
                  return next;
                });
              }}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2 min-w-0">
            <input
              type="number"
              inputMode="decimal"
              className="input !h-10 !rounded-xl !py-2 !text-sm w-full min-w-0"
              placeholder="ยอดที่ TikTok โอนเข้าร้าน (บาท)"
              value={net}
              onChange={e => { setNet(e.target.value); setDeferNet(false); }}
              disabled={saving}
            />
            <DeferNetButton
              active={deferNet}
              disabled={saving}
              className="w-full justify-center !py-2 !text-xs shrink-0"
              onToggle={() => {
                setDeferNet(v => {
                  const next = !v;
                  if (next) setNet('');
                  return next;
                });
              }}
            />
          </div>
        )}

        <div className="text-[11px] text-muted-soft mt-1.5">
          ใช้คำนวณกำไร · ไม่แสดงในใบเสร็จลูกค้า
        </div>
      </div>
    </div>
  );
}

export default function TikTokConfirmActionBar({
  net,
  setNet,
  deferNet,
  setDeferNet,
  saving,
  allMatched,
  viewMode,
  netOk,
  stockBlocked,
  resolutionBlocked,
  onConfirm,
}) {
  const reviewReady = allMatched && viewMode === 'review';
  const showNet = reviewReady && !stockBlocked && !resolutionBlocked;
  const canConfirm = showNet && netOk && !saving;

  const blocked = reviewReady && (stockBlocked || resolutionBlocked);

  return (
    <div className="px-4 py-3 ttc-confirm-footer bg-surface-cream-strong shrink-0 space-y-2.5 min-w-0 overflow-hidden">
      {reviewReady ? (
        <NetReceivedCard
          showNet={showNet}
          deferNet={deferNet}
          setDeferNet={setDeferNet}
          net={net}
          setNet={setNet}
          saving={saving}
        />
      ) : (
        <div className="text-xs text-muted flex items-center gap-2 px-1">
          <Icon name="link" size={14}/>
          <span>
            {allMatched
              ? TTC_COPY.actionGoReview
              : TTC_COPY.actionPickAll}
          </span>
        </div>
      )}

      <button
        type="button"
        className={'btn-ttc-coral-mesh w-full !py-3.5 !text-base inline-flex items-center justify-center gap-2 min-h-[48px] ' + (!canConfirm ? 'opacity-60 cursor-not-allowed' : '')}
        onClick={onConfirm}
        disabled={!canConfirm}
      >
        {saving ? <span className="spinner"/> : <Icon name="check" size={18}/>}
        {blocked ? TTC_COPY.actionFixFirst : TTC_COPY.actionConfirmSale}
      </button>
    </div>
  );
}
