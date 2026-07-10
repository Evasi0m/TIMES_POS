// BillReviewPanel — focused wizard for AI bulk receive review.
// Top: item stepper (colored chips). Below: bill list card + ReceiveMatchPanel side by side.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Icon from '../ui/Icon.jsx';
import BottomSheet from '../ui/mobile/BottomSheet.jsx';
import { classifyMatch, normalizeCode } from '../../lib/fuzzy-match.js';
import { validateCmgBill } from '../../lib/cmg-bill-validate.js';
import ReceiveMatchPanel from './ReceiveMatchPanel.jsx';
import BillItemsListCard from './BillItemsListCard.jsx';
import MobileReviewStepShell from './MobileReviewStepShell.jsx';
import {
  computeRowSummary,
  computeTiktokBillSummary,
  firstAttentionRowIndex,
  getRowDisplayState,
  getRowStepperSku,
  nextAttentionRowIndex,
  prevAttentionRowIndex,
} from './bill-review-shared.js';

export {
  STATUS_META,
  SOFT_MATCH_FLOOR,
  rowNeedsAttention,
  getRowDisplayState,
} from './bill-review-shared.js';

let _rowUidCounter = 0;
export function makeRowUid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  _rowUidCounter += 1;
  return `r${Date.now().toString(36)}${_rowUidCounter}`;
}

export function buildRowFromAi(it, catalog, opts = {}) {
  const {
    forceReview = false,
    validationIssues = [],
    validationDetail = null,
  } = opts;
  const match = classifyMatch(it.model_code, catalog || []);
  return {
    uid: makeRowUid(),
    model_code: it.model_code,
    quantity:   Math.max(0, Math.round(Number(it.quantity) || 0)),
    unit_cost:  Math.max(0, Number(it.unit_cost) || 0),
    line_amount: Math.max(0, Number(it.line_amount) || 0),
    needsReview: Boolean(it.needs_review) || forceReview,
    reviewConfirmed: false,
    validationIssues: Array.isArray(validationIssues) ? validationIssues : [],
    validationDetail: validationDetail || null,
    status:     match.status,
    product:    match.product || null,
    matchScore: typeof match.score === 'number' ? match.score : null,
    candidates: match.candidates || [],
    newProduct: null,
    tiktok_skip: false,
    tiktok_sku: null,
    tiktok_mapping: null,
  };
}

/** Apply arithmetic validation and build review rows from a parsed bill. */
export function materializeParsedBill(parsed, catalog) {
  const validation = validateCmgBill(parsed);
  const itemsRaw = Array.isArray(parsed?.items) ? parsed.items : [];
  const rows = itemsRaw.map((it, j) => {
    const rowResult = validation.rows.find((r) => r.index === j);
    return buildRowFromAi(it, catalog, {
      forceReview: Boolean(validation.rowFlags[j]),
      validationIssues: rowResult?.issues || [],
      validationDetail: rowResult?.detail || null,
    });
  });
  return {
    rows,
    validation,
    bill_subtotal: Number(parsed?.bill_subtotal) || 0,
    total_qty: Math.max(0, Math.round(Number(parsed?.total_qty) || 0)),
    vat_amount: Number(parsed?.vat_amount) || 0,
    grand_total: Number(parsed?.grand_total) || 0,
  };
}

function ItemStepper({
  rows, activeUid, summary, tiktokMirrorEnabled, tiktokSummary, onSelect, onJumpAttention, onOpenAllItems,
}) {
  const chipsRef = useRef(null);

  useEffect(() => {
    const el = chipsRef.current?.querySelector(`[data-chip="${activeUid}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [activeUid]);

  return (
    <div className="air-stepper">
      <div className="air-stepper__progress">
        <span className="tabular-nums">{summary.matched}/{summary.total}</span>
        <span className="h-1.5 rounded-full glass-tube overflow-hidden air-stepper__bar inline-block align-middle">
          <span
            className="block h-full rounded-full bg-[#0fa39a] transition-all duration-300"
            style={{ width: `${summary.pct}%` }}
          />
        </span>
        {tiktokMirrorEnabled && tiktokSummary?.total > 0 && (
          <span className="air-stepper__tiktok-pill" title="จับคู่ TikTok แล้ว">
            <Icon name="store" size={11} className="shrink-0"/>
            {tiktokSummary.ready}/{tiktokSummary.total}
          </span>
        )}
        {onOpenAllItems && (
          <button
            type="button"
            className="air-stepper__all-items lg:hidden"
            onClick={onOpenAllItems}
          >
            <Icon name="menu" size={12}/>
            รายการทั้งหมด
          </button>
        )}
      </div>

      <div ref={chipsRef} className="air-stepper__chips">
        {rows.map((row, idx) => {
          const ds = getRowDisplayState(row, tiktokMirrorEnabled);
          const sku = getRowStepperSku(row);
          return (
            <button
              key={row.uid}
              type="button"
              data-chip={row.uid}
              className={
                'air-stepper__chip air-stepper__chip--' + ds.key +
                (row.uid === activeUid ? ' is-active' : '')
              }
              onClick={() => onSelect(row.uid)}
              title={`#${idx + 1} · ${sku} · ${ds.label}`}
              aria-label={`รายการที่ ${idx + 1} ${sku} · ${ds.label}`}
            >
              {idx + 1}
            </button>
          );
        })}
      </div>

      {summary.attention > 0 && (
        <button type="button" className="air-stepper__jump" onClick={onJumpAttention}>
          <Icon name="alert" size={12} className="inline mr-1"/>
          <span className="hidden lg:inline">ไปที่ต้องแก้ ({summary.attention})</span>
          <span className="lg:hidden">แก้ที่ค้าง ({summary.attention})</span>
        </button>
      )}
    </div>
  );
}

export default function BillReviewPanel({
  rows,
  products,
  recentReceivesMap = null,
  billKey = null,
  hasVat = false,
  billImageUrl = null,
  onZoomImage,
  onUpdateRow,
  onRemoveRow,
  onPickCandidate,
  onSetNewProduct,
  isJsonBill = false,
  tiktokMirrorEnabled = false,
  tiktokCatalog = [],
  tiktokCatalogLoading = false,
  tiktokCatalogError = null,
  onTiktokRetryCatalog,
  tiktokMinPct = 60,
  onTiktokMinPctChange,
  stocksByProductId = {},
  onTiktokRowMatch,
  productImagesById = {},
  onMobileNavChange,
  batchSummary = null,
  submitting = false,
  savingProgress = null,
  onSubmit,
}) {
  const wizardRef = useRef(null);
  const listCardRef = useRef(null);
  const stageRef = useRef(null);
  const swipeRef = useRef({ x: 0, y: 0 });
  const [syncedCardHeight, setSyncedCardHeight] = useState(null);
  const [layoutMode, setLayoutMode] = useState('compact');
  const [itemsSheetOpen, setItemsSheetOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const fn = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  const summary = useMemo(
    () => computeRowSummary(rows, tiktokMirrorEnabled),
    [rows, tiktokMirrorEnabled],
  );

  const tiktokSummary = useMemo(
    () => (tiktokMirrorEnabled ? computeTiktokBillSummary(rows) : null),
    [rows, tiktokMirrorEnabled],
  );

  const dupCodes = useMemo(() => {
    const counts = new Map();
    for (const r of rows) {
      const k = normalizeCode(r.model_code);
      if (!k) continue;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const dups = new Set();
    for (const [k, n] of counts) if (n > 1) dups.add(k);
    return dups;
  }, [rows]);

  const [activeUid, setActiveUid] = useState(null);
  const [billComplete, setBillComplete] = useState(false);

  useEffect(() => {
    setBillComplete(summary.attention === 0 && summary.total > 0);
  }, [summary.attention, summary.total]);

  useEffect(() => {
    if (!rows.length) {
      setActiveUid(null);
      return;
    }
    const idx = firstAttentionRowIndex(rows, tiktokMirrorEnabled);
    const pick = idx >= 0 ? rows[idx] : rows[0];
    setActiveUid(pick.uid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billKey, rows.length]);

  useEffect(() => {
    if (!activeUid || rows.some((r) => r.uid === activeUid)) return;
    setActiveUid(rows[0]?.uid ?? null);
  }, [rows, activeUid]);

  const activeRow = rows.find((r) => r.uid === activeUid) || null;
  const activeIndex = activeRow ? rows.indexOf(activeRow) : 0;

  const handleLayoutModeChange = useCallback((mode) => {
    setLayoutMode(mode);
  }, []);

  useLayoutEffect(() => {
    if (!isDesktop) {
      setSyncedCardHeight(null);
      return;
    }
    const el = stageRef.current;
    if (!el) return;
    const sync = () => {
      const h = Math.round(el.offsetHeight);
      if (h > 0) setSyncedCardHeight(h);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows.length, activeUid, layoutMode, tiktokMirrorEnabled, isDesktop]);

  const listCardStyle = syncedCardHeight > 0
    ? { height: syncedCardHeight, maxHeight: syncedCardHeight, minHeight: syncedCardHeight }
    : { maxHeight: 'min(28rem, calc(100vh - 14rem))' };

  const selectUid = useCallback((uid) => {
    setActiveUid(uid);
    setItemsSheetOpen(false);
  }, []);

  const handlePick = useCallback((product) => {
    if (!activeUid) return;
    onPickCandidate(activeUid, product);
  }, [activeUid, onPickCandidate]);

  const handleCreateNew = useCallback((np) => {
    if (!activeUid) return;
    onSetNewProduct(activeUid, np);
  }, [activeUid, onSetNewProduct]);

  const goPrevAttention = useCallback(() => {
    const idx = prevAttentionRowIndex(rows, activeIndex, tiktokMirrorEnabled);
    if (idx >= 0) selectUid(rows[idx].uid);
  }, [rows, activeIndex, tiktokMirrorEnabled, selectUid]);

  const goNextAttention = useCallback(() => {
    const idx = nextAttentionRowIndex(rows, activeIndex, tiktokMirrorEnabled);
    if (idx >= 0) selectUid(rows[idx].uid);
  }, [rows, activeIndex, tiktokMirrorEnabled, selectUid]);

  const jumpFirstAttention = useCallback(() => {
    const idx = firstAttentionRowIndex(rows, tiktokMirrorEnabled);
    if (idx >= 0) selectUid(rows[idx].uid);
  }, [rows, tiktokMirrorEnabled, selectUid]);

  const prevIdx = prevAttentionRowIndex(rows, activeIndex, tiktokMirrorEnabled);
  const nextIdx = nextAttentionRowIndex(rows, activeIndex, tiktokMirrorEnabled);
  const hasPrevAttention = prevIdx >= 0 && prevIdx !== activeIndex;
  const hasNextAttention = nextIdx >= 0 && nextIdx !== activeIndex;

  const goPrevSequential = useCallback(() => {
    if (activeIndex > 0) selectUid(rows[activeIndex - 1].uid);
  }, [rows, activeIndex, selectUid]);

  const goNextSequential = useCallback(() => {
    if (activeIndex < rows.length - 1) selectUid(rows[activeIndex + 1].uid);
  }, [rows, activeIndex, selectUid]);

  const hasPrev = activeIndex > 0;
  const hasNext = activeIndex < rows.length - 1;

  useEffect(() => {
    if (!isDesktop) return;
    onMobileNavChange?.({
      rowIndex: activeIndex,
      totalRows: rows.length,
      attentionCount: summary.attention,
      hasPrev,
      hasNext,
      onPrev: goPrevSequential,
      onNext: goNextSequential,
      hasPrevAttention,
      hasNextAttention,
      onPrevAttention: goPrevAttention,
      onNextAttention: goNextAttention,
    });
  }, [
    activeIndex,
    rows.length,
    summary.attention,
    hasPrev,
    hasNext,
    hasPrevAttention,
    hasNextAttention,
    goPrevSequential,
    goNextSequential,
    goPrevAttention,
    goNextAttention,
    onMobileNavChange,
    isDesktop,
  ]);

  useEffect(() => {
    const onKey = (e) => {
      const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
      if (!keys.includes(e.key)) return;
      const target = e.target;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return;
      }
      if (!target.closest?.('.air-wizard')) return;
      e.preventDefault();
      const curIdx = rows.findIndex((r) => r.uid === activeUid);
      if (curIdx < 0) return;
      const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
      const newIdx = forward
        ? Math.min(curIdx + 1, rows.length - 1)
        : Math.max(curIdx - 1, 0);
      if (newIdx !== curIdx) selectUid(rows[newIdx].uid);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, activeUid, selectUid]);

  const handleSwipeStart = useCallback((e) => {
    swipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, []);

  const handleSwipeEnd = useCallback((e) => {
    const dx = e.changedTouches[0].clientX - swipeRef.current.x;
    const dy = e.changedTouches[0].clientY - swipeRef.current.y;
    if (Math.abs(dx) < 48 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx < 0) goNextSequential();
    else goPrevSequential();
  }, [goNextSequential, goPrevSequential]);

  if (!rows.length) {
    return (
      <div className="py-10 text-center text-sm text-muted-soft">
        ไม่พบรายการในบิล
      </div>
    );
  }

  const recentInfo =
    activeRow?.status === 'auto' && activeRow.product?.id && recentReceivesMap
      ? recentReceivesMap.get(activeRow.product.id)
      : null;

  if (!isDesktop) {
    return (
      <MobileReviewStepShell
        rows={rows}
        products={products}
        recentReceivesMap={recentReceivesMap}
        hasVat={hasVat}
        onUpdateRow={onUpdateRow}
        onRemoveRow={onRemoveRow}
        onPickCandidate={onPickCandidate}
        onSetNewProduct={onSetNewProduct}
        tiktokMirrorEnabled={tiktokMirrorEnabled}
        tiktokCatalog={tiktokCatalog}
        tiktokCatalogLoading={tiktokCatalogLoading}
        tiktokCatalogError={tiktokCatalogError}
        onTiktokRetryCatalog={onTiktokRetryCatalog}
        tiktokMinPct={tiktokMinPct}
        onTiktokMinPctChange={onTiktokMinPctChange}
        onTiktokRowMatch={onTiktokRowMatch}
        productImagesById={productImagesById}
        dupCodes={dupCodes}
        billComplete={billComplete}
        onNavSummaryChange={onMobileNavChange}
        batchSummary={batchSummary}
        submitting={submitting}
        savingProgress={savingProgress}
        onSubmit={onSubmit}
      />
    );
  }

  return (
    <div className="air-wizard" ref={wizardRef}>
      <ItemStepper
        rows={rows}
        activeUid={activeUid}
        summary={summary}
        tiktokMirrorEnabled={tiktokMirrorEnabled}
        tiktokSummary={tiktokSummary}
        onSelect={selectUid}
        onJumpAttention={jumpFirstAttention}
        onOpenAllItems={() => setItemsSheetOpen(true)}
      />

      <div
        className="air-wizard__workspace"
        onTouchStart={handleSwipeStart}
        onTouchEnd={handleSwipeEnd}
      >
        <BillItemsListCard
          ref={listCardRef}
          className="hidden lg:flex"
          style={listCardStyle}
          rows={rows}
          activeUid={activeUid}
          tiktokMirrorEnabled={tiktokMirrorEnabled}
          onSelect={selectUid}
        />

        <ReceiveMatchPanel
          ref={stageRef}
          onLayoutModeChange={handleLayoutModeChange}
          row={activeRow}
          isJsonBill={isJsonBill}
          rowIndex={activeIndex}
          totalRows={rows.length}
          products={products}
          hasVat={hasVat}
          recentInfo={recentInfo}
          billComplete={billComplete}
          duplicate={activeRow ? dupCodes.has(normalizeCode(activeRow.model_code)) : false}
          onRemove={() => activeUid && onRemoveRow(activeUid)}
          onUpdate={(patch) => activeUid && onUpdateRow(activeUid, patch)}
          onPick={handlePick}
          onCreateNew={handleCreateNew}
          onPrevAttention={goPrevAttention}
          onNextAttention={goNextAttention}
          hasPrevAttention={hasPrevAttention}
          hasNextAttention={hasNextAttention}
          onPrevRow={goPrevSequential}
          onNextRow={goNextSequential}
          hasPrevRow={hasPrev}
          hasNextRow={hasNext}
          attentionCount={summary.attention}
          hideFooter={!isDesktop}
          tiktokMirrorEnabled={tiktokMirrorEnabled}
          tiktokCatalog={tiktokCatalog}
          tiktokCatalogLoading={tiktokCatalogLoading}
          tiktokCatalogError={tiktokCatalogError}
          onTiktokRetryCatalog={onTiktokRetryCatalog}
          tiktokMinPct={tiktokMinPct}
          onTiktokMinPctChange={onTiktokMinPctChange}
          onTiktokRowMatch={
            activeUid && onTiktokRowMatch
              ? (patch) => onTiktokRowMatch(activeUid, patch)
              : undefined
          }
          productImagesById={productImagesById}
        />
      </div>

      <BottomSheet
        open={itemsSheetOpen}
        onClose={() => setItemsSheetOpen(false)}
        title="รายการในบิล"
      >
        <BillItemsListCard
          variant="sheet"
          rows={rows}
          activeUid={activeUid}
          tiktokMirrorEnabled={tiktokMirrorEnabled}
          onSelect={selectUid}
        />
      </BottomSheet>
    </div>
  );
}
