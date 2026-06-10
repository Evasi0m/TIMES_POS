// BillReviewPanel — focused wizard for AI bulk receive review.
// Top: item stepper (colored chips). Below: bill list card + ReceiveMatchPanel side by side.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../ui/Icon.jsx';
import { classifyMatch, normalizeCode } from '../../lib/fuzzy-match.js';
import ReceiveMatchPanel from './ReceiveMatchPanel.jsx';
import BillItemsListCard from './BillItemsListCard.jsx';
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

export function buildRowFromAi(it, catalog) {
  const match = classifyMatch(it.model_code, catalog || []);
  return {
    uid: makeRowUid(),
    model_code: it.model_code,
    quantity:   Math.max(0, Math.round(Number(it.quantity) || 0)),
    unit_cost:  Math.max(0, Number(it.unit_cost) || 0),
    needsReview: Boolean(it.needs_review),
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

function ItemStepper({
  rows, activeUid, summary, tiktokMirrorEnabled, tiktokSummary, onSelect, onJumpAttention,
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
          ไปที่ต้องแก้ ({summary.attention})
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
}) {
  const wizardRef = useRef(null);
  const listCardRef = useRef(null);
  const [listCardHeight, setListCardHeight] = useState(null);

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

  // Auto-select first row needing attention when bill changes or rows load.
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

  // Keep selection valid if active row was deleted.
  useEffect(() => {
    if (!activeUid || rows.some((r) => r.uid === activeUid)) return;
    setActiveUid(rows[0]?.uid ?? null);
  }, [rows, activeUid]);

  const activeRow = rows.find((r) => r.uid === activeUid) || null;
  const activeIndex = activeRow ? rows.indexOf(activeRow) : 0;

  // CARD B height always follows CARD A (list card is the master).
  useEffect(() => {
    const el = listCardRef.current;
    if (!el) return;
    const sync = () => {
      const h = el.getBoundingClientRect().height;
      if (h > 0) setListCardHeight(h);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows.length, activeUid, tiktokMirrorEnabled]);

  const selectUid = useCallback((uid) => setActiveUid(uid), []);

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

  // Keyboard: ←/→ (or ↑/↓) move between items.
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
      />

      <div className="air-wizard__workspace">
        <BillItemsListCard
          ref={listCardRef}
          rows={rows}
          activeUid={activeUid}
          tiktokMirrorEnabled={tiktokMirrorEnabled}
          onSelect={selectUid}
        />

        <ReceiveMatchPanel
          panelHeight={listCardHeight}
          row={activeRow}
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
          attentionCount={summary.attention}
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
    </div>
  );
}
