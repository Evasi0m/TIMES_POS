// Vite ES-module entry. Shims the three globals the legacy CDN script
// relied on (React, ReactDOM, supabase) so the existing app code below runs
// unchanged after `npm run build`.
//
// Long-term plan: split this single file into src/components/, src/views/,
// src/lib/ — see Phase 4 of the code-review plan. Today the goal is just
// "Vite builds + tests run" without rewriting the whole app at once.
import React from 'react';
import * as ReactDOM from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import { registerSW } from 'virtual:pwa-register';
import {
  drainQueue, queueSale, onQueueChange,
  onDrainStateChange, getDrainState,
  listQueuedSales, deleteQueuedSale,
} from './lib/offline-queue.js';
import { onOnlineChange, isOnline } from './lib/online-status.js';
import { mapError } from './lib/error-map.js';
import { useNumberTween } from './lib/use-number-tween.js';
import { useBarcodeScanner, getPreferredFacing, setPreferredFacing } from './lib/use-barcode-scanner.js';
import { playScanBeep, playScanError, vibrateScan, vibrateError } from './lib/barcode-feedback.js';
import KindTabs from './components/movement/KindTabs.jsx';
import CostPercentToggle from './components/movement/CostPercentToggle.jsx';
import MovementItemsPanel from './components/movement/MovementItemsPanel.jsx';
import SupplierForm from './components/movement/SupplierForm.jsx';
import SalePickerForReturn from './components/movement/SalePickerForReturn.jsx';
import './styles.css';

// `supabase.createClient(...)` from the CDN UMD bundle becomes a one-method
// shim around the real ES-module export. Same shape, no other code changes.
const supabase = { createClient };

// Register the service worker (from src/sw.js, emitted by vite-plugin-pwa).
// `autoUpdate` in vite.config.js means the SW silently swaps itself when a
// new build reaches the cache — no "Update available" dialog at the front
// counter. In dev mode this is a stub.
registerSW({
  immediate: true,
  onRegisterError(err) { console.warn('[sw] register failed', err); },
});

// Drain the offline-sale queue any time the browser comes back online.
// Errors are mapped to Thai via mapError() and surfaced to OfflineBanner
// through the offline-queue's drain-state pub/sub — so a queue that gets
// stuck on a server-side bug (signature mismatch, RLS denial, etc.) shows
// the error and a retry button instead of looping "กำลัง sync…" forever.
let _draining = false;
async function tryDrain() {
  if (_draining || !isOnline() || !window._sb) return;
  _draining = true;
  try { await drainQueue(window._sb, mapError); } finally { _draining = false; }
}
onOnlineChange((on) => { if (on) tryDrain(); });
window.addEventListener('focus', tryDrain);

// Expose offline-queue helpers + Supabase client to the legacy script
// below. (The script accesses `sb` lexically; we also stash it on window
// so the SW-aware drainer can use it.)
window._tryDrain = tryDrain;
window._queueSale = queueSale;
window._isOnline = isOnline;
window._onQueueChange = onQueueChange;
window._onOnlineChange = onOnlineChange;
window._onDrainStateChange = onDrainStateChange;
window._getDrainState = getDrainState;
window._listQueuedSales = listQueuedSales;
window._deleteQueuedSale = deleteQueuedSale;

// === BEGIN legacy app body (extracted verbatim from legacy-index.html) =====
//   The block below is the contents of `src/app.legacy.jsx`, inlined so it
//   shares this module's lexical scope (and therefore the `supabase`,
//   `React`, `ReactDOM` shims declared above). To regenerate after editing
//   `app.legacy.jsx`, run:
//     scripts/build-main.sh        (or copy-paste manually)


const SUPABASE_URL = "https://zrymhhkqdcttqsdczfcr.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpyeW1oaGtxZGN0dHFzZGN6ZmNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MjYzNDUsImV4cCI6MjA5MzMwMjM0NX0.M414TfDx_nxJRa3hEWMiY7FAsevj5f0HIGQAp-H-8jM";

// Custom storage adapter — chooses localStorage (remember me) vs sessionStorage (clear on browser close)
// based on the `pos.remember` flag set when the user logs in.
// Default = remember (localStorage). Reads from both stores so existing sessions survive a flag flip.
const REMEMBER_KEY = "pos.remember";
const isRemember = () => localStorage.getItem(REMEMBER_KEY) !== "false";
const authStorage = {
  getItem: (k) => localStorage.getItem(k) ?? sessionStorage.getItem(k),
  setItem: (k, v) => {
    if (isRemember()) { localStorage.setItem(k, v); sessionStorage.removeItem(k); }
    else              { sessionStorage.setItem(k, v); localStorage.removeItem(k); }
  },
  removeItem: (k) => { localStorage.removeItem(k); sessionStorage.removeItem(k); },
};

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, storage: authStorage }
});
// Hand the client to the SW-aware queue drainer (set up in the prelude above).
window._sb = sb;
// Drain on first load too in case the user opened a queued tab while online.
queueMicrotask(() => window._tryDrain?.());

const { useState, useEffect, useMemo, useCallback, useRef } = React;

// Round to satang precision (2 decimals) to avoid JS float drift on currency math.
// Use everywhere prices are added/multiplied/discounted before storing or comparing.
const roundMoney = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
const fmtTHB = (n) => "฿" + roundMoney(n).toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtDate = (s) => s ? new Date(s).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" }) : "-";
const fmtDateTime = (s) => s ? new Date(s).toLocaleString("th-TH", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
// Bangkok-local YYYY-MM-DD — avoids the off-by-one bug when the server/client clock is in UTC
// and the sale happens after 17:00 UTC (= 00:00 next day in Bangkok).
const dateISOBangkok = (d) => (d || new Date()).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
const todayISO = () => dateISOBangkok();
// Stamps a Bangkok-local date (YYYY-MM-DD) as the start/end-of-day in tz-aware ISO so Supabase
// timestamptz comparisons line up with how Thai users experience "วันนี้".
const startOfDayBangkok = (yyyymmdd) => `${yyyymmdd}T00:00:00+07:00`;
const endOfDayBangkok   = (yyyymmdd) => `${yyyymmdd}T23:59:59.999+07:00`;

const CHANNELS = [
  { v: "store",    label: "หน้าร้าน" },
  { v: "tiktok",   label: "TikTok" },
  { v: "shopee",   label: "Shopee" },
  { v: "lazada",   label: "Lazada" },
  { v: "facebook", label: "Facebook" },
];
const PAYMENTS = [
  { v: "transfer", label: "โอนเงิน" },
  { v: "card",     label: "บัตร" },
  { v: "paylater", label: "ผ่อน" },
  { v: "cod",      label: "เก็บปลายทาง" },
];
// Channels whose platform fees make grand_total ≠ shop revenue.
// For these, the cashier records net_received separately for the P&L.
const ECOMMERCE_CHANNELS = new Set(['tiktok', 'shopee', 'lazada']);
// Payments where the platform-deducted total is known immediately at sale
// time. Pay-later (delay 1–2d) and COD (delay until courier remits) aren't.
const NET_RECEIVED_REQUIRED_PAYMENTS = new Set(['transfer', 'card']);
const requiresNetReceived = (channel, payment) =>
  ECOMMERCE_CHANNELS.has(channel) && NET_RECEIVED_REQUIRED_PAYMENTS.has(payment);
const UNITS = ["เรือน", "เส้น", "ก้อน", "ใบ"];
const RETURN_REASONS = ["ชำรุด", "ผิดรุ่น/ผิดสี", "ลูกค้าเปลี่ยนใจ", "ขายผิดราคา", "อื่นๆ"];
const VAT_RATE_DEFAULT = 7;

// VAT-inclusive pricing (retail standard in Thailand): the displayed grand_total already includes VAT.
// Returns { vat, exVat } where roundMoney(vat) + roundMoney(exVat) == roundMoney(grand).
function vatBreakdown(grandTotal, vatRate = VAT_RATE_DEFAULT) {
  const r = (Number(vatRate) || 0) / 100;
  const g = roundMoney(grandTotal);
  if (r <= 0) return { vat: 0, exVat: g };
  const exVat = roundMoney(g / (1 + r));
  const vat = roundMoney(g - exVat);
  return { vat, exVat };
}

// All intermediate steps are rounded to 2 decimals so cascading discount + qty
// don't accumulate float drift (e.g. 0.1 + 0.2 != 0.3).
function applyDiscounts(unitPrice, qty, d1v, d1t, d2v, d2t) {
  let s1 = roundMoney(unitPrice);
  if (d1t === 'percent') s1 = roundMoney(s1 * (1 - (Number(d1v)||0) / 100));
  else if (d1t === 'baht') s1 = roundMoney(s1 - (Number(d1v)||0));
  let s2 = s1;
  if (d2t === 'percent') s2 = roundMoney(s2 * (1 - (Number(d2v)||0) / 100));
  else if (d2t === 'baht') s2 = roundMoney(s2 - (Number(d2v)||0));
  return roundMoney(Math.max(0, s2) * (Number(qty) || 0));
}
function applyOrderDiscount(subtotal, value, type) {
  if (type === 'percent') return Math.max(0, subtotal * (1 - (Number(value)||0)/100));
  if (type === 'baht') return Math.max(0, subtotal - (Number(value)||0));
  if (type === 'net') return Math.max(0, subtotal - (Number(value)||0));
  return subtotal;
}

/* =========================================================
   SVG ICONS (Lucide-inspired, stroke=currentColor)
========================================================= */
const Icon = ({ name, size = 20, className = "", strokeWidth = 1.75, color }) => {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color || "currentColor", strokeWidth, strokeLinecap: "round", strokeLinejoin: "round", className };
  switch (name) {
    case "cart":      return <svg {...p}><path d="M2 3h2.5l3 12h11l2.5-8H7"/><circle cx="10.5" cy="19.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="17.5" cy="19.5" r="1.5" fill="currentColor" stroke="none"/></svg>;
    case "watch":     return <svg {...p}><rect x="6" y="5" width="12" height="14" rx="3"/><path d="M9 5V3h6v2M9 19v2h6v-2"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>;
    case "box":       return <svg {...p}><rect x="2" y="8" width="20" height="13" rx="1"/><path d="M2 8 4 3h16l2 5"/><path d="M9 13h6"/></svg>;
    case "receipt":   return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>;
    case "package":   return <svg {...p}><path d="M12 3l9 5v10l-9 5-9-5V8l9-5z"/><path d="M12 12l9-5"/><path d="M12 12v10"/></svg>;
    case "package-in":  return <svg {...p}><path d="M12 3l9 5v10l-9 5-9-5V8l9-5z"/><path d="M12 8v10"/><path d="M8 12l4-4 4 4"/></svg>;
    case "package-out": return <svg {...p}><path d="M12 3l9 5v10l-9 5-9-5V8l9-5z"/><path d="M12 8v10"/><path d="M8 16l4 4 4-4"/></svg>;
    case "dashboard": return <svg {...p}><rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/></svg>;
    case "search":    return <svg {...p}><circle cx="11" cy="11" r="7.5"/><path d="m16.5 16.5 4.5 4.5"/><circle cx="14.5" cy="7.5" r="1" fill="currentColor" opacity="0.3"/></svg>;
    case "plus":      return <svg {...p}><path d="M12 5v14M5 12h14"/></svg>;
    case "minus":     return <svg {...p}><path d="M5 12h14"/></svg>;
    case "x":         return <svg {...p}><path d="M18 6 6 18M6 6l12 12"/></svg>;
    case "trash":     return <svg {...p}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>;
    case "logout":    return <svg {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>;
    case "calendar":  return <svg {...p}><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M16 3v4M8 3v4M4 11h16"/></svg>;
    case "tag":       return <svg {...p}><path d="M4 4h8l8 8-8 8-8-8V4z"/><circle cx="8" cy="8" r="1.5"/></svg>;
    case "edit":      return <svg {...p}><path d="M12 20h9M16 3l5 5-9 9H7v-5l9-9z"/></svg>;
    case "chevron-r": return <svg {...p}><path d="m9 18 6-6-6-6"/></svg>;
    case "chevron-d": return <svg {...p}><path d="m6 9 6 6 6-6"/></svg>;
    case "chevron-l": return <svg {...p}><path d="m15 18-6-6 6-6"/></svg>;
    case "chevron-u": return <svg {...p}><path d="m6 15 6-6 6 6"/></svg>;
    case "menu":      return <svg {...p}><path d="M3 6h18M3 12h18M3 18h18"/></svg>;
    case "filter":    return <svg {...p}><path d="M4 4h16l-6 8v6l-4 2v-8L4 4z"/></svg>;
    case "check":     return <svg {...p}><path d="m20 6-9 9-5-5"/></svg>;
    case "alert":     return <svg {...p}><path d="M12 2 2 22h20L12 2z"/><path d="M12 9v6M12 17h.01"/></svg>;
    case "barcode":   return <svg {...p}><path d="M4 7v10M7 7v10M10 7v10M14 7v10M17 7v10M20 7v10"/></svg>;
    case "credit-card":return <svg {...p}><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 11h20"/></svg>;
    case "trend-up":  return <svg {...p}><polyline points="4 17 9 12 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>;
    case "arrow-up":  return <svg {...p}><path d="M12 20V4"/><path d="M5 11l7-7 7 7"/></svg>;
    case "arrow-down":return <svg {...p}><path d="M12 4v16"/><path d="M19 13l-7 7-7-7"/></svg>;
    case "store":     return <svg {...p}><path d="M4 4h16l-2 4H6L4 4z"/><path d="M4 8v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/></svg>;
    case "file":      return <svg {...p}><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>;
    case "camera":    return <svg {...p}><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3.5"/></svg>;
    case "flashlight":return <svg {...p}><path d="M18 6 6 18"/><path d="M14 4h6v6"/><path d="M10 20H4v-6"/><circle cx="12" cy="12" r="2"/></svg>;
    case "flip-cam":  return <svg {...p}><path d="M3 7h4l2-3h6l2 3h4v12H3z"/><path d="m9 13 3-3 3 3"/><path d="M12 10v6"/></svg>;
    default: return null;
  }
};

/* =========================================================
   TOAST
========================================================= */
const ToastCtx = React.createContext({ push: ()=>{} });
// Phase 4.1: each toast carries a `closing` flag flipped ~200ms before unmount,
// so the .toast-out keyframe gets a chance to play before React removes the node.
function ToastProvider({ children }) {
  const [list, setList] = useState([]);
  const push = useCallback((msg, type='info') => {
    const id = Date.now()+Math.random();
    setList(l => [...l, { id, msg, type, closing: false }]);
    // Stage 1 (3300ms): mark closing → triggers .toast-out keyframe.
    setTimeout(() => setList(l => l.map(t => t.id === id ? { ...t, closing: true } : t)), 3300);
    // Stage 2 (3500ms): unmount once exit animation has played out.
    setTimeout(() => setList(l => l.filter(t => t.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-20 lg:bottom-6 right-4 lg:right-6 z-[120] space-y-2 max-w-[calc(100vw-32px)]">
        {list.map(t => (
          <div key={t.id} className={"px-4 py-3 rounded-lg shadow-2xl text-sm flex items-center gap-2 " +
              (t.closing ? "toast-out " : "toast-in ") +
              (t.type==='error'?'bg-error text-white':t.type==='success'?'bg-[#1f3d27] text-white':'bg-surface-dark text-on-dark')}>
            <Icon name={t.type==='error'?'alert':t.type==='success'?'check':'alert'} size={16} strokeWidth={2.2}/>
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
const useToast = () => React.useContext(ToastCtx);

/* =========================================================
   MODAL / SHEET
========================================================= */
/* Skeleton primitives.
 *   <Skeleton w="120px" h="14px" />   one shimmering block
 *   <SkeletonRows n={6} />            list-shaped placeholder
 * Less visually noisy than a centered spinner — the eye sees the layout
 * immediately and just waits for content to fill in. */
function Skeleton({ w = '100%', h = '14px', className = '', style }) {
  return <span className={"skeleton " + className} style={{ width: w, height: h, ...(style || {}) }} aria-hidden="true" />;
}
function SkeletonRows({ n = 5, label = 'กำลังโหลด' }) {
  return (
    <div className="p-4 space-y-3" role="status" aria-live="polite" aria-label={label}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="grid grid-cols-12 gap-3 items-center">
          <Skeleton w="100%" h="12px" className="col-span-4" />
          <Skeleton w="80%"  h="12px" className="col-span-3" />
          <Skeleton w="60%"  h="12px" className="col-span-2" />
          <Skeleton w="50%"  h="12px" className="col-span-2" />
          <Skeleton w="40%"  h="12px" className="col-span-1" />
        </div>
      ))}
    </div>
  );
}

/* Hook: keep a component mounted briefly after `open` flips false so an exit animation can run.
   Returns { render, closing } — render the element while `render`, apply close-animation classes when `closing`. */
function useMountedToggle(open, exitMs = 220) {
  const [render, setRender]   = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) { setRender(true); setClosing(false); }
    else if (render) {
      setClosing(true);
      const t = setTimeout(() => { setRender(false); setClosing(false); }, exitMs);
      return () => clearTimeout(t);
    }
  }, [open]);
  return { render, closing };
}

// Selector matching every focusable interactive element inside the modal.
// Used by the focus trap below.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), ' +
  'input:not([disabled]), select:not([disabled]), ' +
  '[tabindex]:not([tabindex="-1"])';

function Modal({ open, onClose, title, children, footer, wide }) {
  const { render, closing } = useMountedToggle(open, 220);
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);

  // Capture focus on open, restore it on close. Trap Tab inside the dialog.
  useEffect(() => {
    if (!render || closing) return;
    previousFocusRef.current = document.activeElement;

    // Focus the first focusable child after the dialog mounts and CSS lays
    // out (a 0ms timeout is enough; rAF here would skip a paint).
    const t = setTimeout(() => {
      const root = dialogRef.current;
      if (!root) return;
      const first = root.querySelector(FOCUSABLE_SELECTOR);
      (first || root).focus();
    }, 0);

    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return; }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll(FOCUSABLE_SELECTOR);
      if (focusables.length === 0) { e.preventDefault(); return; }
      const first = focusables[0];
      const last  = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);

    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      // Restore focus to whatever opened us, but only if the focus didn't
      // already move somewhere else (e.g. a toast button).
      const prev = previousFocusRef.current;
      if (prev && document.contains(prev)) {
        try { prev.focus({ preventScroll: true }); } catch {}
      }
    };
  }, [render, closing, onClose]);

  if (!render) return null;
  return (
    <div
      className={"fixed inset-0 modal-overlay z-[100] flex items-end lg:items-center justify-center lg:p-6 " + (closing ? "overlay-out" : "overlay-in")}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={"bg-white rounded-t-2xl lg:rounded-lg shadow-2xl w-full " + (wide?"lg:max-w-3xl":"lg:max-w-lg") + " max-h-[92vh] flex flex-col " + (closing ? "sheet-out" : "sheet-anim")}
        onClick={e=>e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b hairline flex items-center justify-between flex-shrink-0">
          <div className="font-display text-xl lg:text-2xl">{title}</div>
          <button className="btn-ghost !p-2" onClick={onClose} aria-label="ปิด"><Icon name="x" size={20}/></button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-5 py-4 border-t hairline flex justify-end gap-2 flex-shrink-0 pb-safe">{footer}</div>}
      </div>
    </div>
  );
}

/* =========================================================
   BARCODE SCANNER MODAL — camera-based fallback for mobile/tablet.
   Desktop still uses USB scanners; this is mobile-only UX.

   - mode='single'      → fires onScan once, then closes.
   - mode='continuous'  → keeps camera live, fires onScan per accepted code,
                          shows a hit log; user closes manually.
   The hook (`useBarcodeScanner`) drives the camera + decoder; this
   component only handles UI, animation, feedback, and torch/facing toggles.
========================================================= */
function BarcodeScannerModal({ open, onClose, onScan, mode = 'single', title }) {
  const { render, closing } = useMountedToggle(open, 220);
  const videoRef = useRef(null);
  const [facing, setFacing] = useState(getPreferredFacing());
  const [hits, setHits] = useState([]); // continuous mode log: [{code, at}]
  const [flashHit, setFlashHit] = useState(false);
  // Latch the latest onScan so the hook closure is stable.
  const onScanRef = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);
  // Persistent lock across modal open/close cycles. The component instance
  // itself never unmounts (only inner JSX via `render`), so refs survive.
  // Semantics:
  //   - On a successful scan we set lockedCode = that code. Subsequent
  //     detections of the SAME code are silently ignored — the camera is
  //     still aimed at the just-scanned item and we don't want to fire again
  //     when the user reopens the modal to scan a DIFFERENT product.
  //   - The lock auto-releases the moment we detect a DIFFERENT code (=
  //     user has moved the camera away to a new item) OR after 15 seconds
  //     have elapsed (safety net so the user is never stuck if they really
  //     do want to rescan the same barcode in a low-barcode environment).
  const lockedRef = useRef({ code: null, at: 0 });
  const LOCK_TIMEOUT_MS = 15000;

  const handleDetect = useCallback(async (code) => {
    const now = Date.now();
    const lock = lockedRef.current;
    // Same code while still locked — ignore silently. No beep, no callback,
    // so cart quantity never increments by accident.
    if (lock.code === code && now - lock.at < LOCK_TIMEOUT_MS) return;
    // Different code seen (or lock expired) — release before processing.
    if (lock.code !== null) lockedRef.current = { code: null, at: 0 };

    // Forward to consumer. Consumer returns true on confirmed hit (product
    // found + added) or false on miss/error so we don't lock unmatched codes.
    let success = true;
    try {
      const r = onScanRef.current?.(code);
      if (r && typeof r.then === 'function') {
        const awaited = await r;
        if (awaited === false) success = false;
      } else if (r === false) {
        success = false;
      }
    } catch { success = false; }
    if (!success) return; // miss feedback is the consumer's responsibility

    // Confirmed success: feedback + lock + close (single mode).
    playScanBeep();
    vibrateScan();
    setFlashHit(true);
    setTimeout(() => setFlashHit(false), 240);
    lockedRef.current = { code, at: Date.now() };
    if (mode === 'continuous') {
      setHits(h => [{ code, at: Date.now() }, ...h].slice(0, 4));
    } else {
      // single-shot: close after a short delay so the user sees the green flash.
      setTimeout(() => onClose?.(), 220);
    }
  }, [mode, onClose]);

  const { status, torchSupported, torchOn, toggleTorch } = useBarcodeScanner({
    videoRef,
    enabled: render,
    onDetect: handleDetect,
    facing,
  });

  const switchCamera = () => {
    const next = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    setPreferredFacing(next);
  };

  if (!render) return null;
  return (
    <div
      className={"fixed inset-0 modal-overlay z-[110] flex items-end lg:items-center justify-center lg:p-6 " + (closing ? "overlay-out" : "overlay-in")}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title || 'สแกนบาร์โค้ด'}
        className={"bg-black text-white rounded-t-2xl lg:rounded-2xl shadow-2xl w-full lg:max-w-md max-h-[92vh] flex flex-col overflow-hidden relative " + (closing ? "sheet-out" : "sheet-anim")}
        onClick={e => e.stopPropagation()}
      >
        {/* Camera viewport */}
        <div className="scanner-viewport">
          <video ref={videoRef} className="scanner-video" playsInline muted/>
          {/* Reticle overlay */}
          <div className={"scanner-reticle " + (flashHit ? "scanner-reticle--hit" : "")} aria-hidden="true">
            <div className="scanner-reticle-corner tl"/>
            <div className="scanner-reticle-corner tr"/>
            <div className="scanner-reticle-corner bl"/>
            <div className="scanner-reticle-corner br"/>
            <div className="scanner-reticle-line"/>
          </div>

          {/* Toolbar */}
          <div className="scanner-toolbar">
            <div className="font-display text-base">{title || 'สแกนบาร์โค้ด'}</div>
            <div className="flex items-center gap-1.5">
              {torchSupported && (
                <button type="button" onClick={toggleTorch}
                  className={"scanner-icon-btn " + (torchOn ? "scanner-icon-btn--active" : "")}
                  aria-label="เปิด/ปิดไฟฉาย">
                  <Icon name="flashlight" size={18}/>
                </button>
              )}
              <button type="button" onClick={switchCamera} className="scanner-icon-btn" aria-label="สลับกล้อง">
                <Icon name="flip-cam" size={18}/>
              </button>
              <button type="button" onClick={onClose} className="scanner-icon-btn" aria-label="ปิด">
                <Icon name="x" size={18}/>
              </button>
            </div>
          </div>

          {/* Status overlay (loading / denied / unsupported / error) */}
          {status !== 'running' && (
            <div className="scanner-status">
              {status === 'starting' && (<><span className="spinner"/> กำลังเปิดกล้อง…</>)}
              {status === 'denied' && (
                <div className="text-center px-6">
                  <div className="mb-2"><Icon name="camera" size={36}/></div>
                  <div className="font-display text-lg mb-1">ไม่ได้รับสิทธิ์ใช้กล้อง</div>
                  <div className="text-sm opacity-80">เปิด permission กล้องในตั้งค่าเบราว์เซอร์ แล้วลองอีกครั้ง</div>
                </div>
              )}
              {status === 'unsupported' && (
                <div className="text-center px-6">
                  <div className="mb-2"><Icon name="alert" size={32}/></div>
                  <div className="font-display text-lg mb-1">เบราว์เซอร์ไม่รองรับ</div>
                  <div className="text-sm opacity-80">ลองใช้ Chrome / Safari เวอร์ชันใหม่บนมือถือ</div>
                </div>
              )}
              {status === 'error' && (
                <div className="text-center px-6">
                  <div className="mb-2"><Icon name="alert" size={32}/></div>
                  <div className="font-display text-lg mb-1">เปิดกล้องไม่สำเร็จ</div>
                  <div className="text-sm opacity-80">ตรวจสอบกล้องบนเครื่องแล้วลองอีกครั้ง</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Hint / hit log */}
        <div className="bg-black/60 px-4 py-3 text-xs flex items-center justify-between gap-3 flex-shrink-0">
          <span className="opacity-80">
            {mode === 'continuous'
              ? 'วางบาร์โค้ดในกรอบ — กล้องจะปิดอัตโนมัติเมื่อสแกนสำเร็จ'
              : 'วางบาร์โค้ดในกรอบเพื่อสแกน'}
          </span>
          {mode === 'continuous' && hits.length > 0 && (
            <span className="font-mono text-[11px] opacity-90 truncate max-w-[55%]" title={hits[0].code}>
              ✓ {hits[0].code}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   CONFIRM / PROMPT DIALOG (replaces window.confirm / window.prompt)
   - useConfirm() returns confirm({...}) → Promise<boolean>
   - usePrompt()  returns prompt({...})  → Promise<string|null>  (null = cancelled)
========================================================= */
const DialogCtx = React.createContext({ confirm: ()=>Promise.resolve(false), prompt: ()=>Promise.resolve(null) });
function DialogProvider({ children }) {
  const [state, setState] = useState(null); // { kind:'confirm'|'prompt', title, message, label, defaultValue, danger, multiline, resolve }
  const [value, setValue] = useState("");

  const confirm = useCallback((opts) => new Promise((resolve) => {
    setState({ kind:'confirm', danger:false, ...opts, resolve });
  }), []);
  const prompt = useCallback((opts) => new Promise((resolve) => {
    setValue(opts?.defaultValue ?? "");
    setState({ kind:'prompt', danger:false, ...opts, resolve });
  }), []);

  const close = (result) => {
    if (!state) return;
    state.resolve(result);
    setState(null);
    setValue("");
  };

  const okLabel = state?.okLabel || (state?.kind==='prompt' ? 'ตกลง' : 'ยืนยัน');
  const cancelLabel = state?.cancelLabel || 'ยกเลิก';

  return (
    <DialogCtx.Provider value={{ confirm, prompt }}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(state?.kind==='prompt' ? null : false)}
        title={state?.title || (state?.kind==='prompt' ? 'กรอกข้อมูล' : 'ยืนยัน')}
        footer={
          <>
            <button className="btn-secondary" onClick={() => close(state?.kind==='prompt' ? null : false)}>{cancelLabel}</button>
            <button
              className={state?.danger ? "btn-danger" : "btn-primary"}
              onClick={() => close(state?.kind==='prompt' ? value : true)}
              autoFocus
            >{okLabel}</button>
          </>
        }
      >
        {state?.message && <div className="text-sm text-body whitespace-pre-line mb-3">{state.message}</div>}
        {state?.kind === 'prompt' && (
          <>
            {state.label && <label className="text-xs uppercase tracking-wider text-muted">{state.label}</label>}
            {state.multiline
              ? <textarea className="input mt-1 w-full" rows={3} value={value} onChange={e=>setValue(e.target.value)} autoFocus
                  onKeyDown={e=>{ if (e.key==='Enter' && (e.ctrlKey||e.metaKey)) close(value); if (e.key==='Escape') close(null); }}/>
              : <input className="input mt-1 w-full" value={value} onChange={e=>setValue(e.target.value)} autoFocus
                  onKeyDown={e=>{ if (e.key==='Enter') close(value); if (e.key==='Escape') close(null); }}/>}
          </>
        )}
      </Modal>
    </DialogCtx.Provider>
  );
}
const useConfirm = () => React.useContext(DialogCtx).confirm;
const usePrompt  = () => React.useContext(DialogCtx).prompt;

/* =========================================================
   LOGIN
========================================================= */
const LAST_EMAIL_KEY = "pos.lastEmail";
/* =========================================================
   DATE PICKER (single date + range — replaces native date input)
========================================================= */
const TH_MONTHS       = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const TH_MONTHS_SHORT = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const TH_WEEKDAYS     = ["อา","จ","อ","พ","พฤ","ศ","ส"];

const isoOfDate = (d) => {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
};
const dateOfIso = (iso) => iso ? new Date(iso+"T00:00:00") : null;

const fmtThaiDateShort = (iso) => {
  if (!iso) return "";
  const d = dateOfIso(iso);
  return `${d.getDate()} ${TH_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()+543}`;
};
const fmtThaiRange = (from, to) => {
  if (!from && !to) return "";
  if (from === to) return fmtThaiDateShort(from);
  const f = dateOfIso(from), t = dateOfIso(to);
  if (f.getFullYear() === t.getFullYear() && f.getMonth() === t.getMonth())
    return `${f.getDate()} – ${t.getDate()} ${TH_MONTHS_SHORT[t.getMonth()]} ${t.getFullYear()+543}`;
  if (f.getFullYear() === t.getFullYear())
    return `${f.getDate()} ${TH_MONTHS_SHORT[f.getMonth()]} – ${t.getDate()} ${TH_MONTHS_SHORT[t.getMonth()]} ${t.getFullYear()+543}`;
  return `${fmtThaiDateShort(from)} – ${fmtThaiDateShort(to)}`;
};

function DatePicker({ value, onChange, mode = 'single', placeholder = 'เลือกวันที่', className = '' }) {
  const [open, setOpen] = useState(false);
  const { render: renderPanel, closing: panelClosing } = useMountedToggle(open, 200);
  const initIso = mode === 'single' ? value : (value?.from || isoOfDate(new Date()));
  const initDate = dateOfIso(initIso) || new Date();
  const [viewMonth, setViewMonth] = useState(() => new Date(initDate.getFullYear(), initDate.getMonth(), 1));
  const [pendingStart, setPendingStart] = useState(null);
  const [hoverIso, setHoverIso] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Whenever the picker opens, jump to the month of the current value
  useEffect(() => {
    if (!open) return;
    const iso = mode === 'single' ? value : value?.from;
    const d = dateOfIso(iso) || new Date();
    setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    setPendingStart(null);
    setHoverIso(null);
  }, [open]);

  const today = new Date();
  const todayIso = isoOfDate(today);

  // 6×7 grid starting from the Sunday on/before the 1st
  const firstDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const gridStart = new Date(firstDay);
  gridStart.setDate(gridStart.getDate() - firstDay.getDay());
  const grid = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    grid.push(d);
  }

  const isInRange = (d) => {
    if (mode !== 'range') return false;
    let lo, hi;
    if (pendingStart) {
      const a = pendingStart, b = hoverIso || pendingStart;
      lo = a < b ? a : b; hi = a < b ? b : a;
    } else if (value?.from && value?.to) {
      lo = value.from; hi = value.to;
    } else return false;
    const dIso = isoOfDate(d);
    return dIso >= lo && dIso <= hi;
  };

  const isEdge = (d) => {
    const dIso = isoOfDate(d);
    if (mode === 'single') return dIso === value;
    if (pendingStart) return dIso === pendingStart;
    return dIso === value?.from || dIso === value?.to;
  };

  const handlePick = (d) => {
    const iso = isoOfDate(d);
    if (mode === 'single') {
      onChange(iso); setOpen(false);
    } else {
      if (!pendingStart) {
        setPendingStart(iso);
      } else {
        const lo = pendingStart < iso ? pendingStart : iso;
        const hi = pendingStart < iso ? iso : pendingStart;
        onChange({ from: lo, to: hi });
        setPendingStart(null); setHoverIso(null); setOpen(false);
      }
    }
  };

  const presets = [
    { label: "วันนี้",        get: () => ({ from: todayIso, to: todayIso }) },
    { label: "เมื่อวาน",      get: () => { const d=new Date(); d.setDate(d.getDate()-1); const iso=isoOfDate(d); return { from: iso, to: iso }; } },
    { label: "7 วันล่าสุด",   get: () => { const d=new Date(); d.setDate(d.getDate()-6); return { from: isoOfDate(d), to: todayIso }; } },
    { label: "30 วันล่าสุด",  get: () => { const d=new Date(); d.setDate(d.getDate()-29); return { from: isoOfDate(d), to: todayIso }; } },
    { label: "เดือนนี้",      get: () => { const d=new Date(); return { from: isoOfDate(new Date(d.getFullYear(), d.getMonth(), 1)), to: todayIso }; } },
    { label: "เดือนก่อน",     get: () => { const d=new Date(); const lm=d.getMonth()-1; const y= lm<0 ? d.getFullYear()-1 : d.getFullYear(); const m=(lm+12)%12; const last=new Date(y, m+1, 0); return { from: isoOfDate(new Date(y,m,1)), to: isoOfDate(last) }; } },
  ];

  const display = mode === 'single'
    ? (value ? fmtThaiDateShort(value) : placeholder)
    : (value?.from ? fmtThaiRange(value.from, value.to) : placeholder);

  return (
    <div className={"relative " + className} ref={ref}>
      <button type="button" onClick={()=>setOpen(o=>!o)} className="input flex items-center gap-2.5 text-left hover:bg-white/95 transition-colors">
        <Icon name="calendar" size={18} className="text-body flex-shrink-0" strokeWidth={2}/>
        <span className={(mode==='single'?value:value?.from) ? "text-ink truncate" : "text-muted-soft truncate"}>{display}</span>
        <Icon name="chevron-d" size={16} className={"ml-auto text-muted flex-shrink-0 transition-transform " + (open?"rotate-180":"")}/>
      </button>
      {renderPanel && (
        <div className={"absolute z-50 mt-2 left-0 w-[320px] max-w-[calc(100vw-32px)] glass-strong rounded-xl p-3 " + (panelClosing?"fade-out":"fade-in")} style={{boxShadow:'var(--shadow-high)'}}>
          {mode === 'range' && (
            <div className="flex flex-wrap gap-1.5 mb-3 pb-3 border-b hairline">
              {presets.map(p => (
                <button key={p.label} type="button"
                  className="text-xs px-3 py-1.5 rounded-full glass-soft hover:bg-white/80 hover-lift transition font-medium"
                  onClick={()=>{ onChange(p.get()); setPendingStart(null); setOpen(false); }}>
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between mb-2">
            <button type="button" className="btn-ghost !p-2 !min-h-0" onClick={()=>setViewMonth(m=>new Date(m.getFullYear(), m.getMonth()-1, 1))} aria-label="เดือนก่อน">
              <Icon name="chevron-l" size={18}/>
            </button>
            <button type="button" className="font-display text-lg btn-ghost !min-h-0 !py-1" onClick={()=>setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>
              {TH_MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()+543}
            </button>
            <button type="button" className="btn-ghost !p-2 !min-h-0" onClick={()=>setViewMonth(m=>new Date(m.getFullYear(), m.getMonth()+1, 1))} aria-label="เดือนถัดไป">
              <Icon name="chevron-r" size={18}/>
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {TH_WEEKDAYS.map((w,i) => (
              <div key={i} className={"text-center text-[11px] py-1 font-medium " + ((i===0||i===6)?"text-primary/70":"text-muted")}>{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5" onMouseLeave={()=>setHoverIso(null)}>
            {grid.map((d, i) => {
              const dIso = isoOfDate(d);
              const inMonth = d.getMonth() === viewMonth.getMonth();
              const isToday = dIso === todayIso;
              const inRange = isInRange(d);
              const edge = isEdge(d);
              const cls =
                "h-9 rounded-md text-sm transition-all relative tabular-nums " +
                (edge
                  ? "bg-primary text-white font-semibold shadow-md hover:brightness-110 "
                  : inRange
                  ? "bg-primary/15 text-ink hover:bg-primary/25 "
                  : inMonth
                  ? "text-ink hover:bg-white/70 hover:scale-105 "
                  : "text-muted-soft hover:bg-white/40 ") +
                (isToday && !edge ? "ring-2 ring-primary/40 " : "");
              return (
                <button key={i} type="button"
                  onClick={()=>handlePick(d)}
                  onMouseEnter={()=>setHoverIso(dIso)}
                  className={cls}>
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          {mode === 'range' && pendingStart && (
            <div className="text-xs text-muted mt-3 pt-2 border-t hairline text-center">
              <Icon name="check" size={12} className="inline mr-1"/> เริ่ม {fmtThaiDateShort(pendingStart)} · กดวันที่สิ้นสุด
            </div>
          )}
          {mode === 'single' && (
            <div className="flex justify-end mt-2 pt-2 border-t hairline">
              <button type="button" className="text-xs btn-ghost !min-h-0" onClick={()=>{ onChange(todayIso); setOpen(false); }}>วันนี้</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* =========================================================
   SHOP SETTINGS CONTEXT — single-row config for receipts
========================================================= */
const ShopCtx = React.createContext({ shop: null, refreshShop: ()=>{} });
const useShop = () => React.useContext(ShopCtx);

function ShopProvider({ children }) {
  const [shop, setShop] = useState(null);
  const refreshShop = useCallback(async () => {
    const { data } = await sb.from('shop_settings').select('*').eq('id', 1).single();
    setShop(data || { shop_name: 'TIMES' });
  }, []);
  useEffect(() => { refreshShop(); }, [refreshShop]);
  return <ShopCtx.Provider value={{ shop, refreshShop }}>{children}</ShopCtx.Provider>;
}

/* =========================================================
   SETTINGS MODAL — edit shop_settings
========================================================= */
function SettingsModal({ open, onClose }) {
  const toast = useToast();
  const { shop, refreshShop } = useShop();
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && shop) setDraft({ ...shop }); }, [open, shop]);
  if (!draft) return null;
  const set = (k,v) => setDraft(d => ({ ...d, [k]: v }));
  const save = async () => {
    setBusy(true);
    const { error } = await sb.from('shop_settings').update({
      shop_name: (draft.shop_name||'').trim() || 'TIMES',
      shop_address: draft.shop_address?.trim() || null,
      shop_phone: draft.shop_phone?.trim() || null,
      shop_tax_id: draft.shop_tax_id?.trim() || null,
      receipt_footer: draft.receipt_footer?.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    setBusy(false);
    if (error) { toast.push("บันทึกไม่ได้: " + mapError(error), 'error'); return; }
    toast.push("บันทึกการตั้งค่าแล้ว", 'success');
    await refreshShop();
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="ตั้งค่าร้าน"
      footer={<>
        <button className="btn-secondary" onClick={onClose}>ยกเลิก</button>
        <button className="btn-primary" onClick={save} disabled={busy}>
          {busy ? <span className="spinner"/> : <Icon name="check" size={16}/>}
          บันทึก
        </button>
      </>}>
      <div className="space-y-4">
        <div className="text-xs text-muted">ข้อมูลส่วนนี้จะแสดงบนใบเสร็จและใบกำกับภาษี</div>
        <div>
          <label className="text-xs uppercase tracking-wider text-muted">ชื่อร้าน *</label>
          <input className="input mt-1" value={draft.shop_name||""} onChange={e=>set('shop_name', e.target.value)} />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-muted">ที่อยู่</label>
          <textarea className="input mt-1" rows="2" value={draft.shop_address||""} onChange={e=>set('shop_address', e.target.value)} placeholder="เช่น 123 ห้างสรรพสินค้า ABC ชั้น 2" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs uppercase tracking-wider text-muted">เบอร์โทร</label>
            <input className="input mt-1 font-mono" value={draft.shop_phone||""} onChange={e=>set('shop_phone', e.target.value)} placeholder="02-xxx-xxxx" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-muted">เลขผู้เสียภาษี</label>
            <input className="input mt-1 font-mono" value={draft.shop_tax_id||""} onChange={e=>set('shop_tax_id', e.target.value)} placeholder="13 หลัก" />
          </div>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-muted">ข้อความท้ายใบเสร็จ</label>
          <input className="input mt-1" value={draft.receipt_footer||""} onChange={e=>set('receipt_footer', e.target.value)} placeholder="เช่น ขอบคุณที่ใช้บริการ" />
        </div>
      </div>
    </Modal>
  );
}

/* =========================================================
   RECEIPT — 100mm thermal sticker layout
========================================================= */
// 'cash' kept for legacy bills that haven't been migrated; the dropdown no longer offers it.
const PAYMENT_LABELS = { cash: 'เงินสด', transfer: 'โอนเงิน', card: 'บัตร', paylater: 'ผ่อน', cod: 'เก็บปลายทาง' };
const CHANNEL_LABELS = { store: 'หน้าร้าน', tiktok: 'TikTok', shopee: 'Shopee', lazada: 'Lazada', facebook: 'Facebook' };

function Receipt({ order, items, shop, variant = 'receipt' }) {
  const isInvoice = variant === 'tax_invoice';
  const exVat = Number(order.grand_total||0) - Number(order.vat_amount||0);
  return (
    <div className="receipt-100mm receipt-print">
      <div className="r-center">
        <div className="r-shop">{shop?.shop_name || 'TIMES'}</div>
        {shop?.shop_address && <div className="r-addr">{shop.shop_address}</div>}
        {shop?.shop_phone   && <div className="r-addr">โทร {shop.shop_phone} (คุณตุ๋ม)</div>}
        {isInvoice && shop?.shop_tax_id && <div className="r-addr">เลขผู้เสียภาษี {shop.shop_tax_id}</div>}
      </div>

      <hr className="r-double"/>
      <div className="r-center r-title">{isInvoice ? 'ใบกำกับภาษี / ใบเสร็จรับเงิน' : 'ใบเสร็จรับเงิน'}</div>
      <hr className="r-hr"/>

      <div className="r-meta">
        <div className="r-row"><span>เลขที่บิล</span><span>#{order.id}</span></div>
        {order.tax_invoice_no && <div className="r-row"><span>ใบกำกับ</span><span>{order.tax_invoice_no}</span></div>}
        <div className="r-row"><span>วันที่</span><span>{fmtDateTime(order.sale_date)}</span></div>
        <div className="r-row"><span>ช่องทาง</span><span>{CHANNEL_LABELS[order.channel]||'—'}</span></div>
        <div className="r-row"><span>ชำระโดย</span><span>{PAYMENT_LABELS[order.payment_method]||'—'}</span></div>
      </div>

      {isInvoice && (order.buyer_name || order.buyer_tax_id) && (<>
        <hr className="r-hr"/>
        <div className="r-bold">ผู้ซื้อ</div>
        {order.buyer_name && <div>{order.buyer_name}</div>}
        {order.buyer_tax_id && <div className="r-sm">เลขผู้เสียภาษี {order.buyer_tax_id}</div>}
        {order.buyer_address && <div className="r-sm">{order.buyer_address}</div>}
      </>)}

      <hr className="r-hr"/>

      <div className="r-items">
        {items.map(it => {
          const net = applyDiscounts(it.unit_price, it.quantity, it.discount1_value, it.discount1_type, it.discount2_value, it.discount2_type);
          return (
            <div key={it.id} className="r-item">
              <div className="r-name">{it.product_name}</div>
              <div className="r-line">
                <span>{it.quantity} × {fmtTHB(it.unit_price)}
                  {it.discount1_value ? ` −${it.discount1_value}${it.discount1_type==='percent'?'%':'฿'}` : ''}
                  {it.discount2_value ? ` −${it.discount2_value}${it.discount2_type==='percent'?'%':'฿'}` : ''}
                </span>
                <span>{fmtTHB(net)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <hr className="r-hr"/>

      <div className="r-totals">
        <div className="r-row"><span>รวมก่อนลด</span><span>{fmtTHB(order.subtotal)}</span></div>
        {Number(order.discount_value)>0 && (
          <div className="r-row"><span>ส่วนลดบิล</span><span>−{order.discount_value}{order.discount_type==='percent'?'%':'฿'}</span></div>
        )}
        {Number(order.vat_amount)>0 && (<>
          <div className="r-row"><span>ก่อนหัก VAT {order.vat_rate}%</span><span>{fmtTHB(exVat)}</span></div>
          <div className="r-row"><span>VAT {order.vat_rate}%</span><span>{fmtTHB(order.vat_amount)}</span></div>
        </>)}
        <hr className="r-double"/>
        <div className="r-row r-grand"><span>รวมทั้งสิ้น</span><span>{fmtTHB(order.grand_total)}</span></div>
      </div>

      {order.notes && (<>
        <hr className="r-hr"/>
        <div className="r-sm"><span className="r-bold">หมายเหตุ:</span> {order.notes}</div>
      </>)}

      <hr className="r-hr"/>
      <div className="r-center r-sm" style={{fontWeight:600}}>กรณี คืน/เคลมสินค้า</div>
      <div className="r-center r-sm">กรุณาแนบใบเสร็จกลับมาด้วยค่ะ</div>

      <hr className="r-hr"/>
      <div className="r-center r-footer">{shop?.receipt_footer || 'ขอบคุณที่ใช้บริการ'}</div>
      <div className="r-center r-xs" style={{marginTop: '3mm', opacity: 0.55}}>พิมพ์ {fmtDateTime(new Date().toISOString())}</div>
    </div>
  );
}

/* =========================================================
   RECEIPT MODAL — preview + print
========================================================= */
function ReceiptModal({ open, onClose, orderId }) {
  const { shop } = useShop();
  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [variant, setVariant] = useState('receipt');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !orderId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [oRes, iRes] = await Promise.all([
        sb.from('sale_orders').select('*').eq('id', orderId).single(),
        sb.from('sale_order_items').select('*').eq('sale_order_id', orderId).order('id'),
      ]);
      if (!cancelled) {
        setOrder(oRes.data);
        setItems(iRes.data || []);
        setVariant(oRes.data?.tax_invoice_no ? 'tax_invoice' : 'receipt');
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, orderId]);

  const canTaxInvoice = !!(order?.tax_invoice_no || order?.buyer_name);

  return (
    <Modal open={open} onClose={onClose} title="พิมพ์ใบเสร็จ"
      footer={<>
        <button className="btn-secondary" onClick={onClose}>ปิด</button>
        <button className="btn-primary" onClick={()=>window.print()} disabled={!order}>
          <Icon name="receipt" size={16}/> พิมพ์
        </button>
      </>}>
      {loading && <div className="p-6 text-muted text-sm flex items-center gap-2"><span className="spinner"/>กำลังโหลด...</div>}
      {!loading && order && (
        <div>
          {canTaxInvoice && (
            <div className="flex gap-2 mb-3">
              <button type="button" onClick={()=>setVariant('receipt')}
                className={"flex-1 py-2 px-3 rounded-md text-sm font-medium border transition " + (variant==='receipt' ? "bg-primary text-on-primary border-primary" : "bg-white text-muted border-hairline hover:text-ink")}>
                ใบเสร็จรับเงิน
              </button>
              <button type="button" onClick={()=>setVariant('tax_invoice')}
                className={"flex-1 py-2 px-3 rounded-md text-sm font-medium border transition " + (variant==='tax_invoice' ? "bg-primary text-on-primary border-primary" : "bg-white text-muted border-hairline hover:text-ink")}>
                ใบกำกับภาษี
              </button>
            </div>
          )}
          <div className="bg-surface-soft p-3 rounded-lg overflow-auto">
            <div className="mx-auto" style={{width:'100mm'}}>
              <Receipt order={order} items={items} shop={shop} variant={variant}/>
            </div>
          </div>
          <div className="text-xs text-muted-soft mt-2 text-center">ตัวอย่าง — กด "พิมพ์" เพื่อส่งไปเครื่องพิมพ์สติ๊กเกอร์ความร้อน 100มม.</div>
        </div>
      )}
    </Modal>
  );
}

/* =========================================================
   MOVEMENT HISTORY — list + detail/edit/void
   kind: 'receive' | 'claim' | 'return'
========================================================= */
const MOVEMENT_META = {
  receive: {
    title: 'ประวัติรับเข้า',
    table: 'receive_orders',
    itemTable: 'receive_order_items',
    itemFk: 'receive_order_id',
    dateField: 'receive_date',
    voidRpc: 'void_receive_order',
    showSupplier: true,
    showInvoice: true,
    showVat: true,
  },
  claim: {
    title: 'ประวัติส่งเคลม / คืนบริษัท',
    table: 'supplier_claim_orders',
    itemTable: 'supplier_claim_order_items',
    itemFk: 'supplier_claim_order_id',
    dateField: 'claim_date',
    voidRpc: 'void_supplier_claim',
    showSupplier: true,
    showInvoice: true,
    showClaimReason: true,
    showVat: true,
  },
  return: {
    title: 'ประวัติรับคืนจากลูกค้า',
    table: 'return_orders',
    itemTable: 'return_order_items',
    itemFk: 'return_order_id',
    dateField: 'return_date',
    voidRpc: 'void_return_order',
    showChannel: true,
    showOrigSale: true,
    showReturnReason: true,
  },
};

function MovementHistoryModal({ open, onClose, kind }) {
  const meta = MOVEMENT_META[kind];
  const toast = useToast();
  const [range, setRange] = useState(() => {
    const today = new Date();
    const ago = new Date(today); ago.setDate(today.getDate() - 30);
    return { from: dateISOBangkok(ago), to: dateISOBangkok(today) };
  });
  const [excludeVoided, setExcludeVoided] = useState(true);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      let q = sb.from(meta.table).select('*')
        .gte(meta.dateField, startOfDayBangkok(range.from))
        .lte(meta.dateField, endOfDayBangkok(range.to))
        .order(meta.dateField, { ascending: false });
      if (excludeVoided) q = q.is('voided_at', null);
      const { data, error } = await q;
      if (!cancel) {
        if (error) toast.push("โหลดไม่ได้: " + mapError(error), 'error');
        setRows(data || []); setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [open, range.from, range.to, excludeVoided, kind, reloadKey]);

  const refresh = useCallback(() => setReloadKey(k => k+1), []);

  return (
    <Modal open={open} onClose={onClose} wide title={meta.title}
      footer={<button className="btn-secondary" onClick={onClose}>ปิด</button>}>
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <label className="text-xs uppercase tracking-wider text-muted">ช่วงเวลา</label>
            <DatePicker mode="range" value={range} onChange={setRange} className="mt-1"/>
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none pb-2">
            <span className={"relative flex items-center justify-center w-5 h-5 rounded border transition-colors " + (excludeVoided?"bg-primary border-primary":"bg-white border-hairline")}>
              <input type="checkbox" className="sr-only" checked={excludeVoided} onChange={e=>setExcludeVoided(e.target.checked)} />
              {excludeVoided && <Icon name="check" size={13} className="text-white" strokeWidth={2.5}/>}
            </span>
            <span className="text-sm">ไม่รวมที่ยกเลิก</span>
          </label>
        </div>

        {loading && <div className="p-6 text-muted text-sm flex items-center gap-2"><span className="spinner"/>กำลังโหลด...</div>}
        {!loading && !rows.length && (
          <div className="p-8 text-center text-muted text-sm card-canvas">
            <Icon name="receipt" size={28} className="mx-auto mb-2 text-muted-soft"/>
            ไม่มีรายการในช่วงเวลานี้
          </div>
        )}
        {!loading && rows.length > 0 && (
          <div className="card-canvas overflow-hidden">
            {rows.map(r => {
              const voided = !!r.voided_at;
              const date = r[meta.dateField];
              const refLabel = meta.showSupplier ? (r.supplier_name || '—')
                             : meta.showChannel  ? (CHANNEL_LABELS[r.channel] || r.channel || '—')
                             : '—';
              return (
                <div key={r.id}
                  className={"px-4 py-3 border-b hairline last:border-0 hover:bg-white/40 cursor-pointer flex items-center gap-3 transition-colors " + (voided ? "opacity-60" : "")}
                  onClick={()=>setDetailId(r.id)}>
                  <div className="flex-shrink-0 font-mono text-xs text-muted-soft w-16">#{r.id}</div>
                  <div className="min-w-0 flex-1">
                    <div className={"font-medium text-sm truncate " + (voided?"line-through":"")}>{refLabel}</div>
                    <div className="text-xs text-muted">{fmtThaiDateShort(date)}{r.supplier_invoice_no ? ` · ${r.supplier_invoice_no}` : ''}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={"font-medium tabular-nums text-sm " + (voided?"line-through text-muted":"")}>{fmtTHB(r.total_value)}</div>
                    {voided && <span className="badge-pill !bg-error/10 !text-error mt-0.5">ยกเลิก</span>}
                  </div>
                  <Icon name="chevron-r" size={16} className="text-muted-soft flex-shrink-0"/>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <MovementDetailModal kind={kind} orderId={detailId}
        onClose={()=>setDetailId(null)} onChanged={refresh}/>
    </Modal>
  );
}

function MovementDetailModal({ kind, orderId, onClose, onChanged }) {
  const meta = MOVEMENT_META[kind];
  const toast = useToast();
  const askConfirm = useConfirm();
  const askPrompt = usePrompt();
  const isAdmin = useIsAdmin();
  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const voidLockRef = useRef(false);

  useEffect(() => {
    if (!orderId) { setOrder(null); setItems([]); setEditing(false); return; }
    let cancel = false;
    (async () => {
      setLoading(true);
      const [oRes, iRes] = await Promise.all([
        sb.from(meta.table).select('*').eq('id', orderId).single(),
        sb.from(meta.itemTable).select('*').eq(meta.itemFk, orderId).order('id'),
      ]);
      if (!cancel) {
        setOrder(oRes.data); setItems(iRes.data || []);
        setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [orderId, kind]);

  const startEdit = () => {
    setDraft({ ...order });
    setEditing(true);
  };
  const cancelEdit = () => { setEditing(false); setDraft(null); };
  const saveEdit = async () => {
    setBusy(true);
    const patch = { notes: draft.notes?.trim() || null };
    patch[meta.dateField] = draft[meta.dateField];
    if (meta.showSupplier)     patch.supplier_name = draft.supplier_name?.trim() || null;
    if (meta.showInvoice)      patch.supplier_invoice_no = draft.supplier_invoice_no?.trim() || null;
    if (meta.showClaimReason)  patch.claim_reason = draft.claim_reason || null;
    if (meta.showChannel)      patch.channel = draft.channel || 'store';
    if (meta.showReturnReason) patch.return_reason = draft.return_reason || null;
    if (meta.showOrigSale) {
      const sid = parseInt(draft.original_sale_order_id, 10);
      patch.original_sale_order_id = Number.isFinite(sid) && sid>0 ? sid : null;
    }
    const { error } = await sb.from(meta.table).update(patch).eq('id', order.id);
    setBusy(false);
    if (error) { toast.push("บันทึกไม่ได้: " + mapError(error), 'error'); return; }
    toast.push("แก้ไขแล้ว", 'success');
    setOrder({ ...order, ...patch });
    setEditing(false);
    onChanged?.();
  };

  const voidIt = async () => {
    if (voidLockRef.current) return; // hard guard against double-click
    const reason = await askPrompt({
      title: "ยกเลิกรายการนี้",
      label: "เหตุผล (ไม่บังคับ)",
      defaultValue: "",
      multiline: true,
      okLabel: "ถัดไป",
      danger: true,
    });
    if (reason === null) return;
    const ok = await askConfirm({
      title: "ยืนยันการยกเลิก",
      message: "สต็อกจะถูกปรับกลับให้สอดคล้องอัตโนมัติ — ดำเนินการต่อ?",
      okLabel: "ยกเลิกรายการ",
      danger: true,
    });
    if (!ok) return;
    voidLockRef.current = true;
    setBusy(true);
    try {
      const { error } = await sb.rpc(meta.voidRpc, { p_id: order.id, p_reason: reason || null });
      if (error) { toast.push("ยกเลิกไม่ได้: " + mapError(error), 'error'); return; }
      toast.push("ยกเลิกแล้ว · สต็อกถูกปรับกลับ", 'success');
      setOrder({ ...order, voided_at: new Date().toISOString(), void_reason: reason || null });
      onChanged?.();
    } finally { setBusy(false); voidLockRef.current = false; }
  };

  const dateInput = editing ? draft[meta.dateField]?.slice(0,10) : null;
  const isVoided = !!order?.voided_at;

  return (
    <Modal open={!!orderId} onClose={onClose} wide
      title={order ? `${meta.title.replace('ประวัติ','')} #${order.id}${isVoided?' · ยกเลิกแล้ว':''}` : ""}
      footer={<>
        {order && !isVoided && !editing && isAdmin && (<>
          <button className="btn-secondary !text-error hover:!bg-error/10" onClick={voidIt} disabled={busy}>
            <Icon name="trash" size={16}/> ยกเลิกบิลนี้
          </button>
          <button
            className="btn-secondary" onClick={startEdit} disabled={busy}
            title="แก้ไขได้เฉพาะข้อมูลส่วนหัว (ไม่รวมรายการสินค้า) — ถ้าต้องแก้รายการ ให้ยกเลิกบิลแล้วทำใหม่"
          >
            <Icon name="edit" size={16}/> แก้ไข header
          </button>
        </>)}
        {editing && (<>
          <button className="btn-secondary" onClick={cancelEdit} disabled={busy}>ยกเลิก</button>
          <button className="btn-primary" onClick={saveEdit} disabled={busy}>
            {busy ? <span className="spinner"/> : <Icon name="check" size={16}/>} บันทึก
          </button>
        </>)}
        {!editing && <button className="btn-secondary" onClick={onClose}>ปิด</button>}
      </>}>
      {loading && <div className="p-6 text-muted text-sm flex items-center gap-2"><span className="spinner"/>กำลังโหลด...</div>}
      {!loading && order && (
        <div className="space-y-4">
          {isVoided && (
            <div className="p-3 rounded-md bg-error/10 text-error text-sm flex items-start gap-2">
              <Icon name="alert" size={16} className="mt-0.5 flex-shrink-0"/>
              <div>
                <div className="font-medium">บิลนี้ถูกยกเลิกแล้ว</div>
                <div className="text-xs mt-1">{fmtDateTime(order.voided_at)}{order.void_reason? ` · ${order.void_reason}`:''}</div>
              </div>
            </div>
          )}

          {/* Header fields — read or edit */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-wider text-muted">วันที่</label>
              {editing ? (
                <DatePicker mode="single" value={dateInput} onChange={(v)=>setDraft(d=>({...d,[meta.dateField]: startOfDayBangkok(v)}))} className="mt-1"/>
              ) : (
                <div className="mt-1 text-sm">{fmtThaiDateShort(order[meta.dateField])}</div>
              )}
            </div>
            {meta.showChannel && (
              <div>
                <label className="text-xs uppercase tracking-wider text-muted">ช่องทาง</label>
                {editing ? (
                  <select className="input mt-1" value={draft.channel||'store'} onChange={e=>setDraft(d=>({...d, channel: e.target.value}))}>
                    {CHANNELS.map(c=><option key={c.v} value={c.v}>{c.label}</option>)}
                  </select>
                ) : (
                  <div className="mt-1 text-sm">{CHANNEL_LABELS[order.channel]||'—'}</div>
                )}
              </div>
            )}
            {meta.showSupplier && (
              <div className="sm:col-span-2">
                <label className="text-xs uppercase tracking-wider text-muted">{kind==='receive'?'ผู้ขาย / Supplier':'บริษัทที่ส่งคืน'}</label>
                {editing ? (
                  <div className="flex gap-2 mt-1.5 flex-wrap">
                    {SUPPLIERS.map(s => (
                      <button key={s} type="button" onClick={()=>setDraft(d=>({...d, supplier_name: s}))}
                        className={"py-2 px-3 rounded-lg text-sm font-medium border transition " + (draft.supplier_name===s ? "bg-primary text-on-primary border-primary" : "bg-white text-ink border-hairline hover:bg-white/80")}>
                        {s}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="mt-1 text-sm">{order.supplier_name||'—'}</div>
                )}
              </div>
            )}
            {meta.showInvoice && (
              <div className="sm:col-span-2">
                <label className="text-xs uppercase tracking-wider text-muted">{kind==='receive'?'เลขบิล':'เลขเอกสาร / Tracking'}</label>
                {editing ? (
                  <input className="input mt-1 font-mono" value={draft.supplier_invoice_no||""} onChange={e=>setDraft(d=>({...d, supplier_invoice_no: e.target.value}))} />
                ) : (
                  <div className="mt-1 text-sm font-mono">{order.supplier_invoice_no||'—'}</div>
                )}
              </div>
            )}
            {meta.showClaimReason && (
              <div className="sm:col-span-2">
                <label className="text-xs uppercase tracking-wider text-muted">เหตุผลที่ส่งคืน</label>
                {editing ? (
                  <select className="input mt-1" value={draft.claim_reason||""} onChange={e=>setDraft(d=>({...d, claim_reason: e.target.value}))}>
                    <option value="">— เลือก —</option>
                    {CLAIM_REASONS.map(r=><option key={r} value={r}>{r}</option>)}
                  </select>
                ) : (
                  <div className="mt-1 text-sm">{order.claim_reason||'—'}</div>
                )}
              </div>
            )}
            {meta.showOrigSale && (
              <div>
                <label className="text-xs uppercase tracking-wider text-muted">บิลขายต้นฉบับ</label>
                {editing ? (
                  <input className="input mt-1 font-mono" inputMode="numeric" value={draft.original_sale_order_id||""} onChange={e=>setDraft(d=>({...d, original_sale_order_id: e.target.value.replace(/\D/g,'')}))} />
                ) : (
                  <div className="mt-1 text-sm font-mono">{order.original_sale_order_id||'—'}</div>
                )}
              </div>
            )}
            {meta.showReturnReason && (
              <div>
                <label className="text-xs uppercase tracking-wider text-muted">เหตุผลที่คืน</label>
                {editing ? (
                  <select className="input mt-1" value={draft.return_reason||""} onChange={e=>setDraft(d=>({...d, return_reason: e.target.value}))}>
                    <option value="">— เลือก —</option>
                    {RETURN_REASONS.map(r=><option key={r} value={r}>{r}</option>)}
                  </select>
                ) : (
                  <div className="mt-1 text-sm">{order.return_reason||'—'}</div>
                )}
              </div>
            )}
            <div className="sm:col-span-2">
              <label className="text-xs uppercase tracking-wider text-muted">หมายเหตุ</label>
              {editing ? (
                <textarea className="input mt-1" rows="2" value={draft.notes||""} onChange={e=>setDraft(d=>({...d, notes: e.target.value}))}/>
              ) : (
                <div className="mt-1 text-sm whitespace-pre-wrap">{order.notes||'—'}</div>
              )}
            </div>
          </div>

          {editing && (
            <div className="text-xs text-muted-soft p-3 bg-surface-soft rounded-md">
              หมายเหตุ: แก้ได้เฉพาะข้อมูลส่วนหัว — ถ้าต้องแก้รายการสินค้า/จำนวน ให้กดยกเลิกบิลนี้แล้วบันทึกใหม่
            </div>
          )}

          {/* Items (read-only) */}
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <div className="text-xs uppercase tracking-wider text-muted">รายการสินค้า ({items.length})</div>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/15 text-muted-soft font-medium"
                title="แก้ไขรายการ/จำนวนไม่ได้ — ต้องยกเลิกบิลแล้วทำใหม่"
              >
                แก้ไขไม่ได้
              </span>
            </div>
            <div className="card-canvas overflow-hidden">
              {items.map(it => (
                <div key={it.id} className="px-4 py-2.5 border-b hairline last:border-0 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{it.product_name}</div>
                    <div className="text-xs text-muted">{it.quantity} {it.unit} × {fmtTHB(it.unit_price)}</div>
                  </div>
                  <div className="text-sm font-medium tabular-nums flex-shrink-0">
                    {fmtTHB(applyDiscounts(it.unit_price, it.quantity, it.discount1_value, it.discount1_type, it.discount2_value, it.discount2_type))}
                  </div>
                </div>
              ))}
              <div className="px-4 py-3 bg-surface-cream-strong flex justify-between font-medium">
                <span>รวม</span>
                <span className="tabular-nums">{fmtTHB(order.total_value)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState(() => localStorage.getItem(LAST_EMAIL_KEY) || "");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(() => localStorage.getItem(REMEMBER_KEY) !== "false");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    // Persist remember-me flag BEFORE signing in so authStorage routes tokens correctly
    localStorage.setItem(REMEMBER_KEY, remember ? "true" : "false");
    if (remember) localStorage.setItem(LAST_EMAIL_KEY, email);
    else          localStorage.removeItem(LAST_EMAIL_KEY);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setErr(mapError(error));
  };
  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-5">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center gap-3 mb-8 lg:mb-10">
          <img src="icons/logo_web3_512.png" alt="TIMES logo" style={{width:49,height:49,objectFit:'contain'}} />
          <div style={{fontFamily:"'Jost', sans-serif", fontWeight:600}} className="text-3xl lg:text-4xl leading-none">TIMES</div>
        </div>
        <div className="card-canvas p-6 lg:p-8">
          <div className="text-xs uppercase tracking-[1.5px] text-muted font-medium">POS · ร้านนาฬิกา</div>
          <h1 className="font-display text-4xl lg:text-5xl mt-2 mb-6 text-ink">เข้าสู่ระบบ</h1>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-xs uppercase tracking-wider text-muted font-medium">อีเมล</label>
              <input type="email" autoFocus inputMode="email" autoComplete="email" className="input mt-1" value={email} onChange={e=>setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-muted font-medium">รหัสผ่าน</label>
              <input type="password" autoComplete="current-password" className="input mt-1" value={password} onChange={e=>setPassword(e.target.value)} required />
            </div>

            <label className="flex items-center gap-3 cursor-pointer select-none py-1">
              <span className={"relative flex items-center justify-center w-5 h-5 rounded border transition-colors " + (remember?"bg-primary border-primary":"bg-white border-hairline hover:border-muted")}>
                <input type="checkbox" className="sr-only" checked={remember} onChange={e=>setRemember(e.target.checked)} />
                {remember && <Icon name="check" size={14} className="text-white" strokeWidth={2.5}/>}
              </span>
              <span className="text-sm text-ink">จดจำการเข้าสู่ระบบ</span>
              <span className="text-xs text-muted-soft ml-auto">{remember? "ค้างไว้":"ออกเมื่อปิดเบราว์เซอร์"}</span>
            </label>

            {err && <div className="text-sm text-error bg-error/10 px-3 py-2 rounded-md flex items-center gap-2"><Icon name="alert" size={16}/>{err}</div>}
            <button className="btn-primary w-full !py-3" disabled={busy}>
              {busy ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
            </button>
          </form>
        </div>
        <div className="text-center text-sm text-muted-soft mt-6 font-italic">"ทุกเรือนมีเรื่องราว"</div>
      </div>
    </div>
  );
}

/* =========================================================
   ROLE / RBAC
   - Source of truth: auth.users.raw_app_meta_data->>'app_role' (set by admin only)
   - 'admin' = full access; anything else (incl. unset) defaults to 'cashier'.
   - DB enforces this via RLS (see supabase-migrations/005_user_roles.sql).
   - Client uses it ONLY to hide menus/buttons. Never trust the client gate alone.
========================================================= */
const getUserRole = (session) =>
  session?.user?.app_metadata?.app_role === 'admin' ? 'admin' : 'cashier';

const RoleCtx = React.createContext('cashier');
const useRole = () => React.useContext(RoleCtx);
const useIsAdmin = () => useRole() === 'admin';

/* =========================================================
   NAV CONFIG
   - `adminOnly` views are hidden from cashiers (P&L exposes cost/profit).
========================================================= */
const NAV = [
  { k: "pos",       label: "ขาย",        labelLong: "ขายสินค้า",          icon: "cart" },
  { k: "products",  label: "สินค้า",      labelLong: "สินค้า",              icon: "box" },
  { k: "sales",     label: "ประวัติ",     labelLong: "ประวัติการขาย",       icon: "receipt" },
  { k: "receive",   label: "รับเข้า",     labelLong: "รับสินค้าจากบริษัท",  icon: "arrow-up",  adminOnly: true },
  { k: "return",    label: "รับคืน",      labelLong: "รับคืนจากลูกค้า",     icon: "arrow-down" },
  { k: "dashboard", label: "ภาพรวม",     labelLong: "แดชบอร์ด",           icon: "dashboard", adminOnly: true },
  { k: "pnl",       label: "กำไร",       labelLong: "กำไร / ขาดทุน",       icon: "trend-up",  adminOnly: true },
];
const navForRole = (role) => NAV.filter(it => !it.adminOnly || role === 'admin');

const SUPPLIERS = ["CMG", "SEIKO TH", "ถ่าน", "สาย"];
const CLAIM_REASONS = ["ชำรุดจากโรงงาน", "ส่งผิดรุ่น", "ส่งผิดจำนวน", "ขายไม่ได้/คืนสต็อก", "อื่นๆ"];

/* =========================================================
   DESKTOP SIDEBAR
========================================================= */
function Sidebar({ view, setView, userEmail, onOpenSettings }) {
  const role = useRole();
  const items = navForRole(role);
  return (
    <aside className="sidebar hidden lg:flex w-64 flex-col">
      <div className="sidebar-header px-6 py-6 flex items-center gap-3 border-b">
        <img src="icons/logo_web3_512.png" alt="TIMES logo" style={{width:41,height:41,objectFit:'contain'}} />
        <div style={{fontFamily:"'Jost', sans-serif", fontWeight:600, color:'#faf9f5'}} className="text-2xl leading-none self-center">TIMES</div>
      </div>
      <nav className="p-3 flex-1 overflow-y-auto" aria-label="เมนูหลัก">
        {items.map(it => (
          <button
            key={it.k}
            type="button"
            className={"nav-item w-full text-left bg-transparent " + (view===it.k?"active":"")}
            onClick={()=>setView(it.k)}
            aria-current={view===it.k ? 'page' : undefined}
          >
            <Icon name={it.icon} size={18}/>
            <span>{it.labelLong}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer p-4 border-t space-y-2">
        {role === 'admin' && (
          <button className="btn-settings-sidebar" onClick={onOpenSettings}>
            <Icon name="edit" size={16}/> ตั้งค่าบิล
          </button>
        )}
        <div className="sidebar-email text-xs truncate pt-1">
          {userEmail} {role === 'admin' && <span className="text-primary">· admin</span>}
        </div>
        <button className="btn-danger-sidebar" onClick={()=>sb.auth.signOut()}>
          <Icon name="logout" size={16}/> ออกจากระบบ
        </button>
      </div>
    </aside>
  );
}

/* =========================================================
   MOBILE TOP BAR + BOTTOM TABS
========================================================= */
function MobileTopBar({ title, userEmail, onLogout, onOpenSettings }) {
  const [openMenu, setOpenMenu] = useState(false);
  const role = useRole();
  const { render: drawerRender, closing: drawerClosing } = useMountedToggle(openMenu, 220);
  return (
    <>
    <header className="lg:hidden sticky top-0 z-40 mobile-topbar pt-safe">
      <div className="flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-2">
          <img src="icons/logo_web3_512.png" alt="TIMES logo" style={{width:32,height:32,objectFit:'contain'}} />
          <div style={{fontFamily:"'Jost', sans-serif", fontWeight:600}} className="text-xl leading-none self-center">TIMES</div>
          <div className="text-muted-soft mx-1">·</div>
          <div className="text-sm text-muted">{title}</div>
        </div>
        <button className="btn-ghost !p-2" onClick={()=>setOpenMenu(true)} aria-label="menu">
          <Icon name="menu" size={22}/>
        </button>
      </div>
    </header>
    {drawerRender && (
      <div className={"lg:hidden fixed inset-0 z-[110] modal-overlay " + (drawerClosing?"overlay-out":"overlay-in")} onClick={()=>setOpenMenu(false)}>
        <div className={"absolute right-0 top-0 bottom-0 w-72 bg-canvas shadow-xl pt-safe " + (drawerClosing?"drawer-out":"drawer-in")} onClick={e=>e.stopPropagation()}>
          <div className="px-5 py-4 border-b hairline flex items-center justify-between">
            <div className="font-display text-xl">เมนู</div>
            <button className="btn-ghost !p-2" onClick={()=>setOpenMenu(false)} aria-label="ปิดเมนู"><Icon name="x" size={20}/></button>
          </div>
          <div className="p-4 space-y-3">
            {role === 'admin' && (
              <button className="btn-secondary w-full" onClick={()=>{ onOpenSettings?.(); }}>
                <Icon name="edit" size={16}/> ตั้งค่าร้าน
              </button>
            )}
            <div>
              <div className="text-xs uppercase tracking-wider text-muted mb-2">บัญชี</div>
              <div className="text-sm text-ink truncate mb-3">
                {userEmail} {role === 'admin' && <span className="text-primary">· admin</span>}
              </div>
              <button className="btn-secondary w-full" onClick={onLogout}>
                <Icon name="logout" size={16}/> ออกจากระบบ
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// Phase 5 redesign: floating pill bar with a center FAB ("ขาย").
// - All other tabs sit in two halves around the FAB notch (admin: 3-FAB-3,
//   cashier: 2-FAB-1) so every menu remains visible without an overflow sheet.
// - FAB doubles as an offline-queue indicator: a red badge with the pending
//   sale count appears whenever `onQueueChange` reports >0 queued items.
function MobileTabBar({ view, setView }) {
  const role = useRole();
  const all = navForRole(role);
  // Pull POS out — it becomes the FAB. Everything else fills the bar halves.
  const posItem = all.find(it => it.k === 'pos');
  const others  = all.filter(it => it.k !== 'pos');
  // Split: balance left vs right (right takes the larger half if odd).
  const leftCount = Math.floor(others.length / 2);
  const left  = others.slice(0, leftCount);
  const right = others.slice(leftCount);

  // Subscribe to queue length so the FAB badge stays accurate while the cashier
  // navigates around. `onQueueChange` fires once with the baseline on subscribe.
  const [queued, setQueued] = useState(0);
  useEffect(() => {
    const off = onQueueChange?.(setQueued);
    return () => off?.();
  }, []);

  const renderTab = (it) => (
    <button
      key={it.k}
      className={"tab-btn pressable " + (view===it.k ? "active" : "")}
      onClick={()=>setView(it.k)}
      aria-label={it.label}
      aria-current={view===it.k ? "page" : undefined}
      title={it.label}
    >
      <Icon name={it.icon} size={20} strokeWidth={view===it.k?2.2:1.8}/>
      <span className="tab-label">{it.label}</span>
    </button>
  );

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 pb-safe mobile-tabbar-wrap" role="navigation" aria-label="หลัก">
      <div className="mobile-tabbar">
        {left.map(renderTab)}
        {posItem && (
          <button
            className={"mobile-fab " + (view==='pos' ? "active " : "") + (queued>0 ? "has-queue" : "")}
            onClick={()=>setView('pos')}
            aria-label={posItem.labelLong || posItem.label}
            aria-current={view==='pos' ? "page" : undefined}
            title={posItem.labelLong || posItem.label}
          >
            <Icon name="cart" size={28} strokeWidth={2.4}/>
            {queued > 0 && (
              <span className="fab-badge" aria-label={`มี ${queued} บิลรอ sync`}>{queued > 99 ? '99+' : queued}</span>
            )}
          </button>
        )}
        {right.map(renderTab)}
      </div>
    </nav>
  );
}

/* =========================================================
   PAGE HEADER (desktop)
========================================================= */
function PageHeader({ title, subtitle, right }) {
  return (
    <header className="hidden lg:flex px-10 pt-10 pb-6 items-end justify-between border-b hairline">
      <div>
        <div className="text-xs uppercase tracking-[1.5px] text-muted">{subtitle}</div>
        <h1 className="font-display text-5xl mt-2 leading-tight text-ink">{title}</h1>
      </div>
      <div>{right}</div>
    </header>
  );
}

/* =========================================================
   POS VIEW
========================================================= */
function POSView() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState([]);
  const [channel, setChannel] = useState("tiktok");
  const [payment, setPayment] = useState("transfer");
  const [netPrice, setNetPrice] = useState("");
  // Money the shop actually receives from the platform (e-commerce only).
  // Empty string = not entered yet; gets fallback to grand_total in P&L.
  const [netReceived, setNetReceived] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const { render: cartSheetRender, closing: cartSheetClosing } = useMountedToggle(cartOpen, 220);
  // Mobile cart redesign: bill details (channel/payment/prices/tax/notes/VAT)
  // are collapsed by default so the items list owns the visible area.
  // Auto-expanded by `flagMissing` when the user attempts checkout with
  // missing fields. Desktop ignores this flag entirely.
  const [billExpanded, setBillExpanded] = useState(false);
  const [expandedDisc, setExpandedDisc] = useState({});
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [taxInvoice, setTaxInvoice] = useState(false);
  const [buyer, setBuyer] = useState({ name: "", taxId: "", address: "", invoiceNo: "" });
  const [receiptOrderId, setReceiptOrderId] = useState(null); // shows ReceiptModal after sale
  const searchRef = useRef(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const submitLockRef = useRef(false); // prevents double-submit even if React hasn't re-rendered yet
  const netPriceRef = useRef(null);
  const netReceivedRef = useRef(null);
  const buyerNameRef = useRef(null);
  // Set to true when user attempts to submit while form invalid — drives
  // the field-error-glow on missing required fields. Auto-clears below.
  const [showErrors, setShowErrors] = useState(false);
  // Phase 4.6: brief shake animation on the checkout panel when validation fails.
  const [shaking, setShaking] = useState(false);
  // Modal for tax-invoice details (replaces the previous inline form
  // that bloated the checkout panel).
  const [taxInvoiceModalOpen, setTaxInvoiceModalOpen] = useState(false);
  // Refs for the swipe-down-to-close gesture on the mobile cart sheet.
  const sheetRef = useRef(null);
  const sheetDragStartY = useRef(null);
  const sheetDragOffset = useRef(0);
  const onSheetDragStart = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    sheetDragStartY.current = e.clientY;
    sheetDragOffset.current = 0;
    if (sheetRef.current) sheetRef.current.style.transition = 'none';
  };
  const onSheetDragMove = (e) => {
    if (sheetDragStartY.current == null) return;
    const dy = Math.max(0, e.clientY - sheetDragStartY.current);
    sheetDragOffset.current = dy;
    if (sheetRef.current) sheetRef.current.style.transform = `translateY(${dy}px)`;
  };
  const onSheetDragEnd = () => {
    if (sheetDragStartY.current == null) return;
    sheetDragStartY.current = null;
    const shouldClose = sheetDragOffset.current > 80;
    sheetDragOffset.current = 0;
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'transform 200ms ease-out';
      sheetRef.current.style.transform = 'translateY(0)';
    }
    if (shouldClose) setCartOpen(false);
  };

  useEffect(() => {
    if (!search.trim()) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      const q = search.trim();
      const { data: barcodeHit } = await sb.from('products').select('*').eq('barcode', q).limit(1);
      let rows = [];
      if (barcodeHit && barcodeHit.length) {
        if (!cancelled) { addToCart(barcodeHit[0]); setSearch(''); setSearching(false); }
        return;
      }
      const { data, error } = await sb.from('products').select('*').ilike('name', `%${q}%`).limit(20);
      if (!error) rows = data || [];
      rows.sort((a,b) => (Number(b.current_stock)||0) - (Number(a.current_stock)||0));
      if (!cancelled) { setResults(rows); setSearching(false); }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search]);

  const addToCart = (p) => {
    const stock = Number(p.current_stock) || 0;
    if (stock <= 0) { toast.push(`"${p.name}" หมดสต็อก ไม่สามารถขายได้`, "error"); return; }
    setCart(c => {
      const i = c.findIndex(x => x.product_id === p.id);
      if (i >= 0) {
        if (c[i].quantity >= stock) { toast.push(`เพิ่มไม่ได้ — เกินสต็อก (${stock} ชิ้น)`, "error"); return c; }
        const n = [...c]; n[i] = { ...n[i], quantity: n[i].quantity + 1 }; return n;
      }
      return [...c, {
        product_id: p.id, product_name: p.name, barcode: p.barcode,
        quantity: 1, unit_price: Number(p.retail_price)||0,
        discount1_value: 0, discount1_type: null,
        discount2_value: 0, discount2_type: null,
        current_stock: stock,
      }];
    });
    searchRef.current?.focus();
  };
  // Camera scanner — looks up by barcode and adds to cart on hit.
  // Returns true on confirmed success / false on miss or error so
  // `BarcodeScannerModal` only locks + plays feedback on real hits.
  // Stale-frame re-fires (camera still aimed at the just-scanned item when
  // the user reopens the modal) are handled inside the modal via lockedRef.
  const handleCameraScan = async (code) => {
    try {
      const { data } = await sb.from('products').select('*').eq('barcode', code).limit(1);
      if (data && data.length) {
        addToCart(data[0]);
        setScannerOpen(false);
        return true;
      }
      playScanError(); vibrateError();
      toast.push(`ไม่พบสินค้าบาร์โค้ด ${code}`, 'error');
      return false;
    } catch {
      playScanError(); vibrateError();
      toast.push('สแกนไม่สำเร็จ', 'error');
      return false;
    }
  };

  const updateLine = (idx, patch) => setCart(c => c.map((l,i)=> i===idx?{...l,...patch}:l));
  const removeLine = (idx) => setCart(c => c.filter((_,i)=>i!==idx));
  const lineNet = (l) => applyDiscounts(l.unit_price, l.quantity, l.discount1_value, l.discount1_type, l.discount2_value, l.discount2_type);
  const subtotal = useMemo(()=> cart.reduce((s,l)=> s + lineNet(l), 0), [cart]);
  const netPriceNum = netPrice === "" || netPrice == null ? null : Math.max(0, Math.min(Number(netPrice)||0, subtotal));
  const grand = netPriceNum == null ? subtotal : netPriceNum;
  // Phase 4.3: animate the displayed grand from previous value → new value over 250ms
  // so jumps from ฿0 → ฿X,XXX feel intentional rather than abrupt.
  const grandTween = useNumberTween(grand, 250);
  const discountAmount = Math.max(0, subtotal - grand);
  const totalQty = useMemo(()=> cart.reduce((s,l)=> s+l.quantity, 0), [cart]);

  // Form validity — drives the submit button disabled state and the
  // submit() guard. Centralised so both stay in sync.
  const netPriceFilled = netPrice !== "" && Number(netPrice) > 0;
  const netReceivedOk  = !requiresNetReceived(channel, payment)
    || (netReceived !== "" && Number(netReceived) > 0);
  const buyerNameOk    = !taxInvoice || !!buyer.name.trim();
  const canSubmit = !submitting && cart.length > 0 && netPriceFilled && netReceivedOk && buyerNameOk;

  // Per-field error flags — only show after the user attempted to submit.
  const netPriceErr     = showErrors && !netPriceFilled;
  const netReceivedErr  = showErrors && !netReceivedOk;
  const buyerNameErr    = showErrors && !buyerNameOk;

  // Clear the error glow as soon as the form becomes valid again.
  useEffect(() => { if (canSubmit && showErrors) setShowErrors(false); }, [canSubmit, showErrors]);

  // Called when user clicks the submit button while it's disabled
  // (the wrapping div catches the click). Highlights missing fields
  // and scrolls the first one into view so they know what's wrong.
  const flagMissing = () => {
    setShowErrors(true);
    // Mobile: ensure the bill panel is open so the user can actually SEE the
    // field we're about to scroll to. Desktop is unaffected since the panel
    // there is always visible.
    setBillExpanded(true);
    // Phase 4.6: re-trigger by toggling state — `key`-based re-mount isn't worth
    // the extra plumbing here, a 280ms timeout is good enough.
    setShaking(false);
    requestAnimationFrame(() => setShaking(true));
    setTimeout(() => setShaking(false), 320);
    const first = !netPriceFilled ? netPriceRef.current
                : !netReceivedOk  ? netReceivedRef.current
                : !buyerNameOk    ? buyerNameRef.current
                : null;
    // Defer the scroll one frame so the bill panel's expand animation has
    // mounted the input into the DOM before we try to focus it.
    requestAnimationFrame(() => {
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      first?.focus?.({ preventScroll: true });
    });
  };

  const submit = async () => {
    if (submitLockRef.current) return; // hard guard against double-submit
    if (!cart.length) { toast.push("ไม่มีสินค้าในตะกร้า", "error"); return; }
    if (!netPriceFilled) { toast.push("กรุณากรอก 'ราคาที่ลูกค้าจ่าย'", "error"); return; }
    if (taxInvoice && !buyer.name.trim()) { toast.push("กรุณากรอกชื่อผู้ซื้อสำหรับใบกำกับภาษี", 'error'); return; }
    if (requiresNetReceived(channel, payment) && (netReceived === "" || Number(netReceived) <= 0)) {
      toast.push("กรุณากรอก 'เงินที่ร้านค้าได้รับ' (ช่องทาง e-commerce + ชำระทันที)", 'error');
      return;
    }
    submitLockRef.current = true;
    setSubmitting(true);
    try {
      const grandR = roundMoney(grand);
      const subtotalR = roundMoney(subtotal);
      const discountR = roundMoney(discountAmount);
      const { vat } = vatBreakdown(grandR, VAT_RATE_DEFAULT);
      const headerPayload = {
        sale_date: new Date().toISOString(), channel, payment_method: payment,
        discount_value: discountR, discount_type: discountR > 0 ? 'net' : null,
        subtotal: subtotalR, total_after_discount: grandR, grand_total: grandR,
        vat_rate: VAT_RATE_DEFAULT, vat_amount: vat, price_includes_vat: true,
        tax_invoice_no: taxInvoice ? (buyer.invoiceNo.trim() || null) : null,
        buyer_name:    taxInvoice ? (buyer.name.trim()    || null) : null,
        buyer_tax_id:  taxInvoice ? (buyer.taxId.trim()   || null) : null,
        buyer_address: taxInvoice ? (buyer.address.trim() || null) : null,
        notes: notes.trim() || null,
        // Only persist net_received for e-commerce sales — for store/facebook
        // grand_total IS the revenue, so this stays null.
        net_received: ECOMMERCE_CHANNELS.has(channel) && netReceived !== "" && Number(netReceived) > 0
          ? roundMoney(Number(netReceived))
          : null,
      };
      const itemsPayload = cart.map(l => ({
        product_id: l.product_id, product_name: l.product_name,
        quantity: l.quantity, unit_price: roundMoney(l.unit_price),
        discount1_value: roundMoney(l.discount1_value || 0), discount1_type: l.discount1_type,
        discount2_value: roundMoney(l.discount2_value || 0), discount2_type: l.discount2_type,
      }));
      const rpcArgs = { p_header: headerPayload, p_items: itemsPayload };

      // Offline path: stash the sale in IndexedDB and let the SW-aware drainer
      // send it when the network returns. We can't open a receipt (no order id
      // yet), so we just confirm it's queued.
      if (window._isOnline && !window._isOnline()) {
        await window._queueSale(rpcArgs);
        toast.push(`บันทึกในคิวออฟไลน์ · ${fmtTHB(grandR)} (จะส่งเมื่อออนไลน์)`, 'info');
      } else {
        // Atomic: header + items + adjust_stock all in one Postgres transaction.
        // See supabase-migrations/001_create_sale_order_with_items.sql.
        const { data: order, error: e1 } = await sb.rpc('create_sale_order_with_items', rpcArgs);
        if (e1) {
          // Network failure mid-call → fall back to the offline queue rather
          // than asking the user to redo the bill.
          const networkish = /Failed to fetch|NetworkError|TypeError/i.test(String(e1.message || e1));
          if (networkish && window._queueSale) {
            await window._queueSale(rpcArgs);
            toast.push(`บันทึกในคิวออฟไลน์ · ${fmtTHB(grandR)} (จะส่งเมื่อออนไลน์)`, 'info');
          } else {
            throw e1;
          }
        } else {
          toast.push(`บันทึกบิล #${order.id} · ${fmtTHB(grandR)}`, 'success');
          setReceiptOrderId(order.id);  // open receipt modal for this new bill
        }
      }

      setCart([]); setNetPrice(""); setNetReceived("");
      setChannel("tiktok"); setPayment("transfer"); setCartOpen(false);
      setNotes(""); setShowNotes(false);
      setTaxInvoice(false); setBuyer({ name: "", taxId: "", address: "", invoiceNo: "" });
    } catch (err) {
      toast.push("บันทึกไม่สำเร็จ: " + mapError(err), 'error');
    } finally { setSubmitting(false); submitLockRef.current = false; }
  };

  const SearchInput = (
    <div className="relative flex items-center gap-2">
      <div className="relative flex-1">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none text-muted z-10"><Icon name="search" size={20} strokeWidth={2.25}/></span>
        <input
          ref={searchRef}
          className="input !pl-12 !py-3 !text-base lg:!text-lg"
          placeholder="สแกนบาร์โค้ด หรือพิมพ์ชื่อรุ่น"
          value={search}
          onChange={e=>setSearch(e.target.value)}
          autoFocus
        />
        {search && <button className="absolute right-3 top-1/2 -translate-y-1/2 btn-ghost !p-2 !min-h-0" onClick={()=>{setSearch("");setResults([]);searchRef.current?.focus();}} aria-label="ล้างคำค้น"><Icon name="x" size={18}/></button>}
      </div>
      <button type="button" className="scan-inline-btn" onClick={()=>setScannerOpen(true)} aria-label="สแกนด้วยกล้อง">
        <Icon name="camera" size={20}/>
      </button>
    </div>
  );

  const ResultsList = (
    <div className="card-canvas overflow-hidden flex-1 flex flex-col min-h-0">
      {!search && (
        <div className="p-8 lg:p-12 text-center flex-shrink-0">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-surface-card text-muted mb-4">
            <Icon name="barcode" size={28}/>
          </div>
          <div className="font-display text-2xl lg:text-3xl text-ink mb-1">เริ่มสแกนสินค้า</div>
          <p className="text-muted text-sm">พิมพ์ชื่อรุ่นหรือยิงบาร์โค้ดในช่องด้านบน</p>
        </div>
      )}
      {search && searching && <div className="p-6 text-muted text-sm flex-shrink-0">กำลังค้นหา...</div>}
      {search && !searching && results.length===0 && <div className="p-6 text-muted text-sm flex-shrink-0">ไม่พบสินค้า "{search}"</div>}
      <div className="flex-1 overflow-y-auto min-h-0">
        {results.map((p, idx) => {
          const oos = (Number(p.current_stock)||0) <= 0;
          return (
          <div key={p.id}
            // Phase 4.2: stagger via --i so search results glide in instead of popping all at once.
            style={{ '--i': Math.min(idx, 12) }}
            className={"fade-in stagger px-4 lg:px-5 py-3.5 border-b hairline last:border-0 flex items-center gap-3 transition-colors " + (oos ? "opacity-60 cursor-not-allowed" : "hover:bg-white/40 cursor-pointer")}
            onClick={oos ? undefined : ()=>addToCart(p)}>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-ink truncate text-base">{p.name}</div>
              <div className="text-xs text-muted mt-0.5 font-mono truncate">{p.barcode || '— ไม่มีบาร์โค้ด —'}</div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="font-display text-xl lg:text-2xl text-ink leading-tight tabular-nums">{fmtTHB(p.retail_price)}</div>
              <div className="mt-1">
                <span className={"badge-pill " + (oos?'!bg-error/10 !text-error':p.current_stock<5?'!bg-warning/15 !text-[#8a6500]':'')}>
                  {oos ? 'หมดสต็อก' : `คงเหลือ ${p.current_stock}`}
                </span>
              </div>
            </div>
            {oos
              ? <button className="!py-2 !px-3 !min-h-[40px] rounded-md bg-hairline text-muted cursor-not-allowed flex-shrink-0 inline-flex items-center justify-center" disabled aria-label="หมดสต็อก"><Icon name="x" size={18}/></button>
              : <button className="btn-primary !py-2 !px-3 !min-h-[40px] flex-shrink-0" aria-label="เพิ่ม"><Icon name="plus" size={18}/></button>}
          </div>
          );
        })}
      </div>
    </div>
  );

  const CartContent = (close) => (
    <>
      <div className="flex-1 overflow-y-auto p-3">
        {!cart.length && (
          <div className="p-8 text-center">
            <div className="inline-flex w-12 h-12 items-center justify-center rounded-full bg-surface-card text-muted mb-3"><Icon name="cart" size={24}/></div>
            <div className="text-muted text-sm">ยังไม่มีสินค้า</div>
          </div>
        )}
        {cart.map((l, idx) => {
          const expanded = expandedDisc[idx];
          return (
            <div key={l.product_id} style={{ '--i': Math.min(idx, 8) }} className="glass-soft rounded-lg p-3 mb-2 hover-lift fade-in stagger">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{l.product_name}</div>
                  <div className="text-xs text-muted font-mono truncate">{l.barcode||''}</div>
                </div>
                <button className="text-muted-soft hover:text-error p-1" onClick={()=>removeLine(idx)} aria-label="ลบ"><Icon name="trash" size={16}/></button>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <div className="flex items-center bg-white/60 backdrop-blur rounded-lg border border-white/50 shadow-sm overflow-hidden">
                  <button className="stepper-btn rounded-l-lg text-ink" onClick={()=>updateLine(idx,{quantity:Math.max(1,l.quantity-1)})}><Icon name="minus" size={16}/></button>
                  <input type="number" min="1" max={l.current_stock||undefined} inputMode="numeric" className="w-12 text-center bg-transparent text-base font-medium border-0 focus:!outline-none focus:!shadow-none py-1" value={l.quantity} onChange={e=>{
                    const v = Math.max(1, Number(e.target.value)||1);
                    const cap = Number(l.current_stock)||v;
                    if (v > cap) toast.push(`เกินสต็อก (${cap} ชิ้น)`, 'error');
                    updateLine(idx,{quantity: Math.min(v, cap)});
                  }}/>
                  <button className="stepper-btn rounded-r-lg text-ink disabled:opacity-40 disabled:cursor-not-allowed" disabled={l.quantity >= (Number(l.current_stock)||l.quantity)} onClick={()=>{
                    const cap = Number(l.current_stock)||l.quantity;
                    if (l.quantity >= cap) { toast.push(`เกินสต็อก (${cap} ชิ้น)`, 'error'); return; }
                    updateLine(idx,{quantity: l.quantity+1});
                  }}><Icon name="plus" size={16}/></button>
                </div>
                <div className="text-xs text-muted flex-1 tabular-nums">@ {fmtTHB(l.unit_price)}</div>
                <div className="text-right font-medium text-sm tabular-nums">{fmtTHB(lineNet(l))}</div>
              </div>
              {(() => {
                const hasDisc = (Number(l.discount1_value)||0) > 0 || (Number(l.discount2_value)||0) > 0;
                return (
                  <button
                    type="button"
                    className={"mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border transition " + (
                      expanded
                        ? "bg-primary/15 text-primary border-primary/30"
                        : hasDisc
                          ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/15"
                          : "bg-white/60 text-muted border-hairline hover:text-primary hover:bg-white"
                    )}
                    onClick={()=>setExpandedDisc(s=>({...s,[idx]:!expanded}))}
                    aria-expanded={expanded}
                  >
                    <Icon name="tag" size={12}/>
                    {hasDisc ? 'ส่วนลดที่ตั้งไว้' : 'เพิ่มส่วนลด'}
                    <Icon name={expanded?"chevron-d":"chevron-r"} size={12}/>
                  </button>
                );
              })()}
              {expanded && (
                <div className="grid grid-cols-12 gap-1 mt-2 fade-in">
                  <input type="number" inputMode="numeric" autoFocus className="input !h-8 !rounded-lg !py-1 !text-xs col-span-4" placeholder="ลด 1" value={l.discount1_value||""} onChange={e=>updateLine(idx,{discount1_value:Number(e.target.value)||0, discount1_type: l.discount1_type||'baht'})}/>
                  <select className="input !h-8 !rounded-lg !py-1 !text-xs col-span-2" value={l.discount1_type||""} onChange={e=>updateLine(idx,{discount1_type:e.target.value||null})}>
                    <option value="">—</option><option value="baht">฿</option><option value="percent">%</option>
                  </select>
                  <input type="number" inputMode="numeric" className="input !h-8 !rounded-lg !py-1 !text-xs col-span-4" placeholder="ลด 2" value={l.discount2_value||""} onChange={e=>updateLine(idx,{discount2_value:Number(e.target.value)||0, discount2_type: l.discount2_type||'baht'})}/>
                  <select className="input !h-8 !rounded-lg !py-1 !text-xs col-span-2" value={l.discount2_type||""} onChange={e=>updateLine(idx,{discount2_type:e.target.value||null})}>
                    <option value="">—</option><option value="baht">฿</option><option value="percent">%</option>
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className={"p-4 lg:p-5 border-t hairline bg-surface-cream-strong flex-shrink-0 " + (shaking ? "shake-error" : "")}>
        {/* Section: ข้อมูลบิล */}
        <div className="text-[9px] uppercase tracking-[0.12em] text-muted-soft font-medium mb-1.5">ข้อมูลบิล</div>
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted">ช่องทาง</label>
            <select className="input mt-1 !h-10 !rounded-xl !py-2 !text-sm" value={channel} onChange={e=>setChannel(e.target.value)}>
              {CHANNELS.map(c=> <option key={c.v} value={c.v}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted">ชำระโดย</label>
            <select className="input mt-1 !h-10 !rounded-xl !py-2 !text-sm" value={payment} onChange={e=>setPayment(e.target.value)}>
              {PAYMENTS.map(p=> <option key={p.v} value={p.v}>{p.label}</option>)}
            </select>
          </div>
        </div>

        {/* Section: ราคา */}
        <div className="text-[9px] uppercase tracking-[0.12em] text-muted-soft font-medium mb-1.5">ราคา</div>
        <div className="mb-3">
          <div className="flex items-center justify-between">
            <label className="text-[10px] uppercase tracking-wider text-muted inline-flex items-center gap-1.5">
              <Icon name="credit-card" size={12}/>
              ราคาที่ลูกค้าจ่าย <span className="text-error">*</span>
            </label>
            {discountAmount > 0 && (
              <span className="text-[10px] text-primary tabular-nums">ส่วนลด −{fmtTHB(discountAmount)}</span>
            )}
          </div>
          <div className={netPriceErr ? "field-error-glow mt-1" : "mt-1"}>
            <input
              ref={netPriceRef}
              type="number"
              inputMode="decimal"
              className="input !h-10 !rounded-xl !py-2 !text-sm"
              placeholder={subtotal>0 ? fmtTHB(subtotal) : "ราคาที่ลูกค้าจ่ายจริง"}
              value={netPrice}
              onChange={e=>setNetPrice(e.target.value)}
            />
          </div>
        </div>

        {ECOMMERCE_CHANNELS.has(channel) && (
          <div className={"rounded-xl p-3 mb-4 bg-primary/5 border border-primary/15 fade-in " + (netReceivedErr ? "field-error-glow" : "")}>
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase tracking-wider text-primary inline-flex items-center gap-1.5 font-medium">
                <Icon name="store" size={12}/>
                เงินที่ร้านได้รับ
                {requiresNetReceived(channel, payment)
                  ? <span className="text-error ml-0.5">*</span>
                  : <span className="text-muted-soft ml-0.5 font-normal normal-case tracking-normal">(ทีหลังได้)</span>}
              </label>
              {netReceived !== "" && Number(netReceived) > 0 && grand > 0 && (
                <span className="text-[10px] text-muted-soft tabular-nums">
                  ค่าธรรมเนียม {((grand - Number(netReceived)) / grand * 100).toFixed(1)}%
                </span>
              )}
            </div>
            <input
              ref={netReceivedRef}
              type="number"
              inputMode="decimal"
              className="input mt-1 !h-10 !rounded-xl !py-2 !text-sm"
              placeholder={requiresNetReceived(channel, payment)
                ? `ยอดที่ ${CHANNEL_LABELS[channel]||channel} โอนเข้าร้าน (บาท)`
                : 'รู้ทีหลังก็มาแก้ในหน้าขายได้'}
              value={netReceived}
              onChange={e=>setNetReceived(e.target.value)}
            />
            <div className="text-[10px] text-muted-soft mt-1">
              ใช้คำนวณกำไร · ไม่แสดงในใบเสร็จลูกค้า
            </div>
          </div>
        )}

        {/* Section: ตัวเลือกเสริม */}
        <div className="text-[9px] uppercase tracking-[0.12em] text-muted-soft font-medium mb-1.5">ตัวเลือกเสริม</div>
        <div className="flex gap-2 mb-3">
          <button type="button" onClick={()=>setTaxInvoiceModalOpen(true)}
            className={"flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-md text-xs font-medium border transition " + (taxInvoice?"bg-primary text-on-primary border-primary shadow-sm":"bg-white text-muted border-hairline hover:text-ink hover:bg-white/90")}>
            <Icon name={taxInvoice?"check":"plus"} size={13}/> ใบกำกับภาษี
          </button>
          <button type="button" onClick={()=>setShowNotes(v=>!v)}
            className={"flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-md text-xs font-medium border transition " + (showNotes||notes?"bg-white text-ink border-primary/40 shadow-sm":"bg-white text-muted border-hairline hover:text-ink")}>
            <Icon name="edit" size={13}/> หมายเหตุ {notes && <span className="w-1.5 h-1.5 bg-primary rounded-full"/>}
          </button>
        </div>

        {taxInvoice && (
          <button type="button" onClick={()=>setTaxInvoiceModalOpen(true)}
            className={"w-full text-left bg-white border rounded-md p-2.5 mb-3 fade-in flex items-center gap-2 hover:bg-white/80 transition " + (buyerNameErr ? "border-error" : "hairline")}>
            <Icon name="receipt" size={14} className="text-primary flex-shrink-0"/>
            <div className="flex-1 min-w-0 text-xs">
              <div className="font-medium truncate">{buyer.name || <span className="text-error">— ยังไม่ได้กรอกชื่อ —</span>}</div>
              <div className="text-muted-soft truncate text-[10px]">
                {[buyer.taxId, buyer.invoiceNo].filter(Boolean).join(' · ') || 'แตะเพื่อกรอกข้อมูลเพิ่มเติม'}
              </div>
            </div>
            <Icon name="edit" size={12} className="text-muted-soft flex-shrink-0"/>
          </button>
        )}

        {showNotes && (
          <textarea className="input !py-2 !text-sm mb-3 fade-in" rows="2" placeholder="หมายเหตุบนบิล (เช่น ลูกค้ามีรอยขีดข่วน, รอของลอตต่อ)" value={notes} onChange={e=>setNotes(e.target.value)}/>
        )}

        <div className="border-t hairline pt-3">
          <div className="flex justify-between text-sm text-muted mb-1"><span>รวมก่อนลด</span><span className="tabular-nums">{fmtTHB(subtotal)}</span></div>
          <div className="flex justify-between text-xs text-muted-soft mb-1"><span>ก่อนหัก VAT 7%</span><span className="tabular-nums">{fmtTHB(vatBreakdown(grand).exVat)}</span></div>
          <div className="flex justify-between text-xs text-muted-soft mb-2"><span>VAT 7%</span><span className="tabular-nums">{fmtTHB(vatBreakdown(grand).vat)}</span></div>
          <div className="flex justify-between font-display text-3xl mb-3"><span>รวม</span><span className="tabular-nums">{fmtTHB(grandTween)}</span></div>

          {/* Wrapper catches clicks while the inner button is disabled,
              so we can flag missing fields and scroll the user to them. */}
          <div onClick={!canSubmit ? flagMissing : undefined}>
            <button className="btn-primary w-full !py-3 !text-base" disabled={!canSubmit} onClick={submit}>
              {submitting? 'กำลังบันทึก...' : `ชำระเงิน ${fmtTHB(grand)}`}
            </button>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* DESKTOP LAYOUT */}
      <div className="hidden lg:grid grid-cols-12 gap-6 px-10 py-8 h-[calc(100vh-180px)]">
        <div className="col-span-7 flex flex-col overflow-hidden">
          <div className="card-canvas p-3 mb-4 flex-shrink-0">{SearchInput}</div>
          <div className="flex-1 flex flex-col min-h-0">{ResultsList}</div>
        </div>
        <div className="col-span-5 flex flex-col">
          <div className="card-cream flex flex-col flex-1 overflow-hidden">
            <div className="p-5 border-b hairline flex items-center justify-between flex-shrink-0">
              <div>
                <div className="font-display text-2xl">ตะกร้า</div>
                <div className="text-xs text-muted mt-0.5">{cart.length} รายการ · {totalQty} ชิ้น</div>
              </div>
              {cart.length>0 && <button className="btn-ghost !text-xs text-muted hover:text-error" onClick={()=>setCart([])}>ล้างตะกร้า</button>}
            </div>
            {CartContent()}
          </div>
        </div>
      </div>

      {/* MOBILE LAYOUT */}
      <div className="lg:hidden px-4 py-4 pb-24">
        <div className="mb-3">{SearchInput}</div>
        {ResultsList}
      </div>

      {/* MOBILE FLOATING CART BUTTON */}
      {cart.length>0 && !cartOpen && (
        <button className="lg:hidden fixed bottom-28 left-4 right-4 z-30 btn-primary !rounded-xl !py-4 !px-5 flex items-center justify-between fade-in" onClick={()=>setCartOpen(true)}>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Icon name="cart" size={24}/>
              <span className="absolute -top-2 -right-2 bg-canvas text-ink text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shadow-md">{totalQty}</span>
            </div>
            <span className="font-medium text-base">ดูตะกร้า</span>
          </div>
          <span className="font-display text-2xl tabular-nums">{fmtTHB(grandTween)}</span>
        </button>
      )}

      {/* MOBILE CART SHEET — three-section layout:
          (1) header (drag-to-close, count, clear) with safe-area-top padding
          (2) items list — flex-1 with min-height so it stays visible
          (3) bill section: collapsed summary bar OR expanded form
          (4) sticky checkout (total + pay button) always visible
          Desktop continues to use the original `CartContent()` layout. */}
      {cartSheetRender && (
        <div className={"lg:hidden fixed inset-0 modal-overlay z-[100] flex items-end " + (cartSheetClosing?"overlay-out":"overlay-in")} onClick={()=>setCartOpen(false)}>
          <div ref={sheetRef} className={"cart-sheet-mobile flex flex-col card-cream " + (cartSheetClosing?"sheet-out":"sheet-anim")} onClick={e=>e.stopPropagation()}>
            {/* (1) Drag-handle header */}
            <div
              className="cart-sheet-header flex-shrink-0 cursor-grab active:cursor-grabbing touch-none select-none"
              onPointerDown={onSheetDragStart}
              onPointerMove={onSheetDragMove}
              onPointerUp={onSheetDragEnd}
              onPointerCancel={onSheetDragEnd}
            >
              <div className="w-10 h-1 rounded-full bg-muted-soft/40 mx-auto mb-2" aria-hidden="true"/>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-display text-xl leading-none">ตะกร้า</div>
                  <div className="text-[11px] text-muted mt-1">{cart.length} รายการ · {totalQty} ชิ้น</div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {cart.length > 0 && (
                    <button className="btn-ghost !text-xs !px-2 !py-1.5 !min-h-0 text-muted hover:!text-error" onClick={()=>setCart([])}>ล้าง</button>
                  )}
                  <button className="btn-ghost !p-2 !min-h-0" onClick={()=>setCartOpen(false)} aria-label="ปิดตะกร้า"><Icon name="x" size={20}/></button>
                </div>
              </div>
            </div>

            {/* (2) Items list */}
            <div className="cart-items-area">
              {!cart.length && (
                <div className="p-8 text-center">
                  <div className="inline-flex w-12 h-12 items-center justify-center rounded-full bg-surface-card text-muted mb-3"><Icon name="cart" size={24}/></div>
                  <div className="text-muted text-sm">ยังไม่มีสินค้า</div>
                </div>
              )}
              {cart.map((l, idx) => {
                const expanded = expandedDisc[idx];
                return (
                  <div key={l.product_id} style={{ '--i': Math.min(idx, 8) }} className="glass-soft rounded-lg p-3 mb-2 hover-lift fade-in stagger">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{l.product_name}</div>
                        <div className="text-xs text-muted font-mono truncate">{l.barcode||''}</div>
                      </div>
                      <button className="text-muted-soft hover:text-error p-1" onClick={()=>removeLine(idx)} aria-label="ลบ"><Icon name="trash" size={16}/></button>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex items-center bg-white/60 backdrop-blur rounded-lg border border-white/50 shadow-sm overflow-hidden">
                        <button className="stepper-btn rounded-l-lg text-ink" onClick={()=>updateLine(idx,{quantity:Math.max(1,l.quantity-1)})}><Icon name="minus" size={16}/></button>
                        <input type="number" min="1" max={l.current_stock||undefined} inputMode="numeric" className="w-12 text-center bg-transparent text-base font-medium border-0 focus:!outline-none focus:!shadow-none py-1" value={l.quantity} onChange={e=>{
                          const v = Math.max(1, Number(e.target.value)||1);
                          const cap = Number(l.current_stock)||v;
                          if (v > cap) toast.push(`เกินสต็อก (${cap} ชิ้น)`, 'error');
                          updateLine(idx,{quantity: Math.min(v, cap)});
                        }}/>
                        <button className="stepper-btn rounded-r-lg text-ink disabled:opacity-40 disabled:cursor-not-allowed" disabled={l.quantity >= (Number(l.current_stock)||l.quantity)} onClick={()=>{
                          const cap = Number(l.current_stock)||l.quantity;
                          if (l.quantity >= cap) { toast.push(`เกินสต็อก (${cap} ชิ้น)`, 'error'); return; }
                          updateLine(idx,{quantity: l.quantity+1});
                        }}><Icon name="plus" size={16}/></button>
                      </div>
                      <div className="text-xs text-muted flex-1 tabular-nums">@ {fmtTHB(l.unit_price)}</div>
                      <div className="text-right font-medium text-sm tabular-nums">{fmtTHB(lineNet(l))}</div>
                    </div>
                    {(() => {
                      const hasDisc = (Number(l.discount1_value)||0) > 0 || (Number(l.discount2_value)||0) > 0;
                      return (
                        <button
                          type="button"
                          className={"mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border transition " + (
                            expanded
                              ? "bg-primary/15 text-primary border-primary/30"
                              : hasDisc
                                ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/15"
                                : "bg-white/60 text-muted border-hairline hover:text-primary hover:bg-white"
                          )}
                          onClick={()=>setExpandedDisc(s=>({...s,[idx]:!expanded}))}
                          aria-expanded={expanded}
                        >
                          <Icon name="tag" size={12}/>
                          {hasDisc ? 'ส่วนลดที่ตั้งไว้' : 'เพิ่มส่วนลด'}
                          <Icon name={expanded?"chevron-d":"chevron-r"} size={12}/>
                        </button>
                      );
                    })()}
                    {expanded && (
                      <div className="grid grid-cols-12 gap-1 mt-2 fade-in">
                        <input type="number" inputMode="numeric" autoFocus className="input !h-8 !rounded-lg !py-1 !text-xs col-span-4" placeholder="ลด 1" value={l.discount1_value||""} onChange={e=>updateLine(idx,{discount1_value:Number(e.target.value)||0, discount1_type: l.discount1_type||'baht'})}/>
                        <select className="input !h-8 !rounded-lg !py-1 !text-xs col-span-2" value={l.discount1_type||""} onChange={e=>updateLine(idx,{discount1_type:e.target.value||null})}>
                          <option value="">—</option><option value="baht">฿</option><option value="percent">%</option>
                        </select>
                        <input type="number" inputMode="numeric" className="input !h-8 !rounded-lg !py-1 !text-xs col-span-4" placeholder="ลด 2" value={l.discount2_value||""} onChange={e=>updateLine(idx,{discount2_value:Number(e.target.value)||0, discount2_type: l.discount2_type||'baht'})}/>
                        <select className="input !h-8 !rounded-lg !py-1 !text-xs col-span-2" value={l.discount2_type||""} onChange={e=>updateLine(idx,{discount2_type:e.target.value||null})}>
                          <option value="">—</option><option value="baht">฿</option><option value="percent">%</option>
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* (3) Collapsible bill section */}
            <div className={"cart-bill-section " + (shaking ? "shake-error" : "")}>
              {!billExpanded ? (
                <button type="button" onClick={()=>setBillExpanded(true)} className="cart-bill-collapsed" aria-expanded="false">
                  <div className="cart-bill-collapsed-summary">
                    <div className="text-[9px] uppercase tracking-[0.12em] text-muted-soft font-medium">รายละเอียดบิล</div>
                    <div className="text-sm font-medium truncate mt-0.5">
                      {CHANNEL_LABELS[channel]||channel} · {PAYMENTS.find(p=>p.v===payment)?.label||payment}
                      {netPriceFilled && <span className="text-muted-soft"> · รับ {fmtTHB(Number(netPrice))}</span>}
                      {taxInvoice && <span className="text-primary"> · ใบกำกับ</span>}
                      {notes && <span className="text-muted-soft"> · มีหมายเหตุ</span>}
                    </div>
                    {showErrors && !canSubmit && cart.length>0 && (
                      <div className="text-[10px] text-error mt-1 inline-flex items-center gap-1">
                        <Icon name="alert" size={10}/> ข้อมูลยังไม่ครบ — แตะเพื่อกรอก
                      </div>
                    )}
                  </div>
                  <Icon name="chevron-u" size={18} className="text-muted flex-shrink-0"/>
                </button>
              ) : (
                <div className="cart-bill-expanded">
                  {/* ข้อมูลบิล */}
                  <div className="text-[9px] uppercase tracking-[0.12em] text-muted-soft font-medium mb-1.5">ข้อมูลบิล</div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-muted">ช่องทาง</label>
                      <select className="input mt-1 !h-10 !rounded-xl !py-2 !text-sm" value={channel} onChange={e=>setChannel(e.target.value)}>
                        {CHANNELS.map(c=> <option key={c.v} value={c.v}>{c.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wider text-muted">ชำระโดย</label>
                      <select className="input mt-1 !h-10 !rounded-xl !py-2 !text-sm" value={payment} onChange={e=>setPayment(e.target.value)}>
                        {PAYMENTS.map(p=> <option key={p.v} value={p.v}>{p.label}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* ราคา */}
                  <div className="text-[9px] uppercase tracking-[0.12em] text-muted-soft font-medium mb-1.5">ราคา</div>
                  <div className="mb-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] uppercase tracking-wider text-muted inline-flex items-center gap-1.5">
                        <Icon name="credit-card" size={12}/>
                        ราคาที่ลูกค้าจ่าย <span className="text-error">*</span>
                      </label>
                      {discountAmount > 0 && (
                        <span className="text-[10px] text-primary tabular-nums">ส่วนลด −{fmtTHB(discountAmount)}</span>
                      )}
                    </div>
                    <div className={netPriceErr ? "field-error-glow mt-1" : "mt-1"}>
                      <input
                        ref={netPriceRef}
                        type="number"
                        inputMode="decimal"
                        className="input !h-10 !rounded-xl !py-2 !text-sm"
                        placeholder={subtotal>0 ? fmtTHB(subtotal) : "ราคาที่ลูกค้าจ่ายจริง"}
                        value={netPrice}
                        onChange={e=>setNetPrice(e.target.value)}
                      />
                    </div>
                  </div>

                  {ECOMMERCE_CHANNELS.has(channel) && (
                    <div className={"rounded-xl p-3 mb-3 bg-primary/5 border border-primary/15 fade-in " + (netReceivedErr ? "field-error-glow" : "")}>
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] uppercase tracking-wider text-primary inline-flex items-center gap-1.5 font-medium">
                          <Icon name="store" size={12}/>
                          เงินที่ร้านได้รับ
                          {requiresNetReceived(channel, payment)
                            ? <span className="text-error ml-0.5">*</span>
                            : <span className="text-muted-soft ml-0.5 font-normal normal-case tracking-normal">(ทีหลังได้)</span>}
                        </label>
                        {netReceived !== "" && Number(netReceived) > 0 && grand > 0 && (
                          <span className="text-[10px] text-muted-soft tabular-nums">
                            ค่าธรรมเนียม {((grand - Number(netReceived)) / grand * 100).toFixed(1)}%
                          </span>
                        )}
                      </div>
                      <input
                        ref={netReceivedRef}
                        type="number"
                        inputMode="decimal"
                        className="input mt-1 !h-10 !rounded-xl !py-2 !text-sm"
                        placeholder={requiresNetReceived(channel, payment)
                          ? `ยอดที่ ${CHANNEL_LABELS[channel]||channel} โอนเข้าร้าน (บาท)`
                          : 'รู้ทีหลังก็มาแก้ในหน้าขายได้'}
                        value={netReceived}
                        onChange={e=>setNetReceived(e.target.value)}
                      />
                      <div className="text-[10px] text-muted-soft mt-1">
                        ใช้คำนวณกำไร · ไม่แสดงในใบเสร็จลูกค้า
                      </div>
                    </div>
                  )}

                  {/* ตัวเลือกเสริม */}
                  <div className="text-[9px] uppercase tracking-[0.12em] text-muted-soft font-medium mb-1.5">ตัวเลือกเสริม</div>
                  <div className="flex gap-2 mb-2">
                    <button type="button" onClick={()=>setTaxInvoiceModalOpen(true)}
                      className={"flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-2 rounded-md text-xs font-medium border transition " + (taxInvoice?"bg-primary text-on-primary border-primary shadow-sm":"bg-white text-muted border-hairline hover:text-ink hover:bg-white/90")}>
                      <Icon name={taxInvoice?"check":"plus"} size={13}/> ใบกำกับภาษี
                    </button>
                    <button type="button" onClick={()=>setShowNotes(v=>!v)}
                      className={"flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-2 rounded-md text-xs font-medium border transition " + (showNotes||notes?"bg-white text-ink border-primary/40 shadow-sm":"bg-white text-muted border-hairline hover:text-ink")}>
                      <Icon name="edit" size={13}/> หมายเหตุ {notes && <span className="w-1.5 h-1.5 bg-primary rounded-full"/>}
                    </button>
                  </div>

                  {taxInvoice && (
                    <button type="button" onClick={()=>setTaxInvoiceModalOpen(true)}
                      className={"w-full text-left bg-white border rounded-md p-2.5 mb-2 fade-in flex items-center gap-2 hover:bg-white/80 transition " + (buyerNameErr ? "border-error" : "hairline")}>
                      <Icon name="receipt" size={14} className="text-primary flex-shrink-0"/>
                      <div className="flex-1 min-w-0 text-xs">
                        <div className="font-medium truncate">{buyer.name || <span className="text-error">— ยังไม่ได้กรอกชื่อ —</span>}</div>
                        <div className="text-muted-soft truncate text-[10px]">
                          {[buyer.taxId, buyer.invoiceNo].filter(Boolean).join(' · ') || 'แตะเพื่อกรอกข้อมูลเพิ่มเติม'}
                        </div>
                      </div>
                      <Icon name="edit" size={12} className="text-muted-soft flex-shrink-0"/>
                    </button>
                  )}

                  {showNotes && (
                    <textarea className="input !py-2 !text-sm mb-2 fade-in" rows="2" placeholder="หมายเหตุบนบิล (เช่น ลูกค้ามีรอยขีดข่วน, รอของลอตต่อ)" value={notes} onChange={e=>setNotes(e.target.value)}/>
                  )}

                  {/* VAT breakdown */}
                  <div className="border-t hairline pt-2 mt-1">
                    <div className="flex justify-between text-xs text-muted mb-0.5"><span>รวมก่อนลด</span><span className="tabular-nums">{fmtTHB(subtotal)}</span></div>
                    <div className="flex justify-between text-[11px] text-muted-soft mb-0.5"><span>ก่อนหัก VAT 7%</span><span className="tabular-nums">{fmtTHB(vatBreakdown(grand).exVat)}</span></div>
                    <div className="flex justify-between text-[11px] text-muted-soft"><span>VAT 7%</span><span className="tabular-nums">{fmtTHB(vatBreakdown(grand).vat)}</span></div>
                  </div>

                  <button type="button" onClick={()=>setBillExpanded(false)}
                    className="w-full inline-flex items-center justify-center gap-1 mt-2 py-1.5 text-xs text-muted hover:text-ink">
                    ยุบ <Icon name="chevron-d" size={12}/>
                  </button>
                </div>
              )}
            </div>

            {/* (4) Sticky checkout */}
            <div className="cart-checkout-sticky">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-sm text-muted">รวมทั้งสิ้น</span>
                <span className="font-display text-2xl tabular-nums">{fmtTHB(grandTween)}</span>
              </div>
              <div onClick={!canSubmit ? flagMissing : undefined}>
                <button className="btn-primary w-full !py-3 !text-base" disabled={!canSubmit} onClick={submit}>
                  {submitting? 'กำลังบันทึก...' : `ชำระเงิน ${fmtTHB(grand)}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tax-invoice details — opens from the "ใบกำกับภาษี" button.
          Saving sets taxInvoice=true; "ลบใบกำกับ" clears the flag and
          all buyer fields. */}
      <Modal open={taxInvoiceModalOpen} onClose={()=>setTaxInvoiceModalOpen(false)}
        title="ข้อมูลใบกำกับภาษี"
        footer={<>
          {taxInvoice && (
            <button className="btn-secondary !text-error hover:!bg-error/10" onClick={()=>{
              setTaxInvoice(false);
              setBuyer({ name: "", taxId: "", address: "", invoiceNo: "" });
              setTaxInvoiceModalOpen(false);
            }}>
              <Icon name="trash" size={14}/> ลบใบกำกับ
            </button>
          )}
          <button className="btn-secondary" onClick={()=>setTaxInvoiceModalOpen(false)}>ปิด</button>
          <button className="btn-primary" disabled={!buyer.name.trim()} onClick={()=>{
            setTaxInvoice(true);
            setTaxInvoiceModalOpen(false);
          }}>บันทึก</button>
        </>}>
        <div className="space-y-3">
          <div>
            <label className="text-xs uppercase tracking-wider text-muted">ชื่อผู้ซื้อ / บริษัท <span className="text-error">*</span></label>
            <input className="input mt-1" autoFocus placeholder="เช่น บริษัท ABC จำกัด" value={buyer.name} onChange={e=>setBuyer(b=>({...b,name:e.target.value}))}/>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs uppercase tracking-wider text-muted">เลขผู้เสียภาษี</label>
              <input className="input mt-1 font-mono" inputMode="numeric" placeholder="13 หลัก" value={buyer.taxId} onChange={e=>setBuyer(b=>({...b,taxId:e.target.value}))}/>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wider text-muted">เลขใบกำกับ</label>
              <input className="input mt-1" placeholder="INV-XXXX" value={buyer.invoiceNo} onChange={e=>setBuyer(b=>({...b,invoiceNo:e.target.value}))}/>
            </div>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-muted">ที่อยู่</label>
            <textarea className="input mt-1" rows="3" placeholder="ที่อยู่ผู้ซื้อ (พิมพ์ในใบเสร็จ)" value={buyer.address} onChange={e=>setBuyer(b=>({...b,address:e.target.value}))}/>
          </div>
        </div>
      </Modal>

      {/* Receipt modal — opens after successful sale */}
      <ReceiptModal open={!!receiptOrderId} onClose={()=>setReceiptOrderId(null)} orderId={receiptOrderId}/>

      {/* Camera barcode scanner — mobile/tablet only (FAB and inline button hidden on desktop). */}
      <BarcodeScannerModal
        open={scannerOpen}
        onClose={()=>setScannerOpen(false)}
        onScan={handleCameraScan}
        mode="continuous"
        title="สแกนสินค้าเข้าตะกร้า"
      />
    </>
  );
}

/* =========================================================
   PRODUCTS VIEW
========================================================= */
function ProductsView() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [brands, setBrands] = useState([]);
  const [categories, setCategories] = useState([]);
  const [filterBrand, setFilterBrand] = useState("");
  const [filterCategory, setFilterCategory] = useState("");

  const loadTaxonomy = useCallback(async () => {
    const [b, c] = await Promise.all([
      sb.from('brands').select('*').order('name'),
      sb.from('categories').select('*').order('name'),
    ]);
    setBrands(b.data || []);
    setCategories(c.data || []);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    let query = sb.from('products').select('*').limit(50);
    if (q.trim()) {
      const term = q.trim();
      query = query.or(`name.ilike.%${term}%,barcode.eq.${term}`);
    } else {
      query = query.order('updated_at', { ascending: false });
    }
    if (filterBrand)    query = query.eq('brand_id', filterBrand);
    if (filterCategory) query = query.eq('category_id', filterCategory);
    const { data, error } = await query;
    if (error) toast.push("โหลดสินค้าไม่ได้", "error");
    setRows(data || []);
    setLoading(false);
  }, [q, filterBrand, filterCategory]);

  useEffect(()=>{ loadTaxonomy(); }, [loadTaxonomy]);
  useEffect(()=>{ const t = setTimeout(load, 200); return ()=>clearTimeout(t); }, [load]);

  const brandName = (id) => brands.find(b=>b.id===id)?.name;
  const catName   = (id) => categories.find(c=>c.id===id)?.name;

  const save = async (p) => {
    try {
      // Catalog-only fields. Stock & cost lifecycle is owned by stock_movements
      // (see StockMovementForm + create_stock_movement_with_items RPC), so we
      // strip current_stock from update payloads and force it to 0 on insert.
      const payload = {
        name: p.name, barcode: p.barcode||null,
        retail_price: p.retail_price||0,
        brand_id: p.brand_id || null,
        category_id: p.category_id || null,
      };
      if (p.id) {
        payload.cost_price = p.cost_price||0; // editable override in edit mode
        payload.updated_at = new Date().toISOString();
        const { error } = await sb.from('products').update(payload).eq('id', p.id);
        if (error) throw error;
        toast.push("บันทึกสินค้าสำเร็จ", "success");
      } else {
        // New product: stock & cost start at 0; first "รับเข้า" bill seeds them.
        payload.cost_price = 0;
        payload.current_stock = 0;
        const { error } = await sb.from('products').insert(payload);
        if (error) throw error;
        toast.push("เพิ่มสินค้าสำเร็จ — ไปหน้า \"รับเข้า\" เพื่อเพิ่มสต็อก", "success");
      }
      setEditing(null);
      load();
    } catch (e) {
      toast.push("บันทึกไม่ได้: " + e.message, "error");
    }
  };

  const addBrand = async (name) => {
    const t = (name||"").trim(); if (!t) return null;
    const { data, error } = await sb.from('brands').insert({ name: t }).select().single();
    if (error) { toast.push("เพิ่มแบรนด์ไม่ได้: " + mapError(error), 'error'); return null; }
    setBrands(b => [...b, data].sort((a,b)=>a.name.localeCompare(b.name)));
    return data.id;
  };
  const addCategory = async (name) => {
    const t = (name||"").trim(); if (!t) return null;
    const { data, error } = await sb.from('categories').insert({ name: t }).select().single();
    if (error) { toast.push("เพิ่มหมวดไม่ได้: " + mapError(error), 'error'); return null; }
    setCategories(c => [...c, data].sort((a,b)=>a.name.localeCompare(b.name)));
    return data.id;
  };

  return (
    <div className="px-4 py-4 lg:px-10 lg:py-6 lg:h-[calc(100vh-180px)] lg:flex lg:flex-col">
      <div className="mb-3 flex-shrink-0">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted z-10"><Icon name="search" size={18} strokeWidth={2.25}/></span>
          <input className="input !pl-10" placeholder="ชื่อรุ่น หรือ บาร์โค้ด" value={q} onChange={e=>setQ(e.target.value)} autoFocus />
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mb-4 flex-shrink-0">
        <select className="input !py-2 !text-sm !w-auto" value={filterBrand} onChange={e=>setFilterBrand(e.target.value)}>
          <option value="">ทุกแบรนด์</option>
          {brands.map(b=> <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className="input !py-2 !text-sm !w-auto" value={filterCategory} onChange={e=>setFilterCategory(e.target.value)}>
          <option value="">ทุกหมวด</option>
          {categories.map(c=> <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {(filterBrand||filterCategory) && (
          <button className="btn-ghost !py-2 !text-sm text-muted" onClick={()=>{setFilterBrand("");setFilterCategory("");}}>
            <Icon name="x" size={14}/> ล้างตัวกรอง
          </button>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden lg:flex lg:flex-col lg:flex-1 lg:min-h-0 card-canvas overflow-hidden">
        <div className="grid grid-cols-12 px-4 py-3 text-xs uppercase tracking-wider text-muted border-b hairline bg-surface-soft flex-shrink-0">
          <div className="col-span-4">ชื่อรุ่น</div>
          <div className="col-span-3">บาร์โค้ด</div>
          <div className="col-span-2 text-right">ทุน</div>
          <div className="col-span-2 text-right">ราคาป้าย</div>
          <div className="col-span-1 text-right">คงเหลือ</div>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && <SkeletonRows n={8} label="กำลังโหลดสินค้า" />}
          {!loading && rows.length===0 && <div className="p-6 text-muted text-sm">ไม่พบสินค้า</div>}
          {rows.map(p => (
            <div key={p.id} className="grid grid-cols-12 px-4 py-3.5 items-center border-b hairline last:border-0 hover:bg-white/40 cursor-pointer transition-colors" onClick={()=>setEditing(p)}>
              <div className="col-span-4 font-medium truncate">{p.name}</div>
              <div className="col-span-3 font-mono text-sm text-muted truncate">{p.barcode||'—'}</div>
              <div className="col-span-2 text-right text-muted tabular-nums">{fmtTHB(p.cost_price)}</div>
              <div className="col-span-2 text-right font-medium tabular-nums">{fmtTHB(p.retail_price)}</div>
              <div className="col-span-1 text-right">
                <span className={"badge-pill " + (p.current_stock<=0?'!bg-error/10 !text-error':p.current_stock<5?'!bg-warning/15 !text-[#8a6500]':'')}>{p.current_stock}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Mobile cards */}
      <div className="lg:hidden space-y-2">
        {loading && <div className="p-4 text-muted text-sm flex items-center gap-2"><span className="spinner"/>กำลังโหลด...</div>}
        {!loading && rows.length===0 && <div className="p-4 text-muted text-sm">ไม่พบสินค้า</div>}
        {rows.map(p => (
          <div key={p.id} className="card-canvas pressable p-3.5 flex items-center gap-3" onClick={()=>setEditing(p)}>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{p.name}</div>
              <div className="font-mono text-xs text-muted truncate mt-0.5">{p.barcode||'—'}</div>
              {(brandName(p.brand_id) || catName(p.category_id)) && (
                <div className="text-xs text-muted-soft mt-0.5 truncate">
                  {[brandName(p.brand_id), catName(p.category_id)].filter(Boolean).join(' · ')}
                </div>
              )}
              <div className="flex items-center gap-2 mt-1.5">
                <span className="font-display text-lg leading-none tabular-nums">{fmtTHB(p.retail_price)}</span>
                <span className={"badge-pill " + (p.current_stock<=0?'!bg-error/10 !text-error':p.current_stock<5?'!bg-warning/15 !text-[#8a6500]':'')}>คงเหลือ {p.current_stock}</span>
              </div>
            </div>
            <Icon name="chevron-r" size={18} className="text-muted-soft flex-shrink-0"/>
          </div>
        ))}
      </div>

      <ProductEditor editing={editing} onClose={()=>setEditing(null)} onSave={save}
        brands={brands} categories={categories} addBrand={addBrand} addCategory={addCategory} />
    </div>
  );
}

const STOCK_REASON_LABELS = {
  sale:                { label: "ขาย",              tone: "red"   },
  sale_void:           { label: "ยกเลิกขาย",         tone: "green" },
  receive:             { label: "รับเข้า",           tone: "green" },
  receive_void:        { label: "ยกเลิกรับเข้า",     tone: "red"   },
  return_in:           { label: "คืนเข้า",           tone: "green" },
  return_void:         { label: "ยกเลิกรับคืน",      tone: "red"   },
  manual_adjust:       { label: "แก้ไขเอง",          tone: "gray"  },
  initial:             { label: "ตั้งต้น",            tone: "gray"  },
  supplier_claim:      { label: "ส่งเคลม/คืนบริษัท", tone: "red"   },
  supplier_claim_void: { label: "ยกเลิกส่งเคลม",     tone: "green" },
};

function StockHistoryPanel({ productId }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await sb.from('stock_movements')
      .select('*').eq('product_id', productId)
      .order('created_at', { ascending: false }).limit(50);
    setRows(data || []);
    setLoading(false);
  };

  const toggle = () => {
    if (!open && rows === null) load();
    setOpen(o => !o);
  };

  return (
    <div className="border hairline rounded-xl bg-white/80">
      <button type="button" onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-white/80 hover:bg-surface-soft rounded-xl">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Icon name="trend-up" size={16}/> ประวัติสต็อก
          {rows && <span className="badge-pill !text-[11px]">{rows.length} รายการ</span>}
        </span>
        <Icon name={open?"chevron-d":"chevron-r"} size={16} className="text-muted"/>
      </button>
      {open && (
        <div className="border-t hairline p-3 max-h-72 overflow-y-auto fade-in">
          {loading && <div className="text-muted text-sm p-2 flex items-center gap-2"><span className="spinner"/>กำลังโหลด...</div>}
          {!loading && rows && rows.length===0 && <div className="text-muted text-sm p-2">ยังไม่มีประวัติ</div>}
          {!loading && rows && rows.map(m => {
            const meta = STOCK_REASON_LABELS[m.reason] || { label: m.reason, tone: "gray" };
            const isPos = m.qty_delta > 0;
            return (
              <div key={m.id} className="flex items-center gap-3 py-2 border-b hairline-soft last:border-0">
                <div className={"w-14 text-right font-mono font-medium tabular-nums " + (isPos?"text-success":"text-error")}>
                  {isPos?"+":""}{m.qty_delta}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm flex items-center gap-2">
                    <span className={"badge-pill !text-[11px] " + (meta.tone==='red'?'!bg-error/10 !text-error':meta.tone==='green'?'!bg-success/15 !text-[#2c6b3a]':'')}>{meta.label}</span>
                    {m.ref_table && m.ref_id && <span className="text-xs text-muted-soft font-mono">{m.ref_table.replace('_orders','')}#{m.ref_id}</span>}
                  </div>
                  <div className="text-xs text-muted mt-0.5">{fmtDateTime(m.created_at)}</div>
                </div>
                <div className="text-xs text-muted-soft tabular-nums">→ {m.balance_after}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProductEditor({ editing, onClose, onSave, brands, categories, addBrand, addCategory }) {
  const [draft, setDraft] = useState(null);
  const [barcodeEdit, setBarcodeEdit] = useState(false);
  const [manualApproved, setManualApproved] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const barcodeRef = useRef(null);
  const askPrompt = usePrompt();
  const askConfirm = useConfirm();
  useEffect(()=>{ setDraft(editing? {...editing} : null); setBarcodeEdit(false); setManualApproved(false); }, [editing]);
  if (!draft) return null;
  const set = (k,v)=> setDraft(d=>({...d,[k]:v}));
  const onBrandChange = async (val) => {
    if (val === "__new__") {
      const name = await askPrompt({ title: "เพิ่มแบรนด์ใหม่", label: "ชื่อแบรนด์", defaultValue: "" });
      if (name && name.trim()) { const id = await addBrand(name.trim()); if (id) set('brand_id', id); }
    } else set('brand_id', val? Number(val): null);
  };
  const onCatChange = async (val) => {
    if (val === "__new__") {
      const name = await askPrompt({ title: "เพิ่มหมวดใหม่", label: "ชื่อหมวด", defaultValue: "" });
      if (name && name.trim()) { const id = await addCategory(name.trim()); if (id) set('category_id', id); }
    } else set('category_id', val? Number(val): null);
  };
  const confirmManualBarcode = async () => {
    const ok = await askConfirm({
      title: "แก้ไข Barcode ด้วยการพิมพ์",
      message: "หากต้องการเปลี่ยน ควรใช้เครื่องสแกนเพื่อความแม่นยำ — ดำเนินการต่อ?",
      okLabel: "พิมพ์เอง",
    });
    if (ok) {
      setManualApproved(true);
      setTimeout(()=>barcodeRef.current?.focus(), 0);
    }
  };
  // Client-side validation. Server still enforces the same rules (NOT NULL,
  // CHECK constraints, RLS) — this is just to surface the failure locally
  // before we round-trip to Supabase.
  const validate = () => {
    if (!draft.name || !draft.name.trim()) return 'กรุณากรอกชื่อรุ่น';
    if (!draft.barcode || !draft.barcode.trim()) return 'กรุณาสแกนหรือพิมพ์บาร์โค้ด';
    if (draft.list_price != null && Number(draft.list_price) < 0) return 'ราคาป้ายต้องไม่ติดลบ';
    if (draft.cost_price != null && Number(draft.cost_price) < 0) return 'ราคาทุนต้องไม่ติดลบ';
    return null;
  };
  const tryToast = useToast();
  const handleSave = () => {
    const reason = validate();
    if (reason) { tryToast.push(reason, 'error'); return; }
    onSave(draft);
  };
  // Live margin % for the pricing section header badge.
  const marginPct = draft.retail_price > 0
    ? ((draft.retail_price - (draft.cost_price || 0)) / draft.retail_price * 100)
    : null;
  const marginBadgeClass = marginPct == null ? '' :
    marginPct >= 30 ? 'badge-pill !bg-success/15 !text-success' :
    marginPct >= 10 ? 'badge-pill !bg-warning/15 !text-[#8a6500]' :
    'badge-pill !bg-error/10 !text-error';

  const labelCls = "text-[9.5px] font-semibold uppercase tracking-[1.5px] text-muted";
  const fieldLabel = "text-xs uppercase tracking-wider text-muted";

  return (
    <>
    <Modal open={!!draft} onClose={onClose} title={draft.id ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่"}
      footer={<>
        <button className="btn-secondary" onClick={onClose}>ยกเลิก</button>
        <button className="btn-primary" onClick={handleSave}><Icon name="check" size={16}/>บันทึก</button>
      </>}>

      <div className="space-y-3">

        {/* ── ข้อมูลสินค้า ── */}
        <div className="rounded-xl border hairline p-4">
          <div className="mb-3">
            <div className="inline-flex items-center gap-1.5 bg-ink/[0.06] rounded-md px-2 py-1">
              <Icon name="box" size={12} className="text-muted"/>
              <span className={labelCls}>ข้อมูลสินค้า</span>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label className={fieldLabel}>ชื่อรุ่น</label>
              <input className="input mt-1" value={draft.name||""} onChange={e=>set('name', e.target.value)} />
            </div>
            <div>
              <label className={fieldLabel + " flex items-center gap-2"}>
                บาร์โค้ด
                {draft.id && !barcodeEdit && (
                  <button type="button" className="inline-flex items-center gap-1 text-xs text-[#6b3a26] bg-[#6b3a26]/10 hover:bg-[#6b3a26]/20 px-2 py-0.5 rounded-md transition-colors normal-case tracking-normal font-medium" onClick={()=>{ setBarcodeEdit(true); setTimeout(()=>barcodeRef.current?.focus(), 50); }}>
                    <Icon name="barcode" size={11}/> แก้ไข Barcode
                  </button>
                )}
                {draft.id && barcodeEdit && (
                  <span className="inline-flex items-center gap-1 text-xs text-success normal-case tracking-normal font-medium">
                    <Icon name="barcode" size={11}/> พร้อมสแกน
                  </span>
                )}
                {!draft.id && (
                  <span className="inline-flex items-center gap-1 text-muted-soft normal-case tracking-normal font-normal text-xs">
                    <Icon name="barcode" size={12}/> สแกน หรือ พิมพ์
                  </span>
                )}
                {/* Mobile-only camera scan button — desktop hides via .scan-inline-btn @media. */}
                <button type="button" className="scan-inline-btn ml-auto !h-11 !w-11" onClick={()=>setScannerOpen(true)} aria-label="สแกนด้วยกล้อง">
                  <Icon name="camera" size={16}/>
                </button>
              </label>
              <input
                ref={barcodeRef}
                className={"input mt-1 font-mono" + (draft.id && !barcodeEdit ? " opacity-60 cursor-not-allowed" : "")}
                placeholder="วางหัวอ่านแล้วสแกน หรือพิมพ์ตรงนี้..."
                inputMode="text"
                autoFocus={!draft.id}
                readOnly={!!(draft.id && !barcodeEdit)}
                value={draft.barcode||""}
                onChange={e=>set('barcode', e.target.value)}
                onMouseDown={e=>{ if (draft.id && barcodeEdit && !manualApproved) { e.preventDefault(); confirmManualBarcode(); } }}
                onTouchStart={e=>{ if (draft.id && barcodeEdit && !manualApproved) { e.preventDefault(); confirmManualBarcode(); } }}
              />
            </div>
          </div>
        </div>

        {/* ── หมวดหมู่ ── */}
        <div className="rounded-xl border hairline bg-surface-soft p-4">
          <div className="mb-3">
            <div className="inline-flex items-center gap-1.5 bg-ink/[0.06] rounded-md px-2 py-1">
              <Icon name="tag" size={12} className="text-muted"/>
              <span className={labelCls}>หมวดหมู่</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={fieldLabel}>แบรนด์</label>
              <select className="input mt-1" value={draft.brand_id||""} onChange={e=>onBrandChange(e.target.value)}>
                <option value="">— ไม่ระบุ —</option>
                {brands.map(b=> <option key={b.id} value={b.id}>{b.name}</option>)}
                <option value="__new__">+ เพิ่มแบรนด์ใหม่…</option>
              </select>
            </div>
            <div>
              <label className={fieldLabel}>หมวดหมู่</label>
              <select className="input mt-1" value={draft.category_id||""} onChange={e=>onCatChange(e.target.value)}>
                <option value="">— ไม่ระบุ —</option>
                {categories.map(c=> <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="__new__">+ เพิ่มหมวดใหม่…</option>
              </select>
            </div>
          </div>
        </div>

        {/* ── ราคา & สต็อก ── */}
        <div className="rounded-xl border hairline p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="inline-flex items-center gap-1.5 bg-ink/[0.06] rounded-md px-2 py-1">
              <Icon name="credit-card" size={12} className="text-muted"/>
              <span className={labelCls}>ราคา & สต็อก</span>
            </div>
            {marginPct != null && (
              <span className={marginBadgeClass}>กำไร {marginPct.toFixed(0)}%</span>
            )}
          </div>
          {/* ราคาป้าย — primary field, larger text. Catalog data, always editable. */}
          <div className="mb-3">
            <label className={fieldLabel}>ราคาขาย (ป้าย)</label>
            <input type="number" inputMode="decimal" className="input mt-1 !text-lg !font-display !tabular-nums"
              value={draft.retail_price||0} onChange={e=>set('retail_price', Number(e.target.value))} />
          </div>
          {!draft.id ? (
            // CREATE mode — stock & cost are derived from the first "รับเข้า" bill,
            // not entered here. Hiding the inputs forces every stock/cost change to
            // flow through stock_movements so history stays accurate.
            <div className="rounded-lg bg-surface-soft border hairline-soft p-3 flex items-start gap-2 text-xs text-muted">
              <Icon name="info" size={14} className="text-muted-soft flex-shrink-0 mt-0.5"/>
              <div>
                สต็อกและทุนจะถูกบันทึกเมื่อ <span className="font-medium text-ink">รับเข้าครั้งแรก</span> —
                หลังบันทึกสินค้านี้แล้ว ไปหน้า <span className="font-medium text-ink">"รับเข้า"</span> เพื่อเพิ่มสต็อก
              </div>
            </div>
          ) : (
            // EDIT mode — cost editable (running average override), stock read-only.
            // current_stock can only change via create_stock_movement_with_items RPC.
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>ราคาทุน</label>
                <input type="number" inputMode="decimal" className="input mt-1 tabular-nums"
                  value={draft.cost_price||0} onChange={e=>set('cost_price', Number(e.target.value))} />
              </div>
              <div>
                <label className={fieldLabel}>คงเหลือ</label>
                <div className="mt-1 input !flex items-center justify-between !cursor-not-allowed opacity-80 bg-surface-soft">
                  <span className="font-display text-lg tabular-nums">{draft.current_stock||0}</span>
                  <span className="text-[10px] text-muted-soft">read-only</span>
                </div>
                <div className="text-[10px] text-muted-soft mt-1 leading-snug">
                  ปรับสต็อกผ่านหน้า <span className="font-medium">รับเข้า / ส่งเคลม / คืน</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── ประวัติสต็อก (edit mode only) ── */}
        {draft.id && (
          <div className="rounded-xl border hairline bg-surface-soft p-4">
            <StockHistoryPanel productId={draft.id}/>
          </div>
        )}
      </div>
    </Modal>
    {/* Camera scanner — single-shot. Editing existing products requires the
        explicit "แก้ไข Barcode" gate first to avoid accidental overwrites. */}
    <BarcodeScannerModal
      open={scannerOpen}
      onClose={()=>setScannerOpen(false)}
      mode="single"
      title="สแกนบาร์โค้ดสินค้า"
      onScan={(code)=>{
        if (draft.id && !barcodeEdit) return false; // shouldn't happen — button gated, but be safe
        set('barcode', code);
        return true;
      }}
    />
    </>
  );
}

/* =========================================================
   SALES HISTORY VIEW
========================================================= */
function SalesView({ onGoPOS }) {
  const toast = useToast();
  const askPrompt = usePrompt();
  const isAdmin = useIsAdmin();
  const [range, setRange] = useState({ from: todayISO(), to: todayISO() });
  const from = range.from, to = range.to;
  const [reprintId, setReprintId] = useState(null);
  const [channel, setChannel] = useState("");
  const [excludeVoided, setExcludeVoided] = useState(true);
  const [orders, setOrders] = useState([]);
  // Per-order summary: { [orderId]: { productLabel, profit, itemCount, costApprox } }
  // Computed in load() by joining sale_order_items + receive_order_items + products.
  const [orderSummary, setOrderSummary] = useState({});
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const voidLockRef = useRef(false);
  // Phase 3.4: default-expanded so first-time users discover filters; auto-collapses
  // after a range pick (see handleRangeChange below).
  const [filterOpen, setFilterOpen] = useState(true);
  // Phase 3.4: pick-then-collapse handler.
  const handleRangeChange = (next) => {
    setRange(next);
    if (next?.from && next?.to) setFilterOpen(false);
  };
  const [voiding, setVoiding] = useState(false);
  const [editNet, setEditNet] = useState(false); // toggles inline net_received editor
  const [netDraft, setNetDraft] = useState("");
  const [savingNet, setSavingNet] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // .limit(200) ทำให้บิลในช่วงเวลาที่กว้าง (เช่น 1-30 เม.ย. ที่มีบิลเกิน 200) โดน truncate
    // เปลี่ยนเป็น 5000 ครอบคลุมเดือนยาวสุดของร้านนี้ (~500 บิล/เดือน × 10 เดือน)
    let q = sb.from('sale_orders').select('*')
      .gte('sale_date', startOfDayBangkok(from))
      .lte('sale_date', endOfDayBangkok(to))
      .order('sale_date', { ascending: false }).limit(5000);
    if (channel) q = q.eq('channel', channel);
    if (excludeVoided) q = q.eq('status', 'active');
    const { data, error } = await q;
    if (error) toast.push("โหลดไม่ได้", "error");
    const ordersList = data || [];
    setOrders(ordersList);

    // Compute per-order product summary + profit (mirrors ProfitLossView).
    if (ordersList.length) {
      try {
        const orderIds = ordersList.map(o => o.id);
        const { data: itemsData } = await sb.from('sale_order_items')
          .select('*').in('sale_order_id', orderIds);
        const items = itemsData || [];
        const pids = [...new Set(items.map(i => i.product_id).filter(Boolean))];

        let recvRows = [];
        if (pids.length) {
          const { data: rd } = await sb.from('receive_order_items')
            .select('product_id, unit_price, receive_orders!inner(receive_date, voided_at)')
            .in('product_id', pids).is('receive_orders.voided_at', null);
          recvRows = rd || [];
        }
        const recvMap = {};
        recvRows.forEach(r => {
          const date = r.receive_orders?.receive_date;
          if (!date) return;
          (recvMap[r.product_id] ||= []).push({ date: new Date(date).getTime(), unit_price: Number(r.unit_price)||0 });
        });
        Object.values(recvMap).forEach(arr => arr.sort((a,b)=>b.date-a.date));

        const prodMap = {};
        if (pids.length) {
          const { data: prods } = await sb.from('products').select('id, cost_price').in('id', pids);
          (prods||[]).forEach(p => { prodMap[p.id] = Number(p.cost_price)||0; });
        }

        const itemsByOrder = {};
        items.forEach(it => { (itemsByOrder[it.sale_order_id] ||= []).push(it); });

        const summary = {};
        for (const o of ordersList) {
          const lines = itemsByOrder[o.id] || [];
          const lineRevenues = lines.map(it => applyDiscounts(
            it.unit_price, it.quantity,
            it.discount1_value, it.discount1_type,
            it.discount2_value, it.discount2_type,
          ));
          const subtotalCalc = lineRevenues.reduce((s,x)=>s+x, 0);
          const revenueBase = (ECOMMERCE_CHANNELS.has(o.channel) && o.net_received != null)
            ? Number(o.net_received)
            : Number(o.grand_total) || 0;
          const ratio = subtotalCalc > 0 ? revenueBase / subtotalCalc : 1;
          const saleTs = new Date(o.sale_date).getTime();
          let totalProfit = 0;
          let costApprox = false;
          lines.forEach((it, idx) => {
            const qty = Number(it.quantity)||0;
            const lineRev = lineRevenues[idx] * ratio;
            let unitCost = 0;
            if (it.product_id) {
              const list = recvMap[it.product_id];
              if (list && list.length) {
                const found = list.find(r => r.date <= saleTs);
                if (found) unitCost = found.unit_price;
                else { unitCost = prodMap[it.product_id] || 0; costApprox = true; }
              } else {
                unitCost = prodMap[it.product_id] || 0;
                costApprox = true;
              }
            }
            totalProfit += lineRev - unitCost * qty;
          });
          const productLabel = lines.length === 0 ? '—'
            : lines.length === 1 ? (lines[0].product_name || '—')
            : `${lines[0].product_name || '—'} +${lines.length - 1}`;
          summary[o.id] = {
            productLabel,
            profit: o.status === 'voided' ? 0 : totalProfit,
            itemCount: lines.length,
            costApprox,
          };
        }
        setOrderSummary(summary);
      } catch (e) {
        console.error('orderSummary load failed', e);
        setOrderSummary({});
      }
    } else {
      setOrderSummary({});
    }
    setLoading(false);
  }, [from, to, channel, excludeVoided]);

  // Group orders by sale-date (YYYY-MM-DD) preserving DESC order
  const groupedByDay = useMemo(() => {
    const map = new Map();
    for (const o of orders) {
      const key = (o.sale_date || '').slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(o);
    }
    return Array.from(map.entries()).map(([day, list]) => ({
      day, list,
      count: list.length,
      total: list.filter(o=>o.status==='active').reduce((s,o)=>s+Number(o.grand_total||0),0),
    }));
  }, [orders]);

  useEffect(()=>{ load(); }, [load]);

  const openDetail = async (order) => {
    const { data } = await sb.from('sale_order_items').select('*').eq('sale_order_id', order.id);
    setDetail({ order, items: data || [] });
    setEditNet(false);
    setNetDraft(order.net_received != null ? String(order.net_received) : "");
  };

  const saveNetReceived = async () => {
    if (!detail) return;
    const raw = String(netDraft).trim();
    const value = raw === "" ? null : Math.max(0, Number(raw));
    if (raw !== "" && !Number.isFinite(value)) {
      toast.push("กรอกตัวเลขเท่านั้น", "error");
      return;
    }
    setSavingNet(true);
    try {
      const { error } = await sb.from('sale_orders')
        .update({ net_received: value }).eq('id', detail.order.id);
      if (error) throw error;
      toast.push(value == null ? "ลบค่าเงินที่ได้รับแล้ว" : `บันทึกเงินที่ได้รับ ${fmtTHB(value)}`, 'success');
      setDetail(d => d ? { ...d, order: { ...d.order, net_received: value } } : d);
      setOrders(list => list.map(o => o.id === detail.order.id ? { ...o, net_received: value } : o));
      setEditNet(false);
    } catch (e) {
      toast.push("บันทึกไม่ได้: " + mapError(e), 'error');
    } finally { setSavingNet(false); }
  };

  const voidSale = async () => {
    if (voidLockRef.current) return; // hard guard against double-click
    if (!detail) return;
    const reason = await askPrompt({
      title: `ยกเลิกบิล #${detail.order.id}`,
      label: "เหตุผล (ไม่บังคับ)",
      defaultValue: "",
      multiline: true,
      okLabel: "ยกเลิกบิล",
      danger: true,
    });
    if (reason === null) return; // user cancelled the prompt
    voidLockRef.current = true;
    setVoiding(true);
    try {
      const { error } = await sb.rpc('void_sale_order', { p_sale_order_id: detail.order.id, p_reason: reason || null });
      if (error) throw error;
      toast.push(`ยกเลิกบิล #${detail.order.id} แล้ว · สต็อกถูกบวกคืน`, 'success');
      setDetail(null);
      load();
    } catch (e) {
      toast.push("ยกเลิกบิลไม่ได้: " + mapError(e), 'error');
    } finally { setVoiding(false); voidLockRef.current = false; }
  };

  const total = useMemo(()=> orders.reduce((s,o)=> s + Number(o.grand_total||0), 0), [orders]);

  const FilterControls = (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs uppercase tracking-wider text-muted">ช่วงวันที่</label>
          <DatePicker mode="range" value={range} onChange={handleRangeChange} placeholder="เลือกช่วงวันที่" className="mt-1"/>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-muted">ช่องทาง</label>
          <select className="input mt-1" value={channel} onChange={e=>setChannel(e.target.value)}>
            <option value="">ทุกช่องทาง</option>
            {CHANNELS.map(c=> <option key={c.v} value={c.v}>{c.label}</option>)}
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <span className={"relative flex items-center justify-center w-5 h-5 rounded border transition-colors " + (excludeVoided?"bg-primary border-primary":"bg-white border-hairline")}>
          <input type="checkbox" className="sr-only" checked={excludeVoided} onChange={e=>setExcludeVoided(e.target.checked)} />
          {excludeVoided && <Icon name="check" size={13} className="text-white" strokeWidth={2.5}/>}
        </span>
        <span className="text-sm">ไม่รวมบิลที่ยกเลิก (voided)</span>
      </label>
    </div>
  );

  return (
    <div className="px-4 py-4 lg:px-10 lg:py-8">
      {/* Summary card */}
      <div className="card-cream p-4 lg:p-5 mb-4 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted">รวมทั้งหมด</div>
          <div className="font-display text-3xl lg:text-4xl mt-1">{fmtTHB(total)}</div>
          <div className="text-xs text-muted mt-1">{orders.length} บิล</div>
        </div>
        <button className="lg:hidden btn-secondary !py-2 !px-3" onClick={()=>setFilterOpen(o=>!o)}>
          <Icon name="filter" size={16}/> ตัวกรอง
        </button>
      </div>

      {/* Filters */}
      <div className={"mb-5 " + (filterOpen?"block":"hidden lg:block")}>{FilterControls}</div>

      {/* Desktop — grouped by day */}
      <div className="hidden lg:block space-y-4">
        {loading && <div className="card-canvas overflow-hidden"><SkeletonRows n={6} label="กำลังโหลดบิล" /></div>}
        {!loading && orders.length===0 && (
          <div className="card-canvas p-8 text-center">
            <div className="text-muted text-sm">ไม่พบบิลในช่วงเวลานี้</div>
            {onGoPOS && (
              <button className="btn-primary mt-4 !py-2.5 !px-5" onClick={onGoPOS}>
                <Icon name="cart" size={16}/> เริ่มขายใหม่
              </button>
            )}
          </div>
        )}
        {!loading && groupedByDay.map(g => (
          <div key={g.day} className="card-canvas overflow-hidden">
            {/* Day header */}
            <div className="flex items-center justify-between px-4 py-3 border-b hairline bg-surface-cream-strong/50">
              <div className="flex items-center gap-3">
                <Icon name="calendar" size={16} className="text-primary"/>
                <span className="font-display text-lg">{fmtThaiDateShort(g.day)}</span>
                <span className="badge-pill">{g.count} บิล</span>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-muted">รวมวันนี้</div>
                <div className="font-display text-xl tabular-nums">{fmtTHB(g.total)}</div>
              </div>
            </div>
            {/* Column header */}
            <div className="grid grid-cols-12 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-soft border-b hairline">
              <div className="col-span-1">เลขที่บิล</div>
              <div className="col-span-1">เวลา</div>
              <div className="col-span-3">ชื่อสินค้า</div>
              <div className="col-span-2">ช่องทาง</div>
              <div className="col-span-1">ชำระ</div>
              <div className="col-span-2 text-right">ยอดสุทธิ</div>
              <div className="col-span-2 text-right">กำไร</div>
            </div>
            {/* Rows */}
            {g.list.map(o => {
              const sm = orderSummary[o.id];
              return (
              <div key={o.id} className={"grid grid-cols-12 px-4 py-3 items-center gap-x-2 border-b hairline last:border-0 hover:bg-white/40 cursor-pointer transition-colors " + (o.status==='voided'?'opacity-60':'')} onClick={()=>openDetail(o)}>
                <div className="col-span-1 font-mono text-sm flex items-center gap-1 truncate">
                  <span className="truncate">#{o.id}</span>
                  {o.status==='voided' && <span className="badge-pill !bg-error/10 !text-error !text-[10px]">VOID</span>}
                </div>
                <div className="col-span-1 text-sm tabular-nums">{new Date(o.sale_date).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"})}</div>
                <div className="col-span-3 text-sm min-w-0">
                  <div className="truncate" title={sm?.productLabel || ''}>{sm?.productLabel ?? <span className="text-muted-soft">—</span>}</div>
                  {sm?.costApprox && <span className="badge-pill !bg-warning/15 !text-[#8a6500] !text-[10px] mt-0.5">ทุนประมาณ</span>}
                </div>
                <div className="col-span-2"><span className="badge-pill !text-[10px]">{CHANNEL_LABELS[o.channel] || o.channel || '—'}</span></div>
                <div className="col-span-1 text-xs text-muted truncate">{PAYMENTS.find(p=>p.v===o.payment_method)?.label || '—'}</div>
                <div className={"col-span-2 text-right tabular-nums " + (o.status==='voided'?'line-through':'')}>
                  <div className="font-medium">{fmtTHB(o.grand_total)}</div>
                  {ECOMMERCE_CHANNELS.has(o.channel) && o.net_received != null && (
                    <div className="text-[10px] text-muted-soft">ได้รับ {fmtTHB(o.net_received)}</div>
                  )}
                </div>
                <div className={"col-span-2 text-right tabular-nums font-medium " + (o.status==='voided' ? 'text-muted-soft line-through' : sm && sm.profit >= 0 ? 'text-ink' : 'text-error')}>
                  {sm == null ? <span className="text-muted-soft">—</span> : (sm.profit >= 0 ? '+' : '') + fmtTHB(sm.profit)}
                </div>
              </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Mobile — grouped by day */}
      <div className="lg:hidden space-y-4">
        {loading && <div className="p-4 text-muted text-sm flex items-center gap-2"><span className="spinner"/>กำลังโหลด...</div>}
        {!loading && orders.length===0 && (
          <div className="p-6 text-center">
            <div className="text-muted text-sm">ไม่พบบิลในช่วงเวลานี้</div>
            {onGoPOS && (
              <button className="btn-primary mt-3 !py-2 !px-4" onClick={onGoPOS}>
                <Icon name="cart" size={16}/> เริ่มขายใหม่
              </button>
            )}
          </div>
        )}
        {!loading && groupedByDay.map(g => (
          <div key={g.day}>
            {/* Sticky day header */}
            <div className="sticky top-14 z-20 -mx-4 px-4 py-2.5 mb-2 mobile-topbar flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon name="calendar" size={14} className="text-primary"/>
                <span className="font-display text-base">{fmtThaiDateShort(g.day)}</span>
                <span className="text-xs text-muted">· {g.count} บิล</span>
              </div>
              <span className="font-display text-base tabular-nums">{fmtTHB(g.total)}</span>
            </div>
            <div className="space-y-2">
              {g.list.map(o => {
                const sm = orderSummary[o.id];
                return (
                <div key={o.id} className={"card-canvas pressable p-3.5 flex items-center gap-3 " + (o.status==='voided'?'opacity-60':'')} onClick={()=>openDetail(o)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted">#{o.id}</span>
                      <span className="badge-pill !text-[10px]">{CHANNEL_LABELS[o.channel] || o.channel || '—'}</span>
                      {o.status==='voided' && <span className="badge-pill !bg-error/10 !text-error !text-[10px]">VOIDED</span>}
                    </div>
                    {sm && sm.itemCount > 0 && (
                      <div className="text-sm text-ink mt-1 truncate" title={sm.productLabel}>{sm.productLabel}</div>
                    )}
                    <div className="text-xs text-muted mt-1 tabular-nums">{new Date(o.sale_date).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"})} น. · {PAYMENTS.find(p=>p.v===o.payment_method)?.label || '—'}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={"font-display text-lg leading-none tabular-nums " + (o.status==='voided'?'line-through':'')}>{fmtTHB(o.grand_total)}</div>
                    {ECOMMERCE_CHANNELS.has(o.channel) && o.net_received != null && (
                      <div className="text-[10px] text-muted-soft mt-0.5 tabular-nums">ได้รับ {fmtTHB(o.net_received)}</div>
                    )}
                    {sm && o.status !== 'voided' && (
                      <div className={"text-xs tabular-nums mt-0.5 " + (sm.profit >= 0 ? 'text-success' : 'text-error')}>
                        {sm.profit >= 0 ? '+' : ''}{fmtTHB(sm.profit)}
                      </div>
                    )}
                  </div>
                  <Icon name="chevron-r" size={16} className="text-muted-soft"/>
                </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!detail} onClose={()=>setDetail(null)} wide
        title={detail?`บิล #${detail.order.id}${detail.order.status==='voided'?' · ยกเลิกแล้ว':''}`:""}
        footer={<>
          {detail?.order.status==='active' && isAdmin && (
            <button className="btn-secondary !text-error hover:!bg-error/10" onClick={voidSale} disabled={voiding}>
              <Icon name="trash" size={16}/>{voiding?'กำลังยกเลิก...':'ยกเลิกบิล'}
            </button>
          )}
          {detail && (
            <button className="btn-secondary" onClick={()=>setReprintId(detail.order.id)}>
              <Icon name="receipt" size={16}/> พิมพ์ใบเสร็จ
            </button>
          )}
          <button className="btn-secondary" onClick={()=>setDetail(null)}>ปิด</button>
        </>}>
        {detail && (
          <div>
            {detail.order.status==='voided' && (
              <div className="mb-4 p-3 rounded-md bg-error/10 text-error text-sm flex items-start gap-2">
                <Icon name="alert" size={16} className="mt-0.5 flex-shrink-0"/>
                <div>
                  <div className="font-medium">บิลนี้ถูกยกเลิกแล้ว</div>
                  <div className="text-xs mt-1">{fmtDateTime(detail.order.voided_at)}{detail.order.void_reason? ` · ${detail.order.void_reason}`:''}</div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4 text-sm">
              <div><div className="text-muted text-xs uppercase">วันที่</div><div className="mt-0.5">{fmtDateTime(detail.order.sale_date)}</div></div>
              <div><div className="text-muted text-xs uppercase">ช่องทาง</div><div className="mt-0.5">{CHANNELS.find(c=>c.v===detail.order.channel)?.label||'—'}</div></div>
              <div><div className="text-muted text-xs uppercase">ชำระ</div><div className="mt-0.5">{PAYMENTS.find(p=>p.v===detail.order.payment_method)?.label||'—'}</div></div>
            </div>

            {(detail.order.tax_invoice_no || detail.order.buyer_name) && (
              <div className="mb-4 p-3 rounded-md bg-surface-card text-sm">
                <div className="text-muted text-xs uppercase tracking-wider mb-1">ใบกำกับภาษี</div>
                {detail.order.tax_invoice_no && <div className="font-mono text-xs">เลขที่ {detail.order.tax_invoice_no}</div>}
                {detail.order.buyer_name && <div>{detail.order.buyer_name}</div>}
                {detail.order.buyer_tax_id && <div className="font-mono text-xs text-muted">TAX ID {detail.order.buyer_tax_id}</div>}
                {detail.order.buyer_address && <div className="text-xs text-muted mt-1">{detail.order.buyer_address}</div>}
              </div>
            )}

            <div className="border-t hairline">
              {detail.items.map(it => (
                <div key={it.id} className="py-2 border-b hairline-soft flex justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{it.product_name}</div>
                    <div className="text-xs text-muted">{it.quantity} × {fmtTHB(it.unit_price)}
                      {it.discount1_value? ` − ${it.discount1_value}${it.discount1_type==='percent'?'%':'฿'}`:''}
                      {it.discount2_value? ` − ${it.discount2_value}${it.discount2_type==='percent'?'%':'฿'}`:''}
                    </div>
                  </div>
                  <div className="font-medium flex-shrink-0 tabular-nums">{fmtTHB(applyDiscounts(it.unit_price, it.quantity, it.discount1_value, it.discount1_type, it.discount2_value, it.discount2_type))}</div>
                </div>
              ))}
            </div>

            {detail.order.notes && (
              <div className="mt-3 text-sm text-body bg-surface-soft rounded-md p-3">
                <div className="text-xs uppercase tracking-wider text-muted mb-1">หมายเหตุ</div>
                {detail.order.notes}
              </div>
            )}

            <div className="mt-4 space-y-1 text-sm">
              <div className="flex justify-between text-muted"><span>รวมก่อนลด</span><span className="tabular-nums">{fmtTHB(detail.order.subtotal)}</span></div>
              {Number(detail.order.vat_amount)>0 && (<>
                <div className="flex justify-between text-muted-soft text-xs"><span>ก่อนหัก VAT {detail.order.vat_rate}%</span><span className="tabular-nums">{fmtTHB(Number(detail.order.grand_total)-Number(detail.order.vat_amount))}</span></div>
                <div className="flex justify-between text-muted-soft text-xs"><span>VAT {detail.order.vat_rate}%</span><span className="tabular-nums">{fmtTHB(detail.order.vat_amount)}</span></div>
              </>)}
              <div className="flex justify-between font-display text-2xl pt-2"><span>ยอดสุทธิ</span><span className="tabular-nums">{fmtTHB(detail.order.grand_total)}</span></div>
              {ECOMMERCE_CHANNELS.has(detail.order.channel) && (
                <div className="mt-2 pt-2 border-t hairline">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm">
                      <div className="text-muted text-xs uppercase tracking-wider">เงินที่ร้านได้รับ</div>
                      <div className="text-[10px] text-muted-soft">ใช้คำนวณกำไร · ไม่แสดงในใบเสร็จ</div>
                    </div>
                    {!editNet ? (
                      <div className="flex items-center gap-2">
                        <span className="font-display text-xl tabular-nums">
                          {detail.order.net_received != null ? fmtTHB(detail.order.net_received) : <span className="text-muted-soft text-sm font-sans">— ยังไม่ได้กรอก —</span>}
                        </span>
                        {isAdmin && detail.order.status==='active' && (
                          <button className="btn-secondary !py-1.5 !px-2.5 !text-xs" onClick={()=>{ setNetDraft(detail.order.net_received != null ? String(detail.order.net_received) : ""); setEditNet(true); }}>
                            <Icon name="edit" size={12}/> แก้ไข
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          type="number" inputMode="decimal" autoFocus
                          className="input !h-9 !w-32 !rounded-lg !py-1 !text-sm text-right tabular-nums"
                          placeholder="0"
                          value={netDraft}
                          onChange={e=>setNetDraft(e.target.value)}
                        />
                        <button className="btn-primary !py-1.5 !px-3 !text-xs" onClick={saveNetReceived} disabled={savingNet}>
                          {savingNet ? '...' : 'บันทึก'}
                        </button>
                        <button className="btn-secondary !py-1.5 !px-2.5 !text-xs" onClick={()=>setEditNet(false)} disabled={savingNet}>
                          ยกเลิก
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <ReceiptModal open={!!reprintId} onClose={()=>setReprintId(null)} orderId={reprintId}/>
    </div>
  );
}

/* =========================================================
   ADD PRODUCT MODAL (self-contained, used from ReceiveView)
========================================================= */
function AddProductModal({ open, onClose, onAdded }) {
  const toast = useToast();
  const [brands, setBrands] = useState([]);
  const [categories, setCategories] = useState([]);
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      sb.from('brands').select('*').order('name'),
      sb.from('categories').select('*').order('name'),
    ]).then(([b, c]) => {
      setBrands(b.data || []);
      setCategories(c.data || []);
      setEditing({ name: '', barcode: '', cost_price: 0, retail_price: 0, current_stock: 0 });
    });
  }, [open]);

  const handleClose = () => { setEditing(null); onClose(); };

  const save = async (p) => {
    try {
      const payload = {
        name: p.name, barcode: p.barcode || null,
        cost_price: p.cost_price || 0, retail_price: p.retail_price || 0,
        current_stock: p.current_stock || 0,
        brand_id: p.brand_id || null,
        category_id: p.category_id || null,
      };
      const { error } = await sb.from('products').insert(payload);
      if (error) throw error;
      toast.push("เพิ่มสินค้าใหม่สำเร็จ", "success");
      handleClose();
      if (onAdded) onAdded();
    } catch (e) {
      toast.push("บันทึกไม่ได้: " + e.message, "error");
    }
  };

  const addBrand = async (name) => {
    const t = (name||"").trim(); if (!t) return null;
    const { data, error } = await sb.from('brands').insert({ name: t }).select().single();
    if (error) { toast.push("เพิ่มแบรนด์ไม่ได้: " + mapError(error), 'error'); return null; }
    setBrands(b => [...b, data].sort((a,b)=>a.name.localeCompare(b.name)));
    return data.id;
  };
  const addCategory = async (name) => {
    const t = (name||"").trim(); if (!t) return null;
    const { data, error } = await sb.from('categories').insert({ name: t }).select().single();
    if (error) { toast.push("เพิ่มหมวดไม่ได้: " + mapError(error), 'error'); return null; }
    setCategories(c => [...c, data].sort((a,b)=>a.name.localeCompare(b.name)));
    return data.id;
  };

  return (
    <ProductEditor
      editing={editing}
      onClose={handleClose}
      onSave={save}
      brands={brands}
      categories={categories}
      addBrand={addBrand}
      addCategory={addCategory}
    />
  );
}

/* =========================================================
   STOCK VIEW (Receive + Return tabs)
========================================================= */
function ReceiveView() {
  const [tab, setTab] = useState('receive');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const tabs = [
    { k: 'receive', label: 'รับเข้า',         icon: 'package-in',  hint: 'รับสินค้าจากบริษัท · เพิ่มสต็อก' },
    { k: 'claim',   label: 'ส่งเคลม / คืน',   icon: 'package-out', hint: 'ส่งสินค้าคืนบริษัท · หักสต็อก' },
  ];
  const TabGroup = <KindTabs tabs={tabs} current={tab} onChange={setTab} Icon={Icon} />;
  const ActionButtons = (
    <div className="flex items-center gap-2">
      <button className="btn-add-product !py-2 !text-sm" onClick={()=>setAddProductOpen(true)}>
        <Icon name="plus" size={15}/> เพิ่มรุ่นสินค้า
      </button>
      <button className="btn-secondary !py-2 !text-sm" onClick={()=>setHistoryOpen(true)}>
        <Icon name="receipt" size={16}/> ดูประวัติ
      </button>
    </div>
  );
  return (
    <div>
      {/* Desktop header */}
      <header className="hidden lg:flex px-10 pt-10 pb-6 items-end justify-between border-b hairline gap-4">
        <div>
          <div className="text-xs uppercase tracking-[1.5px] text-muted">Stock In · From Supplier</div>
          <h1 className="font-display text-5xl mt-2 leading-tight text-ink">รับสินค้าจากบริษัท</h1>
        </div>
        <div className="flex items-center gap-8 pb-1">
          {TabGroup}
          {ActionButtons}
        </div>
      </header>

      <div className="px-4 py-4 lg:px-10 lg:py-8">
        {/* Mobile controls */}
        <div className="flex items-center justify-between gap-3 mb-5 lg:hidden">
          {TabGroup}
          {ActionButtons}
        </div>
        <div className="text-xs text-muted mb-4 ml-1">{tabs.find(t=>t.k===tab).hint}</div>
        <StockMovementForm key={tab} kind={tab}/>
        <MovementHistoryModal open={historyOpen} onClose={()=>setHistoryOpen(false)} kind={tab}/>
        <AddProductModal open={addProductOpen} onClose={()=>setAddProductOpen(false)}/>
      </div>
    </div>
  );
}
function ReturnView()  {
  const [historyOpen, setHistoryOpen] = useState(false);
  const HistoryBtn = (
    <button className="btn-secondary !py-2 !text-sm" onClick={()=>setHistoryOpen(true)}>
      <Icon name="receipt" size={16}/> ดูประวัติรับคืน
    </button>
  );
  return (
    <div>
      {/* Desktop header */}
      <header className="hidden lg:flex px-10 pt-10 pb-6 items-end justify-between border-b hairline gap-4">
        <div>
          <div className="text-xs uppercase tracking-[1.5px] text-muted">Customer Return</div>
          <h1 className="font-display text-5xl mt-2 leading-tight text-ink">รับคืนจากลูกค้า</h1>
        </div>
        <div className="pb-1">{HistoryBtn}</div>
      </header>

      <div className="px-4 py-4 lg:px-10 lg:py-8">
        <div className="flex justify-end mb-3 lg:hidden">{HistoryBtn}</div>
        <StockMovementForm kind="return"/>
        <MovementHistoryModal open={historyOpen} onClose={()=>setHistoryOpen(false)} kind="return"/>
      </div>
    </div>
  );
}

function StockMovementForm({ kind }) {
  const toast = useToast();
  const productSearchRef = useRef(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [channel, setChannel] = useState("store");
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  // Receive-specific
  const [supplierName, setSupplierName] = useState("");
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [hasVat, setHasVat] = useState(true);
  // Cost-percent auto-fill (receive + claim) — defaults reset every form mount
  const [costPctEnabled, setCostPctEnabled] = useState(false);
  const [costPct, setCostPct] = useState(58);
  const [costPctMode, setCostPctMode] = useState('once'); // 'once' | 'persist'
  const [costPctChooserOpen, setCostPctChooserOpen] = useState(false);
  // Return-specific
  const [origSaleId, setOrigSaleId] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const [origSaleMode, setOrigSaleMode] = useState('search'); // 'search' | 'manual'
  const [saleSearch, setSaleSearch] = useState("");
  const [recentSales, setRecentSales] = useState([]);
  const [saleSearching, setSaleSearching] = useState(false);
  const [selectedSale, setSelectedSale] = useState(null);
  // Shared
  const [notes, setNotes] = useState("");
  // Validation + confirm
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const submitLockRef = useRef(false); // hard guard against double-submit

  // Load recent sales when return + search mode is active
  useEffect(()=>{
    if (kind !== 'return' || origSaleMode !== 'search') return;
    let cancel = false;
    setSaleSearching(true);
    (async()=>{
      const { data } = await sb.from('sale_orders').select('id, sale_date, channel, grand_total').eq('status','active').order('sale_date',{ascending:false}).limit(50);
      if (!cancel) { setRecentSales(data||[]); setSaleSearching(false); }
    })();
    return ()=>{ cancel=true; };
  }, [kind, origSaleMode]);

  const saleResults = React.useMemo(()=>{
    const q = saleSearch.trim();
    if (!q) return recentSales.slice(0,15);
    return recentSales.filter(s => String(s.id).includes(q)).slice(0,15);
  }, [recentSales, saleSearch]);

  const selectSale = async (sale) => {
    setSelectedSale(sale);
    setOrigSaleId(String(sale.id));
    if (sale.sale_date) setDate(sale.sale_date.slice(0,10));
    if (sale.channel) setChannel(sale.channel);
    const { data } = await sb.from('sale_order_items').select('*').eq('sale_order_id', sale.id);
    if (data && data.length) {
      setItems(data.map(l => ({
        _uid: (crypto.randomUUID?.() || `r${Math.random().toString(36).slice(2)}${Date.now()}`),
        product_id: l.product_id,
        product_name: l.product_name,
        retail_price: l.unit_price,
        cost_price: 0,
        quantity: l.quantity,
        unit: 'เรือน',
        unit_price: l.unit_price,
        manualPrice: true,
        discount1_value: 0, discount1_type: null,
        discount2_value: 0, discount2_type: null,
      })));
    }
  };

  useEffect(()=>{
    if (!search.trim()) { setResults([]); return; }
    let cancel=false;
    const t = setTimeout(async ()=>{
      const q = search.trim();
      const { data: barcodeHit } = await sb.from('products').select('*').eq('barcode', q).limit(1);
      if (barcodeHit?.length) {
        if (!cancel) { addItem(barcodeHit[0]); setSearch(''); }
        return;
      }
      const { data } = await sb.from('products').select('*').ilike('name', `%${q}%`).limit(15);
      const rows = data || [];
      if (!cancel) setResults(rows);
    }, 200);
    return ()=>{ cancel=true; clearTimeout(t); };
  }, [search]);

  const computeAutoPrice = (p, pctEnabled, pct) => {
    if (kind === 'return') return Number(p.retail_price) || 0;
    if (pctEnabled && (kind === 'receive' || kind === 'claim')) {
      return Math.round(((Number(p.retail_price) || 0) * (100 - (Number(pct) || 0))) / 100);
    }
    // Default for receive/claim: show retail price (ราคาป้าย) as starting point
    return Number(p.retail_price) || 0;
  };
  const addItem = (p) => {
    setItems(it => [...it, {
      _uid: (crypto.randomUUID?.() || `r${Math.random().toString(36).slice(2)}${Date.now()}`),
      product_id: p.id, product_name: p.name,
      retail_price: Number(p.retail_price) || 0,
      cost_price: Number(p.cost_price) || 0,
      quantity: 1, unit: 'เรือน',
      unit_price: computeAutoPrice(p, costPctEnabled, costPct),
      manualPrice: false,
      discount1_value: 0, discount1_type: null,
      discount2_value: 0, discount2_type: null,
    }]);
    // Keep search & results visible so the user can pick another color/variant of the same model
    // without retyping. They can clear via the × button or pick a different search.
  };
  // Camera scanner — lookup by barcode and add to items on hit.
  // Returns true on confirmed success / false otherwise (mirrors POSView).
  // Stale-frame re-fires are handled by `BarcodeScannerModal.lockedRef`.
  const handleCameraScan = async (code) => {
    try {
      const { data } = await sb.from('products').select('*').eq('barcode', code).limit(1);
      if (data && data.length) {
        addItem(data[0]);
        setScannerOpen(false);
        return true;
      }
      playScanError(); vibrateError();
      toast.push(`ไม่พบสินค้าบาร์โค้ด ${code}`, 'error');
      return false;
    } catch {
      playScanError(); vibrateError();
      toast.push('สแกนไม่สำเร็จ', 'error');
      return false;
    }
  };
  const upd = (i, patch) => setItems(it => it.map((x,j)=>j===i?{...x,...patch}:x));
  const updPrice = (i, val) => setItems(it => it.map((x,j)=>j===i?{...x, unit_price: Number(val)||0, manualPrice: true}:x));
  const rm = (i) => setItems(it => it.filter((_,j)=>j!==i));

  // Recompute non-manual items when cost% toggle / value changes
  useEffect(()=>{
    if (kind === 'return') return;
    setItems(it => it.map(l => {
      if (l.manualPrice) return l;
      const auto = costPctEnabled
        ? Math.round((Number(l.retail_price)||0) * (100 - (Number(costPct)||0)) / 100)
        : (Number(l.retail_price)||0);
      return { ...l, unit_price: auto };
    }));
  }, [costPctEnabled, costPct, kind]);

  const total = useMemo(()=> items.reduce((s,l)=> s + applyDiscounts(l.unit_price, l.quantity, l.discount1_value, l.discount1_type, l.discount2_value, l.discount2_type), 0), [items]);

  // Required-field validation per kind (เลขบิล optional — auto-generate if empty)
  const missing = useMemo(()=>{
    const m = { date: !date };
    if (kind === 'receive' || kind === 'claim') {
      m.supplier = !supplierName.trim();
    }
    if (kind === 'claim') {
      m.claimReason = !returnReason; // reuse returnReason state for claim_reason
    }
    return m;
  }, [kind, date, supplierName, returnReason]);

  const autoInvoiceNo = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}_${p(d.getMonth()+1)}_${p(d.getDate())}_${p(d.getHours())}_${p(d.getMinutes())}_${p(d.getSeconds())}`;
  };
  const hasMissing = Object.values(missing).some(Boolean);
  const errCls = (key) => attemptedSubmit && missing[key] ? ' field-error-glow' : '';

  const requestSubmit = () => {
    if (!items.length) { toast.push("ไม่มีรายการ", 'error'); return; }
    if (hasMissing) {
      setAttemptedSubmit(true);
      toast.push("กรุณากรอกข้อมูลให้ครบ", 'error');
      return;
    }
    setConfirmOpen(true);
  };

  const submit = async () => {
    if (submitLockRef.current) return; // hard guard against double-submit
    if (!items.length) { toast.push("ไม่มีรายการ", 'error'); return; }
    submitLockRef.current = true;
    setSubmitting(true);
    try {
      const totalR = roundMoney(total);
      // Date field name varies by kind; the RPC reads it from the header by the
      // expected key for that kind.
      const dateField = kind==='receive' ? 'receive_date' : kind==='claim' ? 'claim_date' : 'return_date';
      const headerPayload = { [dateField]: startOfDayBangkok(date), total_value: totalR, notes: notes.trim()||null };

      if (kind==='receive' || kind==='claim') {
        const { vat } = vatBreakdown(totalR, hasVat?VAT_RATE_DEFAULT:0);
        headerPayload.vat_rate = hasVat?VAT_RATE_DEFAULT:0;
        headerPayload.vat_amount = vat;
        headerPayload.supplier_name = supplierName.trim()||null;
        headerPayload.supplier_invoice_no = supplierInvoiceNo.trim() || autoInvoiceNo();
        if (kind==='claim') headerPayload.claim_reason = returnReason||null; // reuse the reason state
      } else {
        // return — from customer
        headerPayload.channel = channel;
        headerPayload.return_reason = returnReason||null;
        const sid = parseInt(origSaleId,10);
        headerPayload.original_sale_order_id = Number.isFinite(sid) && sid>0 ? sid : null;
      }

      const itemsPayload = items.map(l => ({
        product_id: l.product_id, product_name: l.product_name,
        quantity: l.quantity, unit: l.unit, unit_price: roundMoney(l.unit_price),
        discount1_value: roundMoney(l.discount1_value||0), discount1_type: l.discount1_type,
        discount2_value: roundMoney(l.discount2_value||0), discount2_type: l.discount2_type,
      }));

      // Atomic: header + items + adjust_stock in one Postgres transaction.
      // See supabase-migrations/002_create_stock_movement_with_items.sql.
      const { data: head, error: e1 } = await sb.rpc('create_stock_movement_with_items', {
        p_kind: kind,
        p_header: headerPayload,
        p_items: itemsPayload,
      });
      if (e1) throw e1;

      const verb = kind==='receive' ? 'การรับ' : kind==='claim' ? 'ส่งเคลม' : 'การคืน';
      toast.push(`บันทึก${verb} #${head.id} สำเร็จ`, 'success');
      setItems([]); setNotes(""); setSupplierName(""); setSupplierInvoiceNo(""); setOrigSaleId(""); setReturnReason("");
      setSelectedSale(null); setSaleSearch(""); setOrigSaleMode('search');
      // Cost % toggle: 'once' resets after save, 'persist' stays on until leaving page
      if (costPctMode !== 'persist') { setCostPctEnabled(false); setCostPct(58); setCostPctMode('once'); }
      setAttemptedSubmit(false); setConfirmOpen(false);
    } catch (e) {
      toast.push("บันทึกไม่ได้: " + mapError(e), 'error');
    } finally { setSubmitting(false); submitLockRef.current = false; }
  };

  const supplierLabel = kind==='receive' ? 'ผู้ขาย / Supplier' : 'บริษัทที่ส่งคืน';
  const invoiceLabel  = kind==='receive' ? 'เลขบิล' : 'เลขเอกสารส่งคืน / Tracking';
  const verbLabel     = kind==='receive' ? 'การรับ' : kind==='claim' ? 'ส่งเคลม' : 'การคืน';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 lg:items-start">
      {/* LEFT: Search only */}
      <div className="lg:col-span-7 space-y-4 lg:space-y-0 lg:flex lg:flex-col lg:gap-4">
        <div className="card-canvas overflow-hidden lg:flex lg:flex-col">
          <div className="p-3 lg:p-4 border-b hairline">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none text-muted z-10"><Icon name="search" size={20} strokeWidth={2.25}/></span>
                <input
                  ref={productSearchRef}
                  className="input !pl-12 !py-3 !text-base"
                  placeholder={
                    kind==='receive' ? "ค้นหาสินค้าที่จะรับเข้า (ชื่อรุ่น / บาร์โค้ด)" :
                    kind==='claim'   ? "ค้นหาสินค้าที่จะส่งเคลม/คืนบริษัท (ชื่อรุ่น / บาร์โค้ด)" :
                                       "ค้นหาสินค้าที่ลูกค้าคืน (ชื่อรุ่น / บาร์โค้ด)"
                  }
                  value={search}
                  onChange={e=>setSearch(e.target.value)}
                  autoFocus
                />
                {search && (
                  <button className="absolute right-3 top-1/2 -translate-y-1/2 btn-ghost !p-2 !min-h-0" onClick={()=>{setSearch("");setResults([]);}} aria-label="ล้างคำค้น">
                    <Icon name="x" size={18}/>
                  </button>
                )}
              </div>
              <button type="button" className="scan-inline-btn" onClick={()=>setScannerOpen(true)} aria-label="สแกนด้วยกล้อง">
                <Icon name="camera" size={20}/>
              </button>
            </div>
            {results.length>0 && (
              <div className="text-xs text-muted-soft mt-2">เลือกได้หลายรายการ — รายการค้นหาจะอยู่จนกว่าจะกด ×</div>
            )}
          </div>
          {!search && <div className="p-6 text-muted text-sm">พิมพ์เพื่อค้นหา แล้วแตะเพื่อเพิ่มรายการ — สามารถเลือกหลายรุ่น/หลายสีติดต่อกันได้โดยไม่ต้องค้นหาใหม่</div>}
          {search && !results.length && <div className="p-6 text-muted text-sm">ไม่พบสินค้า "{search}"</div>}
          <div className="max-h-[50vh] lg:max-h-[calc(100vh-380px)] overflow-y-auto">
            {results.map(p => (
              <div key={p.id} className="px-4 py-3 border-b hairline last:border-0 hover:bg-white/40 cursor-pointer flex items-center gap-3 transition-colors" onClick={()=>addItem(p)}>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate text-sm">{p.name}</div>
                  <div className="text-xs text-muted font-mono truncate">{p.barcode||'—'}</div>
                </div>
                <div className="text-right text-xs flex-shrink-0 tabular-nums">
                  <div className="text-muted">ทุน {fmtTHB(p.cost_price)}</div>
                  <div>ขาย {fmtTHB(p.retail_price)}</div>
                </div>
                <button className="btn-primary !py-2 !px-3 !min-h-[40px] flex-shrink-0" aria-label="เพิ่ม"><Icon name="plus" size={16}/></button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT: Items list + Bill details + Submit */}
      <div className="lg:col-span-5 lg:sticky lg:top-4">
        <div className="card-cream overflow-hidden">
          <div className="p-4 lg:p-5 border-b hairline flex items-center justify-between gap-3">
            <div>
              <div className="font-display text-2xl">{kind==='receive'?'รายการรับเข้า':kind==='claim'?'รายการส่งเคลม/คืน':'รายการคืน'}</div>
              <div className="text-xs text-muted mt-0.5">{items.length} รายการ</div>
            </div>
          </div>

          {/* Cost % toggle (receive + claim) */}
          {(kind==='receive' || kind==='claim') && (
            <CostPercentToggle
              Icon={Icon} fmtTHB={fmtTHB}
              enabled={costPctEnabled} value={costPct} mode={costPctMode}
              onToggleOff={()=>{ setCostPctEnabled(false); setCostPctMode('once'); }}
              onOpenChooser={()=>setCostPctChooserOpen(true)}
              onChangeValue={(v)=>setCostPct(v)}
              sampleRetailPrice={items[0]?.retail_price}
            />
          )}

          <MovementItemsPanel
            Icon={Icon} fmtTHB={fmtTHB} applyDiscounts={applyDiscounts} UNITS={UNITS}
            items={items} kind={kind}
            costPctEnabled={costPctEnabled} costPct={costPct}
            onUpdItem={upd} onUpdPrice={updPrice} onRemoveItem={rm}
            showItemsError={attemptedSubmit && !items.length}
          />

          {/* BILL DETAILS — moved from left panel */}
          <div className="p-4 lg:p-5 border-t hairline bg-white/30 space-y-3">
            <div className="text-xs uppercase tracking-wider text-muted">รายละเอียดบิล</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className={"rounded-xl" + errCls('date')}>
                <label className="text-xs uppercase tracking-wider text-muted">วันที่</label>
                <DatePicker mode="single" value={date} onChange={setDate} placeholder="เลือกวันที่" className="mt-1"/>
              </div>
              {kind==='return' && (
                <div>
                  <label className="text-xs uppercase tracking-wider text-muted">ช่องทางที่ลูกค้าคืน</label>
                  <select className="input mt-1 !h-10" value={channel} onChange={e=>setChannel(e.target.value)}>
                    {CHANNELS.map(c=><option key={c.v} value={c.v}>{c.label}</option>)}
                  </select>
                </div>
              )}
            </div>

            {(kind==='receive' || kind==='claim') && (
              <SupplierForm
                Icon={Icon} kind={kind}
                SUPPLIERS={SUPPLIERS} CLAIM_REASONS={CLAIM_REASONS}
                supplierName={supplierName} setSupplierName={setSupplierName}
                supplierInvoiceNo={supplierInvoiceNo} setSupplierInvoiceNo={setSupplierInvoiceNo}
                hasVat={hasVat} setHasVat={setHasVat}
                returnReason={returnReason} setReturnReason={setReturnReason}
                errCls={errCls}
              />
            )}

            {kind==='return' && (
              <SalePickerForReturn
                Icon={Icon} fmtTHB={fmtTHB} fmtThaiDateShort={fmtThaiDateShort}
                CHANNEL_LABELS={CHANNEL_LABELS}
                items={items}
                origSaleMode={origSaleMode} setOrigSaleMode={setOrigSaleMode}
                selectedSale={selectedSale}
                saleSearch={saleSearch} setSaleSearch={setSaleSearch}
                saleResults={saleResults} saleSearching={saleSearching}
                origSaleId={origSaleId} setOrigSaleId={setOrigSaleId}
                onSelectSale={selectSale}
                onClearSale={()=>{ setSelectedSale(null); setSaleSearch(""); setOrigSaleId(""); }}
                onWantManualButNoItems={()=>{
                  toast.push("กรุณาเลือกสินค้าก่อน", 'error');
                  productSearchRef.current?.focus();
                }}
              />
            )}

            <div>
              <label className="text-xs uppercase tracking-wider text-muted">หมายเหตุ</label>
              <textarea className="input mt-1" rows="2" placeholder={
                kind==='receive' ? "เช่น เลขล็อต / ตำหนิ / ข้อตกลงพิเศษ" :
                kind==='claim'   ? "เช่น รายละเอียดความเสียหาย / ข้อตกลงเคลมกับ supplier" :
                                   "เช่น สภาพสินค้าที่คืนมา / เปลี่ยนเป็นรุ่นใหม่"
              } value={notes} onChange={e=>setNotes(e.target.value)} />
            </div>
          </div>

          <div className="p-4 lg:p-5 border-t hairline bg-surface-cream-strong">
            <div className="flex justify-between font-display text-2xl mb-3"><span>รวม</span><span>{fmtTHB(total)}</span></div>
            <button className="btn-primary w-full !py-3" disabled={submitting||!items.length} onClick={requestSubmit}>
              {submitting?'กำลังบันทึก...':<><Icon name="check" size={16}/>บันทึก{verbLabel}</>}
            </button>
          </div>
        </div>
      </div>

      {/* CONFIRM MODAL */}
      <Modal
        open={confirmOpen}
        onClose={()=>!submitting && setConfirmOpen(false)}
        title={`ยืนยัน${verbLabel}`}
        footer={<>
          <button className="btn-ghost" disabled={submitting} onClick={()=>setConfirmOpen(false)}>ยกเลิก</button>
          <button className="btn-primary" disabled={submitting} onClick={submit}>
            {submitting ? 'กำลังบันทึก...' : <><Icon name="check" size={16}/> ยืนยันบันทึก</>}
          </button>
        </>}
      >
        <div className="space-y-3 text-sm">
          <div className="flex justify-between"><span className="text-muted">จำนวนรายการ</span><span className="font-medium">{items.length} รายการ</span></div>
          <div className="flex justify-between"><span className="text-muted">วันที่</span><span className="font-medium">{date ? fmtThaiDateShort(date) : '—'}</span></div>
          {(kind==='receive' || kind==='claim') && (<>
            <div className="flex justify-between"><span className="text-muted">{supplierLabel}</span><span className="font-medium">{supplierName||'—'}</span></div>
            <div className="flex justify-between gap-3">
              <span className="text-muted flex-shrink-0">{invoiceLabel}</span>
              <span className="font-medium font-mono text-right break-all">
                {supplierInvoiceNo.trim()
                  ? supplierInvoiceNo
                  : <span className="text-muted-soft">— จะสร้างอัตโนมัติ —</span>}
              </span>
            </div>
            <div className="flex justify-between"><span className="text-muted">VAT</span><span className="font-medium">{hasVat?'รวม VAT 7%':'ไม่มี VAT'}</span></div>
          </>)}
          {kind==='return' && (
            <div className="flex justify-between"><span className="text-muted">ช่องทาง</span><span className="font-medium">{CHANNELS.find(c=>c.v===channel)?.label||'—'}</span></div>
          )}
          <div className="border-t hairline pt-3 flex justify-between font-display text-2xl"><span>รวม</span><span className="tabular-nums">{fmtTHB(total)}</span></div>
        </div>
      </Modal>

      {/* COST % CHOOSER MODAL */}
      <Modal
        open={costPctChooserOpen}
        onClose={()=>setCostPctChooserOpen(false)}
        title="คำนวณทุนจากราคาป้าย"
      >
        <div className="space-y-3">
          <div className="text-sm text-muted">เลือกโหมดการใช้งาน — ปกติจะปิดเองหลังบันทึกบิลนี้</div>
          <button
            type="button"
            className="w-full text-left p-4 rounded-xl border border-hairline hover:border-primary hover:bg-white/60 transition-all hover-lift"
            onClick={()=>{ setCostPctEnabled(true); setCostPctMode('once'); setCostPctChooserOpen(false); }}
          >
            <div className="font-medium text-sm flex items-center gap-2">
              <Icon name="check" size={14} className="text-primary"/> เปิดเฉพาะรายการนี้
            </div>
            <div className="text-xs text-muted mt-1">เปิดอยู่จนกว่าจะกดบันทึก จากนั้นปิดอัตโนมัติ</div>
          </button>
          <button
            type="button"
            className="w-full text-left p-4 rounded-xl border border-hairline hover:border-primary hover:bg-white/60 transition-all hover-lift"
            onClick={()=>{ setCostPctEnabled(true); setCostPctMode('persist'); setCostPctChooserOpen(false); }}
          >
            <div className="font-medium text-sm flex items-center gap-2">
              <Icon name="check" size={14} className="text-primary"/> เปิดตลอด
            </div>
            <div className="text-xs text-muted mt-1">เปิดค้างไว้สำหรับทุกบิลถัดไป จนกว่าจะออกจากหน้านี้</div>
          </button>
        </div>
      </Modal>

      {/* Camera barcode scanner — continuous mode (matches POS UX). */}
      <BarcodeScannerModal
        open={scannerOpen}
        onClose={()=>setScannerOpen(false)}
        onScan={handleCameraScan}
        mode="continuous"
        title={kind==='receive' ? 'สแกนสินค้าที่รับเข้า' : kind==='claim' ? 'สแกนสินค้าที่ส่งคืน' : 'สแกนสินค้าที่ลูกค้าคืน'}
      />
    </div>
  );
}

/* =========================================================
   DASHBOARD VIEW
========================================================= */
function DashboardView() {
  const today = todayISO();
  const [dateRange, setDateRange] = useState({ from: today, to: today });
  const [stats, setStats] = useState(null);
  const [topProducts, setTopProducts] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [byChannel, setByChannel] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(()=>{ (async ()=>{
    setLoading(true);
    setStats(null);
    const { from, to } = dateRange;

    const [rangeQ, lowQ] = await Promise.all([
      sb.from('sale_orders').select('id, grand_total, channel, net_received').eq('status','active')
        .gte('sale_date', startOfDayBangkok(from)).lte('sale_date', endOfDayBangkok(to)),
      sb.from('products').select('id,name,current_stock').lt('current_stock', 5).gt('current_stock', -1).order('current_stock', { ascending: true }).limit(8),
    ]);

    const rangeRows = rangeQ.data || [];
    // For e-commerce sales the actual shop revenue is net_received (after platform fee).
    // Fallback to grand_total when net_received hasn't been entered yet.
    const revenueOf = (r) => (ECOMMERCE_CHANNELS.has(r.channel) && r.net_received != null)
      ? Number(r.net_received)
      : Number(r.grand_total) || 0;
    const rangeTotal = rangeRows.reduce((s,r)=>s+revenueOf(r),0);

    const chMap = {};
    rangeRows.forEach(r=>{ const k = r.channel||'store'; chMap[k]=(chMap[k]||0)+revenueOf(r); });
    setByChannel(Object.entries(chMap).map(([k,v])=>({ channel:k, total:v })));

    setStats({ rangeCount: rangeRows.length, rangeTotal });
    setLowStock(lowQ.data || []);

    const ids = rangeRows.map(x=>x.id);
    if (ids.length) {
      const { data: items } = await sb.from('sale_order_items').select('product_name,quantity').in('sale_order_id', ids);
      const map = {};
      (items||[]).forEach(it => { map[it.product_name] = (map[it.product_name]||0) + (Number(it.quantity)||0); });
      const top = Object.entries(map).map(([name,q])=>({name,q})).sort((a,b)=>b.q-a.q).slice(0,8);
      setTopProducts(top);
    } else setTopProducts([]);
    setLoading(false);
  })(); }, [dateRange.from, dateRange.to]);

  const StatCard = ({ tone, label, value, sub, icon }) => (
    <div className={
      "rounded-lg p-4 lg:p-6 " +
      (tone==='canvas' ? "card-canvas" :
       tone==='cream'  ? "card-cream"  :
       tone==='dark'   ? "card-dark"   :
       "card-primary-mesh text-on-primary")
    }>
      <div className="flex items-center justify-between">
        <div className={"text-[10px] lg:text-xs uppercase tracking-[1.5px] " + (tone==='dark'?'text-on-dark-soft':tone==='coral'?'opacity-90':'text-muted')}>{label}</div>
        <span className={tone==='dark'?'text-on-dark-soft':tone==='coral'?'opacity-80':'text-muted-soft'}><Icon name={icon} size={18}/></span>
      </div>
      <div className="font-display stat-value tabular-nums mt-2" title={String(value)}>{value}</div>
      {sub && <div className={"text-xs mt-1 " + (tone==='dark'?'text-on-dark-soft':tone==='coral'?'opacity-90':'text-muted')}>{sub}</div>}
    </div>
  );

  const rangeLabel = dateRange.from === dateRange.to
    ? fmtThaiDateShort(dateRange.from)
    : fmtThaiRange(dateRange.from, dateRange.to);
  const channelRows = CHANNELS.map(c => {
    const total = byChannel.find(x=>x.channel===c.v)?.total || 0;
    const share = stats?.rangeTotal ? (total / stats.rangeTotal) * 100 : 0;
    return { ...c, total, share };
  });
  const channelMax = Math.max(...channelRows.map(c=>c.total), 1);
  const channelSorted = channelRows.filter(c=>c.total>0).sort((a,b)=>b.total-a.total);
  const CH_META = {
    store:    { bg:'#fef3c7', fg:'#78350f', border:'rgba(217,119,6,0.18)' },
    tiktok:   { bg:'#09090b', fg:'#f4f4f5', border:'rgba(255,45,85,0.35)' },
    shopee:   { bg:'#ea580c', fg:'#ffffff', border:'rgba(255,200,100,0.22)' },
    lazada:   { bg:'#6d28d9', fg:'#ffffff', border:'rgba(196,181,253,0.28)' },
    facebook: { bg:'#1d4ed8', fg:'#ffffff', border:'rgba(147,197,253,0.28)' },
  };

  return (
    <div className="space-y-4 lg:space-y-8">

      {/* Custom page header with date picker */}
      <header className="hidden lg:flex px-10 pt-10 pb-6 items-end justify-between border-b hairline">
        <div>
          <div className="text-xs uppercase tracking-[1.5px] text-muted">Dashboard</div>
          <h1 className="font-display text-5xl mt-2 leading-tight text-ink">แดชบอร์ด</h1>
        </div>
        <div className="flex items-center gap-3 pb-1">
          <DatePicker mode="range" value={dateRange} onChange={setDateRange} placeholder="เลือกช่วงวันที่" className="w-64"/>
          {loading && <span className="spinner text-muted"/>}
        </div>
      </header>

      {/* Mobile date picker */}
      <div className="lg:hidden px-4 pt-4 flex items-center gap-3">
        <Icon name="calendar" size={18} className="text-muted flex-shrink-0"/>
        <DatePicker mode="range" value={dateRange} onChange={setDateRange} placeholder="เลือกช่วงวันที่" className="flex-1"/>
        {loading && <span className="spinner text-muted"/>}
      </div>

      <div className="px-4 lg:px-10 space-y-4 lg:space-y-8 pb-8 cascade">

      {!stats ? (
        <div className="text-muted text-sm flex items-center gap-3"><span className="spinner"/>กำลังโหลดข้อมูล...</div>
      ) : (<>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4" style={{ '--i': 0 }}>
          <StatCard tone="canvas" label="ยอดขายรวม" value={fmtTHB(stats.rangeTotal)} sub={`${stats.rangeCount} บิล`} icon="trend-up"/>
          <StatCard tone="cream"  label="จำนวนบิล" value={stats.rangeCount} sub={rangeLabel} icon="receipt"/>
          <StatCard tone="dark"   label="เฉลี่ยต่อบิล" value={stats.rangeCount? fmtTHB(stats.rangeTotal/stats.rangeCount):'—'} sub={rangeLabel} icon="credit-card"/>
          <StatCard tone="coral"  label="สต็อกใกล้หมด" value={lowStock.length} sub="รายการ (น้อยกว่า 5)" icon="alert"/>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6" style={{ '--i': 1 }}>
          <div className="lg:col-span-7 card-canvas p-4 lg:p-6">
            <div className="font-display text-xl lg:text-2xl mb-3 lg:mb-4 flex items-center gap-2"><Icon name="trend-up" size={20}/> สินค้าขายดีในช่วงนี้</div>
            {!topProducts.length && <div className="text-muted text-sm">ยังไม่มียอดขายในช่วงที่เลือก</div>}
            {topProducts.map((p,i)=>(
              <div key={p.name} className="flex items-center gap-3 py-2 border-b hairline-soft last:border-0">
                <div className="font-display text-xl lg:text-2xl w-7 text-muted-soft">{i+1}</div>
                <div className="flex-1 truncate text-sm">{p.name}</div>
                <div className="badge-pill">{p.q} ชิ้น</div>
              </div>
            ))}
          </div>
          <div className="lg:col-span-5 card-canvas p-4 lg:p-6">
            <div className="font-display text-xl lg:text-2xl mb-3 lg:mb-4 flex items-center gap-2"><Icon name="alert" size={20}/> สต็อกใกล้หมด</div>
            {!lowStock.length && <div className="text-muted text-sm">สต็อกปลอดภัย</div>}
            {lowStock.map(p => (
              <div key={p.id} className="flex items-center gap-3 py-2 border-b hairline-soft last:border-0">
                <div className="flex-1 truncate text-sm">{p.name}</div>
                <span className={"badge-pill " + (p.current_stock<=0?'!bg-error/10 !text-error':'!bg-warning/15 !text-[#8a6500]')}>{p.current_stock}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card-dark p-4 lg:p-6" style={{ '--i': 2 }}>
          <div className="flex items-start justify-between gap-3 mb-3 lg:mb-4">
            <div className="font-display text-xl lg:text-2xl flex items-center gap-2"><Icon name="store" size={20}/> ยอดขายแยกช่องทาง</div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-on-dark-soft">รวม</div>
              <div className="font-display text-lg tabular-nums">{fmtTHB(stats.rangeTotal)}</div>
            </div>
          </div>
          {!channelSorted.length && <div className="text-on-dark-soft text-sm">ยังไม่มียอดขายในช่วงที่เลือก</div>}

          {/* Mobile — horizontal bar list (Phase 3.1): readable labels + amounts on small screens */}
          {channelSorted.length>0 && (
            <div className="lg:hidden space-y-2.5">
              {channelSorted.map(ch => {
                const m = CH_META[ch.v] || { bg:'#f3f4f6', fg:'#111827', border:'rgba(0,0,0,0.1)' };
                return (
                  <div key={ch.v} className="flex items-center gap-3">
                    <div
                      className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center"
                      style={{ background: m.bg, border: `1px solid ${m.border}` }}
                    >
                      {ch.v==='store'    && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={m.fg} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18v13a1 1 0 01-1 1H4a1 1 0 01-1-1V7z"/><path d="M3 7 5.5 3h13L21 7"/><path d="M9 21V13h6v8"/></svg>}
                      {ch.v==='tiktok'   && <svg width="18" height="18" viewBox="0 0 24 24" fill={m.fg}><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 000 12.68 6.34 6.34 0 006.33-6.34V7.83a8.16 8.16 0 004.77 1.52V5.9a4.85 4.85 0 01-1-.21z"/></svg>}
                      {ch.v==='shopee'   && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={m.fg} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 01-8 0"/></svg>}
                      {ch.v==='lazada'   && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={m.fg} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 8v7h7"/></svg>}
                      {ch.v==='facebook' && <svg width="18" height="18" viewBox="0 0 24 24" fill={m.fg}><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/></svg>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <span className="text-sm font-medium text-on-dark truncate">{ch.label}</span>
                        <span className="text-xs text-on-dark-soft tabular-nums flex-shrink-0">
                          <span className="font-medium text-on-dark">{ch.share.toFixed(0)}%</span>
                          <span className="mx-1.5 opacity-40">·</span>
                          {fmtTHB(ch.total)}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${Math.max(2, ch.share)}%`, background: m.bg, boxShadow: `0 0 0 1px ${m.border} inset` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Desktop — masonry tiles */}
          {channelSorted.length>0 && (
            <div className="hidden lg:grid grid-cols-4 gap-2 lg:gap-3" style={{gridAutoRows:'110px'}}>
              {channelSorted.map((ch, idx) => {
                const big = idx === 0;
                const m = CH_META[ch.v] || { bg:'#f3f4f6', fg:'#111827', border:'rgba(0,0,0,0.1)' };
                const iconSize = big ? 34 : 20;
                const sw = 1.5;
                return (
                  <div key={ch.v}
                    className={"rounded-2xl p-3 lg:p-4 flex flex-col justify-between transition-all duration-200 hover:scale-[1.02] hover:shadow-xl " + (big ? "col-span-2 row-span-2" : "col-span-1 row-span-1")}
                    style={{ background: m.bg, border: `1px solid ${m.border}`, gridRow: big ? 'span 2' : undefined }}
                  >
                    <div className="flex items-start justify-between gap-1">
                      {ch.v==='store'    && <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke={m.fg} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18v13a1 1 0 01-1 1H4a1 1 0 01-1-1V7z"/><path d="M3 7 5.5 3h13L21 7"/><path d="M9 21V13h6v8"/></svg>}
                      {ch.v==='tiktok'   && <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill={m.fg}><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 000 12.68 6.34 6.34 0 006.33-6.34V7.83a8.16 8.16 0 004.77 1.52V5.9a4.85 4.85 0 01-1-.21z"/></svg>}
                      {ch.v==='shopee'   && <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke={m.fg} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 01-8 0"/></svg>}
                      {ch.v==='lazada'   && <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke={m.fg} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 8v7h7"/></svg>}
                      {ch.v==='facebook' && <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill={m.fg}><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/></svg>}
                      <span className="text-[9px] lg:text-[10px] font-semibold uppercase tracking-wider leading-tight text-right" style={{color:m.fg, opacity:0.5}}>{ch.label}</span>
                    </div>
                    <div>
                      <div className={"font-display leading-none tabular-nums " + (big ? "text-5xl lg:text-7xl" : "text-2xl lg:text-3xl")} style={{color:m.fg}}>
                        {ch.share.toFixed(0)}<span className={"font-sans font-normal " + (big ? "text-xl lg:text-2xl" : "text-sm")} style={{opacity:0.45}}>%</span>
                      </div>
                      <div className={"mt-1 tabular-nums font-medium " + (big ? "text-xs lg:text-sm" : "text-[10px]")} style={{color:m.fg, opacity:0.6}}>
                        {fmtTHB(ch.total)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </>)}
      </div>
    </div>
  );
}

/* =========================================================
   PROFIT / LOSS VIEW
========================================================= */
function ProfitLossView() {
  const today = todayISO();
  const [dateRange, setDateRange] = useState({ from: today, to: today });
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]); // per-line: { sale_id, sale_date, channel, product_id, product_name, qty, unit_price, lineRevenue, unitCost, costTotal, profit, costSource }
  const [filterChannel, setFilterChannel] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  useEffect(()=>{ (async ()=>{
    setLoading(true);
    setRows([]);
    setPage(1);
    const { from, to } = dateRange;
    try {
      // 1) Sales in range (active only)
      const { data: orders } = await sb.from('sale_orders')
        .select('id, sale_date, channel, grand_total, subtotal, net_received')
        .eq('status', 'active')
        .gte('sale_date', startOfDayBangkok(from))
        .lte('sale_date', endOfDayBangkok(to))
        .order('sale_date', { ascending: false });
      const ordersList = orders || [];
      if (!ordersList.length) { setRows([]); setLoading(false); return; }

      const orderIds = ordersList.map(o=>o.id);
      // 2) Items
      const { data: itemsData } = await sb.from('sale_order_items')
        .select('*')
        .in('sale_order_id', orderIds);
      const items = itemsData || [];

      const pids = [...new Set(items.map(i=>i.product_id).filter(Boolean))];

      // 3) Receive history (only active i.e. voided_at IS NULL)
      let recvRows = [];
      if (pids.length) {
        const { data } = await sb.from('receive_order_items')
          .select('product_id, unit_price, receive_orders!inner(receive_date, voided_at)')
          .in('product_id', pids)
          .is('receive_orders.voided_at', null);
        recvRows = data || [];
      }
      // Map: product_id -> sorted [{date, unit_price}] desc
      const recvMap = {};
      recvRows.forEach(r => {
        const date = r.receive_orders?.receive_date;
        if (!date) return;
        (recvMap[r.product_id] ||= []).push({ date: new Date(date).getTime(), unit_price: Number(r.unit_price)||0 });
      });
      Object.values(recvMap).forEach(arr => arr.sort((a,b)=>b.date-a.date));

      // 4) Products fallback
      let prodMap = {};
      if (pids.length) {
        const { data: prods } = await sb.from('products').select('id, cost_price').in('id', pids);
        (prods||[]).forEach(p => { prodMap[p.id] = Number(p.cost_price)||0; });
      }

      // 5) Build per-line rows
      const orderById = Object.fromEntries(ordersList.map(o=>[o.id, o]));
      const itemsByOrder = {};
      items.forEach(it => { (itemsByOrder[it.sale_order_id] ||= []).push(it); });

      const result = [];
      for (const o of ordersList) {
        const lines = itemsByOrder[o.id] || [];
        const lineRevenues = lines.map(it => applyDiscounts(it.unit_price, it.quantity, it.discount1_value, it.discount1_type, it.discount2_value, it.discount2_type));
        const subtotalCalc = lineRevenues.reduce((s,x)=>s+x, 0);
        // For e-commerce sales, real revenue = net_received (after platform fees);
        // for store/facebook (or e-commerce without net_received yet), revenue = grand_total.
        const revenueBase = (ECOMMERCE_CHANNELS.has(o.channel) && o.net_received != null)
          ? Number(o.net_received)
          : Number(o.grand_total) || 0;
        // distribute order-level discount + platform fee proportionally per line.
        const ratio = subtotalCalc > 0 ? revenueBase / subtotalCalc : 1;
        const saleTs = new Date(o.sale_date).getTime();

        lines.forEach((it, idx) => {
          const qty = Number(it.quantity)||0;
          const lineRev = lineRevenues[idx] * ratio;
          let unitCost = 0;
          let costSource = 'fallback';
          if (it.product_id) {
            const list = recvMap[it.product_id];
            if (list && list.length) {
              const found = list.find(r => r.date <= saleTs);
              if (found) { unitCost = found.unit_price; costSource = 'receive'; }
              else { unitCost = prodMap[it.product_id] || 0; costSource = 'fallback'; }
            } else {
              unitCost = prodMap[it.product_id] || 0;
              costSource = 'fallback';
            }
          }
          const costTotal = unitCost * qty;
          const profit = lineRev - costTotal;
          result.push({
            sale_id: o.id,
            sale_date: o.sale_date,
            channel: o.channel || '',
            product_id: it.product_id,
            product_name: it.product_name,
            qty,
            unit_price: Number(it.unit_price)||0,
            lineRevenue: lineRev,
            unitCost,
            costTotal,
            profit,
            costSource,
          });
        });
      }
      setRows(result);
    } catch (e) {
      console.error(e);
      setRows([]);
    } finally { setLoading(false); }
  })(); }, [dateRange.from, dateRange.to]);

  // Filtered rows (channel + search)
  const filtered = useMemo(()=>{
    return rows.filter(r => {
      if (filterChannel && r.channel !== filterChannel) return false;
      if (search.trim() && !r.product_name?.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [rows, filterChannel, search]);

  // Aggregates
  const agg = useMemo(()=>{
    let revenue = 0, cost = 0, profit = 0;
    filtered.forEach(r => { revenue += r.lineRevenue; cost += r.costTotal; profit += r.profit; });
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    return { revenue, cost, profit, margin };
  }, [filtered]);

  // Top 10 by profit
  const topProfit = useMemo(()=>{
    const map = {};
    filtered.forEach(r => {
      const key = r.product_id || `name:${r.product_name}`;
      if (!map[key]) map[key] = { name: r.product_name, qty: 0, profit: 0, revenue: 0 };
      map[key].qty += r.qty;
      map[key].profit += r.profit;
      map[key].revenue += r.lineRevenue;
    });
    return Object.values(map).sort((a,b)=>b.profit-a.profit).slice(0,10);
  }, [filtered]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);
  useEffect(()=>{ if (page > totalPages) setPage(1); }, [totalPages, page]);

  const rangeLabel = dateRange.from === dateRange.to
    ? fmtThaiDateShort(dateRange.from)
    : fmtThaiRange(dateRange.from, dateRange.to);

  const StatCard = ({ tone, label, value, sub, icon }) => (
    <div className={
      "rounded-lg p-4 lg:p-6 " +
      (tone==='canvas' ? "card-canvas" :
       tone==='cream'  ? "card-cream"  :
       tone==='dark'   ? "card-dark"   :
       "card-primary-mesh text-on-primary")
    }>
      <div className="flex items-center justify-between">
        <div className={"text-[10px] lg:text-xs uppercase tracking-[1.5px] " + (tone==='dark'?'text-on-dark-soft':tone==='coral'?'opacity-90':'text-muted')}>{label}</div>
        <span className={tone==='dark'?'text-on-dark-soft':tone==='coral'?'opacity-80':'text-muted-soft'}><Icon name={icon} size={18}/></span>
      </div>
      <div className="font-display stat-value tabular-nums mt-2" title={String(value)}>{value}</div>
      {sub && <div className={"text-xs mt-1 " + (tone==='dark'?'text-on-dark-soft':tone==='coral'?'opacity-90':'text-muted')}>{sub}</div>}
    </div>
  );

  // Quick presets — all dates Bangkok-local
  const setPreset = (preset) => {
    const t = new Date();
    const iso = dateISOBangkok;
    if (preset === 'today') setDateRange({ from: iso(t), to: iso(t) });
    else if (preset === '7d') { const d = new Date(t); d.setDate(d.getDate()-6); setDateRange({ from: iso(d), to: iso(t) }); }
    else if (preset === 'month') { setDateRange({ from: iso(t).slice(0,7)+'-01', to: iso(t) }); }
    else if (preset === 'year')  { setDateRange({ from: iso(t).slice(0,4)+'-01-01', to: iso(t) }); }
  };

  const DateControls = (
    <>
      <DatePicker mode="range" value={dateRange} onChange={setDateRange} placeholder="เลือกช่วงวันที่" className="w-64"/>
      {loading && <span className="spinner text-muted ml-2"/>}
    </>
  );
  return (
    <div>
      {/* Desktop header */}
      <header className="hidden lg:flex px-10 pt-10 pb-6 items-end justify-between border-b hairline gap-4">
        <div>
          <div className="text-xs uppercase tracking-[1.5px] text-muted">Profit & Loss</div>
          <h1 className="font-display text-5xl mt-2 leading-tight text-ink">กำไร / ขาดทุน</h1>
        </div>
        <div className="flex items-center gap-3 pb-1">{DateControls}</div>
      </header>

      <div className="px-4 py-4 lg:px-10 lg:py-8 space-y-4 lg:space-y-6">

      {/* Disclaimer (Phase 3.3): only show when range includes pre-June-2026 dates,
          since cost data was incomplete then and the calc may be approximate. */}
      {dateRange.from < '2026-06-01' && (
        <div className="rounded-xl border-2 border-dashed border-red-300/70 bg-red-50/40 px-4 py-2.5 text-xs lg:text-sm text-red-700/80">
          ข้อมูลก่อน <span className="font-medium">มิถุนายน 2026</span> อาจคำนวณกำไรไม่แม่นยำ — ทุนของบางรายการเป็นค่าประมาณ
        </div>
      )}

      {/* Mobile date controls */}
      <div className="flex flex-wrap items-center gap-2 lg:hidden">
        <Icon name="calendar" size={18} className="text-muted flex-shrink-0"/>
        {DateControls}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <StatCard tone="canvas" label="ยอดขายสุทธิ" value={fmtTHB(agg.revenue)} sub={rangeLabel} icon="trend-up"/>
        <StatCard tone="cream"  label="ต้นทุนรวม" value={fmtTHB(agg.cost)} sub={`${filtered.length} รายการ`} icon="package-in"/>
        <StatCard tone={agg.profit>=0?"dark":"coral"} label="กำไรสุทธิ" value={fmtTHB(agg.profit)} sub={agg.profit>=0?"กำไร":"ขาดทุน"} icon="trend-up"/>
        <StatCard tone="coral"  label="Margin" value={`${agg.margin.toFixed(1)}%`} sub="กำไร / ยอดขาย" icon="tag"/>
      </div>

      {/* Top 10 */}
      <div className="card-canvas p-4 lg:p-6">
        <div className="font-display text-xl lg:text-2xl mb-3 lg:mb-4 flex items-center gap-2">
          <Icon name="trend-up" size={20}/> Top 10 สินค้าทำกำไรสูงสุด
        </div>
        {!topProfit.length && <div className="text-muted text-sm">ยังไม่มีข้อมูลในช่วงที่เลือก</div>}
        {topProfit.map((p,i)=>(
          <div key={p.product_id || p.name || i} className="flex items-center gap-3 py-2 border-b hairline-soft last:border-0">
            <div className="font-display text-xl lg:text-2xl w-7 text-muted-soft">{i+1}</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm truncate font-medium">{p.name}</div>
              <div className="text-xs text-muted">ขาย {p.qty} ชิ้น · ยอด {fmtTHB(p.revenue)}</div>
            </div>
            <div className={"font-display text-base lg:text-lg tabular-nums " + (p.profit>=0?"text-ink":"text-error")}>
              {p.profit>=0?'+':''}{fmtTHB(p.profit)}
            </div>
          </div>
        ))}
      </div>

      {/* Detail table */}
      <div className="card-cream overflow-hidden">
        <div className="p-4 lg:p-5 border-b hairline space-y-3">
          <div className="font-display text-xl lg:text-2xl flex items-center gap-2"><Icon name="receipt" size={20}/> รายละเอียดทุกรายการ</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 lg:gap-3">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted z-10"><Icon name="search" size={16} strokeWidth={2.25}/></span>
              <input className="input !pl-9 !py-2 !text-sm" placeholder="ค้นหาชื่อสินค้า" value={search} onChange={e=>setSearch(e.target.value)}/>
            </div>
            <select className="input !py-2 !text-sm" value={filterChannel} onChange={e=>setFilterChannel(e.target.value)}>
              <option value="">ทุกช่องทาง</option>
              {CHANNELS.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
            </select>
          </div>
        </div>

        {/* Desktop table */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-cream-strong/95 backdrop-blur z-10">
              <tr className="text-[10px] uppercase tracking-wider text-muted">
                <th className="text-left px-4 py-2 font-medium">บิล</th>
                <th className="text-left px-2 py-2 font-medium">วันที่</th>
                <th className="text-left px-2 py-2 font-medium">สินค้า</th>
                <th className="text-left px-2 py-2 font-medium">ช่องทาง</th>
                <th className="text-right px-2 py-2 font-medium">จำนวน</th>
                <th className="text-right px-2 py-2 font-medium">ขาย</th>
                <th className="text-right px-2 py-2 font-medium">ทุน/หน่วย</th>
                <th className="text-right px-2 py-2 font-medium">ทุนรวม</th>
                <th className="text-right px-2 py-2 font-medium">กำไร</th>
                <th className="text-right px-4 py-2 font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {!loading && !pageRows.length && (
                <tr><td colSpan="10" className="text-center text-muted py-8">ไม่มีบิลในช่วงที่เลือก ลองขยายช่วงวันที่หรือเปลี่ยนตัวกรอง</td></tr>
              )}
              {pageRows.map((r, i) => {
                const pct = r.lineRevenue > 0 ? (r.profit / r.lineRevenue) * 100 : 0;
                return (
                  <tr key={`${r.sale_id}-${r.product_id || r.product_name}-${i}`} className="border-b hairline-soft hover:bg-white/40">
                    <td className="px-4 py-2 font-mono text-xs">#{r.sale_id}</td>
                    <td className="px-2 py-2 text-xs whitespace-nowrap">{fmtThaiDateShort(r.sale_date.slice(0,10))}</td>
                    <td className="px-2 py-2">
                      <div className="truncate max-w-[260px]" title={r.product_name}>{r.product_name}</div>
                      {r.costSource==='fallback' && <span className="badge-pill !bg-warning/15 !text-[#8a6500] !text-[10px] mt-0.5">ทุนประมาณ</span>}
                    </td>
                    <td className="px-2 py-2"><span className="badge-pill !text-[10px]">{CHANNEL_LABELS[r.channel]||r.channel||'—'}</span></td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.qty}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtTHB(r.lineRevenue)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted">{fmtTHB(r.unitCost)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted">{fmtTHB(r.costTotal)}</td>
                    <td className={"px-2 py-2 text-right tabular-nums font-medium " + (r.profit>=0?"text-ink":"text-error")}>
                      {r.profit>=0?'+':''}{fmtTHB(r.profit)}
                    </td>
                    <td className={"px-4 py-2 text-right tabular-nums text-xs " + (r.profit>=0?"text-muted":"text-error")}>
                      {pct.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="lg:hidden p-3 space-y-2">
          {!loading && !pageRows.length && <div className="text-center text-muted text-sm py-8">ไม่มีบิลในช่วงที่เลือก<br/>ลองขยายช่วงวันที่หรือเปลี่ยนตัวกรอง</div>}
          {pageRows.map((r,i) => {
            const pct = r.lineRevenue > 0 ? (r.profit / r.lineRevenue) * 100 : 0;
            // Phase 3.2: color-code margin so cashiers can scan profitability at a glance.
            // >30% green · 10–30% yellow · <10% (incl. negative) red.
            const marginCls = r.profit < 0 || pct < 10
              ? 'bg-error/15 text-error'
              : pct < 30
                ? 'bg-[#b45309]/15 text-[#92400e]'
                : 'bg-[#1f3d27]/12 text-[#1f3d27]';
            return (
              <div key={`${r.sale_id}-${r.product_id || r.product_name}-${i}`} className="glass-soft rounded-lg p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{r.product_name}</div>
                    <div className="text-xs text-muted mt-0.5">
                      #{r.sale_id} · {fmtThaiDateShort(r.sale_date.slice(0,10))} · {CHANNEL_LABELS[r.channel]||r.channel||'—'}
                    </div>
                    {r.costSource==='fallback' && <span className="badge-pill !bg-warning/15 !text-[#8a6500] !text-[10px] mt-1">ทุนประมาณ</span>}
                  </div>
                  <div className={"text-right " + (r.profit>=0?"":"text-error")}>
                    <div className="font-display text-base tabular-nums">{r.profit>=0?'+':''}{fmtTHB(r.profit)}</div>
                    <span className={"inline-block mt-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium tabular-nums " + marginCls}>
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2 text-[11px]">
                  <div><div className="text-muted-soft">จำนวน</div><div className="tabular-nums">{r.qty}</div></div>
                  <div><div className="text-muted-soft">ขาย</div><div className="tabular-nums">{fmtTHB(r.lineRevenue)}</div></div>
                  <div><div className="text-muted-soft">ทุน</div><div className="tabular-nums">{fmtTHB(r.costTotal)}</div></div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        {filtered.length > PAGE_SIZE && (
          <div className="p-3 border-t hairline flex items-center justify-between gap-2">
            <div className="text-xs text-muted">
              {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, filtered.length)} จาก {filtered.length}
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-ghost !py-1.5 !px-3 !min-h-0" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>
                <Icon name="chevron-r" size={14} className="rotate-180"/>
              </button>
              <span className="text-xs tabular-nums">{page} / {totalPages}</span>
              <button className="btn-ghost !py-1.5 !px-3 !min-h-0" disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>
                <Icon name="chevron-r" size={14}/>
              </button>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

/* =========================================================
   OFFLINE BANNER
   Persistent strip at the top when network is down OR there are queued
   sales OR the last drain attempt failed. Three visual states:

     - red      offline (bills will queue)
     - yellow   online + draining or queue has pending items
     - dark red online + queue stuck on a hard error → show the message
                + retry button so the cashier isn't stuck staring at a
                forever-spinning "กำลัง sync…"

   Refreshes from window._isOnline + window._onQueueChange +
   window._onDrainStateChange (set up in the main.jsx prelude).
========================================================= */
function OfflineBanner() {
  const [online, setOnline]   = useState(() => (window._isOnline ? window._isOnline() : true));
  const [queued, setQueued]   = useState(0);
  const [drainSt, setDrainSt] = useState(() => window._getDrainState?.() || { state: 'idle', lastError: null });
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const offOnline = window._onOnlineChange?.(setOnline);
    const offQueue  = window._onQueueChange?.(setQueued);
    const offDrain  = window._onDrainStateChange?.(setDrainSt);
    return () => { offOnline?.(); offQueue?.(); offDrain?.(); };
  }, []);

  const handleRetry = async () => {
    setRetrying(true);
    try { await window._tryDrain?.(); } finally { setRetrying(false); }
  };

  if (online && queued === 0 && drainSt.state !== 'error') return null;

  const stuck = online && drainSt.state === 'error' && queued > 0;
  const cls = !online
    ? 'bg-error/15 text-error'
    : stuck
      ? 'bg-error/20 text-error'
      : 'bg-warning/15 text-[#8a6500]';
  const dot = !online || stuck ? 'bg-error' : 'bg-warning';

  return (
    <div
      role="status"
      aria-live="polite"
      className={"sticky top-0 z-[80] w-full text-sm font-medium px-4 py-2 flex items-center justify-center gap-3 flex-wrap " + cls}
    >
      <span className={"inline-block w-2 h-2 rounded-full " + dot} />
      {!online && (
        <>ออฟไลน์ — บิลใหม่จะถูกเก็บในเครื่องและส่งเมื่อออนไลน์{queued > 0 ? ` (รอ ${queued})` : ''}</>
      )}
      {online && stuck && (
        <>
          <span>ส่งบิลในคิวไม่สำเร็จ ({queued} รายการ): <span className="font-normal">{drainSt.lastError}</span></span>
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            className="ml-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-error/15 hover:bg-error/25 text-error text-xs font-medium disabled:opacity-60"
          >
            {retrying ? 'กำลังลอง…' : 'ลองส่งอีกครั้ง'}
          </button>
        </>
      )}
      {online && !stuck && queued > 0 && (
        <>มีบิลรอส่ง {queued} รายการ — กำลัง sync…</>
      )}
    </div>
  );
}

/* =========================================================
   APP SHELL
========================================================= */
function App() {
  const [session, setSession] = useState(undefined);
  const [view, setView] = useState("pos");
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const role = getUserRole(session);

  // Defensive: if a cashier has stale URL state pointing at an admin-only view
  // (or if the role flips during a session), drop them back to POS.
  useEffect(() => {
    if (!session) return;
    const allowed = navForRole(role).map(n => n.k);
    if (!allowed.includes(view)) setView('pos');
  }, [session, role, view]);

  if (session === undefined) return <div className="min-h-screen flex items-center justify-center gap-3 text-muted"><span className="spinner lg"/>กำลังโหลด...</div>;
  if (!session) return <ToastProvider><DialogProvider><LoginScreen /></DialogProvider></ToastProvider>;

  const titles = {
    pos:       { t: "ขายสินค้า",            s: "POS" },
    products:  { t: "สินค้า",                s: "Inventory" },
    sales:     { t: "ประวัติการขาย",          s: "Sales History" },
    receive:   { t: "รับสินค้าจากบริษัท",    s: "Stock In · From Supplier" },
    return:    { t: "รับคืนจากลูกค้า",       s: "Customer Return" },
    dashboard: { t: "แดชบอร์ด",              s: "Dashboard" },
    pnl:       { t: "กำไร / ขาดทุน",         s: "Profit & Loss" },
  };

  return (
    <ToastProvider>
      <DialogProvider>
      <RoleCtx.Provider value={role}>
      <ShopProvider>
        <OfflineBanner />
        <div className="lg:flex">
          <Sidebar view={view} setView={setView} userEmail={session.user?.email} onOpenSettings={()=>setSettingsOpen(true)}/>
          <main className="flex-1 min-h-screen pb-24 lg:pb-0 lg:pl-64">
            <MobileTopBar title={titles[view].t} userEmail={session.user?.email} onLogout={()=>sb.auth.signOut()} onOpenSettings={()=>setSettingsOpen(true)}/>
            {!['dashboard','receive','return','pnl'].includes(view) && <PageHeader title={titles[view].t} subtitle={titles[view].s} />}
            <div key={view} className="view-fade">
              {view==='pos' && <POSView />}
              {view==='products' && <ProductsView />}
              {view==='sales' && <SalesView onGoPOS={()=>setView('pos')} />}
              {view==='receive' && role==='admin' && <ReceiveView />}
              {view==='return' && <ReturnView />}
              {view==='dashboard' && role==='admin' && <DashboardView />}
              {view==='pnl' && role==='admin' && <ProfitLossView />}
            </div>
          </main>
        </div>
        <MobileTabBar view={view} setView={setView} />
        {role === 'admin' && <SettingsModal open={settingsOpen} onClose={()=>setSettingsOpen(false)} />}
      </ShopProvider>
      </RoleCtx.Provider>
      </DialogProvider>
    </ToastProvider>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);

