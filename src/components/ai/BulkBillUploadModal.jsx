// BulkBillUploadModal — multi-image picker for the "รับเข้า ×10" flow.
//
// Differences from CmgBillUploadModal (the single-bill predecessor):
//   - Accepts 1–10 images in one session (file picker `multiple`,
//     drag-drop of multiple files, repeated paste).
//   - Shows a thumbnail GRID instead of a single big preview. Each
//     thumb has a numbered badge (1, 2, …) and individual remove
//     button — order = order the bills will be processed and saved.
//   - Commits the whole batch in one go via `onConfirm({ images })`.
//
// Why batch matters: each Gemini call burns 1 RPD (peak requests/day),
// and the free tier is capped at 20 RPD. Packing 5–10 bills into one
// request keeps RPD usage 5–10× smaller while token cost stays linear
// — see edge function header comment for the full rationale.
//
// Props:
//   open: bool
//   onClose(): user cancelled
//   onConfirm({ images: [{ base64, mime, name, previewUrl, sizeBytes }] })
//     called when the user commits the batch. Order is the order the
//     user added them in (most recent at the end).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../ui/Icon.jsx';
import { prepareBillImage, formatBytes } from '../../lib/image-prep.js';

// Hard cap matches the edge function. Bumping requires also bumping
// MAX_BILLS_PER_BATCH in the edge function and the output token cap.
const MAX_BILLS = 10;

// Mount-toggle pattern duplicated from CmgBillUploadModal — keeps the
// modal mounted briefly after `open` flips false so the holographic
// exit animation can play. Once unmounted, file inputs / paste
// listeners are released.
const EXIT_MS = 300;

function useMountToggle(open, exitMs) {
  const [render, setRender]   = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) { setRender(true); setClosing(false); }
    else if (render) {
      setClosing(true);
      const t = setTimeout(() => { setRender(false); setClosing(false); }, exitMs);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return { render, closing };
}

export default function BulkBillUploadModal({ open, ...rest }) {
  const { render, closing } = useMountToggle(open, EXIT_MS);
  if (!render) return null;
  return <Impl {...rest} closing={closing} />;
}

function Impl({ onClose, onConfirm, closing }) {
  // ─── state ─────────────────────────────────────────────────────────
  // `thumbs` holds the in-progress batch. Each entry:
  //   { uid, base64, mime, name, previewUrl, sizeBytes }
  // previewUrl is an Object URL we revoke on remove / unmount.
  const [thumbs, setThumbs] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef   = useRef(null);
  const cameraInputRef = useRef(null);

  // ─── core: take one or many Files, run pipeline per file ───────────
  // We process files sequentially (not in parallel) because
  // prepareBillImage uses createImageBitmap + canvas, both of which
  // are CPU-bound on the main thread. Parallel-await would just race
  // for the same execution slot and could OOM on phones.
  const handleFiles = useCallback(async (files) => {
    if (!files || files.length === 0) return;
    setError(null);
    setProcessing(true);
    try {
      const accepted = [];
      for (const file of files) {
        // Stop accepting once the batch is full. We check against the
        // CURRENT thumbs length + what's already accepted in this loop
        // to enforce the cap mid-batch (e.g. user drops 8 files when
        // already 5 are in — accept 5 more, reject the last 3).
        if (thumbs.length + accepted.length >= MAX_BILLS) {
          setError(`รับได้สูงสุด ${MAX_BILLS} บิล/รอบ — รูปที่เกินถูกข้าม`);
          break;
        }
        try {
          const result = await prepareBillImage(file);
          const previewBlob = base64ToBlob(result.base64, result.mime);
          const previewUrl = URL.createObjectURL(previewBlob);
          accepted.push({
            uid: makeUid(),
            base64: result.base64,
            mime: result.mime,
            name: file.name || 'bill.jpg',
            previewUrl,
            sizeBytes: result.finalSize,
            width: result.width,
            height: result.height,
          });
        } catch (e) {
          // Soft-fail per file — the others might be OK. Surface the
          // first error so the user knows something went wrong, but
          // keep processing the rest.
          if (!error) setError(`รูป "${file.name}": ${e?.message || String(e)}`);
        }
      }
      if (accepted.length > 0) {
        setThumbs((prev) => [...prev, ...accepted]);
      }
    } finally {
      setProcessing(false);
    }
    // intentionally exclude `thumbs.length`/`error` — we read them via
    // the closure for the cap-check; including them would recreate
    // this handler on every state change and re-bind paste listener
    // unnecessarily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── input sources ─────────────────────────────────────────────────
  const onFileInputChange = (e) => {
    const files = Array.from(e.target.files || []);
    // Reset the value so picking the same file twice re-fires the event.
    e.target.value = '';
    if (files.length) handleFiles(files);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) handleFiles(files);
  };
  const onDragOver  = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);

  useEffect(() => {
    const onPaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const pasted = [];
      for (const it of items) {
        if (it.kind === 'file' && /^image\//i.test(it.type)) {
          const file = it.getAsFile();
          if (file) pasted.push(file);
        }
      }
      if (pasted.length > 0) {
        e.preventDefault();
        handleFiles(pasted);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [handleFiles]);

  // ─── cleanup: revoke preview URLs on unmount ───────────────────────
  useEffect(() => {
    return () => {
      thumbs.forEach((t) => URL.revokeObjectURL(t.previewUrl));
    };
    // We want this to run ONLY on unmount, so omit thumbs from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── handlers ──────────────────────────────────────────────────────
  const removeThumb = (uid) => {
    setThumbs((prev) => {
      const target = prev.find((t) => t.uid === uid);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((t) => t.uid !== uid);
    });
  };

  const clearAll = () => {
    thumbs.forEach((t) => URL.revokeObjectURL(t.previewUrl));
    setThumbs([]);
    setError(null);
  };

  const commit = () => {
    if (!thumbs.length) return;
    // We hand the thumbs over to the parent — including previewUrl so
    // the wizard can show the same thumbnails without re-decoding. The
    // parent is responsible for revoking them when done.
    onConfirm({ images: thumbs });
  };

  // ─── render ────────────────────────────────────────────────────────
  const canAddMore = thumbs.length < MAX_BILLS;

  return createPortal(
    <div
      className={
        'fixed inset-0 z-[101] bg-black/55 flex items-center justify-center p-3 ' +
        (closing ? 'holo-backdrop-out' : 'holo-backdrop-in')
      }
      onDragOver={canAddMore ? onDragOver : undefined}
      onDragLeave={onDragLeave}
      onDrop={canAddMore ? onDrop : undefined}
    >
      <div
        className={
          'bg-canvas rounded-2xl shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden ' +
          (closing ? 'holo-card-out' : 'holo-card-in')
        }
      >
        <header className="flex items-center justify-between px-5 py-4 border-b hairline">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="ai-chip">AI</span>
            <div className="min-w-0">
              <div className="font-display text-xl truncate">อัปโหลดบิล CMG หลายใบ</div>
              <div className="text-xs text-muted mt-0.5">
                เลือกได้ {thumbs.length} / {MAX_BILLS} บิล · เลือกรูป · ลากวาง · หรือกด Ctrl+V
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost !p-2 flex-shrink-0" aria-label="ปิด">
            <Icon name="x" size={20}/>
          </button>
        </header>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={onFileInputChange}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onFileInputChange}
        />

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-3 text-sm text-error bg-error/10 border border-error/30 rounded-md p-3 flex items-start gap-2">
              <Icon name="alert" size={16} className="shrink-0 mt-0.5"/>
              <div className="whitespace-pre-wrap">{error}</div>
            </div>
          )}

          {thumbs.length === 0 && !processing && (
            // Empty state — full-width dropzone matching the single-bill
            // flow's look, but worded for batches.
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={
                  'w-full rounded-xl border-2 border-dashed p-8 sm:p-12 flex flex-col items-center gap-3 transition ' +
                  (dragOver
                    ? 'border-primary bg-primary/10'
                    : 'border-hairline bg-surface-soft hover:border-primary hover:bg-primary/5')
                }
              >
                <div className="w-14 h-14 rounded-full bg-canvas border hairline flex items-center justify-center">
                  <Icon name="file" size={26} className="text-primary"/>
                </div>
                <div className="text-sm font-medium">เลือกรูปบิล หรือ ลากวางที่นี่</div>
                <div className="text-xs text-muted-soft">
                  เลือกได้พร้อมกันสูงสุด {MAX_BILLS} บิล · JPG / PNG / WebP
                </div>
                <div className="text-[11px] text-muted-soft">
                  กด Ctrl+V เพื่อวางจาก clipboard ก็ได้
                </div>
              </button>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => cameraInputRef.current?.click()}
                >
                  <Icon name="camera" size={16}/> ถ่ายจากกล้อง
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Icon name="file" size={16}/> เลือกไฟล์ (หลายได้)
                </button>
              </div>
            </>
          )}

          {/* Thumbnail grid — visible whenever at least one bill is queued */}
          {thumbs.length > 0 && (
            <div className="space-y-3">
              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}
              >
                {thumbs.map((t, idx) => (
                  <div
                    key={t.uid}
                    className="relative group rounded-xl overflow-hidden border hairline bg-surface-soft"
                  >
                    <div className="aspect-[3/4] bg-canvas">
                      <img
                        src={t.previewUrl}
                        alt={`bill ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    {/* Numbered badge — same styling as the review
                        wizard's stepper so the user sees a continuous
                        identity for each bill. */}
                    <div className="absolute top-1.5 left-1.5 ai-row-badge !w-8 !h-8 !text-sm">
                      {idx + 1}
                    </div>
                    {/* Remove button — only visible on hover (desktop)
                        or always (touch). Uses btn-ghost with a red
                        hover so removal feels intentional. */}
                    <button
                      type="button"
                      onClick={() => removeThumb(t.uid)}
                      className="absolute top-1.5 right-1.5 bg-canvas/90 backdrop-blur rounded-full w-7 h-7 flex items-center justify-center text-muted hover:text-error hover:bg-error/10 transition border hairline shadow-sm"
                      aria-label={`ลบบิลที่ ${idx + 1}`}
                    >
                      <Icon name="x" size={14}/>
                    </button>
                    {/* Footer chip — file size for at-a-glance health */}
                    <div className="absolute bottom-1.5 left-1.5 right-1.5 text-[10px] text-white bg-black/55 backdrop-blur rounded px-1.5 py-0.5 tabular-nums truncate">
                      {formatBytes(t.sizeBytes)}
                    </div>
                  </div>
                ))}

                {/* "Add more" tile — looks like the empty slots so the
                    grid feels intentional. Disabled at the cap. */}
                {canAddMore && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={
                      'aspect-[3/4] rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1.5 transition ' +
                      (dragOver
                        ? 'border-primary bg-primary/10'
                        : 'border-hairline bg-surface-soft hover:border-primary hover:bg-primary/5 text-muted hover:text-primary')
                    }
                  >
                    <Icon name="plus" size={28}/>
                    <span className="text-xs">เพิ่มรูป</span>
                    <span className="text-[10px] text-muted-soft">{thumbs.length}/{MAX_BILLS}</span>
                  </button>
                )}
              </div>

              {processing && (
                <div className="text-xs text-muted-soft flex items-center gap-2 justify-center py-2">
                  <span className="spinner"/> กำลังเตรียมรูป…
                </div>
              )}
            </div>
          )}

          {processing && thumbs.length === 0 && (
            <div className="py-12 text-center space-y-3">
              <div><span className="spinner"/></div>
              <div className="text-sm text-muted">กำลังเตรียมรูป…</div>
              <div className="text-xs text-muted-soft">decoding · auto-rotate · resize</div>
            </div>
          )}
        </div>

        <footer className="px-5 py-4 border-t hairline bg-surface-soft flex items-center justify-between gap-2">
          {/* Left side: clear-all when something is queued */}
          <div>
            {thumbs.length > 0 && (
              <button type="button" className="btn-ghost text-sm" onClick={clearAll}>
                <Icon name="trash" size={14}/> ล้างทั้งหมด
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              ยกเลิก
            </button>
            <button
              type="button"
              className="btn-ai-mesh btn-ai-mesh-wide"
              onClick={commit}
              disabled={thumbs.length === 0 || processing}
            >
              <Icon name="scan" size={16}/>
              AI อ่านทั้งหมด ({thumbs.length})
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

// ─── helpers ──────────────────────────────────────────────────────────
function makeUid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Decode a base64 string back to a Blob so we can build a preview URL
 *  that matches the exact bytes we'll POST to the edge function. */
function base64ToBlob(b64, mime) {
  const bin = atob(b64);
  const len = bin.length;
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime || 'image/jpeg' });
}
