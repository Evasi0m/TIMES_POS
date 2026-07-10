// BulkReceiveView — the "รับเข้า ×10" page.
//
// Three-phase wizard that wraps the entire flow:
//
//   1. EMPTY  — landing state. User taps the upload button which opens
//               BulkBillUploadModal to pick 1–10 bill images.
//   2. PARSING — one bill per cmg-bill-parse request (chunk size 1) for
//               accuracy on dense dot-matrix tables; trade-off is ~2× API
//               calls vs paired batches.
//   3. REVIEW — wizard with stepper. One bill visible at a time; user
//               resolves any unmatched rows in the BillReviewPanel,
//               navigates with ← / → between bills, then taps "บันทึก
//               ทั้งหมด" to save sequentially.
//
// Save loop is sequential and partial-success: each bill maps to a
// `create_stock_movement_with_items('receive', …)` RPC call. Failures
// don't abort the batch — they get marked saveState='failed' and the
// summary screen offers a "ลองใหม่ X บิลที่พลาด" button. Successful
// bills are locked (saveState='saved') so retry doesn't double-record.
//
// AI errors (429 quota, 503 overload, 500 internal, etc.) are mapped
// through `friendlyEdgeError` to Thai messages with actionable hints
// — see CmgBillScanModal's predecessor for the historical context on
// why we drill into FunctionsHttpError.context manually.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sb } from '../../lib/supabase-client.js';
import { getProductListBundle } from '../../lib/product-catalog-cache.js';
import { mapError } from '../../lib/error-map.js';
import { VAT_RATE_DEFAULT, fmtTHB } from '../../lib/money.js';
import { buildReceiveItems, receiveTotals, grossUnitCost } from '../../lib/ai-receive.js';
import { validateRowMath } from '../../lib/cmg-bill-validate.js';
import { startOfDayBangkok } from '../../lib/date.js';
import { todayISO } from '../../lib/server-clock.js';
import Icon from '../ui/Icon.jsx';
import BillReviewPanel, { materializeParsedBill, makeRowUid } from './BillReviewPanel.jsx';
import BulkBillUploadModal from './BulkBillUploadModal.jsx';
import JsonBillImportModal from './JsonBillImportModal.jsx';
import BillImageLightbox from './BillImageLightbox.jsx';
import AIErrorCard, { parseAIError } from './AIErrorCard.jsx';
import MacTerminal from '../ui/MacTerminal.jsx';
import BottomSheet from '../ui/mobile/BottomSheet.jsx';
import { collectBillAlerts, BILL_STATUS_LABELS, BILL_STATUS_CHIP_CLS } from './bill-card-alerts.js';
import {
  deriveParsingSteps,
  makeLogLine,
  msgAllDone,
  msgBillSuccess,
  msgCatalogDone,
  msgCatalogStart,
  msgCatalogWarn,
  msgChunkHeader,
  msgChunkMeta,
  msgDupCheckStart,
  msgEdgeConnect,
  msgMatchSummary,
  msgValidationSummary,
  msgParseError,
  msgPrepImages,
  msgResponseOk,
  msgRetryScan,
  msgSendBills,
  msgJsonBillReady,
  msgStartJsonImport,
  msgStartScan,
  msgTokenUsage,
  msgTraceLines,
  msgWaitingDetail,
} from './parse-activity-log.js';
import { enrichTiktokMappingFromCatalog, computeRowSummary, computeBillStatus } from './bill-review-shared.js';
import { useRecentReceivesMap, findExistingCmgInvoices } from '../../lib/recent-receives.js';
import { saveDraft, loadDraft, clearDraft, base64ToBlob } from '../../lib/ai-draft.js';
import { useTikTokMirrorCatalog } from '../../hooks/useTikTokMirrorCatalog.js';
import {
  buildSyncLine,
  fetchPosStocks,
  formatMirrorToast,
  getTikTokConnectionStatus,
  isTikTokLineReady,
  mirrorStockToTikTok,
  persistTiktokMatchMapping,
} from '../../lib/tiktok-inventory-sync.js';
import { flushDraftNow, resolveMobileBackAction } from './bulk-receive-mobile-back.js';

const AI_PARSE_CHUNK_SIZE = 1;

function mergeRowPatch(row, patch) {
  const next = { ...row, ...patch };
  if ('quantity' in patch || 'unit_cost' in patch) {
    next.reviewConfirmed = false;
    const { mismatch, detail } = validateRowMath(next);
    const issues = (row.validationIssues || []).filter((i) => i !== 'row_math_mismatch');
    if (mismatch) {
      issues.push('row_math_mismatch');
      next.validationIssues = issues;
      next.validationDetail = detail;
    } else {
      next.validationIssues = issues;
      if (!issues.length) next.validationDetail = null;
    }
  }
  return next;
}

function aggregateAiUsage(usages) {
  const valid = (usages || []).filter(Boolean);
  if (!valid.length) return null;
  const out = valid.reduce((acc, u) => ({
    prompt_tokens: acc.prompt_tokens + (Number(u.prompt_tokens) || 0),
    output_tokens: acc.output_tokens + (Number(u.output_tokens) || 0),
    total_tokens: acc.total_tokens + (Number(u.total_tokens) || 0),
    estimated_usd: acc.estimated_usd + (Number(u.estimated_usd) || 0),
    estimated_thb: acc.estimated_thb + (Number(u.estimated_thb) || 0),
    bills_count: acc.bills_count + (Number(u.bills_count) || 0),
    model: acc.model || u.model || '',
    key_label: acc.key_label || u.key_label || '',
  }), {
    prompt_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    estimated_usd: 0,
    estimated_thb: 0,
    bills_count: 0,
    model: '',
    key_label: '',
  });
  const models = [...new Set(valid.map((u) => u.model).filter(Boolean))];
  const keys = [...new Set(valid.map((u) => u.key_label).filter(Boolean))];
  return {
    ...out,
    estimated_usd: Number(out.estimated_usd.toFixed(6)),
    estimated_thb: Number(out.estimated_thb.toFixed(4)),
    model: models.join(', '),
    key_label: keys.join(', '),
  };
}

// ─── Auto invoice number generator ────────────────────────────────────
// Mirror StockMovementForm's autoInvoiceNo so users get the same shape
// when AI didn't pick up a printed invoice number on a bill.
//
// M3 fix: optional `seq` suffix. Without it, two bills in the same
// batch whose loop iterations land in the same second produce IDENTICAL
// fallback invoice numbers — the constraint is non-UNIQUE on the DB so
// nothing errors, but the receive list becomes confusing. Callers in a
// batch context pass 1-based seq so each bill is `…_b1`, `…_b2`, etc.
function autoInvoiceNo(seq) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}_${p(d.getMonth()+1)}_${p(d.getDate())}_${p(d.getHours())}_${p(d.getMinutes())}_${p(d.getSeconds())}`;
  return seq ? `${stamp}_b${seq}` : stamp;
}

// ─── Bill state classifier ────────────────────────────────────────────
// Maps a bill (post-AI, post-row-edits) to one of the stepper statuses.
// Priority (high → low): saveState terminal/in-flight > non-CMG/empty
// > unresolved match > incomplete numeric > ready.
//
// H3 fix: 'incomplete' is the new status surfaced when any row has
// unit_cost <= 0 OR quantity <= 0 (AI rule #5 makes these the
// "unreadable" sentinels — the user MUST fix them before submit
// otherwise we'd persist `unit_price=0` rows that silently wreck
// profit calculations). See computeBillStatus in bill-review-shared.js.
const billStatus = computeBillStatus;

/** Bill stepper chip: green when ready/saved, red otherwise. */
function isBillStepperSuccess(status) {
  return status === 'ready' || status === 'saved';
}

const STEP_STATUS_META = {
  ready:      { icon: 'check', cls: 'bg-success/15 text-success border-success/40' },
  needs_review: { icon: 'alert', cls: 'bg-warning/15 text-warning border-warning/40' },
  unresolved: { icon: 'alert', cls: 'bg-warning/15 text-warning border-warning/40' },
  incomplete: { icon: 'alert', cls: 'bg-warning/15 text-warning border-warning/40' },
  tiktok_unresolved: { icon: 'store', cls: 'bg-warning/15 text-warning border-warning/40' },
  empty:      { icon: 'alert', cls: 'bg-error/15 text-error border-error/40' },
  saving:     { icon: 'refresh', cls: 'bg-primary/15 text-primary border-primary/40', spin: true },
  saved:      { icon: 'check', cls: 'bg-success/20 text-success border-success/55' },
  failed:     { icon: 'x', cls: 'bg-error/20 text-error border-error/55' },
};

// Returns true if a bill can be submitted (passes H3 guards too).
function isBillSubmittable(bill, mirrorOn = false) {
  const s = billStatus(bill, mirrorOn);
  return s === 'ready' || s === 'failed';
}

// ─── Main component ───────────────────────────────────────────────────
export default function BulkReceiveView({ toast, onPhaseChange }) {
  const [phase, setPhase] = useState('empty'); // empty | parsing | review | review_paused | done
  // Duplicate-bill guard — same hook as StockMovementForm uses.
  // Loads once on mount; powers the small "พึ่งรับ X วันก่อน" badge on
  // RowCards whose AI-matched product was already received in the
  // last 7 days. Helps users avoid re-scanning a bill they already
  // submitted earlier in the week.
  const { map: recentReceivesMap, refresh: refreshRecentReceives } = useRecentReceivesMap();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [jsonImportOpen, setJsonImportOpen] = useState(false);
  const [error, setError] = useState(null);
  const [products, setProducts] = useState([]);
  const [bills, setBills] = useState([]); // per-image state
  const [currentIdx, setCurrentIdx] = useState(0);
  const [usage, setUsage] = useState(null);
  const [parsingProgress, setParsingProgress] = useState(null); // {done,total,currentFrom,currentTo}
  const [parseLogs, setParseLogs] = useState([]); // { id, text, tone }
  const [parseActiveLine, setParseActiveLine] = useState(null);
  const [parseIsActive, setParseIsActive] = useState(false);
  const [productImagesById, setProductImagesById] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitSummary, setSubmitSummary] = useState(null); // {savedIds:[], failed:[]}
  const [syncTikTokAfterReceive, setSyncTikTokAfterReceive] = useState(true);
  const [tiktokConnected, setTiktokConnected] = useState(false);
  const [tiktokMinPct, setTiktokMinPct] = useState(60);
  const [lightboxSrc, setLightboxSrc] = useState(null);     // A1: bill image zoom
  const [savingProgress, setSavingProgress] = useState(null); // A4: {done,total}
  const [undo, setUndo] = useState(null);                   // A3: {label, restore}
  const [dupInvoices, setDupInvoices] = useState(() => new Map()); // B2: invoiceNo→{id,date}
  const [draftAvailable, setDraftAvailable] = useState(null); // C1: a saved draft to restore
  // This page only ever scans bills from บริษัท เซ็นทรัลเทรดดิ้ง จำกัด (the
  // Casio/Seiko distributor — "CMG" bills). We attach that registered
  // supplier to every saved receive so the purchase document (เอกสารซื้อ) has
  // the full supplier details for ภ.พ.30. Loaded once on mount.
  const [supplier, setSupplier] = useState(null);
  const undoTimer = useRef(null);
  const draftTimer = useRef(null);
  const draftFailWarned = useRef(false);
  const parseWaitTimer = useRef(null);
  const parseWaitStartedAt = useRef(0);
  const parseWaitContext = useRef({ from: 1, to: 1 });

  const stopWaitTicker = useCallback(() => {
    if (parseWaitTimer.current) {
      clearInterval(parseWaitTimer.current);
      parseWaitTimer.current = null;
    }
  }, []);

  const clearParseActive = useCallback(() => {
    stopWaitTicker();
    setParseActiveLine(null);
    setParseIsActive(false);
  }, [stopWaitTicker]);

  const clearParseLogs = useCallback(() => {
    clearParseActive();
    setParseLogs([]);
  }, [clearParseActive]);

  const appendParseLog = useCallback((lineOrText, tone = 'info') => {
    const line = typeof lineOrText === 'string' ? makeLogLine(lineOrText, tone) : lineOrText;
    if (!line) return;
    setParseLogs((prev) => [...prev, line]);
  }, []);

  const pushParseLogs = useCallback((lines) => {
    const arr = (Array.isArray(lines) ? lines : [lines]).filter(Boolean);
    if (!arr.length) return;
    setParseLogs((prev) => [...prev, ...arr]);
  }, []);

  const startWaitTicker = useCallback((from = 1, to = 1) => {
    stopWaitTicker();
    parseWaitContext.current = { from, to };
    parseWaitStartedAt.current = Date.now();
    setParseIsActive(true);
    const tick = () => {
      const secs = Math.floor((Date.now() - parseWaitStartedAt.current) / 1000);
      const { from: f, to: t } = parseWaitContext.current;
      setParseActiveLine(msgWaitingDetail(f, t, secs));
    };
    tick();
    parseWaitTimer.current = setInterval(tick, 1000);
  }, [stopWaitTicker]);

  useEffect(() => () => stopWaitTicker(), [stopWaitTicker]);

  useEffect(() => {
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await sb.from('suppliers')
        .select('*')
        .ilike('business_name', '%เซ็นทรัลเทรดดิ้ง%')
        .eq('is_active', true)
        .order('id')
        .limit(1);
      if (!cancelled) setSupplier(data?.[0] || null);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const st = await getTikTokConnectionStatus();
        if (!cancelled) setTiktokConnected(!!st?.connected && !st?.token_expired);
      } catch {
        if (!cancelled) setTiktokConnected(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const tiktokMirrorOn = syncTikTokAfterReceive && tiktokConnected;
  const tiktokCatalogLines = useMemo(
    () => bills.flatMap(b => b.rows)
      .filter(r => r.product?.id || (r.status === 'new' && r.newProduct))
      .map(r => ({
        product_id: r.product?.id,
        product_name: r.product?.name || r.newProduct?.name || r.model_code,
        barcode: r.product?.barcode || r.newProduct?.barcode,
        quantity: r.quantity,
      })),
    [bills],
  );
  const {
    catalog: tiktokCatalog,
    catalogLoading: tiktokCatalogLoading,
    loadError: tiktokCatalogError,
    mappingsByProductId,
    stocksByProductId,
    searchCatalog: searchTiktokCatalog,
    reloadCatalog: reloadTiktokCatalog,
    refreshMappings,
  } = useTikTokMirrorCatalog({
    enabled: phase === 'review',
    mirrorEnabled: tiktokMirrorOn && phase === 'review',
    lines: tiktokCatalogLines,
  });

  const reviewProductIds = useMemo(() => {
    if (phase !== 'review') return '';
    const ids = new Set();
    for (const bill of bills) {
      for (const row of bill.rows) {
        if (row.product?.id) ids.add(row.product.id);
      }
    }
    return [...ids].sort((a, b) => a - b).join(',');
  }, [phase, bills]);

  useEffect(() => {
    if (phase !== 'review' || !reviewProductIds) {
      setProductImagesById({});
      return undefined;
    }
    const ids = reviewProductIds.split(',').map(Number).filter(Boolean);
    if (!ids.length) return undefined;
    let cancelled = false;
    (async () => {
      const { data } = await sb
        .from('product_images')
        .select('product_id, image_url, status, updated_at')
        .in('product_id', ids)
        .eq('status', 'found');
      if (cancelled) return;
      const map = {};
      for (const row of data || []) {
        if (row.image_url) map[row.product_id] = row;
      }
      setProductImagesById(map);
    })();
    return () => { cancelled = true; };
  }, [phase, reviewProductIds]);

  useEffect(() => {
    if (!tiktokMirrorOn) return;
    setBills(prev => {
      let changed = false;
      const next = prev.map(bill => {
        let billChanged = false;
        const rows = bill.rows.map(r => {
          if (!r.product?.id || r.tiktok_manual || r.tiktok_skip || r.tiktok_sku || r.tiktok_mapping) return r;
          const raw = mappingsByProductId[r.product.id];
          if (!raw) return r;
          billChanged = true;
          return { ...r, tiktok_mapping: enrichTiktokMappingFromCatalog(raw, tiktokCatalog) };
        });
        if (billChanged) { changed = true; return { ...bill, rows }; }
        return bill;
      });
      return changed ? next : prev;
    });
  }, [tiktokMirrorOn, mappingsByProductId, tiktokCatalog]);

  useEffect(() => {
    if (!tiktokCatalog.length) return;
    setBills(prev => {
      let changed = false;
      const next = prev.map(bill => {
        let billChanged = false;
        const rows = bill.rows.map(r => {
          if (r.tiktok_skip || r.tiktok_sku || !r.tiktok_mapping) return r;
          const enriched = enrichTiktokMappingFromCatalog(r.tiktok_mapping, tiktokCatalog);
          if (enriched === r.tiktok_mapping || enriched.image_url === r.tiktok_mapping.image_url) return r;
          billChanged = true;
          return { ...r, tiktok_mapping: enriched };
        });
        if (billChanged) { changed = true; return { ...bill, rows }; }
        return bill;
      });
      return changed ? next : prev;
    });
  }, [tiktokCatalog]);

  // A3: stash a just-deleted thing with a 6s "เลิกทำ" snackbar instead of
  // removing it irreversibly. `restore` re-applies the captured state;
  // `onExpire` runs cleanup (e.g. revoke an ObjectURL) if NOT undone.
  const offerUndo = useCallback((label, restore, onExpire) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo((prev) => { prev?.onExpire?.(); return { label, restore, onExpire }; });
    undoTimer.current = setTimeout(() => {
      setUndo((u) => { u?.onExpire?.(); return null; });
    }, 6000);
  }, []);
  const doUndo = useCallback(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo((u) => { u?.restore?.(); return null; });
  }, []);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  // M1+M2 fix: a ref tracking the latest bills array. We use it for
  // (a) unmount cleanup — the previous code captured the initial
  // empty array via stale closure, so previewUrls were never revoked
  // — and (b) the submit loop, which needs to read fresh bill state
  // between awaited DB calls without abusing setBills as a Promise.
  const billsRef = useRef(bills);
  useEffect(() => { billsRef.current = bills; }, [bills]);

  // ─── Cleanup: revoke preview URLs when component unmounts ──────────
  useEffect(() => {
    return () => {
      billsRef.current.forEach((b) => {
        if (b.previewUrl) URL.revokeObjectURL(b.previewUrl);
      });
    };
  }, []);

  // ─── C1: offer to restore a saved draft on first mount ─────────────
  useEffect(() => {
    let alive = true;
    loadDraft().then((d) => {
      if (alive && d && Array.isArray(d.bills) && d.bills.length > 0) setDraftAvailable(d);
    });
    return () => { alive = false; };
  }, []);

  // ─── C1: debounced autosave of the in-progress review batch ────────
  useEffect(() => {
    if ((phase !== 'review' && phase !== 'review_paused') || bills.length === 0) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(async () => {
      const result = await flushDraftNow(bills, currentIdx, usage);
      if (!result.ok && !draftFailWarned.current) {
        draftFailWarned.current = true;
        toast?.push('บันทึก draft ไม่สำเร็จ — อย่าปิดแท็บ', 'error');
      }
    }, 800);
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current); };
  }, [bills, currentIdx, usage, phase, toast]);

  // ─── C2: warn before unloading the tab with unsaved bills ──────────
  useEffect(() => {
    const dirty = (phase === 'review' || phase === 'review_paused') && bills.some(
      (b) => b.is_cmg_bill && b.rows.length > 0 && b.saveState !== 'saved'
    );
    if (!dirty) return;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [phase, bills]);

  // ─── C1: restore a saved draft → rebuild previewUrls, refetch catalog ─
  const restoreDraft = useCallback(async (draft) => {
    setDraftAvailable(null);
    try {
      const restoredBills = (draft.bills || []).map((b) => {
        let previewUrl = '';
        if (b.base64) {
          try { previewUrl = URL.createObjectURL(base64ToBlob(b.base64, b.mime)); } catch { /* noop */ }
        }
        return { ...b, previewUrl, footerConfirmed: b.footerConfirmed ?? false };
      });
      setBills(restoredBills);
      setCurrentIdx(Math.min(draft.currentIdx || 0, Math.max(0, restoredBills.length - 1)));
      setUsage(draft.usage || null);
      setPhase('review');
      // Catalog isn't persisted (too large) — refetch so the search /
      // resolve UI works. Matches/candidates from the draft still render
      // immediately; this just rehydrates `products` for new searches.
      getProductListBundle(sb)
        .then(({ bundle, error }) => {
          if (!error && bundle?.products) setProducts(bundle.products);
        })
        .catch(() => {});
      // Refresh the duplicate-invoice guard for the restored bills.
      const invoiceNos = restoredBills
        .map((b) => String(b.supplier_invoice_no || '').trim())
        .filter(Boolean);
      findExistingCmgInvoices(invoiceNos).then(setDupInvoices).catch(() => {});
    } catch (e) {
      console.warn('[BulkReceiveView] restore failed:', e);
      clearDraft();
    }
  }, []);
  const discardDraft = useCallback(() => { setDraftAvailable(null); clearDraft(); }, []);

  // ─── Start a fresh batch: open the upload modal ────────────────────
  // H1 fix: this used to be wired to BOTH EmptyLanding's "start" CTA
  // AND ReviewWizard's "+ เพิ่มบิล" button. In the review case it
  // silently destroyed the in-progress batch (revoked all previewUrls,
  // wiped bills/usage). The "+ เพิ่มบิล" affordance has been removed
  // until we implement proper batch-append (would need a second AI call
  // on only the new images and merge). Now this is only called from
  // landing/error/done — and only the error phase can possibly have
  // bills.length > 0, in which case wiping is the intended behavior.
  const startUpload = () => {
    if (bills.length > 0) {
      bills.forEach((b) => b.previewUrl && URL.revokeObjectURL(b.previewUrl));
      setBills([]);
      setUsage(null);
      setParsingProgress(null);
      setSubmitSummary(null);
      setError(null);
      setCurrentIdx(0);
    }
    setUploadOpen(true);
  };

  const startJsonImport = () => {
    if (bills.length > 0) {
      bills.forEach((b) => b.previewUrl && URL.revokeObjectURL(b.previewUrl));
      setBills([]);
      setUsage(null);
      setParsingProgress(null);
      setSubmitSummary(null);
      setError(null);
      setCurrentIdx(0);
    }
    setJsonImportOpen(true);
  };

  const retryJsonImport = () => {
    setError(null);
    setPhase('empty');
    startJsonImport();
  };

  const handleJsonImportConfirm = useCallback(async ({ bills: parsedBills, fileName } = {}) => {
    if (!parsedBills?.length) return;
    setJsonImportOpen(false);
    setPhase('parsing');
    setError(null);
    clearParseLogs();
    pushParseLogs(msgStartJsonImport(parsedBills.length));
    setParsingProgress({ done: 0, total: parsedBills.length, currentFrom: 1, currentTo: parsedBills.length, failed: 0 });
    setCurrentIdx(0);
    setUsage(null);

    const seedBills = parsedBills.map((_, i) => ({
      uid: makeRowUid(),
      name: fileName ? `${fileName}#${i + 1}` : `json-bill-${i + 1}`,
      importSource: 'json',
      previewUrl: null,
      base64: null,
      mime: null,
      is_cmg_bill: false,
      supplier_invoice_no: '',
      has_vat: true,
      bill_subtotal: 0,
      total_qty: 0,
      vat_amount: 0,
      grand_total: 0,
      validation: null,
      rows: [],
      parseState: 'parsing',
      parseError: null,
      saveState: 'pending',
      savedOrderId: null,
      saveError: null,
      footerConfirmed: false,
    }));
    setBills(seedBills);

    try {
      pushParseLogs(msgCatalogStart());
      const catalogStartedAt = Date.now();
      const { bundle, error: catalogError } = await getProductListBundle(sb);
      const catalog = bundle?.products || [];
      const catalogMs = Date.now() - catalogStartedAt;
      if (catalogError) {
        console.warn('[BulkReceiveView] JSON import catalog load issue:', catalogError);
        pushParseLogs(msgCatalogWarn());
        toast?.push('โหลดรายการสินค้าไม่สำเร็จ — ต้องจับคู่เองทุกรายการ', 'error');
        if (catalog.length === 0) {
          throw new Error('โหลดรายการสินค้าไม่สำเร็จ — ลองใหม่อีกครั้ง');
        }
      } else {
        pushParseLogs(msgCatalogDone(catalog.length, catalogMs));
      }
      setProducts(catalog);

      const materializedBills = [];
      for (let i = 0; i < parsedBills.length; i++) {
        const bill = parsedBills[i];
        const billNo = i + 1;
        const invoiceNo = String(bill?.supplier_invoice_no || '').trim();
        const materialized = materializeParsedBill(bill, catalog);
        const { rows, validation } = materialized;
        appendParseLog(msgJsonBillReady(billNo, invoiceNo, rows.length));
        const auto = rows.filter((r) => r.status === 'auto' || r.status === 'new').length;
        const pick = rows.filter((r) => r.status === 'suggestions').length;
        const none = rows.filter((r) => r.status === 'none').length;
        appendParseLog(msgMatchSummary(billNo, auto, pick, none));
        const valLine = msgValidationSummary(billNo, validation);
        if (valLine) appendParseLog(valLine);
        materializedBills.push({ parsed: bill, materialized });
        setParsingProgress((prev) => ({
          ...(prev || {}),
          done: i + 1,
          total: parsedBills.length,
          currentFrom: 1,
          currentTo: parsedBills.length,
        }));
      }

      setBills((prev) =>
        prev.map((b, i) => {
          const entry = materializedBills[i];
          if (!entry) return b;
          const { parsed, materialized } = entry;
          return {
            ...b,
            is_cmg_bill: Boolean(parsed.is_cmg_bill),
            supplier_invoice_no: String(parsed.supplier_invoice_no || '').trim(),
            bill_subtotal: materialized.bill_subtotal,
            total_qty: materialized.total_qty,
            vat_amount: materialized.vat_amount,
            grand_total: materialized.grand_total,
            validation: materialized.validation,
            rows: materialized.rows,
            parseState: 'parsed',
            parseError: null,
          };
        }),
      );

      const invoiceNos = materializedBills
        .map(({ parsed }) => String(parsed?.supplier_invoice_no || '').trim())
        .filter(Boolean);
      if (invoiceNos.length) pushParseLogs(msgDupCheckStart(invoiceNos.length));
      findExistingCmgInvoices(invoiceNos).then(setDupInvoices).catch(() => {});

      pushParseLogs(msgAllDone(parsedBills.length, parsedBills.length));
      setParsingProgress(null);
      setPhase('review');
    } catch (e) {
      console.warn('[BulkReceiveView] JSON import failed:', e);
      const title = e?.message || mapError(e);
      pushParseLogs(msgParseError(title, ''));
      setError({ title, hint: '', retryable: false });
      setBills((prev) => prev.map((b) => ({ ...b, parseState: 'failed', parseError: title })));
      setPhase('error');
    }
  }, [appendParseLog, clearParseLogs, pushParseLogs, toast]);

  // ─── Upload commit → kick off chunked AI parsing ───────────────────
  const handleUploadConfirm = useCallback(async ({ images, retryOnly = false } = {}) => {
    if (!images?.length) return;
    setUploadOpen(false);
    setPhase('parsing');
    setError(null);
    if (!retryOnly) clearParseLogs();
    pushParseLogs(retryOnly ? msgRetryScan(images.length) : msgStartScan(images.length));
    if (!retryOnly) {
      const totalKb = Math.round(
        images.reduce((s, img) => s + (Number(img.sizeBytes) || 0), 0) / 1024,
      );
      pushParseLogs(msgPrepImages(images.length, totalKb));
    }
    setParsingProgress({ done: 0, total: images.length, currentFrom: 1, currentTo: Math.min(AI_PARSE_CHUNK_SIZE, images.length), failed: 0 });
    let seedBills = bills;
    if (!retryOnly) {
      // Seed bills with the image data so the wizard can show thumbnails
      // even while we're waiting for the AI.
      seedBills = images.map((img) => ({
        uid: makeRowUid(),
        name: img.name,
        previewUrl: img.previewUrl,
        base64: img.base64,
        mime: img.mime,
        width: img.width,
        height: img.height,
        sizeBytes: img.sizeBytes,
        // Filled in after AI returns:
        is_cmg_bill: false,
        supplier_invoice_no: '',
        has_vat: true,
        bill_subtotal: 0,
        total_qty: 0,
        vat_amount: 0,
        grand_total: 0,
        validation: null,
        rows: [],
        parseState: 'pending', // pending | parsing | parsed | failed
        parseError: null,
        // Lifecycle:
        saveState: 'pending', // pending | saving | saved | failed
        savedOrderId: null,
        saveError: null,
        footerConfirmed: false,
      }));
      setBills(seedBills);
      setUsage(null);
    }
    setCurrentIdx(0);

    try {
      // Catalog is needed to materialize parsed rows. Load it before the
      // loop so each successful chunk can be committed immediately; if a
      // later chunk fails, earlier parsed bills remain available.
      pushParseLogs(msgCatalogStart());
      const catalogStartedAt = Date.now();
      const { bundle, error: catalogError } = await getProductListBundle(sb);
      const catalog = bundle?.products || [];
      const catalogMs = Date.now() - catalogStartedAt;
      if (catalogError) {
        console.warn('[BulkReceiveView] catalog load issue:', catalogError);
        pushParseLogs(msgCatalogWarn());
        toast?.push('โหลดรายการสินค้าไม่สำเร็จ — ต้องจับคู่เองทุกรายการ', 'error');
      } else {
        pushParseLogs(msgCatalogDone(catalog.length, catalogMs));
      }
      setProducts(catalog);
      const parsedByIndex = new Map();
      const totalChunks = Math.ceil(images.length / AI_PARSE_CHUNK_SIZE);
      for (let start = 0; start < images.length; start += AI_PARSE_CHUNK_SIZE) {
        const chunk = images.slice(start, start + AI_PARSE_CHUNK_SIZE);
        const currentFrom = start + 1;
        const currentTo = start + chunk.length;
        const chunkIndex = Math.floor(start / AI_PARSE_CHUNK_SIZE) + 1;
        pushParseLogs(msgChunkHeader(chunkIndex, totalChunks));
        pushParseLogs(msgSendBills(currentFrom, currentTo));
        pushParseLogs(msgEdgeConnect(currentFrom, currentTo));
        setParsingProgress((prev) => ({
          ...(prev || {}),
          done: start,
          total: images.length,
          currentFrom,
          currentTo,
        }));
        setBills((prev) => prev.map((b) => {
          const retryIndex = chunk.findIndex((img) => img.uid && img.uid === b.uid);
          const absoluteIndex = retryOnly
            ? (retryIndex >= 0 ? prev.findIndex((x) => x.uid === b.uid) : -1)
            : prev.indexOf(b);
          const inChunk = retryOnly ? retryIndex >= 0 : absoluteIndex >= start && absoluteIndex < currentTo;
          return inChunk ? { ...b, parseState: 'parsing', parseError: null } : b;
        }));

        startWaitTicker(currentFrom, currentTo);
        const invokeStartedAt = Date.now();
        const parseRes = await sb.functions.invoke('cmg-bill-parse', {
          body: {
            images: chunk.map((img) => ({
              image_base64: img.base64,
              mime: img.mime,
            })),
          },
        });
        clearParseActive();
        if (parseRes.error) throw parseRes.error;
        const data = parseRes.data;
        if (!data) throw new Error('ไม่ได้รับข้อมูลจากเซิร์ฟเวอร์ — ลองอีกครั้ง');
        if (data.error) {
          if (Array.isArray(data.trace) && data.trace.length) {
            pushParseLogs(msgTraceLines(data.trace));
          }
          throw new Error(data.error);
        }
        if (!Array.isArray(data.bills) || data.bills.length === 0) {
          throw new Error('AI ไม่ได้รีเทิร์นบิลใดเลย — ลองถ่ายรูปใหม่');
        }
        pushParseLogs(msgResponseOk(data.bills.length, Date.now() - invokeStartedAt));
        if (Array.isArray(data.trace) && data.trace.length) {
          pushParseLogs(msgTraceLines(data.trace));
        }
        data.bills.forEach((bill, i) => {
          const originalIndex = retryOnly
            ? seedBills.findIndex((b) => b.uid === chunk[i]?.uid)
            : start + i;
          const billNo = originalIndex >= 0 ? originalIndex + 1 : start + i + 1;
          if (bill?.parse_warning === 'empty_slot') {
            appendParseLog(`บิลที่ ${billNo}: AI ไม่ได้คืนข้อมูล — ลองถ่ายใหม่`);
            if (originalIndex >= 0) {
              parsedByIndex.set(originalIndex, { bill, emptySlot: true });
            }
            return;
          }
          const itemsRaw = Array.isArray(bill?.items) ? bill.items : [];
          const invoiceNo = String(bill?.supplier_invoice_no || '').trim();
          appendParseLog(msgBillSuccess(billNo, itemsRaw.length, invoiceNo));
          const materialized = materializeParsedBill(bill, catalog);
          const { rows, validation } = materialized;
          const auto = rows.filter((r) => r.status === 'auto' || r.status === 'new').length;
          const pick = rows.filter((r) => r.status === 'suggestions').length;
          const none = rows.filter((r) => r.status === 'none').length;
          appendParseLog(msgMatchSummary(billNo, auto, pick, none));
          const valLine = msgValidationSummary(billNo, validation);
          if (valLine) appendParseLog(valLine);
          if (originalIndex >= 0) {
            parsedByIndex.set(originalIndex, { bill, materialized });
          }
        });
        const metaLine = msgChunkMeta(data.usage);
        if (metaLine) appendParseLog(metaLine);
        if (data.usage?.total_tokens) {
          appendParseLog(msgTokenUsage(data.usage.total_tokens, data.usage.estimated_thb));
        }
        setUsage((prev) => aggregateAiUsage([prev, data.usage]));
        setBills((prev) =>
          prev.map((b, i) => {
            const entry = parsedByIndex.get(i);
            if (!entry) return b;
            if (entry.emptySlot) {
              return {
                ...b,
                is_cmg_bill: false,
                supplier_invoice_no: '',
                bill_subtotal: 0,
                total_qty: 0,
                vat_amount: 0,
                grand_total: 0,
                validation: null,
                rows: [],
                parseState: 'failed',
                parseError: 'AI ไม่ได้คืนข้อมูลบิลนี้ — ลองถ่ายใหม่',
                parse_warning: 'empty_slot',
              };
            }
            const { bill: parsed, materialized } = entry;
            return {
              ...b,
              is_cmg_bill: Boolean(parsed.is_cmg_bill),
              supplier_invoice_no: String(parsed.supplier_invoice_no || '').trim(),
              bill_subtotal: materialized.bill_subtotal,
              total_qty: materialized.total_qty,
              vat_amount: materialized.vat_amount,
              grand_total: materialized.grand_total,
              validation: materialized.validation,
              rows: materialized.rows,
              parseState: 'parsed',
              parseError: null,
            };
          })
        );
        setParsingProgress((prev) => ({
          ...(prev || {}),
          done: Math.min(currentTo, images.length),
          total: images.length,
          currentFrom,
          currentTo,
        }));
      }
      // B2: flag bills whose invoice number was already received from CMG
      // (the "I scanned the same paper bill twice" case). Non-blocking.
      const invoiceNos = [...parsedByIndex.values()]
        .map((pb) => String(pb?.bill?.supplier_invoice_no || '').trim())
        .filter(Boolean);
      if (invoiceNos.length) pushParseLogs(msgDupCheckStart(invoiceNos.length));
      findExistingCmgInvoices(invoiceNos).then(setDupInvoices).catch(() => {});
      pushParseLogs(msgAllDone(images.length, images.length));
      setParsingProgress(null);
      setPhase('review');
    } catch (e) {
      clearParseActive();
      // Convert raw error → structured AIError object that the
      // AIErrorCard knows how to render. Keep the seeded bills around
      // so the user can retry on the SAME images without re-uploading.
      const parsed = await parseAIError(e);
      pushParseLogs(msgParseError(parsed.title, parsed.hint));
      setError(parsed);
      setParsingProgress((prev) => ({ ...(prev || {}), failed: (prev?.failed || 0) + 1 }));
      setBills((prev) => prev.map((b) => (
        b.parseState === 'parsing' ? { ...b, parseState: 'failed', parseError: parsed.title } : b
      )));
      setPhase('error');
    }
  }, [bills, appendParseLog, clearParseActive, clearParseLogs, pushParseLogs, startWaitTicker, toast]);

  // ─── Retry AI on the same images (no re-upload required) ───────────
  // When AI errored after we had already loaded images, the seedBills
  // are still in state — just re-run the parse with their base64.
  const retryParse = useCallback(async () => {
    if (bills.length === 0) return;
    setError(null);
    setPhase('parsing');
    const retryBills = bills.filter((b) => b.parseState !== 'parsed');
    const images = (retryBills.length ? retryBills : bills).map((b) => ({
      uid: b.uid,
      base64: b.base64,
      mime: b.mime,
      name: b.name,
      previewUrl: b.previewUrl,
      width: b.width,
      height: b.height,
      sizeBytes: b.sizeBytes,
    }));
    await handleUploadConfirm({ images, retryOnly: true });
  }, [bills, handleUploadConfirm]);

  // ─── Dismiss error batch (wipe all) vs continue with parsed bills ──
  const discardErrorBatch = () => {
    const parsedCount = bills.filter((b) => b.parseState === 'parsed').length;
    if (parsedCount > 0) {
      const ok = window.confirm(
        `มี ${parsedCount} บิลที่อ่านสำเร็จแล้ว — ลบทั้งหมดและเริ่มใหม่?`
      );
      if (!ok) return;
    }
    setError(null);
    setParsingProgress(null);
    clearParseLogs();
    if (bills.length > 0) {
      bills.forEach((b) => b.previewUrl && URL.revokeObjectURL(b.previewUrl));
      setBills([]);
      setUsage(null);
      setCurrentIdx(0);
    }
    setPhase('empty');
    clearDraft();
  };

  const continueWithParsedBills = () => {
    const parsed = bills.filter((b) => b.parseState === 'parsed');
    if (!parsed.length) return;
    setError(null);
    setParsingProgress(null);
    clearParseLogs();
    bills.forEach((b) => {
      if (b.parseState !== 'parsed' && b.previewUrl) URL.revokeObjectURL(b.previewUrl);
    });
    setBills(parsed);
    setCurrentIdx(0);
    setPhase('review');
  };

  // ─── Row mutators (scoped to currentIdx) ───────────────────────────
  const patchCurrent = (patcher) => {
    setBills((prev) => prev.map((b, i) => (i === currentIdx ? patcher(b) : b)));
  };
  const updateRow = (uid, patch) =>
    patchCurrent((b) => ({
      ...b,
      rows: b.rows.map((r) => (r.uid === uid ? mergeRowPatch(r, patch) : r)),
    }));
  const removeRow = (uid) => {
    const billIdx = currentIdx;
    let removed = null, pos = -1;
    setBills((prev) => prev.map((b, i) => {
      if (i !== billIdx) return b;
      pos = b.rows.findIndex((r) => r.uid === uid);
      removed = b.rows[pos];
      return { ...b, rows: b.rows.filter((r) => r.uid !== uid) };
    }));
    if (removed) {
      offerUndo('ลบรายการแล้ว', () => {
        setBills((prev) => prev.map((b, i) => {
          if (i !== billIdx) return b;
          const rows = [...b.rows];
          rows.splice(Math.max(0, pos), 0, removed);
          return { ...b, rows };
        }));
      });
    }
  };
  const pickCandidate = (uid, product) =>
    updateRow(uid, {
      status: 'auto',
      product,
      newProduct: null,
      reviewConfirmed: true,
      tiktok_skip: false,
      tiktok_sku: null,
      tiktok_mapping: enrichTiktokMappingFromCatalog(mappingsByProductId[product?.id] || null, tiktokCatalog),
      tiktok_manual: false,
    });
  const setNewProduct = (uid, np) =>
    updateRow(uid, { status: 'new', product: null, newProduct: np, reviewConfirmed: true });
  const confirmBillFooter = () =>
    patchCurrent((b) => ({ ...b, footerConfirmed: true }));

  const handleTiktokRowMatch = useCallback((rowUid, patch) => {
    const row = billsRef.current[currentIdx]?.rows.find((r) => r.uid === rowUid);
    const productId = row?.product?.id;
    if (!productId) return;
    // In-memory patch on the row; mapping is persisted again after product insert on save.
    persistTiktokMatchMapping(productId, patch, {
      onPersisted: (id) => refreshMappings([id]),
    }).catch((e) => console.warn('[BulkReceiveView] TikTok mapping persist failed:', e));
  }, [currentIdx, refreshMappings]);
  const updateInvoiceNo = (val) =>
    patchCurrent((b) => ({ ...b, supplier_invoice_no: val }));
  const updateHasVat = (val) =>
    patchCurrent((b) => ({ ...b, has_vat: val }));
  // A2: one-tap VAT toggle for the whole batch.
  const setAllVat = (val) =>
    setBills((prev) => prev.map((b) => ({ ...b, has_vat: val })));
  const removeCurrentBill = () => {
    const idx = currentIdx;
    let removed = null;
    setBills((prev) => {
      removed = prev[idx];
      const next = prev.filter((_, i) => i !== idx);
      if (next.length === 0) { setPhase('empty'); setCurrentIdx(0); return []; }
      setCurrentIdx((c) => Math.min(c, next.length - 1));
      return next;
    });
    if (removed) {
      // Keep the ObjectURL alive until the undo window closes so the
      // thumbnail survives a restore; revoke only if the user lets it go.
      offerUndo('ลบบิลแล้ว',
        () => {
          setBills((prev) => {
            const next = [...prev];
            next.splice(Math.min(idx, next.length), 0, removed);
            return next;
          });
          setPhase('review');
          setCurrentIdx(Math.min(idx, bills.length)); // bills is pre-removal length
        },
        () => { if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl); },
      );
    }
  };

  // ─── Submit summary derived from bills state ───────────────────────
  // We split bills into "actionable" (will attempt save) vs "to-skip"
  // (non-CMG/empty) so the bottom bar can show an accurate count.
  //
  // H3: a bill with rows whose unit_cost <= 0 or quantity <= 0 is
  // counted as "blocked" too — the submit button stays disabled until
  // the user resolves both unmatched products AND incomplete numerics.
  const summary = useMemo(() => {
    const actionable = bills.filter((b) => b.is_cmg_bill && b.rows.length > 0);
    const blocked = actionable.filter((b) => {
      const s = billStatus(b, tiktokMirrorOn);
      return s === 'unresolved' || s === 'incomplete' || s === 'tiktok_unresolved' || s === 'needs_review';
    });
    const skip = bills.filter((b) => !b.is_cmg_bill || b.rows.length === 0);
    const saved = bills.filter((b) => b.saveState === 'saved');
    const failed = bills.filter((b) => b.saveState === 'failed');
    return {
      total: bills.length,
      actionable: actionable.length,
      blocked: blocked.length,
      skip: skip.length,
      saved: saved.length,
      failed: failed.length,
      readyToSubmit: actionable.length > 0 && blocked.length === 0,
    };
  }, [bills, tiktokMirrorOn]);

  // ─── Sequential submit with partial-success ────────────────────────
  // For each bill that is_cmg_bill && rows.length > 0 && saveState !==
  // 'saved': (1) bulk-insert any new products required, (2) call the
  // create_stock_movement_with_items RPC, (3) record outcome. On
  // failure of any bill we continue to the next.
  const submitAll = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    // R3 fix: do NOT clear submitSummary at the start. When this
    // function is invoked from DoneSummary's "ลองใหม่" button,
    // clearing the summary unmounts DoneSummary (render gate is
    // `phase === 'done' && submitSummary`), leaving the screen blank
    // until the whole loop finishes. Keep the prior summary visible;
    // the button text changes via `submitting` and the per-bill
    // stepper animates the retry state.

    // R5 fix: wrap the body in try/finally so an unexpected exception
    // in the snapshot/setup code can never leave submitting=true and
    // permanently lock the UI.
    let savedIdsThisPass = [];
    let failedThisPass = [];
    let submitAttempted = false;
    const mirrorResultsAll = [];
    // Keep billsRef in sync inside submitAll — React may batch setBills
    // across awaits, so the finally block must not rely on useEffect alone.
    const commitBills = (updater) => {
      setBills((prev) => {
        const next = updater(prev);
        billsRef.current = next;
        return next;
      });
    };
    try {
      // Snapshot the indices we'll attempt so concurrent state changes
      // can't shift them mid-loop. We re-read bills[i] each iteration
      // from billsRef to honour any in-flight UI edits, but the
      // "should I try this one?" filter uses the snapshot.
      const targets = [];
      bills.forEach((b, i) => {
        if (!b.is_cmg_bill || b.rows.length === 0) return;
        if (b.saveState === 'saved') return;
        targets.push(i);
      });

      if (targets.length === 0) {
        return;
      }
      submitAttempted = true;
      setSavingProgress({ done: 0, total: targets.length });

      // M6 fix: pre-validate barcodes against the in-memory catalog. If
      // a user typed a barcode that already belongs to another product,
      // the RPC will fail much later with a cryptic unique-violation —
      // and by then we've already inserted some products and have to
      // roll back. Catching it up-front lets the user fix the typo while
      // their entered data is still visible in the ResolveBlock form.
      const existingBarcodes = new Set(
        (products || []).map((p) => (p.barcode || '').trim()).filter(Boolean)
      );

      const savedIds = savedIdsThisPass;
      const failed = failedThisPass;

      for (let loopIdx = 0; loopIdx < targets.length; loopIdx++) {
        const i = targets[loopIdx];
        // M2 fix: read fresh bill state from the ref instead of
        // abusing setBills as a Promise.
        const bill = billsRef.current[i];
        if (!bill || bill.saveState === 'saved') continue;

        // Mark in-flight so the stepper shows a spinner on this bill.
        commitBills((prev) => prev.map((b, j) =>
          j === i ? { ...b, saveState: 'saving', saveError: null } : b,
        ));

        // H2 fix: hoist okProducts OUTSIDE the try so the catch block
        // can roll the inserted rows back if Phase C (the RPC) fails.
        // Previously, RPC failure left orphan products in the catalog;
        // retrying then collided on UNIQUE(barcode) or silently
        // created duplicate-name products.
        let okProducts = [];

        try {
        // M4 fix: dedupe new-product rows by trimmed name within this
        // bill. AI may emit the same unreadable model_code twice for
        // multi-line bills — without dedupe we'd insert two products
        // with identical names (no UNIQUE on products.name) and split
        // the qty across them, which is unrecoverable inventory chaos.
        const newRowsAll = bill.rows.filter((r) => r.status === 'new' && r.newProduct);
        const seenName = new Map(); // trimmedName → first row in this bill
        const newRows = [];
        const dupRowsToCanonical = new Map(); // uid → canonical-row-uid
        for (const r of newRowsAll) {
          const key = r.newProduct.name.trim();
          if (!key) continue;
          if (!seenName.has(key)) {
            seenName.set(key, r);
            newRows.push(r);
          } else {
            dupRowsToCanonical.set(r.uid, seenName.get(key).uid);
          }
        }

        // M6 + R2: pre-check barcodes against the catalog AND against
        // other new-product rows in this same bill. The catalog check
        // catches user typos against existing products; the within-bill
        // check catches the user creating two new products with the
        // same barcode in the same review session — which would slip
        // past the catalog check (those barcodes aren't in `products`
        // yet) and only blow up at insert time with a cryptic UNIQUE
        // violation that takes the whole bill down.
        const batchBarcodes = new Set();
        for (const r of newRows) {
          const bc = (r.newProduct.barcode || '').trim();
          if (!bc) continue;
          if (existingBarcodes.has(bc)) {
            throw new Error(
              `บาร์โค้ด "${bc}" มีในระบบอยู่แล้ว — กลับไปแก้รายการ "${r.newProduct.name}" ก่อน`
            );
          }
          if (batchBarcodes.has(bc)) {
            throw new Error(
              `บาร์โค้ด "${bc}" ซ้ำกับรายการอื่นในบิลนี้ — แก้รายการ "${r.newProduct.name}" ก่อน`
            );
          }
          batchBarcodes.add(bc);
        }

        // Phase A — insert any rows flagged as new products.
        // Promise.allSettled so we can clean up partial successes if
        // one insert fails. (Bug M2 in CmgBillScanModal lore.)
        const lineVatApplies = bill.has_vat !== false;
        const insertResults = await Promise.allSettled(newRows.map((r) => {
          const grossCost = grossUnitCost(r.unit_cost, lineVatApplies);
          return sb.from('products').insert({
            name: r.newProduct.name.trim(),
            barcode: r.newProduct.barcode?.trim() || null,
            cost_price: grossCost,
            retail_price: Number(r.newProduct.retail_price) || 0,
            current_stock: 0,
          }).select().single()
            .then(({ data, error }) => { if (error) throw error; return data; });
        }));

        const failProducts = [];
        insertResults.forEach((res, idx) => {
          if (res.status === 'fulfilled') okProducts.push({ uid: newRows[idx].uid, product: res.value });
          else failProducts.push({ row: newRows[idx], reason: res.reason });
        });

        if (failProducts.length > 0) {
          // Rollback the products we successfully inserted before the
          // first failure so the user has a clean slate to retry on.
          if (okProducts.length > 0) {
            const ids = okProducts.map((p) => p.product.id);
            await sb.from('products').delete().in('id', ids);
            okProducts = [];
          }
          const first = failProducts[0].reason;
          throw new Error(
            `สร้างสินค้าใหม่ไม่สำเร็จ (${failProducts.length}/${newRows.length}): ` +
            (first?.message || String(first))
          );
        }

        // Map every new-product row (including the dedupe-collapsed
        // ones) back to its just-inserted product row.
        const newProductByUid = new Map(okProducts.map((p) => [p.uid, p.product]));
        for (const [dupUid, canonUid] of dupRowsToCanonical.entries()) {
          const prod = newProductByUid.get(canonUid);
          if (prod) newProductByUid.set(dupUid, prod);
        }

        // Phase B — resolve each row to its product, then assemble the RPC
        // items via the pure helper. VAT (net→gross) and the defensive
        // 0-cost/0-qty guard now live in src/lib/ai-receive.js (unit-tested);
        // R1/H3 behaviour (floor at 0 so the guard fires, never coerce to 1)
        // is preserved there.
        const resolvedRows = bill.rows.map((r) => ({
          ...r,
          product: r.status === 'new' ? newProductByUid.get(r.uid) : r.product,
        }));
        const items = buildReceiveItems(resolvedRows, lineVatApplies);

        if (items.length === 0) {
          throw new Error('ไม่มีรายการที่บันทึกได้ในบิลนี้');
        }

        const { total, vat } = receiveTotals(items, lineVatApplies);

        // Phase C — call the RPC. Same atomic header+items+adjust_stock
        // path as the regular receive form. Date is today; supplier =
        // CMG; VAT 7% always (CMG always issues VAT invoices).
        const today = todayISO();
        const isJsonBill = bill.importSource === 'json';
        const header = {
          receive_date: startOfDayBangkok(today),
          total_value: total,
          vat_rate: lineVatApplies ? VAT_RATE_DEFAULT : 0,
          vat_amount: vat,
          // Link the registered supplier so the purchase document carries full
          // details; RPC denormalizes name/tax id. Falls back to "CMG" if the
          // supplier record isn't found.
          supplier_id: supplier?.id,
          supplier_name: supplier?.business_name || 'CMG',
          supplier_tax_id: supplier?.tax_id || null,
          created_via: isJsonBill ? 'json_cmg' : 'ai_cmg',
          // M3: per-bill suffix so two same-second fallbacks differ.
          // `loopIdx + 1` mirrors the user-visible bill number well
          // enough; we don't expose the suffix in UI anywhere.
          supplier_invoice_no:
            bill.supplier_invoice_no?.trim() || autoInvoiceNo(i + 1),
          notes: isJsonBill
            ? `JSON import · batch · ${items.length} รายการ`
            : `AI scan · batch · ${items.length} รายการ`,
        };

        const { data: head, error: rpcErr } = await sb.rpc('create_stock_movement_with_items', {
          p_kind: 'receive',
          p_header: header,
          p_items: items,
        });
        if (rpcErr) throw rpcErr;

        if (tiktokMirrorOn) {
          try {
            const productIds = resolvedRows.map(r => r.product?.id).filter(Boolean);
            for (const r of resolvedRows) {
              const pid = r.product?.id;
              if (!pid || r.tiktok_skip) continue;
              try {
                await persistTiktokMatchMapping(pid, r);
              } catch (persistErr) {
                console.warn('[BulkReceiveView] TikTok mapping persist on save failed:', persistErr);
              }
            }
            if (productIds.length) {
              await refreshMappings(productIds).catch(() => {});
            }
            const stocks = await fetchPosStocks(productIds);
            const mirrorPayload = resolvedRows
              .filter(r => r.product?.id)
              .map(r => buildSyncLine({
                receiveOrderId: head.id,
                productId: r.product.id,
                posStockAfter: stocks[r.product.id]?.current_stock ?? 0,
                mapping: r.tiktok_mapping,
                tiktokSku: r.tiktok_sku,
                skipped: r.tiktok_skip,
              }));
            const results = await mirrorStockToTikTok(mirrorPayload);
            mirrorResultsAll.push(...results);
          } catch (mirrorErr) {
            toast?.push('Mirror TikTok ไม่สำเร็จ: ' + mapError(mirrorErr), 'error');
          }
        }

        // From this point the products are "adopted" by the saved
        // receive_order — clear okProducts so the catch block doesn't
        // try to delete them on some unrelated thrown error later.
        okProducts = [];

        // Also add their barcodes to the running set so a later bill
        // in the same batch with the same barcode is caught early.
        for (const r of newRows) {
          const bc = (r.newProduct.barcode || '').trim();
          if (bc) existingBarcodes.add(bc);
        }

        commitBills((prev) => prev.map((b, j) =>
          j === i
            ? { ...b, saveState: 'saved', savedOrderId: head.id, saveError: null }
            : b,
        ));
        savedIds.push(head.id);
      } catch (e) {
        // H2: roll back any products we created for THIS bill but never
        // got to associate with a saved receive_order. (Safe to delete:
        // current_stock=0, no receive_order_items reference them yet.)
        if (okProducts.length > 0) {
          try {
            const ids = okProducts.map((p) => p.product.id);
            await sb.from('products').delete().in('id', ids);
          } catch (rollbackErr) {
            console.warn('[BulkReceiveView] product rollback failed:', rollbackErr);
          }
        }
        const msg = mapError(e) || e?.message || String(e);
        commitBills((prev) => prev.map((b, j) =>
          j === i ? { ...b, saveState: 'failed', saveError: msg } : b,
        ));
        failed.push({ index: i, message: msg });
      }
        setSavingProgress({ done: loopIdx + 1, total: targets.length });
      }
    } finally {
      if (!submitAttempted) {
        setSubmitting(false);
        setSavingProgress(null);
      } else {
      // R7 fix: build the summary from the FINAL bills state, not
      // from per-pass local arrays. After a retry-failed pass, the
      // local `savedIdsThisPass` only contains the retry's saves,
      // throwing away the original successes. Reading from billsRef
      // gives a cumulative view that's always honest about what's
      // actually been saved. commitBills keeps the ref current even
      // when React hasn't flushed batched setBills yet.
      const finalBills = billsRef.current;
      const refSavedIds = finalBills
        .filter((b) => b.saveState === 'saved' && b.savedOrderId != null)
        .map((b) => b.savedOrderId);
      const allSavedIds = [...new Set([...refSavedIds, ...savedIdsThisPass])];
      const allFailed = finalBills
        .map((b, idx) => (b.saveState === 'failed'
          ? { index: idx, message: b.saveError || 'unknown error' }
          : null))
        .filter(Boolean);
      const allSkipped = finalBills.filter(
        (b) => !b.is_cmg_bill || b.rows.length === 0
      ).length;
      setSubmitSummary({
        savedIds: allSavedIds,
        failed: allFailed,
        skipped: allSkipped,
        tiktokMirrorHadFailures: mirrorResultsAll.some((r) => r && r.status === 'failed'),
      });
      if (mirrorResultsAll.length) {
        const { msg, isError } = formatMirrorToast(mirrorResultsAll);
        toast?.push(msg, isError ? 'error' : 'success');
      }
      setSubmitting(false);
      setSavingProgress(null);
      setPhase('done');
      clearDraft(); // batch flow is over; in-session retry doesn't need it
      // H4: invalidate the recent-receives map so a subsequent batch
      // in the same session sees the bills we just saved as "พึ่งรับ
      // X วันก่อน" candidates. Fire-and-forget. We check
      // savedIdsThisPass (not the cumulative count) so we don't
      // re-fetch when retry-failed produced zero new saves.
      if (savedIdsThisPass.length > 0) {
        refreshRecentReceives?.().catch(() => {});
      }
      }
    }
  };

  // ─── Reset for a fresh batch (after done/error) ────────────────────
  const resetBatch = () => {
    bills.forEach((b) => b.previewUrl && URL.revokeObjectURL(b.previewUrl));
    setBills([]);
    setProducts([]);
    setUsage(null);
    setSubmitSummary(null);
    setError(null);
    setCurrentIdx(0);
    setPhase('empty');
    clearDraft();
  };

  const pauseReview = useCallback(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    flushDraftNow(bills, currentIdx, usage);
    setPhase('review_paused');
  }, [bills, currentIdx, usage]);

  const resumeReview = useCallback(() => {
    setPhase('review');
  }, []);

  // ═══ RENDER ═══════════════════════════════════════════════════════
  return (
    <div className="space-y-4">
      {/* PHASE: ERROR — dedicated screen with the AIErrorCard. Sits
          between EMPTY and the rest so the user sees the rich error
          UI (with retry button preserving their images) instead of
          being dumped back to the landing page. */}
      {phase === 'error' && error && (() => {
        const isJsonErrorBatch = bills.some((b) => b.importSource === 'json');
        const pendingCount = bills.filter((b) => b.parseState !== 'parsed').length || bills.length;
        return (
        <div className="space-y-4">
          <AIErrorCard
            error={error}
            onRetry={
              isJsonErrorBatch
                ? retryJsonImport
                : (error.retryable ? retryParse : undefined)
            }
            retryLabel={isJsonErrorBatch ? 'เลือกไฟล์ JSON ใหม่' : undefined}
            onDismiss={discardErrorBatch}
            onContinue={
              bills.some((b) => b.parseState === 'parsed')
                ? continueWithParsedBills
                : undefined
            }
            continueLabel={`ไปตรวจรับ ${bills.filter((b) => b.parseState === 'parsed').length} บิลที่อ่านแล้ว`}
          />
          {parseLogs.length > 0 && (
            <div className="brv-error-terminal-wrap">
              <MacTerminal lines={parseLogs} isActive={false} />
            </div>
          )}
          {bills.length > 0 && (
            <div className="card-canvas p-4">
              <div className="text-xs text-muted-soft mb-2 flex items-center gap-1.5">
                <Icon name="file" size={12}/>
                <span>
                  {isJsonErrorBatch
                    ? `${pendingCount} บิลที่ยังไม่สำเร็จ — เลือกไฟล์ JSON ใหม่ได้`
                    : `${pendingCount} รูปยังรอ retry — รูปที่อ่านสำเร็จแล้วไม่ต้องอ่านซ้ำ`}
                </span>
              </div>
              <div className="flex gap-2 flex-wrap">
                {bills.map((b, i) => (
                  <div key={b.uid} className="relative w-14 h-18 rounded-md overflow-hidden border hairline bg-surface-soft">
                    {b.previewUrl
                      ? <img src={b.previewUrl} alt={`bill ${i + 1}`} className="w-full h-full object-cover"/>
                      : <div className="w-full h-full flex items-center justify-center"><Icon name="file" size={14} className="text-muted-soft"/></div>}
                    <div className="absolute top-0.5 left-0.5 ai-row-badge !w-5 !h-5 !text-[10px]">{i + 1}</div>
                    {b.parseState === 'parsed' && (
                      <div className="absolute bottom-0.5 right-0.5 rounded-full bg-success text-white w-5 h-5 flex items-center justify-center">
                        <Icon name="check" size={11}/>
                      </div>
                    )}
                    {b.parseState === 'failed' && (
                      <div className="absolute bottom-0.5 right-0.5 rounded-full bg-error text-white w-5 h-5 flex items-center justify-center">
                        <Icon name="x" size={11}/>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        );
      })()}

      {/* PHASE: REVIEW_PAUSED — exit focus mode, keep bills in memory */}
      {phase === 'review_paused' && bills.length > 0 && (
        <ReviewPausedCard
          bills={bills}
          summary={summary}
          tiktokMirrorOn={tiktokMirrorOn}
          onResume={resumeReview}
          onDiscard={resetBatch}
        />
      )}

      {/* PHASE: EMPTY — landing screen with the big upload button */}
      {phase === 'empty' && (
        <EmptyLanding
          onStart={startUpload}
          onJsonImport={startJsonImport}
          draft={draftAvailable}
          onRestore={() => restoreDraft(draftAvailable)}
          onDiscard={discardDraft}
        />
      )}

      {/* PHASE: PARSING — full-bleed spinner with thumbnail strip */}
      {phase === 'parsing' && (
        <ParsingScreen
          bills={bills}
          progress={parsingProgress}
          logs={parseLogs}
          activeLine={parseActiveLine}
          isActive={parseIsActive}
        />
      )}

      {/* PHASE: REVIEW — wizard with stepper + per-bill panel */}
      {phase === 'review' && bills.length > 0 && (
        <ReviewWizard
          bills={bills}
          currentIdx={currentIdx}
          setCurrentIdx={setCurrentIdx}
          products={products}
          recentReceivesMap={recentReceivesMap}
          usage={usage}
          summary={summary}
          submitting={submitting}
          onUpdateRow={updateRow}
          onRemoveRow={removeRow}
          onPickCandidate={pickCandidate}
          onSetNewProduct={setNewProduct}
          onConfirmFooter={confirmBillFooter}
          onInvoiceNoChange={updateInvoiceNo}
          onHasVatChange={updateHasVat}
          onRemoveBill={removeCurrentBill}
          onSubmitAll={submitAll}
          onCancel={resetBatch}
          onPauseReview={pauseReview}
          dupInvoices={dupInvoices}
          onZoom={setLightboxSrc}
          onSetAllVat={setAllVat}
          savingProgress={savingProgress}
          supplierName={supplier?.business_name || 'CMG'}
          tiktokConnected={tiktokConnected}
          syncTikTokAfterReceive={syncTikTokAfterReceive}
          onSyncTikTokChange={setSyncTikTokAfterReceive}
          tiktokMirrorOn={tiktokMirrorOn}
          tiktokCatalog={tiktokCatalog}
          tiktokCatalogLoading={tiktokCatalogLoading}
          tiktokCatalogError={tiktokCatalogError}
          onTiktokRetryCatalog={reloadTiktokCatalog}
          tiktokMinPct={tiktokMinPct}
          onTiktokMinPctChange={setTiktokMinPct}
          onTiktokSearchCatalog={searchTiktokCatalog}
          stocksByProductId={stocksByProductId}
          onTiktokRowMatch={handleTiktokRowMatch}
          productImagesById={productImagesById}
        />
      )}

      {/* PHASE: DONE — summary with retry-failed button */}
      {phase === 'done' && submitSummary && (
        <DoneSummary
          summary={summary}
          submitSummary={submitSummary}
          bills={bills}
          onRetryFailed={submitAll}
          onStartNew={resetBatch}
          submitting={submitting}
        />
      )}

      {/* Upload modal — overlays everything when open */}
      <BulkBillUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onConfirm={handleUploadConfirm}
      />

      <JsonBillImportModal
        open={jsonImportOpen}
        onClose={() => setJsonImportOpen(false)}
        onConfirm={handleJsonImportConfirm}
      />

      {/* A1: full-screen zoomable bill image */}
      {lightboxSrc && (
        <BillImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}

      {/* A3: undo snackbar for deleted row/bill */}
      {undo && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[150] pnb-undo">
          <Icon name="trash" size={15} className="text-muted-soft"/>
          <span className="text-sm">{undo.label}</span>
          <button type="button" className="pnb-undo-btn" onClick={doUndo}>
            เลิกทำ
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Sub: paused review (mobile back from list) ───────────────────────
function ReviewPausedCard({ bills, summary, tiktokMirrorOn, onResume, onDiscard }) {
  const rowProgress = useMemo(() => {
    let total = 0;
    let done = 0;
    for (const b of bills) {
      const s = computeRowSummary(b.rows || [], tiktokMirrorOn);
      total += s.total;
      done += s.done;
    }
    return { total, done };
  }, [bills, tiktokMirrorOn]);

  const handleDiscard = () => {
    if (!window.confirm(`ยกเลิก ${bills.length} บิลที่ยังไม่ได้บันทึก?`)) return;
    onDiscard?.();
  };

  return (
    <div className="space-y-3">
      <div className="card-canvas p-4 border-l-4 border-l-primary">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
            <Icon name="file" size={18} className="text-primary"/>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-ink">
              งานตรวจรับค้างอยู่ {bills.length} บิล
            </div>
            <div className="text-xs text-muted-soft mt-1 tabular-nums">
              รายการตรวจแล้ว {rowProgress.done}/{rowProgress.total}
              {summary.blocked > 0 && (
                <span className="text-warning"> · เหลือแก้ {summary.blocked} บิล</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap mt-3">
          {bills.map((b, i) => (
            <div key={b.uid} className="relative w-14 h-18 rounded-md overflow-hidden border hairline bg-surface-soft">
              {b.previewUrl
                ? <img src={b.previewUrl} alt={`bill ${i + 1}`} className="w-full h-full object-cover"/>
                : <div className="w-full h-full flex items-center justify-center text-muted-soft text-xs">{i + 1}</div>}
              <div className="absolute top-0.5 left-0.5 ai-row-badge !w-5 !h-5 !text-[10px]">{i + 1}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-2 mt-4">
          <button type="button" className="btn-primary flex-1 !py-2.5" onClick={onResume}>
            <Icon name="chevron-r" size={16}/> กลับไปตรวจต่อ
          </button>
          <button type="button" className="btn-ghost flex-1 !py-2.5 text-error" onClick={handleDiscard}>
            ยกเลิกและลบงาน
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub: landing screen ──────────────────────────────────────────────
function EmptyLanding({ onStart, onJsonImport, draft, onRestore, onDiscard }) {
  return (
   <div className="space-y-3">
    {/* C1: restore an unsaved batch from a previous session */}
    {draft && Array.isArray(draft.bills) && draft.bills.length > 0 && (
      <div className="card-canvas p-3.5 flex items-center gap-3 border-l-4 border-l-primary">
        <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
          <Icon name="file" size={18} className="text-primary"/>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">มีงานที่ค้างอยู่ {draft.bills.length} บิล</div>
          <div className="text-[11px] text-muted-soft">
            {draft.savedAt ? `บันทึกล่าสุด ${new Date(draft.savedAt).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'ยังไม่ได้บันทึกลงระบบ'}
          </div>
        </div>
        <button type="button" className="btn-ghost !text-xs" onClick={onDiscard}>ทิ้ง</button>
        <button type="button" className="btn-primary !py-1.5 !px-3 !text-xs" onClick={onRestore}>กู้คืนงาน</button>
      </div>
    )}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="card-canvas overflow-hidden flex flex-col brv-landing-card">
        <div className="p-8 lg:p-12 flex flex-col items-center text-center gap-4 flex-1">
          <span className="ai-chip">AI</span>
          <div className="brv-landing-icon w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 border hairline flex items-center justify-center">
            <Icon name="scan" size={32} className="text-primary"/>
          </div>
          <div className="space-y-1.5">
            <div className="font-display text-xl lg:text-2xl">สแกนบิล CMG ด้วย AI</div>
            <div className="text-sm text-muted-soft max-w-sm mx-auto leading-relaxed">
              อัปโหลดรูปบิล 1–10 ใบ/รอบ — AI อ่านทุกบิลใน batch เดียว ประหยัดโควต้า
            </div>
          </div>
          <div className="text-[11px] text-muted-soft max-w-xs leading-relaxed">
            JPG · PNG · WebP · EXIF rotate · resize อัตโนมัติ
          </div>
          <button
            type="button"
            className="btn-ai-mesh btn-ai-mesh-wide !py-3 !px-6 !text-base mt-auto"
            onClick={onStart}
          >
            <Icon name="scan" size={18}/>
            เริ่มสแกนบิล
          </button>
        </div>
      </div>
      <div className="card-canvas overflow-hidden flex flex-col brv-landing-card">
        <div className="p-8 lg:p-12 flex flex-col items-center text-center gap-4 flex-1">
          <span className="json-chip">JSON</span>
          <div className="brv-landing-icon w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 border hairline flex items-center justify-center">
            <Icon name="file" size={32} className="text-primary"/>
          </div>
          <div className="space-y-1.5">
            <div className="font-display text-xl lg:text-2xl">นำเข้าจาก JSON</div>
            <div className="text-sm text-muted-soft max-w-sm mx-auto leading-relaxed">
              ไฟล์จาก Gemini Gem — schema เดียวกับ AI parse สูงสุด 10 บิล/ไฟล์ ไม่ใช้ AI quota
            </div>
          </div>
          <div className="text-[11px] text-muted-soft max-w-xs leading-relaxed">
            {'{ "bills": [...] }'} · ตรวจเลขแถวก่อนเข้า review
          </div>
          <button
            type="button"
            className="btn-json-mesh btn-ai-mesh-wide !py-3 !px-6 !text-base mt-auto"
            onClick={onJsonImport}
          >
            <Icon name="file" size={18}/>
            นำเข้า JSON
          </button>
        </div>
      </div>
    </div>
   </div>
  );
}

// ─── Sub: parsing screen ──────────────────────────────────────────────
function billParseStatusLabel(state) {
  if (state === 'parsed') return { label: 'อ่านแล้ว', chip: 'air-status-chip--done', icon: 'check' };
  if (state === 'failed') return { label: 'ล้มเหลว', chip: 'air-status-chip--missing', icon: 'x' };
  if (state === 'parsing') return { label: 'กำลังอ่าน', chip: 'air-status-chip--soft', icon: null };
  return { label: 'รอคิว', chip: 'air-status-chip--incomplete', icon: null };
}

function ParsingStatusPanel({ bills, progress, parseIsActive, logs }) {
  const done = progress?.done ?? bills.filter((b) => b.parseState === 'parsed').length;
  const total = progress?.total ?? bills.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const currentLabel = progress?.currentFrom
    ? `บิลที่ ${progress.currentFrom}${progress.currentTo !== progress.currentFrom ? `–${progress.currentTo}` : ''} / ${total}`
    : `${total} บิล`;
  const steps = deriveParsingSteps({ bills, progress, parseIsActive, logs });
  const isJsonImport = bills.some((b) => b.importSource === 'json');

  return (
    <div className="brv-parsing-status">
      <div className="brv-parsing-status__head">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={isJsonImport ? 'inline-flex items-center justify-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-accent/15 text-accent border hairline shrink-0' : 'ai-chip shrink-0'}>
            {isJsonImport ? 'JSON' : 'AI'}
          </span>
          <div className="min-w-0">
            <div className="font-display text-lg leading-tight">
              {isJsonImport ? 'กำลังนำเข้าบิลจาก JSON…' : 'กำลังให้ AI อ่านบิล…'}
            </div>
            <div className="text-[11px] text-muted-soft mt-0.5 tabular-nums truncate">
              {currentLabel} · สำเร็จแล้ว {done}/{total}
            </div>
          </div>
        </div>
        {done < total && (
          <span className="spinner shrink-0" aria-hidden="true"/>
        )}
      </div>

      <div className="brv-parsing-status__progress">
        <span className="text-xs font-semibold tabular-nums text-ink">{pct}%</span>
        <span className="brv-parsing-status__bar glass-tube overflow-hidden">
          <span
            className="block h-full rounded-full bg-[#0fa39a] transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </span>
      </div>

      <ol className="brv-parsing-status__steps" aria-label="ขั้นตอนการอ่านบิล">
        {steps.map((step) => (
          <li
            key={step.key}
            className={
              'brv-parsing-status__step' +
              (step.done ? ' is-done' : '') +
              (step.active ? ' is-active' : '')
            }
          >
            <span className="brv-parsing-status__step-icon" aria-hidden="true">
              {step.done ? (
                <Icon name="check" size={11}/>
              ) : step.spinning ? (
                <span className="spinner shrink-0 !w-3 !h-3 !border-[1.5px]"/>
              ) : (
                <span className="brv-parsing-status__step-dot"/>
              )}
            </span>
            <span>{step.label}</span>
          </li>
        ))}
      </ol>

      <div className="brv-parsing-status__bills-label">รายการบิล</div>
      <ul className="brv-parsing-status__bills">
        {bills.map((b, i) => {
          const st = billParseStatusLabel(b.parseState);
          const sub = b.supplier_invoice_no || b.name || `บิล ${i + 1}`;
          return (
            <li
              key={b.uid}
              className={
                'brv-parsing-status__bill' +
                (b.parseState === 'parsing' ? ' is-parsing' : '') +
                (b.parseState === 'parsed' ? ' is-done' : '') +
                (b.parseState === 'failed' ? ' is-failed' : '')
              }
            >
              <span className="brv-parsing-status__bill-idx">{i + 1}</span>
              <div className="brv-parsing-status__bill-thumb">
                {b.previewUrl
                  ? <img src={b.previewUrl} alt="" className="w-full h-full object-cover"/>
                  : <div className="w-full h-full flex items-center justify-center bg-surface-soft">
                      <Icon name="file" size={14} className="text-muted-soft"/>
                    </div>}
              </div>
              <div className="brv-parsing-status__bill-meta min-w-0">
                <div className="brv-parsing-status__bill-name truncate">{sub}</div>
                {b.rows?.length > 0 && (
                  <div className="text-[10px] text-muted-soft tabular-nums">{b.rows.length} รายการ</div>
                )}
              </div>
              <span className={'air-status-chip shrink-0 ' + st.chip}>
                {st.icon && <Icon name={st.icon} size={9}/>}
                <span>{st.label}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ParsingScreen({ bills, progress, logs, activeLine, isActive }) {
  return (
    <div className="brv-parsing-split card-canvas overflow-hidden">
      <div className="brv-parsing-split__left">
        <ParsingStatusPanel
          bills={bills}
          progress={progress}
          parseIsActive={isActive}
          logs={logs}
        />
      </div>
      <div className="brv-parsing-split__divider" aria-hidden="true"/>
      <div className="brv-parsing-split__right">
        <MacTerminal
          className="mac-terminal--embedded"
          lines={logs}
          activeLine={activeLine}
          isActive={isActive}
        />
      </div>
    </div>
  );
}

// ─── Sub: review overflow menu (mobile) ───────────────────────────────
function ReviewOverflowSheet({
  open, onClose, current, billNumber, totalBills, bills, currentIdx,
  supplierName, disabled, onZoom, onSelectBill, onOpenSettings,
  tiktokConnected, syncTikTokAfterReceive, onSyncTikTokChange,
  onSetAllVat, submitting, onCancelAll,
}) {
  const allVat = (bills || []).length > 0 && bills.every((b) => b.has_vat !== false);
  return (
    <BottomSheet open={open} onClose={onClose} title="ตัวเลือก">
      <div className="brv-overflow-menu space-y-1 p-1">
        <button
          type="button"
          className="brv-overflow-menu__row"
          onClick={() => { current?.previewUrl && onZoom?.(current.previewUrl); onClose(); }}
          disabled={!current?.previewUrl}
        >
          <Icon name="search" size={16}/> ดูรูปบิล
        </button>
        {totalBills > 1 && (
          <button
            type="button"
            className="brv-overflow-menu__row"
            onClick={() => { onSelectBill?.(); onClose(); }}
          >
            <Icon name="file" size={16}/> เลือกบิล ({currentIdx + 1}/{totalBills})
          </button>
        )}
        <button
          type="button"
          className="brv-overflow-menu__row"
          onClick={() => { onOpenSettings?.(); onClose(); }}
        >
          <Icon name="settings" size={16}/> ตั้งค่าบิลที่ {billNumber}
        </button>
        {tiktokConnected && (
          <label className="brv-overflow-menu__row brv-overflow-menu__row--check">
            <input
              type="checkbox"
              className="rounded border-hairline"
              checked={syncTikTokAfterReceive}
              onChange={(e) => onSyncTikTokChange?.(e.target.checked)}
              disabled={submitting}
            />
            <span>Mirror สต็อกไป TikTok Shop</span>
          </label>
        )}
        <button
          type="button"
          className="brv-overflow-menu__row"
          onClick={() => onSetAllVat?.(!allVat)}
          disabled={submitting || !(bills || []).length}
        >
          <Icon name="edit" size={16}/> VAT ทั้งชุด {allVat ? '✓' : ''}
        </button>
        <button
          type="button"
          className="brv-overflow-menu__row brv-overflow-menu__row--destructive"
          onClick={() => { onClose(); onCancelAll?.(); }}
          disabled={submitting}
        >
          <Icon name="trash" size={16}/> ยกเลิกงานทั้งหมด
        </button>
      </div>
    </BottomSheet>
  );
}

// ─── Sub: review wizard ───────────────────────────────────────────────
function ReviewWizard({
  bills, currentIdx, setCurrentIdx, products, recentReceivesMap, usage, summary, submitting,
  onUpdateRow, onRemoveRow, onPickCandidate, onSetNewProduct, onConfirmFooter,
  onInvoiceNoChange, onHasVatChange, onRemoveBill, onSubmitAll, onCancel, onPauseReview,
  dupInvoices, onZoom, onSetAllVat, savingProgress, supplierName,
  tiktokConnected, syncTikTokAfterReceive, onSyncTikTokChange,
  tiktokMirrorOn, tiktokCatalog, tiktokCatalogLoading, tiktokCatalogError,
  onTiktokRetryCatalog, tiktokMinPct, onTiktokMinPctChange, onTiktokSearchCatalog,
  stocksByProductId, onTiktokRowMatch, productImagesById = {},
}) {
  const current = bills[currentIdx];
  const canPrev = currentIdx > 0;
  const canNext = currentIdx < bills.length - 1;
  const currentDup = current?.supplier_invoice_no
    ? dupInvoices?.get(current.supplier_invoice_no.trim())
    : null;
  const [billPickerOpen, setBillPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(null);

  useEffect(() => {
    setSettingsOpen(false);
    setOverflowOpen(false);
  }, [current?.uid]);

  const handleCancel = () => {
    if (bills.length > 0 && !submitting) {
      if (!window.confirm(`ยกเลิก ${bills.length} บิลที่ยังไม่ได้บันทึก?`)) return;
    }
    onCancel();
  };

  const handleMobileBack = () => {
    if (submitting) return;
    const nav = mobileNav;
    const action = resolveMobileBackAction({
      macroStep: nav?.macroStep || 'list',
      wizardCanBack: nav?.wizardCanBack,
    });
    if (action === 'wizardBack') nav?.wizardBack?.();
    else if (action === 'goToList') nav?.goToList?.();
    else onPauseReview?.();
  };

  const billDisabled = current?.saveState === 'saved' || submitting;
  const isJsonBatch = bills.some((b) => b.importSource === 'json');

  return (
    <div className="brv-mobile-review lg:space-y-4">
      {/* Desktop top bar */}
      <div className="hidden lg:flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          {isJsonBatch ? (
            <span className="json-chip shrink-0">JSON</span>
          ) : (
            <span className="ai-chip">AI</span>
          )}
          <div className="font-display text-xl truncate">รับเข้า ×10 — Review</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {usage && (
            <div className="text-[11px] text-muted-soft tabular-nums">
              {usage.total_tokens.toLocaleString()} tokens · ≈{fmtTHB(usage.estimated_thb)}
            </div>
          )}
          <button type="button" className="btn-ghost text-sm" onClick={handleCancel} disabled={submitting}>
            ยกเลิกทั้งหมด
          </button>
        </div>
      </div>

      {/* Mobile lean header (Step Wizard B) */}
      <div className="brv-mobile-review__top mrs-header lg:hidden">
        <div className="brv-mobile-review__top-row">
          <button
            type="button"
            className="btn-secondary icon-btn-44 !p-0 shrink-0"
            onClick={handleMobileBack}
            disabled={submitting}
            aria-label="กลับ"
          >
            <Icon name="chevron-l" size={18}/>
          </button>
          <div className="min-w-0 flex-1 text-center">
            <div className="text-sm font-semibold text-ink tabular-nums">
              {mobileNav?.macroStep === 'work' && mobileNav?.totalRows > 0
                ? <>รายการ {mobileNav.rowIndex + 1}/{mobileNav.totalRows}</>
                : <>ตรวจรับบิล</>}
              {mobileNav?.attentionCount > 0 && (
                <span className="text-warning font-semibold text-xs ml-1">
                  · เหลือ {mobileNav.attentionCount}
                </span>
              )}
            </div>
            {mobileNav?.macroStep === 'work' && mobileNav?.totalRows > 0 && (
              <div className="text-[11px] text-muted-soft truncate mt-0.5">
                จับคู่และตรวจรายการทีละชิ้น
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn-secondary icon-btn-44 !p-0 shrink-0"
            onClick={() => setOverflowOpen(true)}
            aria-label="ตัวเลือกเพิ่มเติม"
          >
            <Icon name="menu" size={18}/>
          </button>
        </div>
      </div>

      <div className="brv-mobile-review__scroll">
        <div className="hidden lg:block">
          <Stepper
            bills={bills}
            currentIdx={currentIdx}
            onJump={(i) => setCurrentIdx(i)}
            mirrorOn={tiktokMirrorOn}
          />
        </div>

        {current && (
          <BillCard
            key={current.uid}
            bill={current}
          billNumber={currentIdx + 1}
          totalBills={bills.length}
          products={products}
          recentReceivesMap={recentReceivesMap}
          dup={currentDup}
          onZoom={onZoom}
          onUpdateRow={onUpdateRow}
          onRemoveRow={onRemoveRow}
          onPickCandidate={onPickCandidate}
          onSetNewProduct={onSetNewProduct}
          onConfirmFooter={onConfirmFooter}
          onInvoiceNoChange={onInvoiceNoChange}
          onHasVatChange={onHasVatChange}
          onRemoveBill={onRemoveBill}
          disabled={billDisabled}
          supplierName={supplierName}
          tiktokMirrorEnabled={tiktokMirrorOn}
          tiktokCatalog={tiktokCatalog}
          tiktokCatalogLoading={tiktokCatalogLoading}
          tiktokCatalogError={tiktokCatalogError}
          onTiktokRetryCatalog={onTiktokRetryCatalog}
          tiktokMinPct={tiktokMinPct}
          onTiktokMinPctChange={onTiktokMinPctChange}
          onTiktokSearchCatalog={onTiktokSearchCatalog}
          stocksByProductId={stocksByProductId}
          onTiktokRowMatch={onTiktokRowMatch}
          productImagesById={productImagesById}
          onMobileNavChange={setMobileNav}
          mobileMacroStep={mobileNav?.macroStep ?? 'list'}
          batchSummary={summary}
          submitting={submitting}
          savingProgress={savingProgress}
          onSubmit={onSubmitAll}
        />
      )}

      {bills.length > 1 && (
        <div className="hidden lg:flex items-center justify-between gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setCurrentIdx((c) => Math.max(0, c - 1))}
            disabled={!canPrev || submitting}
          >
            <Icon name="chevron-l" size={16}/> บิลก่อน
          </button>
          <div className="text-xs text-muted-soft tabular-nums">
            บิลที่ {currentIdx + 1} / {bills.length}
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setCurrentIdx((c) => Math.min(bills.length - 1, c + 1))}
            disabled={!canNext || submitting}
          >
            บิลถัดไป <Icon name="chevron-r" size={16}/>
          </button>
        </div>
      )}

        <div className="hidden lg:block">
          <SubmitBar
            summary={summary}
            submitting={submitting}
            savingProgress={savingProgress}
            bills={bills}
            onSetAllVat={onSetAllVat}
            onSubmit={onSubmitAll}
            tiktokConnected={tiktokConnected}
            syncTikTokAfterReceive={syncTikTokAfterReceive}
            onSyncTikTokChange={onSyncTikTokChange}
          />
        </div>
      </div>

      <BillPickerSheet
        open={billPickerOpen}
        onClose={() => setBillPickerOpen(false)}
        bills={bills}
        currentIdx={currentIdx}
        mirrorOn={tiktokMirrorOn}
        onSelect={(i) => { setCurrentIdx(i); setBillPickerOpen(false); }}
      />
      {current && (
        <BillSettingsSheet
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          bill={current}
          billNumber={currentIdx + 1}
          supplierName={supplierName}
          disabled={billDisabled}
          onInvoiceNoChange={onInvoiceNoChange}
          onHasVatChange={onHasVatChange}
          onRemoveBill={onRemoveBill}
        />
      )}
      <ReviewOverflowSheet
        open={overflowOpen}
        onClose={() => setOverflowOpen(false)}
        current={current}
        billNumber={currentIdx + 1}
        totalBills={bills.length}
        bills={bills}
        currentIdx={currentIdx}
        supplierName={supplierName}
        disabled={billDisabled}
        onZoom={onZoom}
        onSelectBill={() => setBillPickerOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        tiktokConnected={tiktokConnected}
        syncTikTokAfterReceive={syncTikTokAfterReceive}
        onSyncTikTokChange={onSyncTikTokChange}
        onSetAllVat={onSetAllVat}
        submitting={submitting}
        onCancelAll={handleCancel}
      />
    </div>
  );
}

// ─── Sub: bill picker bottom sheet (mobile) ───────────────────────────
function BillPickerSheet({ open, onClose, bills, currentIdx, mirrorOn, onSelect }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="เลือกบิล">
      <ul className="brv-bill-picker-list">
        {bills.map((b, i) => {
          const status = billStatus(b, mirrorOn);
          const meta = STEP_STATUS_META[status];
          const label = BILL_STATUS_LABELS[status] || status;
          const isCurrent = i === currentIdx;
          const inv = b.supplier_invoice_no?.trim() || `บิล ${i + 1}`;
          return (
            <li key={b.uid}>
              <button
                type="button"
                className={'brv-bill-picker-list__row' + (isCurrent ? ' is-current' : '')}
                onClick={() => onSelect(i)}
              >
                <div className="brv-bill-picker-list__thumb">
                  {b.previewUrl
                    ? <img src={b.previewUrl} alt="" className="w-full h-full object-cover"/>
                    : <Icon name="file" size={16} className="text-muted-soft"/>}
                  <span className="brv-bill-picker-list__idx">{i + 1}</span>
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <div className="font-mono text-sm font-semibold truncate">{inv}</div>
                  <div className="text-[11px] text-muted-soft tabular-nums">
                    {b.rows.length} รายการ
                    {b.saveState === 'saved' && <> · #{b.savedOrderId}</>}
                  </div>
                </div>
                <span className={'brv-bill-picker-list__chip inline-flex items-center gap-1 ' + (BILL_STATUS_CHIP_CLS[status] || '')}>
                  <Icon name={meta.icon} size={10} className={meta.spin ? 'animate-spin' : ''}/>
                  {label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}

// ─── Sub: bill settings bottom sheet (mobile) ─────────────────────────
function BillSettingsSheet({
  open, onClose, bill, billNumber, supplierName, disabled,
  onInvoiceNoChange, onHasVatChange, onRemoveBill,
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title={`ตั้งค่าบิลที่ ${billNumber}`}>
      <div className="brv-bill-settings space-y-3 p-1">
        <label className="brv-bill-field">
          <span className="brv-bill-field__label">เลขบิล</span>
          <input
            type="text"
            className="input brv-bill-field__input font-mono"
            value={bill.supplier_invoice_no}
            onChange={(e) => onInvoiceNoChange(e.target.value)}
            placeholder="เว้นว่างเพื่อสร้างอัตโนมัติ"
            disabled={disabled}
          />
        </label>
        <div className="brv-bill-field">
          <span className="brv-bill-field__label">ผู้ขาย</span>
          <div className="brv-bill-field__static">{supplierName || 'CMG'}</div>
        </div>
        <label className="brv-bill-field brv-bill-field--vat">
          <span className="brv-bill-field__label">VAT</span>
          <div className="brv-bill-field__vat">
            <input
              type="checkbox"
              className="rounded border-hairline text-primary focus:ring-primary/30 w-3.5 h-3.5 cursor-pointer shrink-0"
              checked={bill.has_vat !== false}
              onChange={(e) => onHasVatChange?.(e.target.checked)}
              disabled={disabled}
            />
            <span className="vat-chip shrink-0">+7%</span>
            <span className="brv-bill-field__vat-hint">สแกนราคาก่อน VAT</span>
          </div>
        </label>
        <button
          type="button"
          className="btn-ghost w-full !py-2 !text-sm text-error"
          onClick={() => { onRemoveBill(); onClose(); }}
          disabled={disabled}
        >
          <Icon name="trash" size={15}/> ลบบิลนี้
        </button>
      </div>
    </BottomSheet>
  );
}

// ─── Sub: stepper ─────────────────────────────────────────────────────
function Stepper({ bills, currentIdx, onJump, mirrorOn = false }) {
  return (
    <div className="card-canvas brv-bill-stepper">
      <div className="brv-bill-stepper__track">
        {bills.map((b, i) => {
          const status = billStatus(b, mirrorOn);
          const meta = STEP_STATUS_META[status];
          const isCurrent = i === currentIdx;
          const tone = isBillStepperSuccess(status) ? 'ok' : 'bad';
          return (
            <button
              key={b.uid}
              type="button"
              onClick={() => onJump(i)}
              className={
                'brv-bill-stepper__chip brv-bill-stepper__chip--' + tone +
                (isCurrent ? ' is-active' : '')
              }
              aria-label={`ไปบิลที่ ${i + 1}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span className="tabular-nums">{i + 1}</span>
              <Icon name={meta.icon} size={12} className={meta.spin ? 'animate-spin' : ''}/>
              {b.saveState === 'saved' && (
                <span className="text-[10px] font-mono">#{b.savedOrderId}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Sub: current bill card (thumbnail + invoice + review panel) ──────
function BillCardMobileStrip({
  bill, billNumber, totalBills, itemCount, supplierName,
  onInvoiceNoChange, onHasVatChange, onRemoveBill, disabled,
  tiktokMirrorEnabled,
}) {
  const status = billStatus(bill, tiktokMirrorEnabled);
  const statusLabel = BILL_STATUS_LABELS[status] || status;
  const statusChip = BILL_STATUS_CHIP_CLS[status] || '';

  return (
    <div className="rrm-bill-strip card-canvas lg:hidden space-y-2.5">
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <input
          type="text"
          className="input font-mono flex-1 min-w-[6.5rem] !h-9 !py-1 !text-sm"
          value={bill.supplier_invoice_no}
          onChange={(e) => onInvoiceNoChange(e.target.value)}
          placeholder="เลขบิล"
          disabled={disabled}
          aria-label="เลขบิล"
        />
        <span className="rrm-bill-strip__pill tabular-nums">
          บิล {billNumber}/{totalBills}
        </span>
        {itemCount > 0 && (
          <span className="rrm-bill-strip__pill tabular-nums">{itemCount} รายการ</span>
        )}
        <span className={'rrm-bill-strip__pill tabular-nums ' + statusChip}>{statusLabel}</span>
        <button
          type="button"
          className="rrm-bill-strip__icon-btn shrink-0"
          onClick={onRemoveBill}
          disabled={disabled}
          aria-label={`ลบบิลที่ ${billNumber}`}
        >
          <Icon name="trash" size={16}/>
        </button>
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <span className="rrm-bill-strip__supplier flex-1" title={supplierName || 'CMG'}>
          {supplierName || 'CMG'}
        </span>
        <label className="rrm-bill-strip__vat shrink-0">
          <input
            type="checkbox"
            className="rounded border-hairline text-primary focus:ring-primary/30 w-3.5 h-3.5 cursor-pointer shrink-0"
            checked={bill.has_vat !== false}
            onChange={(e) => onHasVatChange?.(e.target.checked)}
            disabled={disabled}
          />
          <span className="vat-chip shrink-0">VAT +7%</span>
        </label>
      </div>
    </div>
  );
}

function BillSaveErrorAlert({ rawError }) {
  const [parsed, setParsed] = useState(null);
  useEffect(() => {
    let alive = true;
    parseAIError(rawError).then((e) => { if (alive) setParsed(e); });
    return () => { alive = false; };
  }, [rawError]);
  if (!parsed) return null;
  return <AIErrorCard error={parsed} compact />;
}

function BillCard({
  bill, billNumber, totalBills, products, recentReceivesMap, dup, onZoom,
  onUpdateRow, onRemoveRow, onPickCandidate, onSetNewProduct, onConfirmFooter,
  onInvoiceNoChange, onHasVatChange, onRemoveBill, disabled, supplierName,
  tiktokMirrorEnabled = false,
  tiktokCatalog = [],
  tiktokCatalogLoading = false,
  tiktokCatalogError = null,
  onTiktokRetryCatalog,
  tiktokMinPct = 60,
  onTiktokMinPctChange,
  onTiktokSearchCatalog,
  stocksByProductId = {},
  onTiktokRowMatch,
  productImagesById = {},
  onMobileNavChange,
  mobileMacroStep = 'list',
  batchSummary = null,
  submitting = false,
  savingProgress = null,
  onSubmit,
}) {
  const itemCount = bill.rows.length;
  const [alertsOpen, setAlertsOpen] = useState(false);
  const footerWarningCount = bill.validation?.bill?.warnings?.length || 0;
  const needsFooterConfirm = footerWarningCount > 0 && !bill.footerConfirmed;

  const alerts = useMemo(
    () => collectBillAlerts(bill, { dup, tiktokMirrorEnabled, onZoom }),
    [bill, dup, tiktokMirrorEnabled, onZoom],
  );
  const topAlert = alerts[0] || null;
  const moreAlerts = alerts.length > 1 ? alerts.slice(1) : [];
  const saveFailedAlert = topAlert?.key === 'save-failed' ? topAlert : null;

  return (
    <div className="brv-bill-card ttc-bento rounded-2xl border overflow-hidden">
      <header className="brv-bill-head">
        {mobileMacroStep !== 'work' && (
          <BillCardMobileStrip
            bill={bill}
            billNumber={billNumber}
            totalBills={totalBills}
            itemCount={itemCount}
            supplierName={supplierName}
            onInvoiceNoChange={onInvoiceNoChange}
            onHasVatChange={onHasVatChange}
            onRemoveBill={onRemoveBill}
            disabled={disabled}
            tiktokMirrorEnabled={tiktokMirrorEnabled}
          />
        )}

        <button
          type="button"
          onClick={() => bill.previewUrl && onZoom?.(bill.previewUrl)}
          disabled={!bill.previewUrl}
          className={
            'brv-bill-head__thumb group hidden lg:block' +
            (bill.previewUrl ? '' : ' brv-bill-head__thumb--no-image')
          }
          aria-label={bill.previewUrl ? 'ดูรูปบิลแบบขยาย' : 'ไม่มีรูปบิล (นำเข้า JSON)'}
        >
          {bill.previewUrl ? (
            <>
              <img
                src={bill.previewUrl}
                alt={`bill ${billNumber}`}
                className="brv-bill-head__thumb-img"
              />
              <span className="brv-bill-head__thumb-zoom" aria-hidden="true">
                <Icon name="search" size={14}/>
              </span>
            </>
          ) : (
            <div className="brv-bill-head__thumb-img flex items-center justify-center bg-surface-soft">
              <Icon name="file" size={28} className="text-muted-soft"/>
            </div>
          )}
          <span className="brv-bill-head__thumb-badge ai-row-badge">{billNumber}</span>
        </button>

        <div className="brv-bill-head__top hidden lg:flex">
          <h2 className="brv-bill-head__title">บิลที่ {billNumber} / {totalBills}</h2>
          {itemCount > 0 && (
            <span className="brv-bill-head__count tabular-nums">{itemCount} รายการ</span>
          )}
          {bill.saveState === 'saved' && (
            <span className="air-list-row__status-pill air-list-row__status-pill--done">
              <Icon name="check" size={12}/> บันทึกแล้ว #{bill.savedOrderId}
            </span>
          )}
          {bill.saveState === 'failed' && (
            <span className="air-list-row__status-pill air-list-row__status-pill--missing">
              <Icon name="alert" size={12}/> บันทึกไม่สำเร็จ
            </span>
          )}
        </div>

        <div className="brv-bill-head__actions hidden lg:flex">
          <button
            type="button"
            className="brv-bill-head__delete"
            onClick={onRemoveBill}
            aria-label={`ลบบิลที่ ${billNumber}`}
            disabled={disabled}
          >
            <Icon name="trash" size={15}/>
          </button>
        </div>

        <div className="brv-bill-head__meta hidden lg:grid">
          <label className="brv-bill-field">
            <span className="brv-bill-field__label">เลขบิล</span>
            <input
              type="text"
              className="input brv-bill-field__input font-mono"
              value={bill.supplier_invoice_no}
              onChange={(e) => onInvoiceNoChange(e.target.value)}
              placeholder="เว้นว่างเพื่อสร้างอัตโนมัติ"
              disabled={disabled}
            />
          </label>

          <div className="brv-bill-field">
            <span className="brv-bill-field__label">ผู้ขาย</span>
            <div className="brv-bill-field__static">{supplierName || 'CMG'}</div>
          </div>

          <label className="brv-bill-field brv-bill-field--vat">
            <span className="brv-bill-field__label">VAT</span>
            <div className="brv-bill-field__vat">
              <input
                type="checkbox"
                className="rounded border-hairline text-primary focus:ring-primary/30 w-3.5 h-3.5 cursor-pointer shrink-0"
                checked={bill.has_vat !== false}
                onChange={(e) => onHasVatChange?.(e.target.checked)}
                disabled={disabled}
              />
              <span className="vat-chip shrink-0">+7%</span>
              <span className="brv-bill-field__vat-hint">สแกนราคาก่อน VAT</span>
            </div>
          </label>
        </div>

        {saveFailedAlert && (
          <div className="brv-bill-head__alerts">
            <BillSaveErrorAlert rawError={saveFailedAlert.saveError} />
          </div>
        )}

        {tiktokMirrorEnabled && tiktokCatalogError && (
          <div className="brv-bill-head__alerts">
            <div className="brv-bill-alert brv-bill-alert--warn text-xs">
              <Icon name="store" size={12}/>
              Catalog TikTok โหลดไม่ครบ — ค้นหาด้วยชื่อสินค้าในขั้นจับคู่ TikTok
            </div>
          </div>
        )}

        {needsFooterConfirm && (
          <div className="brv-bill-head__alerts">
            <button
              type="button"
              className="brv-bill-alert brv-bill-alert--warn brv-bill-alert--click w-full"
              onClick={() => onConfirmFooter?.()}
              disabled={disabled}
            >
              <Icon name="alert" size={12}/>
              ผลรวมบิลไม่ตรง footer ({footerWarningCount} จุด) — กดยืนยันหลังตรวจเลขแล้ว
            </button>
          </div>
        )}

        {topAlert && topAlert.key !== 'save-failed' && (
          <div className="brv-bill-head__alerts">
            {topAlert.onClick ? (
              <button
                type="button"
                onClick={topAlert.onClick}
                className={'brv-bill-alert brv-bill-alert--' + topAlert.severity + ' brv-bill-alert--click w-full'}
              >
                <Icon name="alert" size={12}/>
                {topAlert.message}
              </button>
            ) : (
              <div className={'brv-bill-alert brv-bill-alert--' + topAlert.severity}>
                <Icon name="alert" size={12}/>
                {topAlert.message}
              </div>
            )}
            {moreAlerts.length > 0 && (
              <>
                <button
                  type="button"
                  className="brv-bill-alert-more"
                  onClick={() => setAlertsOpen((o) => !o)}
                >
                  {alertsOpen ? 'ซ่อน' : `ดูทั้งหมด (${alerts.length})`}
                </button>
                {alertsOpen && moreAlerts.map((a) => (
                  a.onClick ? (
                    <button
                      key={a.key}
                      type="button"
                      onClick={a.onClick}
                      className={'brv-bill-alert brv-bill-alert--' + a.severity + ' brv-bill-alert--click w-full'}
                    >
                      <Icon name="alert" size={12}/>
                      {a.message}
                    </button>
                  ) : (
                    <div key={a.key} className={'brv-bill-alert brv-bill-alert--' + a.severity}>
                      <Icon name="alert" size={12}/>
                      {a.message}
                    </div>
                  )
                ))}
              </>
            )}
          </div>
        )}
      </header>

      <div className="brv-bill-card__body">
        <BillReviewPanel
          rows={bill.rows}
          products={products}
          recentReceivesMap={recentReceivesMap}
          billKey={bill.uid}
          hasVat={bill.has_vat !== false}
          billImageUrl={bill.previewUrl}
          onZoomImage={onZoom}
          onUpdateRow={onUpdateRow}
          onRemoveRow={onRemoveRow}
          onPickCandidate={onPickCandidate}
          onSetNewProduct={onSetNewProduct}
          isJsonBill={bill.importSource === 'json'}
          tiktokMirrorEnabled={tiktokMirrorEnabled}
          tiktokCatalog={tiktokCatalog}
          tiktokCatalogLoading={tiktokCatalogLoading}
          tiktokCatalogError={tiktokCatalogError}
          onTiktokRetryCatalog={onTiktokRetryCatalog}
          tiktokMinPct={tiktokMinPct}
          onTiktokMinPctChange={onTiktokMinPctChange}
          onTiktokSearchCatalog={onTiktokSearchCatalog}
          stocksByProductId={stocksByProductId}
          onTiktokRowMatch={onTiktokRowMatch}
          productImagesById={productImagesById}
          onMobileNavChange={onMobileNavChange}
          batchSummary={batchSummary}
          submitting={submitting}
          savingProgress={savingProgress}
          onSubmit={onSubmit}
        />
      </div>
    </div>
  );
}

// ─── Sub: submit bar ──────────────────────────────────────────────────
function SubmitBar({
  summary, submitting, savingProgress, bills, onSetAllVat, onSubmit,
  tiktokConnected, syncTikTokAfterReceive, onSyncTikTokChange,
  compact = false,
}) {
  const ready = summary.readyToSubmit && !submitting;
  const allVat = (bills || []).length > 0 && bills.every((b) => b.has_vat !== false);
  const pct = savingProgress && savingProgress.total
    ? Math.round((savingProgress.done / savingProgress.total) * 100)
    : 0;
  const saveLabel = submitting
    ? 'กำลังบันทึก…'
    : `บันทึกเข้าสต็อก (${summary.actionable - summary.blocked} บิล)`;

  if (compact) {
    return (
      <div className="brv-submit-bar-compact space-y-2">
        {(tiktokConnected || (bills || []).length > 0) && (
          <div className="brv-submit-bar-compact__opts flex items-center justify-between gap-2 text-xs">
            {tiktokConnected ? (
              <label className="flex items-center gap-1.5 cursor-pointer select-none text-muted min-w-0">
                <input
                  type="checkbox"
                  className="rounded border-hairline shrink-0"
                  checked={syncTikTokAfterReceive}
                  onChange={(e) => onSyncTikTokChange?.(e.target.checked)}
                  disabled={submitting}
                />
                <span className="truncate">Mirror TikTok</span>
              </label>
            ) : <span/>}
            <button
              type="button"
              className="btn-ghost !py-1 !px-2 !text-[11px] shrink-0"
              onClick={() => onSetAllVat?.(!allVat)}
              disabled={submitting || !(bills || []).length}
            >
              VAT ทั้งชุด {allVat ? '✓' : ''}
            </button>
          </div>
        )}
        {savingProgress && (
          <div className="h-1 rounded-full glass-tube overflow-hidden">
            <div className="h-full rounded-full glass-tube-fill bg-primary transition-all duration-300" style={{ width: `${pct}%` }}/>
          </div>
        )}
        <button
          type="button"
          className="btn-primary w-full !py-3"
          disabled={!ready}
          onClick={onSubmit}
          title={!ready ? `เหลือ ${summary.blocked} บิลที่ต้องแก้` : undefined}
        >
          {submitting
            ? <><span className="spinner"/> {saveLabel}</>
            : <><Icon name="check" size={16}/> {saveLabel}</>}
        </button>
      </div>
    );
  }

  return (
    <div className="card-canvas p-3 lg:p-4 space-y-3">
      {/* A4: live save progress bar */}
      {savingProgress && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-muted-soft tabular-nums">
            <span>กำลังบันทึก {savingProgress.done}/{savingProgress.total} บิล</span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 rounded-full glass-tube overflow-hidden">
            <div className="h-full rounded-full glass-tube-fill bg-primary transition-all duration-300" style={{ width: `${pct}%` }}/>
          </div>
        </div>
      )}
      {tiktokConnected && (
        <label className="flex items-center gap-2.5 cursor-pointer select-none text-sm text-muted">
          <input
            type="checkbox"
            className="rounded border-hairline"
            checked={syncTikTokAfterReceive}
            onChange={e => onSyncTikTokChange?.(e.target.checked)}
            disabled={submitting}
          />
                <span>Mirror สต็อกไป TikTok Shop</span>
        </label>
      )}
      <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-1.5 text-xs flex-wrap">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-soft border hairline">
          <span className="font-semibold text-ink tabular-nums">{summary.total}</span>
          <span className="text-muted-soft">บิล</span>
        </span>
        {summary.actionable > 0 && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-success/10 border border-success/25">
            <span className="font-semibold text-success tabular-nums">
              {summary.actionable - summary.blocked}
            </span>
            <span className="text-muted-soft">พร้อมบันทึก</span>
          </span>
        )}
        {summary.blocked > 0 && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-warning/10 border border-warning/30">
            <span className="font-semibold text-warning tabular-nums">{summary.blocked}</span>
            <span className="text-muted-soft">รอแก้ไข</span>
          </span>
        )}
        {summary.skip > 0 && (
          /* L1: skipped bills (non-CMG / empty) are informational, not
             dangerous — switched from error red to neutral muted. */
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-soft border hairline">
            <span className="font-semibold text-muted tabular-nums">{summary.skip}</span>
            <span className="text-muted-soft">จะข้าม</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {/* A2: toggle VAT for every bill at once */}
        {bills && bills.length > 1 && (
          <button
            type="button"
            className="btn-ghost !text-xs"
            onClick={() => onSetAllVat?.(!allVat)}
            disabled={submitting}
            title="ตั้งค่า VAT ให้ทุกบิลพร้อมกัน"
          >
            <Icon name={allVat ? 'check' : 'x'} size={13}/>
            VAT ทั้งชุด {allVat ? 'เปิด' : 'ปิด'}
          </button>
        )}
        <button
          type="button"
          className="btn-patch-log-action"
          disabled={!ready}
          onClick={onSubmit}
          title={!ready ? `เหลือ ${summary.blocked} บิลที่ต้องแก้` : undefined}
        >
          {submitting
            ? <><span className="spinner"/> กำลังบันทึก…</>
            : <><Icon name="check" size={16}/> บันทึกเข้าสต็อก ({summary.actionable - summary.blocked} บิล)</>}
        </button>
      </div>
      </div>
    </div>
  );
}

// ─── Sub: done summary ────────────────────────────────────────────────
function DoneSummary({ submitSummary, bills, onRetryFailed, onStartNew, submitting }) {
  const failed = submitSummary.failed || [];
  const savedFromSummary = submitSummary.savedIds?.length || 0;
  const savedFromBills = bills.filter((b) => b.saveState === 'saved').length;
  const savedCount = Math.max(savedFromSummary, savedFromBills);
  const failedCount = failed.length;
  const skippedCount = bills.filter((b) => !b.is_cmg_bill || b.rows.length === 0).length;
  const allOk = failedCount === 0;
  const tiktokMirrorPartial = submitSummary.tiktokMirrorHadFailures;

  return (
    <div className="card-canvas overflow-hidden">
      <div className="p-6 lg:p-8 flex flex-col items-center text-center gap-4">
        <div
          className={
            'w-14 h-14 rounded-2xl border flex items-center justify-center ' +
            (allOk ? 'bg-success/10 border-success/40' : 'bg-warning/10 border-warning/40')
          }
        >
          <Icon name={allOk ? 'check' : 'alert'} size={26} className={allOk ? 'text-success' : 'text-warning'}/>
        </div>
        <div>
          <div className="font-display text-2xl">
            {allOk
              ? `บันทึกสำเร็จทั้ง ${savedCount} บิล`
              : `บันทึก ${savedCount}/${savedCount + failedCount} บิล`}
          </div>
          <div className="text-sm text-muted-soft mt-1.5">
            {allOk
              ? 'รายการรับเข้าทั้งหมดถูกบันทึกแล้ว'
              : 'บางบิลบันทึกไม่สำเร็จ — กดลองอีกครั้งหรือเริ่มรอบใหม่'}
            {skippedCount > 0 && (
              <> · ข้าม {skippedCount} บิล (ไม่ใช่ CMG / ไม่มีรายการ)</>
            )}
            {tiktokMirrorPartial && (
              <> · TikTok บางรายการยังไม่ sync — ไป Stock Control</>
            )}
          </div>
        </div>

        {/* Saved bills list */}
        {savedCount > 0 && (
          <div className="w-full max-w-md text-left bg-success/5 border border-success/25 rounded-xl p-3">
            <div className="text-xs font-medium text-success mb-1.5">บันทึกสำเร็จ</div>
            <div className="flex flex-wrap gap-1.5">
              {submitSummary.savedIds.map((id) => (
                <span key={id} className="font-mono text-xs bg-canvas border hairline rounded px-2 py-0.5">
                  #{id}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Failed bills list */}
        {failedCount > 0 && (
          <div className="w-full max-w-md text-left bg-error/5 border border-error/25 rounded-xl p-3 space-y-2">
            <div className="text-xs font-medium text-error">บันทึกไม่สำเร็จ ({failedCount})</div>
            {failed.map((f) => (
              <div key={f.index} className="text-xs">
                <span className="font-medium">บิลที่ {f.index + 1}:</span>{' '}
                <span className="text-muted">{f.message}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap justify-center mt-2">
          {failedCount > 0 && (
            <button
              type="button"
              className="btn-secondary"
              onClick={onRetryFailed}
              disabled={submitting}
            >
              {submitting
                ? <><span className="spinner"/> กำลังลองใหม่…</>
                : <><Icon name="refresh" size={16}/> ลองใหม่ {failedCount} บิลที่พลาด</>}
            </button>
          )}
          <button type="button" className="btn-ai-mesh btn-ai-mesh-wide" onClick={onStartNew} disabled={submitting}>
            <Icon name="scan" size={16}/> เริ่มรอบใหม่
          </button>
        </div>
      </div>
    </div>
  );
}
