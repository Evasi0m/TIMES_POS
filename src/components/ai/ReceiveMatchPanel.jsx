import React, { forwardRef, useEffect, useMemo, useState } from 'react';
import Icon from '../ui/Icon.jsx';
import ExpandableImageThumb from '../ui/ExpandableImageThumb.jsx';
import ProductThumb from '../ui/ProductThumb.jsx';
import { findCandidates } from '../../lib/fuzzy-match.js';
import { tiktokSkuDisplayLabel } from '../../lib/tiktok-mirror-helpers.js';
import TikTokSkuMatchRow, { TIKTOK_MIN_PCT_OPTIONS } from '../ecommerce/TikTokSkuMatchRow.jsx';
import RecentReceiveBadge from '../movement/RecentReceiveBadge.jsx';
import { addVat, stripVat, fmtTHB } from '../../lib/money.js';
import { suggestedRetail } from '../../lib/ai-receive.js';
import {
  SOFT_MATCH_FLOOR,
  getRowDisplayState,
  getItemSteps,
  firstIncompleteStep,
  getRowAsideImageUrl,
  getWorkspaceLayoutMode,
} from './bill-review-shared.js';

function CandidateCell({ c, onPick, highlight, dataFirst }) {
  return (
    <button
      type="button"
      className={'ttc-match-cell text-left w-full' + (highlight ? ' ttc-match-cell--auto' : '')}
      onClick={() => onPick(c.product)}
      data-first-candidate={dataFirst ? '1' : undefined}
    >
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[13px] font-semibold leading-snug break-words">
          {c.product.name}
        </div>
        <div className="text-[11px] text-muted-soft tabular-nums mt-0.5">
          stock {c.product.current_stock}
          {c.product.retail_price > 0 && (
            <> · ขาย ฿{Number(c.product.retail_price).toLocaleString()}</>
          )}
        </div>
      </div>
      <span className="ttc-match-cell__score shrink-0">
        {c.viaBarcode ? 'บาร์โค้ด' : Math.round(c.score * 100) + '%'}
      </span>
    </button>
  );
}

function QtyCostSection({ row, hasVat, onUpdate }) {
  const costIncomplete = !(Number(row.unit_cost) > 0);
  const qtyIncomplete = !(Number(row.quantity) > 0);

  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block">
        <span className={'text-xs mb-1 block flex items-center gap-1 ' + (qtyIncomplete ? 'text-warning font-medium' : 'text-muted-soft')}>
          จำนวน
          {qtyIncomplete && <Icon name="alert" size={10}/>}
        </span>
        <input
          type="number"
          inputMode="numeric"
          min="1"
          className={'input !py-2.5 !min-h-[44px] !text-base w-full tabular-nums ' + (qtyIncomplete ? '!border-warning ring-2 ring-warning/30' : '')}
          value={row.quantity}
          onChange={(e) => onUpdate({ quantity: Math.max(0, Number(e.target.value) || 0) })}
        />
      </label>
      <label className="block">
        <span className={'text-xs mb-1 block flex items-center gap-1 ' + (costIncomplete ? 'text-warning font-medium' : 'text-muted-soft')}>
          ทุน / เรือน
          {costIncomplete && <Icon name="alert" size={10}/>}
        </span>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          className={'input !py-2.5 !min-h-[44px] !text-base w-full text-right font-mono tabular-nums ' + (costIncomplete ? '!border-warning ring-2 ring-warning/30' : '')}
          value={row.unit_cost === 0 ? '' : hasVat ? addVat(row.unit_cost) : row.unit_cost}
          onChange={(e) => {
            const inputVal = e.target.value === '' ? 0 : Number(e.target.value);
            const val = Math.max(0, inputVal || 0);
            onUpdate({ unit_cost: hasVat ? stripVat(val) : val });
          }}
        />
        {hasVat && !costIncomplete && (
          <span className="text-[10px] text-muted-soft mt-1 block text-right tabular-nums">
            ก่อน VAT {fmtTHB(row.unit_cost)}
          </span>
        )}
      </label>
    </div>
  );
}

function StepIndicator({ steps, activeStep, onGotoStep }) {
  return (
    <div className="air-step-indicator shrink-0">
      {steps.map((s, i) => (
        <React.Fragment key={s.key}>
          {i > 0 && <Icon name="chevron-r" size={14} className="air-step-indicator__arrow"/>}
          <button
            type="button"
            className={
              'air-step-indicator__step' +
              (s.key === activeStep ? ' is-active' : '') +
              (s.done ? ' is-done' : '')
            }
            disabled={s.disabled}
            onClick={() => !s.disabled && onGotoStep(s.key)}
          >
            <span className="air-step-indicator__num">
              {s.done ? <Icon name="check" size={11}/> : i + 1}
            </span>
            {s.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

function StageAsideVisual({ row, tiktokCatalog = [], productImagesById = {} }) {
  if (row.tiktok_skip) {
    return (
      <div className="air-stage__visual air-stage__visual--skip" aria-label="ไม่ sync TikTok">
        <Icon name="store" size={22} className="text-[#6d28d9] opacity-70"/>
        <span className="text-xs font-medium text-muted">ไม่ sync</span>
      </div>
    );
  }

  const imageUrl = getRowAsideImageUrl(row, { catalog: tiktokCatalog, productImagesById });
  const alt = tiktokSkuDisplayLabel(row.tiktok_sku || row.tiktok_mapping) || row.model_code || row.product?.name || '';

  if (imageUrl) {
    return (
      <ExpandableImageThumb
        src={imageUrl}
        alt={alt}
        className="air-stage__visual air-stage__visual--product w-full shrink-0"
        imgClassName="w-full h-full object-contain rounded-[inherit]"
        placeholder={(
          <div className="air-stage__visual air-stage__visual--skeleton w-full" aria-hidden="true">
            <span className="skeleton absolute inset-0 rounded-[inherit]"/>
          </div>
        )}
      />
    );
  }

  if (row.product) {
    const productWithImage = {
      ...row.product,
      _imageRow: productImagesById[row.product.id] || null,
    };
    return (
      <div className="air-stage__visual air-stage__visual--product w-full shrink-0 flex items-center justify-center p-3">
        <ProductThumb product={productWithImage} size="xl" className="!shadow-none"/>
      </div>
    );
  }

  return (
    <div className="air-stage__visual air-stage__visual--skeleton" aria-label="ยังไม่มีรูปสินค้า">
      <span className="skeleton absolute inset-0 rounded-[inherit]"/>
    </div>
  );
}

function StageAside({
  rowIndex, row, hasVat, displayState, duplicate, onRemove, tiktokCatalog = [], productImagesById = {},
}) {
  const grossCost = hasVat ? addVat(row.unit_cost) : row.unit_cost;
  return (
    <div className="air-stage__aside">
      <div className="shrink-0 flex items-center gap-2">
        <span className={'ai-row-badge !w-7 !h-7 !text-xs ' + displayState.badgeCls}>{rowIndex + 1}</span>
        <div className="font-semibold text-sm text-ink leading-snug">ตรวจรับรายการ</div>
      </div>

      <StageAsideVisual row={row} tiktokCatalog={tiktokCatalog} productImagesById={productImagesById}/>

      <div className="min-w-0">
        <div className="air-stage__from-label">จากบิล</div>
        <div className="air-stage__from-code">{row.model_code}</div>
        <div className="air-stage__from-meta tabular-nums mt-1">
          ×{row.quantity} · {fmtTHB(grossCost)}
          {hasVat && <span className="text-muted-soft"> (รวม VAT)</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className={'air-status-chip ' + displayState.pillCls}>
          <Icon name={displayState.icon} size={9}/>
          <span>{displayState.label}</span>
        </span>
        {hasVat && <span className="vat-chip">VAT</span>}
        {duplicate && (
          <span className="air-chip air-chip--dup" title="model นี้มีมากกว่าหนึ่งบรรทัดในบิล">ซ้ำ?</span>
        )}
        {row.needsReview && (
          <span className="ai-review-chip"><Icon name="alert" size={10}/> AI ตรวจ</span>
        )}
      </div>

      <button
        type="button"
        className="btn-ghost !py-1.5 !px-2 !text-xs text-muted-soft hover:text-error mt-auto self-start inline-flex items-center gap-1"
        onClick={onRemove}
      >
        <Icon name="trash" size={14}/> ลบรายการนี้
      </button>
    </div>
  );
}

function WorkspaceFooter({
  rowIndex, totalRows, hasPrevAttention, hasNextAttention,
  onPrevAttention, onNextAttention, attentionCount,
}) {
  return (
    <div className="receive-match-panel__footer shrink-0 px-3 py-2.5 border-t hairline-soft flex items-center gap-2">
      <button
        type="button"
        className="btn-secondary !py-1.5 !px-2.5 !text-xs flex-1 min-w-0"
        onClick={onPrevAttention}
        disabled={!hasPrevAttention}
      >
        <Icon name="chevron-l" size={14}/> ก่อนหน้า
      </button>
      <span className="text-[11px] text-muted-soft tabular-nums shrink-0 text-center">
        {rowIndex + 1}/{totalRows}
        {attentionCount > 0 && (
          <span className="block text-[10px] text-amber-700">เหลือ {attentionCount}</span>
        )}
      </span>
      <button
        type="button"
        className="btn-primary !py-1.5 !px-2.5 !text-xs flex-1 min-w-0"
        onClick={onNextAttention}
        disabled={!hasNextAttention}
      >
        ถัดไป <Icon name="chevron-r" size={14}/>
      </button>
    </div>
  );
}

const ReceiveMatchPanel = forwardRef(function ReceiveMatchPanel({
  row,
  rowIndex = 0,
  totalRows = 0,
  products,
  hasVat = false,
  recentInfo = null,
  billComplete = false,
  duplicate = false,
  onRemove,
  onUpdate,
  onPick,
  onCreateNew,
  onPrevAttention,
  onNextAttention,
  hasPrevAttention = false,
  hasNextAttention = false,
  attentionCount = 0,
  tiktokMirrorEnabled = false,
  tiktokCatalog = [],
  tiktokCatalogLoading = false,
  tiktokCatalogError = null,
  onTiktokRetryCatalog,
  tiktokMinPct = 60,
  onTiktokMinPctChange,
  onTiktokRowMatch,
  productImagesById = {},
  onLayoutModeChange,
}, ref) {
  const [rematch, setRematch] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [activeStep, setActiveStep] = useState('match');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [npName, setNpName] = useState('');
  const [npBarcode, setNpBarcode] = useState('');
  const [npRetail, setNpRetail] = useState('');

  const steps = useMemo(
    () => getItemSteps(row, tiktokMirrorEnabled),
    [row, tiktokMirrorEnabled],
  );

  useEffect(() => {
    setRematch(false);
    setShowCreate(false);
    setSearchQuery('');
    if (row) {
      setNpName(row.model_code || '');
      setNpBarcode('');
      setNpRetail('');
      setActiveStep(firstIncompleteStep(getItemSteps(row, tiktokMirrorEnabled)));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.uid]);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(searchQuery), 150);
    return () => clearTimeout(id);
  }, [searchQuery]);

  const searchResults = useMemo(() => {
    const q = debouncedQuery.trim();
    if (!q) return [];
    const fuzzy = findCandidates(q, products, { limit: 10, minScore: 0.4 });
    const qLower = q.toLowerCase();
    const seen = new Set(fuzzy.map((c) => c.product.id));
    const byBarcode = [];
    for (const p of products || []) {
      if (seen.has(p.id)) continue;
      if (p.barcode && String(p.barcode).toLowerCase().includes(qLower)) {
        byBarcode.push({ product: p, score: 1, viaBarcode: true });
        if (byBarcode.length >= 8) break;
      }
    }
    return [...byBarcode, ...fuzzy].slice(0, 12);
  }, [debouncedQuery, products]);

  const isMatched = row && (row.status === 'auto' || row.status === 'new');
  const resolveMode = !isMatched || rematch;

  const layoutMode = useMemo(
    () => getWorkspaceLayoutMode({
      row,
      activeStep,
      rematch,
      showCreate,
      searchQuery,
    }),
    [row, activeStep, rematch, showCreate, searchQuery],
  );

  useEffect(() => {
    onLayoutModeChange?.(layoutMode);
  }, [layoutMode, onLayoutModeChange]);

  // Enter picks first candidate when resolving (match step, not typing).
  useEffect(() => {
    if (!row || activeStep !== 'match' || !resolveMode || showCreate) return;
    const onKey = (e) => {
      if (e.key !== 'Enter') return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
      const first = document.querySelector('[data-first-candidate="1"]');
      if (first) {
        e.preventDefault();
        first.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [row, activeStep, resolveMode, showCreate, row?.candidates?.length]);

  if (!row) {
    return (
      <div
        ref={ref}
        className="receive-match-panel receive-match-panel--empty air-stage--compact ttc-rl ttc-bento rounded-2xl border p-6 flex items-center justify-center min-h-[200px]"
      >
        <div className="text-center text-sm text-muted-soft">
          <Icon name="check" size={24} className="mx-auto mb-2 opacity-40"/>
          ไม่มีรายการให้แก้ไข
        </div>
      </div>
    );
  }

  const displayState = getRowDisplayState(row, tiktokMirrorEnabled);
  const softMatch =
    row.status === 'auto' &&
    typeof row.matchScore === 'number' &&
    row.matchScore < SOFT_MATCH_FLOOR;
  const hasPos = row.product || (row.status === 'new' && row.newProduct);
  const posName = row.product?.name || row.newProduct?.name || null;
  const currentStock = Number(row.product?.current_stock) || 0;
  const stockAfter = currentStock + (Number(row.quantity) || 0);

  const handlePick = (p) => {
    onPick(p);
    setRematch(false);
    setShowCreate(false);
    setActiveStep('qtycost');
  };

  const submitCreate = () => {
    if (!npName.trim()) return;
    const retail = Number(npRetail);
    if (!retail || retail <= 0) return;
    onCreateNew({
      name: npName.trim(),
      barcode: npBarcode.trim() || null,
      retail_price: retail,
    });
    setShowCreate(false);
    setActiveStep('qtycost');
  };

  const hasTiktokStep = steps.some((s) => s.key === 'tiktok');
  const advanceFromQtyCost = () => {
    if (hasTiktokStep) setActiveStep('tiktok');
    else onNextAttention?.();
  };

  return (
    <div
      ref={ref}
      className={
        'air-stage air-stage--' + layoutMode +
        ' ttc-rl ttc-bento rounded-2xl border w-full ' +
        displayState.cardCls
      }
      id="receive-match-workspace"
    >
      <div className="air-stage__grid">
        <StageAside
          rowIndex={rowIndex}
          row={row}
          hasVat={hasVat}
          displayState={displayState}
          duplicate={duplicate}
          onRemove={onRemove}
          tiktokCatalog={tiktokCatalog}
          productImagesById={productImagesById}
        />

        <div className="air-stage__main">
          {billComplete && (
            <div className="air-stage__main-top shrink-0">
              <span className="air-status-chip air-status-chip--done ml-auto">
                <Icon name="check" size={9}/> บิลนี้พร้อมบันทึก
              </span>
            </div>
          )}
          <StepIndicator steps={steps} activeStep={activeStep} onGotoStep={setActiveStep}/>

          <div className="air-stage__main-body">
            {/* ── STEP: MATCH ─────────────────────────────── */}
            {activeStep === 'match' && (
              <>
                {!resolveMode && hasPos ? (
                  <>
                    <div className="receive-match-step-callout receive-match-step-callout--edit">
                      <Icon name="check" size={16} className="shrink-0 text-[#0a7a43]"/>
                      <span>จับคู่รุ่นแล้ว — ตรวจชื่อให้ตรง แล้วไปขั้นถัดไป</span>
                    </div>
                    <div className="air-stage__detail">
                      <div className="air-stage__from-label">POS ในระบบ</div>
                      <div className="font-mono text-base font-semibold text-[#0a5a32] break-words leading-snug">
                        {posName}
                      </div>
                      <div className="text-xs text-muted tabular-nums mt-0.5">
                        {row.status === 'new'
                          ? <>สินค้าใหม่ · ป้าย ฿{Number(row.newProduct?.retail_price).toLocaleString()}</>
                          : <>stock {currentStock} → {stockAfter}
                              {typeof row.matchScore === 'number' && <> · มั่นใจ {Math.round(row.matchScore * 100)}%</>}
                            </>}
                      </div>
                    </div>

                    {softMatch && (
                      <div className="text-xs text-amber-800 bg-amber-50/80 border border-amber-200/60 rounded-lg px-3 py-2 flex items-center gap-2">
                        <Icon name="alert" size={14} className="shrink-0"/>
                        ความมั่นใจ {Math.round(row.matchScore * 100)}% — ตรวจว่ารุ่นตรงไหม
                      </div>
                    )}
                    {row.needsReview && (
                      <div className="text-xs text-amber-800 bg-amber-50/80 border border-amber-200/60 rounded-lg px-3 py-2 flex items-center gap-2">
                        <Icon name="alert" size={14} className="shrink-0"/>
                        AI ไม่มั่นใจ — ตรวจรุ่นและตัวเลขกับรูปบิล
                      </div>
                    )}

                    <div className="air-stage__footer-actions">
                      <button
                        type="button"
                        className="air-change-model-btn air-stage__footer-btn"
                        onClick={() => setRematch(true)}
                      >
                        <Icon name="refresh" size={15}/> เปลี่ยนรุ่น
                      </button>
                      <button
                        type="button"
                        className="btn-primary air-stage__footer-btn !py-2.5 !text-sm"
                        onClick={() => setActiveStep('qtycost')}
                      >
                        ตรวจจำนวน/ทุน <Icon name="chevron-r" size={14}/>
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="receive-match-step-callout">
                      <Icon name="info" size={16} className="shrink-0"/>
                      <span>เลือกรุ่น POS จากรายการใกล้เคียง หรือค้นหา/สร้างใหม่</span>
                    </div>

                    {!showCreate && (
                      <>
                        {row.candidates?.length > 0 && (
                          <section className="ttc-match-panel">
                            <div className="ttc-match-panel__head">
                              รุ่นใกล้เคียง ({row.candidates.length})
                              <span className="text-[10px] text-muted-soft font-normal ml-1">· Enter เลือกอันแรก</span>
                            </div>
                            <div className="ttc-match-panel__body ttc-match-panel__body--focus flex flex-col gap-1.5">
                              {row.candidates.map((c, i) => (
                                <CandidateCell
                                  key={c.product.id}
                                  c={c}
                                  onPick={handlePick}
                                  highlight={i === 0 && c.score >= 0.94}
                                  dataFirst={i === 0}
                                />
                              ))}
                            </div>
                          </section>
                        )}

                        <section>
                          <label className="text-xs font-medium text-muted mb-1.5 block">ค้นหารุ่น หรือ บาร์โค้ด</label>
                          <input
                            type="text"
                            className="input !py-2.5 !min-h-[44px] !text-base w-full font-mono"
                            placeholder="พิมพ์รหัสรุ่น หรือบาร์โค้ด…"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                          />
                          {searchQuery && (
                            <section className="ttc-match-panel mt-2">
                              <div className="ttc-match-panel__head">
                                ผลการค้นหา ({searchResults.length})
                              </div>
                              <div className="ttc-match-panel__body ttc-match-panel__body--focus ttc-match-search-results flex flex-col gap-1.5">
                                {searchResults.length === 0 && (
                                  <div className="ttc-picker-dropdown__empty ttc-match-panel__empty text-xs py-3">ไม่พบ</div>
                                )}
                                {searchResults.map((c) => (
                                  <CandidateCell key={c.product.id} c={c} onPick={handlePick}/>
                                ))}
                              </div>
                            </section>
                          )}
                        </section>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="btn-primary !py-2 !px-4 !text-sm"
                            onClick={() => setShowCreate(true)}
                          >
                            <Icon name="plus" size={14}/> เพิ่มสินค้าใหม่
                          </button>
                          {rematch && (
                            <button
                              type="button"
                              className="btn-ghost !py-2 !px-3 !text-sm text-muted-soft"
                              onClick={() => setRematch(false)}
                            >
                              ยกเลิก
                            </button>
                          )}
                        </div>
                      </>
                    )}

                    {showCreate && (
                      <section className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium text-ink">เพิ่มสินค้าใหม่เข้าคลัง</div>
                          <button
                            type="button"
                            className="text-xs text-muted-soft hover:text-ink"
                            onClick={() => setShowCreate(false)}
                          >
                            ← กลับ
                          </button>
                        </div>
                        <label className="block">
                          <span className="text-xs text-muted-soft mb-1 block">ชื่อรุ่น <span className="text-error">*</span></span>
                          <input
                            type="text"
                            className="input !py-2.5 !text-base w-full font-mono"
                            value={npName}
                            onChange={(e) => setNpName(e.target.value)}
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs text-muted-soft mb-1 block">บาร์โค้ด (ไม่บังคับ)</span>
                          <input
                            type="text"
                            className="input !py-2.5 !text-base w-full font-mono"
                            value={npBarcode}
                            onChange={(e) => setNpBarcode(e.target.value)}
                            placeholder="ใส่ทีหลังได้"
                          />
                        </label>
                        <label className="block">
                          <span className="text-xs text-muted-soft mb-1 flex items-center justify-between">
                            <span>ราคาป้าย / ราคาขาย <span className="text-error">*</span></span>
                            <span className="flex items-center gap-1">
                              {[1.5, 2, 2.5].map((f) => (
                                <button
                                  key={f}
                                  type="button"
                                  className="ai-markup-chip"
                                  onClick={() => setNpRetail(String(suggestedRetail(row.unit_cost, hasVat, f)))}
                                  title={`ทุน×${f}`}
                                >×{f}</button>
                              ))}
                            </span>
                          </span>
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0"
                            className="input !py-2.5 !min-h-[44px] !text-base w-full text-right font-mono tabular-nums"
                            value={npRetail}
                            onChange={(e) => setNpRetail(e.target.value)}
                            placeholder="0.00"
                          />
                        </label>
                        <button
                          type="button"
                          className="btn-primary !py-2.5 !text-sm w-full"
                          onClick={submitCreate}
                          disabled={!npName.trim() || !Number(npRetail)}
                        >
                          <Icon name="check" size={14}/> ยืนยันสร้างสินค้าใหม่
                        </button>
                      </section>
                    )}
                  </>
                )}
              </>
            )}

            {/* ── STEP: QTY / COST ────────────────────────── */}
            {activeStep === 'qtycost' && (
              <>
                <div className="receive-match-step-callout receive-match-step-callout--edit">
                  <Icon name="edit" size={16} className="shrink-0 text-[#0a7a43]"/>
                  <span>ตรวจจำนวนและทุนให้ตรงกับบิล</span>
                </div>

                {posName && (
                  <div className="air-stage__detail">
                    <div className="air-stage__from-label">สินค้า POS</div>
                    <div className="font-mono text-sm font-semibold text-[#0a5a32] break-words leading-snug">
                      {posName}
                    </div>
                    <dl className="mt-1 flex flex-col gap-1">
                      <div className="air-stage__detail-row">
                        <dt>สต็อกหลังรับ</dt>
                        <dd className="text-[#0a5a32]">{currentStock} → {stockAfter}</dd>
                      </div>
                      {row.product?.retail_price > 0 && (
                        <div className="air-stage__detail-row">
                          <dt>ราคาขาย</dt>
                          <dd>฿{Number(row.product.retail_price).toLocaleString()}</dd>
                        </div>
                      )}
                    </dl>
                  </div>
                )}

                {recentInfo && <RecentReceiveBadge info={recentInfo} />}

                <QtyCostSection row={row} hasVat={hasVat} onUpdate={onUpdate} />

                <div className="flex items-center gap-2 mt-auto pt-2">
                  <button
                    type="button"
                    className="btn-ghost !py-2 !px-3 !text-sm text-muted-soft"
                    onClick={() => setActiveStep('match')}
                  >
                    <Icon name="chevron-l" size={14}/> กลับ
                  </button>
                  <button
                    type="button"
                    className="btn-primary !py-2 !px-4 !text-sm ml-auto"
                    onClick={advanceFromQtyCost}
                  >
                    {hasTiktokStep ? 'ไปจับ TikTok' : 'รายการถัดไป'} <Icon name="chevron-r" size={14}/>
                  </button>
                </div>
              </>
            )}

            {/* ── STEP: TIKTOK ────────────────────────────── */}
            {activeStep === 'tiktok' && hasTiktokStep && (
              <>
                <div className="receive-match-step-callout air-tiktok-step-callout">
                  <Icon name="store" size={16} className="shrink-0 text-[#6d28d9]"/>
                  <span className="flex-1 min-w-0">จับคู่ TikTok SKU เพื่อตัดสต็อกฝั่ง TikTok</span>
                  <label className="air-tiktok-minpct shrink-0">
                    <span className="air-tiktok-minpct__label">candidate ≥</span>
                    <select
                      className="air-tiktok-minpct__select"
                      value={tiktokMinPct}
                      onChange={(e) => onTiktokMinPctChange?.(Number(e.target.value))}
                      disabled={tiktokCatalogLoading}
                    >
                      {TIKTOK_MIN_PCT_OPTIONS.map((n) => (
                        <option key={n} value={n}>{n}%</option>
                      ))}
                    </select>
                  </label>
                </div>

                {hasPos && (
                  <TikTokSkuMatchRow
                    line={{
                      product_id: row.product?.id,
                      product_name: row.product?.name || row.newProduct?.name || row.model_code,
                      barcode: row.product?.barcode || row.newProduct?.barcode,
                      quantity: row.quantity,
                    }}
                    skipped={!!row.tiktok_skip}
                    tiktokSku={row.tiktok_sku}
                    mapping={row.tiktok_mapping}
                    previewStockAfter={stockAfter}
                    catalog={tiktokCatalog}
                    catalogLoading={tiktokCatalogLoading}
                    catalogError={tiktokCatalogError}
                    onRetryCatalog={onTiktokRetryCatalog}
                    minPct={tiktokMinPct}
                    onChange={(patch) => {
                      const full = { ...patch, tiktok_manual: true };
                      onUpdate(full);
                      onTiktokRowMatch?.(full);
                    }}
                  />
                )}

                <div className="flex items-center gap-2 mt-auto pt-2">
                  <button
                    type="button"
                    className="btn-ghost !py-2 !px-3 !text-sm text-muted-soft"
                    onClick={() => setActiveStep('qtycost')}
                  >
                    <Icon name="chevron-l" size={14}/> กลับ
                  </button>
                  <button
                    type="button"
                    className="btn-primary !py-2 !px-4 !text-sm ml-auto"
                    onClick={() => onNextAttention?.()}
                    disabled={!hasNextAttention}
                  >
                    รายการถัดไป <Icon name="chevron-r" size={14}/>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <WorkspaceFooter
        rowIndex={rowIndex}
        totalRows={totalRows}
        hasPrevAttention={hasPrevAttention}
        hasNextAttention={hasNextAttention}
        onPrevAttention={onPrevAttention}
        onNextAttention={onNextAttention}
        attentionCount={attentionCount}
      />
    </div>
  );
});

export default ReceiveMatchPanel;
