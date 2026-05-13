// BillReviewPanel — presentational component for the per-bill row
// editor used by both the (legacy) single-bill scan modal and the new
// batch wizard (`BulkReceiveView`). All AI fetching, products catalog
// loading, and submit logic live in the parent; this panel only owns
// the visual grid + row interactions.
//
// Why this exists: the original CmgBillScanModal.jsx grew to ~900 lines
// because it bundled the data plumbing AND the review UI in one file.
// When the batch flow needed the SAME review UI but a different
// orchestration shell, we extracted the UI into this panel. The exports
// (RowCard, STATUS_META, makeRowUid, etc.) are also re-used by tests
// and by `BulkReceiveView` directly when it needs to inspect status.
//
// Public API:
//   <BillReviewPanel
//     rows={rows}                  // mutable rows array
//     products={catalog}           // products for fuzzy-match candidates
//     onUpdateRow={(uid, patch)}   // qty / unit_cost edits
//     onRemoveRow={(uid)}
//     onPickCandidate={(uid, product)}   // picks a fuzzy-match candidate
//     onSetNewProduct={(uid, {name, barcode, retail_price})}
//   />
//
// Named exports:
//   STATUS_META        — status → visual tokens lookup
//   makeRowUid()       — collision-resistant uid generator
//   buildRowFromAi()   — turn an AI-extracted item into a row + classify

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Icon from '../ui/Icon.jsx';
import { classifyMatch, findCandidates } from '../../lib/fuzzy-match.js';
import RecentReceiveBadge from '../movement/RecentReceiveBadge.jsx';

// ─── Status descriptor lookup ────────────────────────────────────────
// Two-bucket palette: resolved rows (auto / user-added new) get a green
// tint, unresolved rows (suggestions / none) get a red tint. The icon
// + text colour still distinguishes the suggestions (warning) vs none
// (error) sub-states inside the red card.
export const STATUS_META = {
  auto: {
    card: 'border-success/40 bg-success/10',
    icon: 'check',
    iconCls: 'text-success',
  },
  new: {
    card: 'border-success/40 bg-success/10',
    icon: 'plus',
    iconCls: 'text-success',
  },
  suggestions: {
    card: 'border-error/40 bg-error/10',
    icon: 'alert',
    iconCls: 'text-warning',
  },
  none: {
    card: 'border-error/40 bg-error/10',
    icon: 'alert',
    iconCls: 'text-error',
  },
};

// ─── Row id generator ────────────────────────────────────────────────
// `Math.random()+Date.now()` mixes had a non-trivial collision rate when
// N rows were built in one synchronous loop (Date.now() identical for
// all, Math.random() has known weakness on V8's pre-shuffle batches).
// Collisions = duplicate React keys = ghosting state when the user
// picks a candidate / deletes a row. crypto.randomUUID is the right
// tool. Module-level counter as the last-resort fallback for very old
// environments.
let _rowUidCounter = 0;
export function makeRowUid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  _rowUidCounter += 1;
  return `r${Date.now().toString(36)}${_rowUidCounter}`;
}

// ─── AI item → row constructor ───────────────────────────────────────
// Takes one AI-extracted item ({model_code, quantity, unit_cost}) and a
// product catalog, runs fuzzy match, and returns a fully-shaped row.
// Pulled out as a named export because BulkReceiveView needs to call
// this once per bill in the batch — same logic, just N times.
export function buildRowFromAi(it, catalog) {
  const match = classifyMatch(it.model_code, catalog || []);
  return {
    uid: makeRowUid(),
    model_code: it.model_code,
    // H3: preserve a 0 from AI rather than coercing to 1. The prompt
    // tells the model to return 0 for unreadable values, and the
    // 'incomplete' status / warning ring rely on that sentinel
    // surviving into UI state.
    quantity:   Math.max(0, Math.round(Number(it.quantity) || 0)),
    unit_cost:  Math.max(0, Number(it.unit_cost) || 0),
    status:     match.status,        // auto | suggestions | none
    product:    match.product || null,
    candidates: match.candidates || [],
    // Used when user picks "add new product" — store the entered
    // retail_price so it's saved when they confirm.
    newProduct: null,                // {name, barcode, retail_price}
  };
}

// ─── Main panel ──────────────────────────────────────────────────────
export default function BillReviewPanel({
  rows,
  products,
  recentReceivesMap = null,
  // L3: pass a stable id for the currently-rendered bill. When it
  // changes (user jumped to another bill via the stepper), we scroll
  // the first unresolved row into view so the user doesn't have to
  // scan a 10-item grid to find the row that needs attention. Optional
  // — if omitted, the auto-scroll behavior is disabled.
  billKey = null,
  onUpdateRow,
  onRemoveRow,
  onPickCandidate,
  onSetNewProduct,
}) {
  // Grid-row equalizer — per user feedback, every RowCard should be
  // as tall as the tallest card in the whole grid, regardless of
  // status colour. CSS Grid alone only equalises siblings within the
  // same row, so we manually measure the natural max height and apply
  // it as min-height to every direct child.
  //
  // BUG HISTORY: the dep used to be `[rows.length]` + rely on
  // ResizeObserver for everything else. That broke one case: picking
  // a fuzzy-match candidate flips status `suggestions` → `auto`, the
  // ResolveBlock unmounts, the card's NATURAL height shrinks — but
  // the previously-pinned minHeight keeps the box at its old size, so
  // ResizeObserver never observes a shrink and equalize() never re-
  // runs. Fix: derive a `statusSig` from the row statuses and depend
  // on it too; any status transition forces a fresh measurement pass
  // with a clean minHeight reset before re-equalising.
  const statusSig = rows.map((r) => r.status).join('|');
  const gridRef = useRef(null);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    let frame = 0;

    const equalize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const cards = Array.from(grid.children);
        if (!cards.length) return;
        // Reset so the next measurement reads natural content height,
        // not the value we just applied.
        cards.forEach((c) => { c.style.minHeight = ''; });
        let max = 0;
        cards.forEach((c) => {
          const h = c.getBoundingClientRect().height;
          if (h > max) max = h;
        });
        cards.forEach((c) => { c.style.minHeight = max + 'px'; });
      });
    };

    equalize();
    const ro = new ResizeObserver(equalize);
    Array.from(grid.children).forEach((c) => ro.observe(c));
    window.addEventListener('resize', equalize);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener('resize', equalize);
    };
  }, [rows.length, statusSig]);

  // L3: auto-scroll first unresolved/incomplete row into view when the
  // user navigates to a different bill. We defer to the next tick so
  // the equalizer above has settled and the cards have their final
  // heights — otherwise scrollIntoView lands on a position that's
  // immediately invalidated by the layout pass.
  useEffect(() => {
    if (!billKey) return;
    const grid = gridRef.current;
    if (!grid) return;
    const id = setTimeout(() => {
      const firstBad = rows.findIndex((r) =>
        r.status === 'suggestions' ||
        r.status === 'none' ||
        !(Number(r.unit_cost) > 0) ||
        !(Number(r.quantity)  > 0)
      );
      if (firstBad < 0) return;
      const el = grid.children[firstBad];
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 50);
    return () => clearTimeout(id);
  // Intentionally exclude `rows` — we only want to auto-scroll on
  // bill change, NOT every time the user edits a number in a row.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billKey]);

  if (!rows.length) {
    return (
      <div className="py-10 text-center text-sm text-muted-soft">
        ไม่พบรายการในบิล
      </div>
    );
  }

  return (
    // `auto-fit` + `minmax(340px, 1fr)` gives both viewport-adaptive
    // (drops columns as the container narrows) and item-count-adaptive
    // (when only 2 rows exist they expand to fill instead of squeezing
    // into a 3-col slot with empties) — auto-fit collapses unused
    // tracks for us. `items-start` prevents a card with an expanded
    // resolve-block from stretching its row-mates.
    <div
      ref={gridRef}
      className="grid gap-4 items-start"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}
    >
      {rows.map((row, idx) => (
        <RowCard
          key={row.uid}
          index={idx}
          row={row}
          products={products}
          recentReceivesMap={recentReceivesMap}
          onUpdate={(patch) => onUpdateRow(row.uid, patch)}
          onPickCandidate={(p) => onPickCandidate(row.uid, p)}
          onSetNewProduct={(np) => onSetNewProduct(row.uid, np)}
          onRemove={() => onRemoveRow(row.uid)}
        />
      ))}
    </div>
  );
}

// ─── Per-line row component ──────────────────────────────────────────
export function RowCard({ index, row, products, recentReceivesMap, onUpdate, onPickCandidate, onSetNewProduct, onRemove }) {
  const meta = STATUS_META[row.status] || { card: 'border-hairline', icon: 'alert', iconCls: 'text-muted' };
  // H3: visual flags for rows where AI couldn't read the numeric. We
  // don't override the status colour (a row can be `auto` AND have
  // unit_cost=0 if AI just misread the cost) — instead we ring the
  // affected input in warning so the user's eye is drawn to the field
  // they need to fix.
  const costIncomplete = !(Number(row.unit_cost) > 0);
  const qtyIncomplete  = !(Number(row.quantity)  > 0);
  // Duplicate-bill guard — only relevant once a product_id is locked
  // in (status: auto). For 'new' / 'suggestions' / 'none' we either
  // don't have a real id yet (new) or haven't picked one (the other
  // two), so there's nothing to look up.
  const recentInfo = (row.status === 'auto' && row.product?.id && recentReceivesMap)
    ? recentReceivesMap.get(row.product.id)
    : null;

  // Render a single status line depending on resolution state.
  const statusLine = (() => {
    if (row.status === 'auto' && row.product) {
      return (
        <>
          <span>ตรงกับ</span>
          <span className="text-ink font-medium">{row.product.name}</span>
          <span className="text-muted-soft">·</span>
          <span className="tabular-nums">
            stock {row.product.current_stock} → {row.product.current_stock + row.quantity}
          </span>
        </>
      );
    }
    if (row.status === 'new' && row.newProduct) {
      return (
        <>
          <span>สินค้าใหม่</span>
          <span className="text-muted-soft">·</span>
          <span>ป้าย ฿{Number(row.newProduct.retail_price).toLocaleString()}</span>
        </>
      );
    }
    if (row.status === 'suggestions') return <>ใกล้เคียงในระบบ — โปรดเลือก</>;
    if (row.status === 'none')        return <>ไม่พบในระบบ — เพิ่มสินค้าใหม่หรือลบ</>;
    return null;
  })();

  return (
    <div className={`rounded-xl border-2 p-3 ${meta.card}`}>
      {/* Top row: #N badge + model + trash */}
      <div className="flex items-start gap-3">
        <div className="ai-row-badge" aria-label={`รายการที่ ${index + 1}`}>
          {index + 1}
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="text-base font-semibold text-ink truncate leading-tight">
            {row.model_code}
          </div>
          <div
            className={
              'text-xs mt-1.5 inline-flex items-center gap-1.5 flex-wrap ' +
              'px-2 py-1 rounded-md bg-white/55 ' +
              `border border-black/15 ${meta.iconCls}`
            }
          >
            <Icon name={meta.icon} size={12}/>
            {statusLine}
          </div>
          {/* Duplicate-bill guard: visible only on auto-matched rows
              whose product was already received in the last 7 days.
              Sits on its own line under the status pill so the warning
              colour doesn't fight with the green "ตรงกับ…" pill. */}
          {recentInfo && (
            <div className="mt-1.5">
              <RecentReceiveBadge info={recentInfo} />
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn-ghost !p-1.5 !min-h-0 -mr-1 -mt-1 text-muted-soft hover:text-error"
          onClick={onRemove}
          aria-label="ลบรายการ"
        >
          <Icon name="trash" size={15}/>
        </button>
      </div>

      {/* qty + cost — editable for every row */}
      <div className="grid grid-cols-2 gap-2 mt-3">
        <label className="block">
          <span className={'text-[11px] mb-1 block flex items-center gap-1 ' + (qtyIncomplete ? 'text-warning font-medium' : 'text-muted-soft')}>
            จำนวน
            {qtyIncomplete && <Icon name="alert" size={10}/>}
          </span>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            className={'input !py-2 !text-sm w-full tabular-nums ' + (qtyIncomplete ? '!border-warning ring-2 ring-warning/30' : '')}
            value={row.quantity}
            // H3: preserve 0 in state (was coerced to 1) so the warning
            // ring stays visible until the user actually types a real
            // value. Submit guard refuses 0 either way.
            onChange={(e) => onUpdate({ quantity: Math.max(0, Number(e.target.value) || 0) })}
          />
        </label>
        <label className="block">
          <span className={'text-[11px] mb-1 block flex items-center gap-1 ' + (costIncomplete ? 'text-warning font-medium' : 'text-muted-soft')}>
            ทุน / เรือน
            {costIncomplete && <Icon name="alert" size={10}/>}
          </span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            className={'input !py-2 !text-sm w-full text-right font-mono tabular-nums ' + (costIncomplete ? '!border-warning ring-2 ring-warning/30' : '')}
            value={row.unit_cost}
            onChange={(e) => onUpdate({ unit_cost: Math.max(0, Number(e.target.value) || 0) })}
          />
        </label>
      </div>

      {/* Resolve actions when status needs human input */}
      {(row.status === 'suggestions' || row.status === 'none') && (
        <ResolveBlock
          row={row}
          products={products}
          onPick={onPickCandidate}
          onCreateNew={onSetNewProduct}
        />
      )}
    </div>
  );
}

export function ResolveBlock({ row, products, onPick, onCreateNew }) {
  const [mode, setMode] = useState(null); // null | 'pick' | 'create' | 'search'
  const [searchQuery, setSearchQuery] = useState('');
  // Debounced query — Levenshtein over a 6k-row catalog is 50-100ms on
  // a mid-range phone. Running it on every keystroke makes the input
  // feel laggy. 150ms is short enough to feel near-instant for normal
  // typing but batches bursts.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(searchQuery), 150);
    return () => clearTimeout(id);
  }, [searchQuery]);
  const [npName, setNpName] = useState(row.model_code);
  const [npBarcode, setNpBarcode] = useState('');
  const [npRetail, setNpRetail] = useState('');

  const searchResults = useMemo(() => {
    const q = debouncedQuery.trim();
    if (!q) return [];
    return findCandidates(q, products, { limit: 8, minScore: 0.4 });
  }, [debouncedQuery, products]);

  const submitCreate = () => {
    if (!npName.trim()) return;
    const retail = Number(npRetail);
    if (!retail || retail <= 0) return;
    onCreateNew({
      name: npName.trim(),
      barcode: npBarcode.trim() || null,
      retail_price: retail,
    });
  };

  // Header row shared by all three modes — title + dismiss link.
  const modeHeader = (title) => (
    <div className="flex items-center justify-between mb-2">
      <div className="text-xs font-medium text-ink">{title}</div>
      <button
        type="button"
        className="text-xs text-muted-soft hover:text-ink"
        onClick={() => setMode(null)}
      >
        ← กลับ
      </button>
    </div>
  );

  // Candidate card — reused by 'pick' and 'search' modes.
  const CandidateCard = ({ c, onClick }) => (
    <button
      key={c.product.id}
      type="button"
      className="w-full text-left px-3 py-2 rounded-lg bg-canvas border hairline hover:border-primary hover:bg-surface-soft transition flex items-center justify-between gap-2"
      onClick={onClick}
    >
      <div className="min-w-0 flex-1">
        <div className="font-mono text-sm truncate text-ink">{c.product.name}</div>
        <div className="text-[11px] text-muted-soft tabular-nums">
          stock {c.product.current_stock}
          {c.product.retail_price > 0 && (
            <> · ขาย ฿{Number(c.product.retail_price).toLocaleString()}</>
          )}
        </div>
      </div>
      <span className="text-[10px] tabular-nums font-semibold text-muted bg-surface-soft border hairline rounded-md px-1.5 py-0.5">
        {Math.round(c.score * 100)}%
      </span>
    </button>
  );

  return (
    <div className="mt-3 pt-3 border-t hairline-soft">
      {!mode && (
        <div className="flex flex-wrap gap-1.5">
          {row.candidates?.length > 0 && (
            <button
              type="button"
              className="btn-secondary !py-1.5 !px-3 !min-h-0 text-xs"
              onClick={() => setMode('pick')}
            >
              <Icon name="check" size={12}/> เลือกใกล้เคียง ({row.candidates.length})
            </button>
          )}
          <button
            type="button"
            className="btn-secondary !py-1.5 !px-3 !min-h-0 text-xs"
            onClick={() => setMode('search')}
          >
            <Icon name="search" size={12}/> ค้นหารุ่น
          </button>
          <button
            type="button"
            className="btn-primary !py-1.5 !px-3 !min-h-0 text-xs"
            onClick={() => setMode('create')}
          >
            <Icon name="plus" size={12}/> เพิ่มสินค้าใหม่
          </button>
        </div>
      )}

      {mode === 'pick' && (
        <div>
          {modeHeader('รุ่นใกล้เคียงในระบบ')}
          <div className="space-y-1.5">
            {row.candidates.map((c) => (
              <CandidateCard key={c.product.id} c={c} onClick={() => onPick(c.product)}/>
            ))}
          </div>
        </div>
      )}

      {mode === 'search' && (
        <div>
          {modeHeader('ค้นหารุ่นในระบบ')}
          <input
            type="text"
            className="input !py-2 !text-sm w-full mb-2"
            placeholder="พิมพ์รหัสรุ่น…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
          <div className="max-h-48 overflow-y-auto space-y-1.5">
            {searchResults.length === 0 && searchQuery && (
              <div className="text-xs text-muted-soft px-1 py-2 text-center">ไม่พบ</div>
            )}
            {searchResults.map((c) => (
              <CandidateCard key={c.product.id} c={c} onClick={() => onPick(c.product)}/>
            ))}
          </div>
        </div>
      )}

      {mode === 'create' && (
        <div className="space-y-2">
          {modeHeader('เพิ่มสินค้าใหม่เข้าคลัง')}
          <label className="block">
            <span className="text-[11px] text-muted-soft mb-1 block">
              ชื่อรุ่น <span className="text-error">*</span>
            </span>
            <input
              type="text"
              className="input !py-2 !text-sm w-full font-mono"
              value={npName}
              onChange={(e) => setNpName(e.target.value)}
              autoFocus
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-muted-soft mb-1 block">บาร์โค้ด <span className="text-muted-soft">(ไม่บังคับ)</span></span>
            <input
              type="text"
              className="input !py-2 !text-sm w-full font-mono"
              value={npBarcode}
              onChange={(e) => setNpBarcode(e.target.value)}
              placeholder="ใส่ทีหลังได้"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-muted-soft mb-1 block">
              ราคาป้าย / ราคาขาย <span className="text-error">*</span>
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              className="input !py-2 !text-sm w-full text-right font-mono tabular-nums"
              value={npRetail}
              onChange={(e) => setNpRetail(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <div className="text-[11px] text-muted-soft bg-surface-soft rounded-md px-2.5 py-1.5 border hairline">
            ทุน <span className="font-mono tabular-nums text-ink">฿{row.unit_cost.toFixed(2)}</span> / เรือน
            <span className="text-muted-soft"> (อ่านจากบิล) · ราคาป้ายต้องใส่เอง</span>
          </div>
          <button
            type="button"
            className="btn-primary !py-2 !px-3 !min-h-0 text-xs w-full"
            onClick={submitCreate}
            disabled={!npName.trim() || !Number(npRetail)}
          >
            <Icon name="check" size={14}/> ยืนยันสร้างสินค้าใหม่
          </button>
        </div>
      )}
    </div>
  );
}
