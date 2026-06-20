// Mobile Step Wizard B - macro steps (list / work) + unified footer for bill review.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Icon from '../ui/Icon.jsx';
import BillItemsListCard from './BillItemsListCard.jsx';
import ReceiveMatchPanel from './ReceiveMatchPanel.jsx';
import { computeRowSummary } from './bill-review-shared.js';
import { normalizeCode } from '../../lib/fuzzy-match.js';
import { pickFirstAttentionRow, pickNextRowAfterComplete } from './mobile-review-step-logic.js';

function MicroStepProgress({ steps, activeStep, onGotoStep }) {
  const trackRef = useRef(null);
  const tabRefs = useRef([]);
  const [indicator, setIndicator] = useState({ x: 0, y: 0, width: 0, height: 0, ready: false });

  const activeIndex = Math.max(0, steps.findIndex((s) => s.key === activeStep));
  const activeStepObj = steps[activeIndex] || steps[0];
  const shortLabel = (s) =>
    s.label === '??????????' ? '??????'
      : s.label === '?????/???' ? '??????'
      : s.label;

  const measureIndicator = useCallback(() => {
    const track = trackRef.current;
    const tab = tabRefs.current[activeIndex];
    if (!track || !tab) return;
    const tr = track.getBoundingClientRect();
    const tb = tab.getBoundingClientRect();
    setIndicator({
      x: tb.left - tr.left,
      y: tb.top - tr.top,
      width: tb.width,
      height: tb.height,
      ready: true,
    });
  }, [activeIndex]);

  useLayoutEffect(() => {
    measureIndicator();
  }, [measureIndicator, steps.length]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => measureIndicator());
    ro.observe(track);
    return () => ro.disconnect();
  }, [measureIndicator]);

  if (!steps?.length) return null;

  return (
    <div className={'mrs-progress-card card-canvas mrs-progress-card--on-' + (activeStep || 'match')}>
      <div className="mrs-progress-card__head">
        <span className="mrs-progress-card__title">???????</span>
        <span className="mrs-progress-card__active">{activeStepObj?.label}</span>
      </div>
      <div
        ref={trackRef}
        className={'mrs-progress mrs-progress--glass mrs-progress--on-' + (activeStep || 'match')}
        aria-label="?????????????"
      >
        <div
          className="mrs-progress__indicator"
          aria-hidden="true"
          style={{
            '--mrs-ind-x': indicator.x + 'px',
            '--mrs-ind-y': indicator.y + 'px',
            '--mrs-ind-w': indicator.width + 'px',
            '--mrs-ind-h': indicator.height + 'px',
            opacity: indicator.ready ? 1 : 0,
          }}
        />
        {steps.map((s, i) => {
          const isActive = s.key === activeStep;
          const isDone = s.done && !isActive;
          const isPending = !isActive && !s.done && !s.disabled;
          const canJump = !s.disabled && (s.done || isActive);
          const Tag = canJump && onGotoStep ? 'button' : 'span';
          return (
            <Tag
              key={s.key}
              ref={(el) => { tabRefs.current[i] = el; }}
              type={Tag === 'button' ? 'button' : undefined}
              className={
                'mrs-progress__tab mrs-progress__tab--' + s.key +
                (isActive ? ' is-active' : '') +
                (isDone ? ' is-done' : '') +
                (isPending ? ' is-pending' : '') +
                (s.disabled ? ' is-disabled' : '') +
                (canJump && onGotoStep ? ' is-tappable' : '')
              }
              style={{ gridColumn: i + 1 }}
              disabled={Tag === 'button' ? !canJump : undefined}
              onClick={canJump && onGotoStep ? () => onGotoStep(s.key) : undefined}
              aria-current={isActive ? 'step' : undefined}
              aria-label={s.label}
            >
              <span className="mrs-progress__tab-icon" aria-hidden="true">
                {isDone ? <Icon name="check" size={13}/> : <Icon name={s.icon} size={14}/>}
              </span>
              <span className="mrs-progress__label">{shortLabel(s)}</span>
            </Tag>
          );
        })}
      </div>
    </div>
  );
}

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
  const saveLabel = submitting
    ? '???????????…'
    : `????????????? (${(batchSummary?.actionable || 0) - (batchSummary?.blocked || 0)} ???)`;

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
          ?????????????????????
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

  let primaryLabel = '?????';
  if (step === 'tiktok') primaryLabel = '???????????';
  else if (step === 'qtycost' && !wizardMeta?.steps?.some((s) => s.key === 'tiktok')) {
    primaryLabel = '???????????';
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
            <><Icon name="menu" size={14}/> ???????????????</>
          ) : (
            <><Icon name="chevron-l" size={14}/> ????</>
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
              <span className="mrs-list__head-title">?????????????</span>
              <span className="mrs-list__head-meta tabular-nums">
                ?????????? {rowSummary.matched}/{rowSummary.total}
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
              <MicroStepProgress
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
