import React from 'react';
import Icon from '../../ui/Icon.jsx';
import DeferNetButton from '../DeferNetButton.jsx';

/** Net-received card — softened red accent on a cream frame (cart tone). */
function NetReceivedCard({ allMatched, deferNet, setDeferNet, net, setNet, saving }) {
  return (
    <div
      className={
        'ttc-net-card relative overflow-hidden rounded-xl px-3 py-2.5 ' +
        (!allMatched ? 'opacity-55 pointer-events-none select-none' : '')
      }
    >
      <div className="relative">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#b3261e]">
            <Icon name="store" size={11}/> เงินที่ร้านได้รับ
            <span className="text-muted-soft ml-0.5 font-normal normal-case tracking-normal">(TikTok)</span>
          </div>
        </div>

        {!allMatched ? (
          <div className="text-xs text-muted leading-relaxed">
            จับคู่สินค้าครบก่อน แล้วค่อยกรอกยอดเงิน
          </div>
        ) : deferNet ? (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 h-10 px-3 rounded-xl bg-surface-soft/70 border hairline text-muted text-xs flex-1">
              <Icon name="bell" size={14}/> จะกรอกยอดจริงภายหลังผ่านปุ่มกระดิ่ง
            </div>
            <DeferNetButton
              active={deferNet}
              disabled={saving}
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
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <input
                type="number"
                inputMode="decimal"
                className="input !h-10 !rounded-xl !py-2 !text-sm w-full"
                placeholder="ยอดที่ TikTok โอนเข้าร้าน (บาท)"
                value={net}
                onChange={e => { setNet(e.target.value); setDeferNet(false); }}
                disabled={saving}
              />
            </div>
            <DeferNetButton
              active={deferNet}
              disabled={saving}
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
  netOk,
  onConfirm,
}) {
  const canConfirm = allMatched && netOk && !saving;

  return (
    <div className="px-4 py-3 border-t-2 border-ink/10 bg-surface-cream-strong shrink-0 space-y-2.5">
      {/* Net card only matters after matching — hidden in step 1 to give the
          recommendation list more room (purely presentational). */}
      {allMatched ? (
        <NetReceivedCard
          allMatched={allMatched}
          deferNet={deferNet}
          setDeferNet={setDeferNet}
          net={net}
          setNet={setNet}
          saving={saving}
        />
      ) : (
        <div className="text-xs text-muted flex items-center gap-2 px-1">
          <Icon name="link" size={14}/>
          <span>จับคู่สินค้า POS ให้ครบทุกรายการก่อน แล้วจึงกรอกยอดเงิน</span>
        </div>
      )}

      {canConfirm && (
        <div className="text-sm text-[#0a7a43] flex items-center gap-2 px-1">
          <Icon name="check" size={16}/>
          <span>พร้อมยืนยัน — กดปุ่มด้านล่างเพื่อตัดสต็อกและออกใบเสร็จ</span>
        </div>
      )}

      <button
        type="button"
        className={'btn-primary w-full !py-3.5 !text-base inline-flex items-center justify-center gap-2 min-h-[48px] ' + (!canConfirm ? 'opacity-60 cursor-not-allowed' : '')}
        onClick={onConfirm}
        disabled={!canConfirm}
      >
        {saving ? <span className="spinner"/> : <Icon name="check" size={18}/>}
        ยืนยันการขาย · ตัดสต็อก
      </button>
    </div>
  );
}
