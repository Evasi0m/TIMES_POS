// Mobile Step Wizard B - macro steps (list / work) + unified footer for bill review.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../ui/Icon.jsx';
import BillItemsListCard from './BillItemsListCard.jsx';
import ReceiveMatchPanel from './ReceiveMatchPanel.jsx';
import ReceiveStepProgress from './ReceiveStepProgress.jsx';
import { computeRowSummary } from './bill-review-shared.js';
import { normalizeCode } from '../../lib/fuzzy-match.js';
import { pickFirstAttentionRow, pickNextRowAfterComplete } from './mobile-review-step-logic.js';

function UnifiedFooter({
  macroStep,
  wizardMeta,
  rowSummary,
  batchSummary,
  submitting,
  savingProgress,
  onSubmit,
  onStartAttention,
  onShowList,
  onFooterPrimary,
  onFooterSecondary,
}) {
  const ready = batchSummary?.readyToSubmit && !submitting;
  const pct = savingProgress?.total
    ? Math.round((savingProgress.done / savingProgress.total) * 100)
    : 0;
  const saveCount = Math.max(0, (batchSummary?.actionable || 0) - (batchSummary?.blocked || 0));
  const saveLabel = submitting
    ? 'กำลังบันทึก…'
    : `บันทึกทั้งหมด (${saveCount} บิล)`;

  if (rowSummary.attention === 0 && rowSummary.total > 0 && macroStep === 'list') {
    return (
      <div className="mrs-footer">
        {savingProgress && (
          <div className="h-1 rounded-full glass-tube overflow-hidden mb-2">
            <div
              className="h-full rounded-full glass-tube-fill bg-primary transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        <button
          type="button"
          className="btn-primary w-full !py-3 mrs-footer__save-ready"
          disabled={!ready}
          onClick={onSubmit}
        >
          {submitting
            ? <><span className="spinner"/> {saveLabel}</>
            : <><Icon name="check" size={16}/> {saveLabel}</>}
        </button>
      </div>
    );
  }

  if (macroStep === 'list') {
    return (
      <div className="mrs-footer">
        <button
          type="button"
          className="btn-primary w-full !py-3"
          onClick={onStartAttention}
          disabled={rowSummary.attention === 0}
        >
          <Icon name="alert" size={16}/>
          ไปแก้รายการที่ค้าง
          {rowSummary.attention > 0 && (
            <span className="ml-1 tabular-nums">({rowSummary.attention})</span>
          )}
        </button>
      </div>
    );
  }

  const step = wizardMeta?.activeStep || 'match';
  const canAdvance = wizardMeta?.canAdvance;
  const canBack = wizardMeta?.canBack;

  let primaryLabel = 'ถัดไป';
  if (step === 'tiktok' || (step === 'qtycost' && !wizardMeta?.steps?.some((s) => s.key === 'tiktok'))) {
    primaryLabel = 'เสร็จรายการ';
  }

  return (
    <div className="mrs-footer">
      <div className="mrs-footer__row flex items-center gap-2">
        <button
          type="button"
          className="btn-secondary !py-2.5 !text-sm flex-1 min-w-0"
          onClick={step === 'match' ? onShowList : onFooterSecondary}
          disabled={step === 'match' ? false : !canBack}
        >
          {step === 'match' ? (
            <><Icon name="menu" size={14}/> รายการทั้งหมด</>
          ) : (
            <><Icon name="chevron-l" size={14}/> กลับ</>
          )}
        </button>
        <button
          type="button"
          className="btn-primary !py-2.5 !text-sm flex-1 min-w-0"
          onClick={onFooterPrimary}
          disabled={!canAdvance}
        >
          {primaryLabel} <Icon name="chevron-r" size={14}/>
        </button>
      </div>
    </div>
  );
}

export default function MobileReviewStepShell({
  rows,
  products,
  recentReceivesMap,
  hasVat,
  onUpdateRow,
  onRemoveRow,
  onPickCandidate,
  onSetNewProduct,
  tiktokMirrorEnabled,
  tiktokCatalog,
  tiktokCatalogLoading,
  tiktokCatalogError,
  onTiktokRetryCatalog,
  tiktokMinPct,
  onTiktokMinPctChange,
  onTiktokRowMatch,
  productImagesById,
  dupCodes,
  billComplete,
  onNavSummaryChange,
  batchSummary,
  submitting,
  savingProgress,
  onSubmit,
}) {
  const rowSummary = useMemo(
    () => computeRowSummary(rows, tiktokMirrorEnabled),
    [rows, tiktokMirrorEnabled],
  );

  const [macroStep, setMacroStep] = useState('list');
  const [activeUid, setActiveUid] = useState(null);
  const [wizardMeta, setWizardMeta] = useState(null);
  const wizardActionsRef = useRef({});

  const activeRow = rows.find((r) => r.uid === activeUid) || null;
  const activeIndex = activeRow ? rows.indexOf(activeRow) : 0;

  const selectUid = useCallback((uid) => {
    setActiveUid(uid);
    setMacroStep('work');
  }, []);

  const goToList = useCallback(() => {
    setMacroStep('list');
  }, []);

  const handleItemComplete = useCallback(() => {
    const next = pickNextRowAfterComplete(rows, activeIndex, tiktokMirrorEnabled);
    if (next) {
      setActiveUid(next.uid);
      setMacroStep('work');
    } else {
      setMacroStep('list');
    }
  }, [rows, activeIndex, tiktokMirrorEnabled]);

  const startFromAttention = useCallback(() => {
    const row = pickFirstAttentionRow(rows, tiktokMirrorEnabled);
    if (row) selectUid(row.uid);
    else setMacroStep('list');
  }, [rows, tiktokMirrorEnabled, selectUid]);

  const handleWizardMeta = useCallback((meta) => {
    setWizardMeta(meta);
    wizardActionsRef.current = meta;
  }, []);

  const handleFooterPrimary = useCallback(() => {
    wizardActionsRef.current?.advance?.();
  }, []);

  const handleFooterSecondary = useCallback(() => {
    wizardActionsRef.current?.back?.();
  }, []);

  // When the active row is removed, fall back to list (matches BillReviewPanel desktop guard).
  useEffect(() => {
    if (!activeUid || rows.some((r) => r.uid === activeUid)) return;
    if (!rows.length) {
      setActiveUid(null);
      setMacroStep('list');
      return;
    }
    setActiveUid(rows[0].uid);
    setMacroStep('list');
  }, [rows, activeUid]);

  useEffect(() => {
    onNavSummaryChange?.({
      rowIndex: activeIndex,
      totalRows: rows.length,
      attentionCount: rowSummary.attention,
      macroStep,
      goToList,
      wizardBack: wizardMeta?.back,
      wizardCanBack: wizardMeta?.canBack,
    });
  }, [
    activeIndex,
    rows.length,
    rowSummary.attention,
    macroStep,
    goToList,
    wizardMeta?.back,
    wizardMeta?.canBack,
    onNavSummaryChange,
  ]);

  const handlePick = useCallback((product) => {
    if (!activeUid) return;
    onPickCandidate(activeUid, product);
  }, [activeUid, onPickCandidate]);

  const handleCreateNew = useCallback((np) => {
    if (!activeUid) return;
    onSetNewProduct(activeUid, np);
  }, [activeUid, onSetNewProduct]);

  const recentInfo =
    activeRow?.status === 'auto' && activeRow.product?.id && recentReceivesMap
      ? recentReceivesMap.get(activeRow.product.id)
      : null;

  const duplicate = activeRow
    ? dupCodes.has(normalizeCode(activeRow.model_code))
    : false;

  return (
    <div className="mrs-shell">
      <div className="mrs-body">
        {macroStep === 'list' && (
          <div className="mrs-list">
            <div className="mrs-list__head">
              <span className="mrs-list__head-title">รายการในบิล</span>
              <span className="mrs-list__head-meta tabular-nums">
                ตรวจแล้ว {rowSummary.done}/{rowSummary.total}
              </span>
            </div>
            <BillItemsListCard
              variant="sheet"
              rows={rows}
              activeUid={activeUid}
              tiktokMirrorEnabled={tiktokMirrorEnabled}
              onSelect={selectUid}
            />
          </div>
        )}

        {macroStep === 'work' && activeRow && (
          <div className="mrs-work">
            {wizardMeta?.steps && (
              <ReceiveStepProgress
                steps={wizardMeta.steps}
                activeStep={wizardMeta.activeStep}
                onGotoStep={wizardMeta.gotoStep}
              />
            )}
            <ReceiveMatchPanel
              wizardMode
              row={activeRow}
              rowIndex={activeIndex}
              totalRows={rows.length}
              products={products}
              hasVat={hasVat}
              recentInfo={recentInfo}
              billComplete={billComplete}
              duplicate={duplicate}
              onRemove={() => onRemoveRow(activeUid)}
              onUpdate={(patch) => onUpdateRow(activeUid, patch)}
              onPick={handlePick}
              onCreateNew={handleCreateNew}
              tiktokMirrorEnabled={tiktokMirrorEnabled}
              tiktokCatalog={tiktokCatalog}
              tiktokCatalogLoading={tiktokCatalogLoading}
              tiktokCatalogError={tiktokCatalogError}
              onTiktokRetryCatalog={onTiktokRetryCatalog}
              tiktokMinPct={tiktokMinPct}
              onTiktokMinPctChange={onTiktokMinPctChange}
              onTiktokRowMatch={onTiktokRowMatch}
              productImagesById={productImagesById}
              hideFooter
              onWizardMetaChange={handleWizardMeta}
              onItemComplete={handleItemComplete}
            />
          </div>
        )}

        {macroStep === 'work' && !activeRow && rows.length > 0 && (
          <div className="py-8 text-center text-sm text-muted-soft">
            ไม่พบรายการที่เลือก — กลับไปรายการทั้งหมด
          </div>
        )}
      </div>

      <div className="mrs-footer__spacer" aria-hidden="true"/>
      <UnifiedFooter
        macroStep={macroStep}
        wizardMeta={wizardMeta}
        rowSummary={rowSummary}
        batchSummary={batchSummary}
        submitting={submitting}
        savingProgress={savingProgress}
        onSubmit={onSubmit}
        onStartAttention={startFromAttention}
        onShowList={goToList}
        onFooterPrimary={handleFooterPrimary}
        onFooterSecondary={handleFooterSecondary}
      />
    </div>
  );
}
