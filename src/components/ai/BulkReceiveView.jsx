// BulkReceiveView — the "รับเข้า ×10" page.
//
// Three-phase wizard that wraps the entire flow:
//
//   1. EMPTY  — landing state. User taps the upload button which opens
//               BulkBillUploadModal to pick 1–10 bill images.
//   2. PARSING — single fetch to cmg-bill-parse with all images packed
//               into one Gemini request (the whole point of this view:
//               cuts RPD usage 5–10×).
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
import { fetchAllFromTable } from '../../lib/sb-paginate.js';
import { mapError } from '../../lib/error-map.js';
import { VAT_RATE_DEFAULT, fmtTHB } from '../../lib/money.js';
import { buildReceiveItems, receiveTotals, grossUnitCost } from '../../lib/ai-receive.js';
import { startOfDayBangkok } from '../../lib/date.js';
import Icon from '../ui/Icon.jsx';
import BillReviewPanel, { buildRowFromAi, makeRowUid } from './BillReviewPanel.jsx';
import BulkBillUploadModal from './BulkBillUploadModal.jsx';
import BillImageLightbox from './BillImageLightbox.jsx';
import AIErrorCard, { parseAIError } from './AIErrorCard.jsx';
import { useRecentReceivesMap, findExistingCmgInvoices } from '../../lib/recent-receives.js';
import { saveDraft, loadDraft, clearDraft, base64ToBlob } from '../../lib/ai-draft.js';

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
// profit calculations).
function billStatus(bill) {
  if (bill.saveState === 'saved')   return 'saved';
  if (bill.saveState === 'failed')  return 'failed';
  if (bill.saveState === 'saving')  return 'saving';
  if (!bill.is_cmg_bill || bill.rows.length === 0) return 'empty';
  const unresolved = bill.rows.filter((r) => r.status === 'suggestions' || r.status === 'none').length;
  if (unresolved > 0) return 'unresolved';
  const incomplete = bill.rows.some((r) =>
    !(Number(r.unit_cost) > 0) || !(Number(r.quantity) > 0)
  );
  if (incomplete) return 'incomplete';
  return 'ready';
}

// Returns true if a bill can be submitted (passes H3 guards too).
function isBillSubmittable(bill) {
  const s = billStatus(bill);
  return s === 'ready' || s === 'failed';
}

const STEP_STATUS_META = {
  ready:      { icon: 'check', cls: 'bg-success/15 text-success border-success/40' },
  unresolved: { icon: 'alert', cls: 'bg-warning/15 text-warning border-warning/40' },
  incomplete: { icon: 'alert', cls: 'bg-warning/15 text-warning border-warning/40' },
  empty:      { icon: 'alert', cls: 'bg-error/15 text-error border-error/40' },
  saving:     { icon: 'refresh', cls: 'bg-primary/15 text-primary border-primary/40', spin: true },
  saved:      { icon: 'check', cls: 'bg-success/20 text-success border-success/55' },
  failed:     { icon: 'x', cls: 'bg-error/20 text-error border-error/55' },
};

// ─── Main component ───────────────────────────────────────────────────
export default function BulkReceiveView() {
  const [phase, setPhase] = useState('empty'); // empty | parsing | review | done
  // Duplicate-bill guard — same hook as StockMovementForm uses.
  // Loads once on mount; powers the small "พึ่งรับ X วันก่อน" badge on
  // RowCards whose AI-matched product was already received in the
  // last 7 days. Helps users avoid re-scanning a bill they already
  // submitted earlier in the week.
  const { map: recentReceivesMap, refresh: refreshRecentReceives } = useRecentReceivesMap();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [error, setError] = useState(null);
  const [products, setProducts] = useState([]);
  const [bills, setBills] = useState([]); // per-image state
  const [currentIdx, setCurrentIdx] = useState(0);
  const [usage, setUsage] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitSummary, setSubmitSummary] = useState(null); // {savedIds:[], failed:[]}
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
    if (phase !== 'review' || bills.length === 0) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      // Strip the ObjectURL (regenerated from base64 on restore).
      const slim = bills.map(({ previewUrl, ...rest }) => rest); // eslint-disable-line no-unused-vars
      saveDraft({ bills: slim, currentIdx, usage });
    }, 800);
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current); };
  }, [bills, currentIdx, usage, phase]);

  // ─── C2: warn before unloading the tab with unsaved bills ──────────
  useEffect(() => {
    const dirty = phase === 'review' && bills.some(
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
        try { previewUrl = URL.createObjectURL(base64ToBlob(b.base64, b.mime)); } catch { /* noop */ }
        return { ...b, previewUrl };
      });
      setBills(restoredBills);
      setCurrentIdx(Math.min(draft.currentIdx || 0, Math.max(0, restoredBills.length - 1)));
      setUsage(draft.usage || null);
      setPhase('review');
      // Catalog isn't persisted (too large) — refetch so the search /
      // resolve UI works. Matches/candidates from the draft still render
      // immediately; this just rehydrates `products` for new searches.
      fetchAllFromTable(sb, 'products', {
        select: 'id, name, barcode, retail_price, cost_price, current_stock',
        orderColumn: 'id',
      }).then((res) => setProducts(res?.data || [])).catch(() => {});
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
      setSubmitSummary(null);
      setError(null);
      setCurrentIdx(0);
    }
    setUploadOpen(true);
  };

  // ─── Upload commit → kick off the single batch AI call ─────────────
  const handleUploadConfirm = useCallback(async ({ images }) => {
    setUploadOpen(false);
    setPhase('parsing');
    setError(null);
    // Seed bills with the image data so the wizard can show thumbnails
    // even while we're waiting for the AI.
    const seedBills = images.map((img) => ({
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
      rows: [],
      // Lifecycle:
      saveState: 'pending', // pending | saving | saved | failed
      savedOrderId: null,
      saveError: null,
    }));
    setBills(seedBills);
    setCurrentIdx(0);

    try {
      // Parallel: AI parse + products catalog. Catalog fetch is needed
      // for the fuzzy-match in buildRowFromAi.
      const [parseRes, catalogRes] = await Promise.all([
        sb.functions.invoke('cmg-bill-parse', {
          body: {
            images: images.map((img) => ({
              image_base64: img.base64,
              mime: img.mime,
            })),
          },
        }),
        fetchAllFromTable(sb, 'products', {
          select: 'id, name, barcode, retail_price, cost_price, current_stock',
          orderColumn: 'id',
        }),
      ]);

      const catalog = catalogRes?.data || [];
      if (catalogRes?.error) {
        console.warn('[BulkReceiveView] catalog load issue:', catalogRes.error);
      }

      if (parseRes.error) {
        // Hand the raw error to parseAIError so we keep the full
        // FunctionsHttpError context for status + body extraction.
        throw parseRes.error;
      }
      const data = parseRes.data;
      if (!data) throw new Error('ไม่ได้รับข้อมูลจากเซิร์ฟเวอร์ — ลองอีกครั้ง');
      if (data.error) throw new Error(data.error);
      if (!Array.isArray(data.bills) || data.bills.length === 0) {
        throw new Error('AI ไม่ได้รีเทิร์นบิลใดเลย — ลองถ่ายรูปใหม่');
      }

      setUsage(data.usage || null);
      setProducts(catalog);

      // Merge parsed bills back into our seeded bills (preserving
      // thumbnail + base64). Edge function guarantees order matches
      // the input images, but we defensively pad if it ever returns
      // fewer entries than we sent.
      setBills((prev) =>
        prev.map((b, i) => {
          const parsed = data.bills[i] || {};
          const itemsRaw = Array.isArray(parsed.items) ? parsed.items : [];
          const rows = itemsRaw.map((it) => buildRowFromAi(it, catalog));
          return {
            ...b,
            is_cmg_bill: Boolean(parsed.is_cmg_bill),
            supplier_invoice_no: String(parsed.supplier_invoice_no || '').trim(),
            rows,
          };
        })
      );
      // B2: flag bills whose invoice number was already received from CMG
      // (the "I scanned the same paper bill twice" case). Non-blocking.
      const invoiceNos = data.bills
        .map((pb) => String(pb?.supplier_invoice_no || '').trim())
        .filter(Boolean);
      findExistingCmgInvoices(invoiceNos).then(setDupInvoices).catch(() => {});
      setPhase('review');
    } catch (e) {
      // Convert raw error → structured AIError object that the
      // AIErrorCard knows how to render. Keep the seeded bills around
      // so the user can retry on the SAME images without re-uploading.
      const parsed = await parseAIError(e);
      setError(parsed);
      setPhase('error');
    }
  }, []);

  // ─── Retry AI on the same images (no re-upload required) ───────────
  // When AI errored after we had already loaded images, the seedBills
  // are still in state — just re-run the parse with their base64.
  const retryParse = useCallback(async () => {
    if (bills.length === 0) return;
    setError(null);
    setPhase('parsing');
    const images = bills.map((b) => ({
      base64: b.base64,
      mime: b.mime,
      name: b.name,
      previewUrl: b.previewUrl,
      width: b.width,
      height: b.height,
      sizeBytes: b.sizeBytes,
    }));
    // Reuse the same path — handleUploadConfirm reseeds bills which is
    // fine because the new seeds carry the same base64 / previewUrl.
    await handleUploadConfirm({ images });
  }, [bills, handleUploadConfirm]);

  // ─── Dismiss the error and go back to landing ──────────────────
  // R6 fix: the prior implementation had identical if/else branches
  // and a misleading comment about preserving thumbs. EmptyLanding
  // does not render thumbs; the bills array silently leaks ObjectURLs
  // every time the user dismisses an error. Wipe explicitly.
  const dismissError = () => {
    setError(null);
    if (bills.length > 0) {
      bills.forEach((b) => b.previewUrl && URL.revokeObjectURL(b.previewUrl));
      setBills([]);
      setUsage(null);
      setCurrentIdx(0);
    }
    setPhase('empty');
    clearDraft();
  };

  // ─── Row mutators (scoped to currentIdx) ───────────────────────────
  const patchCurrent = (patcher) => {
    setBills((prev) => prev.map((b, i) => (i === currentIdx ? patcher(b) : b)));
  };
  const updateRow = (uid, patch) =>
    patchCurrent((b) => ({
      ...b,
      rows: b.rows.map((r) => (r.uid === uid ? { ...r, ...patch } : r)),
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
    updateRow(uid, { status: 'auto', product, newProduct: null });
  const setNewProduct = (uid, np) =>
    updateRow(uid, { status: 'new', product: null, newProduct: np });
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
      const s = billStatus(b);
      return s === 'unresolved' || s === 'incomplete';
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
  }, [bills]);

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
        setBills((prev) => prev.map((b, j) =>
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
        const today = new Date().toISOString().slice(0, 10);
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
          created_via: 'ai_cmg',
          // M3: per-bill suffix so two same-second fallbacks differ.
          // `loopIdx + 1` mirrors the user-visible bill number well
          // enough; we don't expose the suffix in UI anywhere.
          supplier_invoice_no:
            bill.supplier_invoice_no?.trim() || autoInvoiceNo(loopIdx + 1),
          notes: `AI scan · batch · ${items.length} รายการ`,
        };

        const { data: head, error: rpcErr } = await sb.rpc('create_stock_movement_with_items', {
          p_kind: 'receive',
          p_header: header,
          p_items: items,
        });
        if (rpcErr) throw rpcErr;

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

        setBills((prev) => prev.map((b, j) =>
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
        setBills((prev) => prev.map((b, j) =>
          j === i ? { ...b, saveState: 'failed', saveError: msg } : b,
        ));
        failed.push({ index: i, message: msg });
      }
        setSavingProgress({ done: loopIdx + 1, total: targets.length });
      }
    } finally {
      // R7 fix: build the summary from the FINAL bills state, not
      // from per-pass local arrays. After a retry-failed pass, the
      // local `savedIdsThisPass` only contains the retry's saves,
      // throwing away the original successes. Reading from billsRef
      // gives a cumulative view that's always honest about what's
      // actually been saved.
      const finalBills = billsRef.current;
      const allSavedIds = finalBills
        .filter((b) => b.saveState === 'saved' && b.savedOrderId != null)
        .map((b) => b.savedOrderId);
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
      });
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

  // ═══ RENDER ═══════════════════════════════════════════════════════
  return (
    <div className="space-y-4">
      {/* PHASE: ERROR — dedicated screen with the AIErrorCard. Sits
          between EMPTY and the rest so the user sees the rich error
          UI (with retry button preserving their images) instead of
          being dumped back to the landing page. */}
      {phase === 'error' && error && (
        <div className="space-y-4">
          <AIErrorCard
            error={error}
            onRetry={error.retryable ? retryParse : undefined}
            onDismiss={dismissError}
          />
          {/* If we still have image thumbs from the failed attempt,
              show them so the user knows their picks aren't lost. */}
          {bills.length > 0 && (
            <div className="card-canvas p-4">
              <div className="text-xs text-muted-soft mb-2 flex items-center gap-1.5">
                <Icon name="file" size={12}/>
                <span>{bills.length} รูปยังรออยู่ — ไม่ต้องอัปไหลดใหม่</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                {bills.map((b, i) => (
                  <div key={b.uid} className="relative w-14 h-18 rounded-md overflow-hidden border hairline bg-surface-soft">
                    <img src={b.previewUrl} alt={`bill ${i+1}`} className="w-full h-full object-cover"/>
                    <div className="absolute top-0.5 left-0.5 ai-row-badge !w-5 !h-5 !text-[10px]">{i+1}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* PHASE: EMPTY — landing screen with the big upload button */}
      {phase === 'empty' && (
        <EmptyLanding
          onStart={startUpload}
          draft={draftAvailable}
          onRestore={() => restoreDraft(draftAvailable)}
          onDiscard={discardDraft}
        />
      )}

      {/* PHASE: PARSING — full-bleed spinner with thumbnail strip */}
      {phase === 'parsing' && (
        <ParsingScreen bills={bills} />
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
          onInvoiceNoChange={updateInvoiceNo}
          onHasVatChange={updateHasVat}
          onRemoveBill={removeCurrentBill}
          onSubmitAll={submitAll}
          onCancel={resetBatch}
          dupInvoices={dupInvoices}
          onZoom={setLightboxSrc}
          onSetAllVat={setAllVat}
          savingProgress={savingProgress}
          supplierName={supplier?.business_name || 'CMG'}
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

// ─── Sub: landing screen ──────────────────────────────────────────────
function EmptyLanding({ onStart, draft, onRestore, onDiscard }) {
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
    <div className="card-canvas overflow-hidden">
      <div className="p-8 lg:p-12 flex flex-col items-center text-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 border hairline flex items-center justify-center">
          <Icon name="scan" size={32} className="text-primary"/>
        </div>
        <div>
          <div className="font-display text-2xl lg:text-3xl">สแกนบิล CMG หลายใบในครั้งเดียว</div>
          <div className="text-sm text-muted-soft mt-1.5 max-w-md mx-auto leading-relaxed">
            อัปโหลดได้สูงสุด <strong className="text-ink">10 บิล/รอบ</strong> — AI จะอ่านทุกบิลในการเรียกเดียว
            ประหยัดโควต้า เร็วกว่าทีละบิล 5-10 เท่า
          </div>
        </div>
        <button
          type="button"
          className="btn-ai-mesh btn-ai-mesh-wide !py-3 !px-6 !text-base"
          onClick={onStart}
        >
          <Icon name="scan" size={18}/>
          เริ่มสแกนบิล
        </button>
        <div className="text-[11px] text-muted-soft mt-2 flex items-center gap-2 flex-wrap justify-center">
          <span>รองรับ JPG · PNG · WebP</span>
          <span>·</span>
          <span>EXIF rotate อัตโนมัติ</span>
          <span>·</span>
          <span>ปรับขนาดให้พอเหมาะอัตโนมัติ</span>
        </div>
      </div>
    </div>
   </div>
  );
}

// ─── Sub: parsing screen ──────────────────────────────────────────────
function ParsingScreen({ bills }) {
  return (
    <div className="card-canvas overflow-hidden">
      <div className="p-8 flex flex-col items-center text-center gap-5">
        <div className="flex items-center gap-3">
          <span className="spinner lg"/>
          <div>
            <div className="font-display text-xl">กำลังให้ AI อ่านบิล…</div>
            <div className="text-xs text-muted-soft mt-0.5">
              {bills.length} บิล · ใช้เวลา 10-30 วินาที
            </div>
          </div>
        </div>
        {/* Thumbnail strip — so the user sees what's being processed */}
        <div className="flex gap-2 flex-wrap justify-center max-w-xl">
          {bills.map((b, i) => (
            <div
              key={b.uid}
              className="relative w-16 h-20 rounded-md overflow-hidden border hairline bg-surface-soft animate-pulse"
            >
              <img src={b.previewUrl} alt={`bill ${i+1}`} className="w-full h-full object-cover opacity-60"/>
              <div className="absolute top-0.5 left-0.5 ai-row-badge !w-5 !h-5 !text-[10px]">
                {i + 1}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Sub: review wizard ───────────────────────────────────────────────
function ReviewWizard({
  bills, currentIdx, setCurrentIdx, products, recentReceivesMap, usage, summary, submitting,
  onUpdateRow, onRemoveRow, onPickCandidate, onSetNewProduct,
  onInvoiceNoChange, onHasVatChange, onRemoveBill, onSubmitAll, onCancel,
  dupInvoices, onZoom, onSetAllVat, savingProgress, supplierName,
}) {
  const current = bills[currentIdx];
  const canPrev = currentIdx > 0;
  const canNext = currentIdx < bills.length - 1;
  const currentDup = current?.supplier_invoice_no
    ? dupInvoices?.get(current.supplier_invoice_no.trim())
    : null;

  return (
    <div className="space-y-4">
      {/* Top bar: title + summary chips + cancel */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="ai-chip">AI</span>
          <div className="font-display text-xl truncate">รับเข้า ×10 — Review</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {usage && (
            <div className="text-[11px] text-muted-soft tabular-nums">
              {usage.total_tokens.toLocaleString()} tokens · ≈{fmtTHB(usage.estimated_thb)}
            </div>
          )}
          {/* H1: "+ เพิ่มบิล" removed — the old wiring re-ran
              startUpload() which silently wiped the in-progress
              batch. True append-and-reparse isn't implemented; the
              user can finish this batch and start another from the
              done summary. */}
          <button
            type="button"
            className="btn-ghost text-sm"
            onClick={() => {
              // M5: explicit confirm before destroying an in-progress batch.
              if (bills.length > 0 && !submitting) {
                if (!window.confirm(`ยกเลิก ${bills.length} บิลที่ยังไม่ได้บันทึก?`)) return;
              }
              onCancel();
            }}
            disabled={submitting}
          >
            ยกเลิกทั้งหมด
          </button>
        </div>
      </div>

      {/* Stepper — click any bill to jump to it */}
      <Stepper
        bills={bills}
        currentIdx={currentIdx}
        onJump={(i) => setCurrentIdx(i)}
      />

      {/* Current bill card */}
      {current && (
        <BillCard
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
          onInvoiceNoChange={onInvoiceNoChange}
          onHasVatChange={onHasVatChange}
          onRemoveBill={onRemoveBill}
          disabled={current.saveState === 'saved' || submitting}
          supplierName={supplierName}
        />
      )}

      {/* Navigation buttons */}
      <div className="flex items-center justify-between gap-2">
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

      {/* Submit bar */}
      <SubmitBar
        summary={summary}
        submitting={submitting}
        savingProgress={savingProgress}
        bills={bills}
        onSetAllVat={onSetAllVat}
        onSubmit={onSubmitAll}
      />
    </div>
  );
}

// ─── Sub: stepper ─────────────────────────────────────────────────────
function Stepper({ bills, currentIdx, onJump }) {
  return (
    <div className="card-canvas p-2 lg:p-2.5">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {bills.map((b, i) => {
          const status = billStatus(b);
          const meta = STEP_STATUS_META[status];
          const isCurrent = i === currentIdx;
          return (
            <button
              key={b.uid}
              type="button"
              onClick={() => onJump(i)}
              className={
                'relative flex-shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ' +
                (isCurrent
                  ? 'bg-white border-primary text-ink shadow-sm ring-2 ring-primary/30'
                  : `${meta.cls} hover:brightness-105`)
              }
              aria-label={`ไปบิลที่ ${i + 1}`}
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
function BillCard({
  bill, billNumber, totalBills, products, recentReceivesMap, dup, onZoom,
  onUpdateRow, onRemoveRow, onPickCandidate, onSetNewProduct,
  onInvoiceNoChange, onHasVatChange, onRemoveBill, disabled, supplierName,
}) {
  const itemCount = bill.rows.length;
  const unresolved = bill.rows.filter((r) => r.status === 'suggestions' || r.status === 'none').length;
  const isNonCmg = !bill.is_cmg_bill;
  const isEmpty = bill.rows.length === 0;
  // H3: rows where AI couldn't read qty or cost (returned 0 per prompt
  // rule #5). Distinct from "unresolved" because the product itself is
  // identified — the user just needs to type in the missing number.
  const incompleteRows = (!isNonCmg && !isEmpty && unresolved === 0)
    ? bill.rows.filter((r) => !(Number(r.unit_cost) > 0) || !(Number(r.quantity) > 0)).length
    : 0;
  // B1: rows the AI itself flagged as uncertain — informational (doesn't
  // block submit), nudges the user to eyeball them against the image.
  const reviewRows = (!isNonCmg && !isEmpty)
    ? bill.rows.filter((r) => r.needsReview).length
    : 0;

  return (
    <div className="card-canvas overflow-hidden">
      {/* Bill header — thumbnail + meta + delete */}
      <div className="p-4 border-b hairline flex items-start gap-3">
        <button
          type="button"
          onClick={() => bill.previewUrl && onZoom?.(bill.previewUrl)}
          className="group flex-shrink-0 w-16 h-20 lg:w-20 lg:h-24 rounded-md overflow-hidden border hairline bg-surface-soft relative cursor-zoom-in"
          aria-label="ดูรูปบิลแบบขยาย"
        >
          <img
            src={bill.previewUrl}
            alt={`bill ${billNumber}`}
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
          />
          <div className="absolute top-0.5 left-0.5 ai-row-badge !w-6 !h-6 !text-[11px]">
            {billNumber}
          </div>
          <div className="absolute inset-0 flex items-end justify-center pb-1 opacity-0 group-hover:opacity-100 transition-opacity"
               style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.45), transparent 55%)' }}>
            <Icon name="search" size={14} className="text-white"/>
          </div>
        </button>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="font-display text-lg">บิลที่ {billNumber} / {totalBills}</div>
            {bill.saveState === 'saved' && (
              <span className="inline-flex items-center gap-1 text-xs text-success bg-success/10 px-2 py-0.5 rounded-md border border-success/30">
                <Icon name="check" size={12}/> บันทึกแล้ว #{bill.savedOrderId}
              </span>
            )}
            {bill.saveState === 'failed' && (
              <span className="inline-flex items-center gap-1 text-xs text-error bg-error/10 px-2 py-0.5 rounded-md border border-error/30">
                <Icon name="alert" size={12}/> บันทึกไม่สำเร็จ
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-soft">เลขบิล:</span>
              <input
                type="text"
                className="input !py-1 !px-2 !text-xs font-mono !min-h-0 w-44"
                value={bill.supplier_invoice_no}
                onChange={(e) => onInvoiceNoChange(e.target.value)}
                placeholder="เว้นว่างเพื่อสร้างอัตโนมัติ"
                disabled={disabled}
              />
            </label>
            <span className="text-[11px] text-muted-soft">ผู้ขาย {supplierName || 'CMG'}</span>
            <span className="text-[11px] text-muted-soft">·</span>
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs">
              <input
                type="checkbox"
                className="rounded border-hairline text-primary focus:ring-primary/30 w-3.5 h-3.5 cursor-pointer"
                checked={bill.has_vat !== false}
                onChange={(e) => onHasVatChange?.(e.target.checked)}
                disabled={disabled}
              />
              <span className="text-muted-soft font-medium">สแกนราคาก่อน VAT (บวก VAT 7% อัตโนมัติ)</span>
            </label>
          </div>
          {/* B2: invoice already received from CMG — strong warning */}
          {dup && (
            <div className="text-xs text-error bg-error/10 border border-error/40 rounded-md px-2 py-1 inline-flex items-center gap-1.5">
              <Icon name="alert" size={12}/>
              เลขบิลนี้เคยรับเข้าแล้ว (#{dup.id}
              {dup.date ? ` · ${new Date(dup.date).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' })}` : ''})
              — ตรวจก่อนบันทึกซ้ำ
            </div>
          )}
          {/* Per-bill status banner */}
          {isNonCmg && (
            <div className="text-xs text-error bg-error/10 border border-error/30 rounded-md px-2 py-1 inline-flex items-center gap-1.5">
              <Icon name="alert" size={12}/>
              AI บอกว่ารูปนี้ไม่ใช่บิล CMG — บิลนี้จะถูกข้ามตอนบันทึก
            </div>
          )}
          {!isNonCmg && isEmpty && (
            <div className="text-xs text-warning bg-warning/10 border border-warning/30 rounded-md px-2 py-1 inline-flex items-center gap-1.5">
              <Icon name="alert" size={12}/>
              อ่านรายการไม่ได้ — ลบบิลนี้แล้วถ่ายใหม่
            </div>
          )}
          {!isNonCmg && !isEmpty && unresolved > 0 && (
            <div className="text-xs text-warning bg-warning/10 border border-warning/30 rounded-md px-2 py-1 inline-flex items-center gap-1.5">
              <Icon name="alert" size={12}/>
              เหลือ {unresolved} รายการที่ต้อง resolve
            </div>
          )}
          {incompleteRows > 0 && (
            // H3: surfaces rows where AI read 0 for qty/cost. Without
            // this banner the user might submit a bill where one row
            // has unit_price=0, silently breaking profit reports.
            <div className="text-xs text-warning bg-warning/10 border border-warning/30 rounded-md px-2 py-1 inline-flex items-center gap-1.5">
              <Icon name="alert" size={12}/>
              เหลือ {incompleteRows} รายการที่ AI อ่าน ทุน/จำนวน ไม่ออก — กรอกให้ครบก่อนบันทึก
            </div>
          )}
          {reviewRows > 0 && (
            <button
              type="button"
              onClick={() => bill.previewUrl && onZoom?.(bill.previewUrl)}
              className="text-xs text-warning bg-warning/10 border border-warning/30 rounded-md px-2 py-1 inline-flex items-center gap-1.5 hover:bg-warning/15 transition"
            >
              <Icon name="alert" size={12}/>
              AI ไม่มั่นใจ {reviewRows} รายการ — แตะดูรูปเทียบให้ชัวร์
            </button>
          )}
          {bill.saveState === 'failed' && bill.saveError && (
            <AIErrorCard
              compact
              error={{
                kind: 'data',
                severity: 'danger',
                icon: 'alert',
                title: 'บันทึกไม่สำเร็จ',
                body: bill.saveError,
              }}
            />
          )}
        </div>
        <button
          type="button"
          className="btn-ghost !p-2 text-muted-soft hover:text-error flex-shrink-0"
          onClick={onRemoveBill}
          aria-label={`ลบบิลที่ ${billNumber}`}
          disabled={disabled}
        >
          <Icon name="trash" size={16}/>
        </button>
      </div>

      {/* Review panel */}
      <div className="p-4">
        <BillReviewPanel
          rows={bill.rows}
          products={products}
          recentReceivesMap={recentReceivesMap}
          billKey={bill.uid}
          hasVat={bill.has_vat !== false}
          onUpdateRow={onUpdateRow}
          onRemoveRow={onRemoveRow}
          onPickCandidate={onPickCandidate}
          onSetNewProduct={onSetNewProduct}
        />
      </div>
    </div>
  );
}

// ─── Sub: submit bar ──────────────────────────────────────────────────
function SubmitBar({ summary, submitting, savingProgress, bills, onSetAllVat, onSubmit }) {
  const ready = summary.readyToSubmit && !submitting;
  // A2: are all bills currently set to "add VAT"? Drives the one-tap toggle.
  const allVat = (bills || []).length > 0 && bills.every((b) => b.has_vat !== false);
  const pct = savingProgress && savingProgress.total
    ? Math.round((savingProgress.done / savingProgress.total) * 100)
    : 0;
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
            <span className="text-muted-soft">รอ resolve</span>
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
          className="btn-primary"
          disabled={!ready}
          onClick={onSubmit}
          title={!ready ? `เหลือ ${summary.blocked} บิลที่ต้อง resolve` : undefined}
        >
          {submitting
            ? <><span className="spinner"/> กำลังบันทึก…</>
            : <><Icon name="check" size={16}/> บันทึกทั้งหมด ({summary.actionable - summary.blocked} บิล)</>}
        </button>
      </div>
      </div>
    </div>
  );
}

// ─── Sub: done summary ────────────────────────────────────────────────
function DoneSummary({ submitSummary, bills, onRetryFailed, onStartNew, submitting }) {
  const failed = submitSummary.failed || [];
  const savedCount = submitSummary.savedIds?.length || 0;
  const failedCount = failed.length;
  const skippedCount = bills.filter((b) => !b.is_cmg_bill || b.rows.length === 0).length;
  const allOk = failedCount === 0;

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
