// JsonBillImportModal - pick a Gemini Gem JSON export for bulk receive.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../ui/Icon.jsx';
import { formatBytes } from '../../lib/image-prep.js';
import {
  parseCmgBillImportBlob,
  parseCmgBillImportFile,
  MAX_IMPORT_BILLS,
  isLikelyJsonFile,
} from '../../lib/cmg-bill-import.js';
import { validateCmgBill } from '../../lib/cmg-bill-validate.js';

const EXIT_MS = 300;

function useMountToggle(open, exitMs) {
  const [render, setRender] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) { setRender(true); setClosing(false); }
    else if (render) {
      setClosing(true);
      const t = setTimeout(() => { setRender(false); setClosing(false); }, exitMs);
      return () => clearTimeout(t);
    }
  }, [open, render, exitMs]);
  return { render, closing };
}

function buildPreviewFromBills(bills, sizeBytes) {
  const billMeta = bills.map((b) => {
    const inv = String(b.supplier_invoice_no || '').trim() || '—';
    const footerWarnings = validateCmgBill(b).bill?.warnings?.length || 0;
    return { inv, footerWarnings };
  });
  return {
    billCount: bills.length,
    billMeta,
    totalRows: bills.reduce((s, b) => s + (b.items?.length || 0), 0),
    footerWarningBills: billMeta.filter((m) => m.footerWarnings > 0).length,
    sizeBytes,
    bills,
  };
}

export default function JsonBillImportModal({ open, ...rest }) {
  const { render, closing } = useMountToggle(open, EXIT_MS);
  if (!render) return null;
  return <Impl open={open} {...rest} closing={closing} />;
}

function Impl({ open, onClose, onConfirm, closing }) {
  const [importMode, setImportMode] = useState('file');
  const [textDraft, setTextDraft] = useState('');
  const [sourceKind, setSourceKind] = useState('file');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [errors, setErrors] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const reset = useCallback(() => {
    setImportMode('file');
    setTextDraft('');
    setSourceKind('file');
    setFile(null);
    setPreview(null);
    setErrors([]);
    setProcessing(false);
    setDragOver(false);
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const handleClose = useCallback(() => {
    reset();
    onClose?.();
  }, [reset, onClose]);

  const clearInput = useCallback(() => {
    setFile(null);
    setPreview(null);
    setErrors([]);
  }, []);

  const applyParseResult = useCallback((result, { kind, sizeBytes, sourceFile = null }) => {
    if (!result.ok) {
      setFile(null);
      setPreview(null);
      setErrors(result.errors);
      return;
    }
    setSourceKind(kind);
    setFile(sourceFile);
    const previewData = buildPreviewFromBills(result.bills, sizeBytes);
    if (result.warnings?.length) previewData.parseWarnings = result.warnings;
    setPreview(previewData);
    setErrors([]);
  }, []);

  const parseFile = useCallback(async (f) => {
    if (!f) return;
    if (!isLikelyJsonFile(f)) {
      setFile(null);
      setPreview(null);
      setErrors(['ต้องเป็นไฟล์ .json']);
      return;
    }
    setProcessing(true);
    setErrors([]);
    setPreview(null);
    try {
      const result = await parseCmgBillImportBlob(f);
      applyParseResult(result, { kind: 'file', sizeBytes: f.size, sourceFile: f });
    } catch (e) {
      setFile(null);
      setErrors([e?.message || String(e)]);
    } finally {
      setProcessing(false);
    }
  }, [applyParseResult]);

  const parseText = useCallback(() => {
    const trimmed = textDraft.trim();
    if (!trimmed) return;
    setProcessing(true);
    setErrors([]);
    setPreview(null);
    setFile(null);
    try {
      const result = parseCmgBillImportFile(trimmed);
      applyParseResult(result, { kind: 'text', sizeBytes: trimmed.length });
    } catch (e) {
      setErrors([e?.message || String(e)]);
    } finally {
      setProcessing(false);
    }
  }, [textDraft, applyParseResult]);

  const switchToTextMode = useCallback(() => {
    setImportMode('text');
    setFile(null);
    setPreview(null);
    setErrors([]);
    setTextDraft('');
    setDragOver(false);
  }, []);

  const switchToFileMode = useCallback(() => {
    setImportMode('file');
    setFile(null);
    setPreview(null);
    setErrors([]);
    setTextDraft('');
    setDragOver(false);
  }, []);

  const onDragOver = useCallback((e) => {
    if (importMode !== 'file' || preview) return;
    e.preventDefault();
    setDragOver(true);
  }, [importMode, preview]);

  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const onDrop = useCallback((e) => {
    if (importMode !== 'file' || preview) return;
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) parseFile(f);
  }, [importMode, preview, parseFile]);

  const onFileInputChange = useCallback((e) => {
    const f = e.target.files?.[0];
    if (f) parseFile(f);
    e.target.value = '';
  }, [parseFile]);

  const commit = () => {
    if (!preview?.bills?.length) return;
    const fileName = sourceKind === 'file'
      ? (file?.name || 'import.json')
      : 'paste.json';
    onConfirm?.({ bills: preview.bills, fileName });
  };

  const dragEnabled = importMode === 'file' && !preview;
  const showEmptyState = !preview && !processing;
  const headerSubtitle = importMode === 'text'
    ? `วาง JSON จาก Gemini Gem — สูงสุด ${MAX_IMPORT_BILLS} บิล/ไฟล์ · ไม่ใช้ AI quota`
    : `ไฟล์จาก Gemini Gem — สูงสุด ${MAX_IMPORT_BILLS} บิล/ไฟล์ · ไม่ใช้ AI quota`;

  return createPortal(
    <div
      className="fixed inset-0 z-[101] flex items-center justify-center p-3"
      onDragOver={dragEnabled ? onDragOver : undefined}
      onDragLeave={onDragLeave}
      onDrop={dragEnabled ? onDrop : undefined}
    >
      <div className={'absolute inset-0 modal-overlay ' + (closing ? 'holo-backdrop-out' : 'holo-backdrop-in')} aria-hidden="true" />
      <div className={'relative bg-canvas rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden ' + (closing ? 'holo-card-out' : 'holo-card-in')}>
        <header className="flex items-center justify-between px-5 py-4 border-b hairline">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="json-chip">JSON</span>
            <div className="min-w-0">
              <div className="font-display text-xl truncate">นำเข้าจาก JSON</div>
              <div className="text-xs text-muted mt-0.5">{headerSubtitle}</div>
            </div>
          </div>
          <button type="button" onClick={handleClose} className="btn-ghost !p-2 flex-shrink-0" aria-label="ปิด"><Icon name="x" size={20}/></button>
        </header>
        <input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden" onChange={onFileInputChange} />
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {errors.length > 0 && (
            <div className="mb-3 text-sm text-error bg-error/10 border border-error/30 rounded-md p-3 space-y-1">
              {errors.map((err, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Icon name="alert" size={16} className="shrink-0 mt-0.5"/>
                  <span className="whitespace-pre-wrap">{err}</span>
                </div>
              ))}
            </div>
          )}
          {showEmptyState && importMode === 'file' && (
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className={'w-full rounded-xl border-2 border-dashed p-8 sm:p-10 flex flex-col items-center gap-3 transition ' + (dragOver ? 'border-accent bg-accent/10' : 'border-hairline bg-surface-soft hover:border-accent hover:bg-accent/5')}>
              <div className="w-14 h-14 rounded-full bg-canvas border hairline flex items-center justify-center"><Icon name="file" size={26} className="text-accent"/></div>
              <div className="text-sm font-medium">เลือกไฟล์ .json หรือ ลากวางที่นี่</div>
              <div className="text-xs text-muted-soft text-center leading-relaxed max-w-xs">
                รูปแบบ <code className="text-[11px] bg-surface-soft px-1 rounded">{`{ "bills": [...] }`}</code>{' '}· schema เดียวกับ cmg-bill-parse
              </div>
            </button>
          )}
          {showEmptyState && importMode === 'text' && (
            <div className="space-y-2">
              <label className="text-xs text-muted-soft">วาง JSON จาก Gemini Gem</label>
              <textarea
                className="input w-full min-h-[200px] max-h-[40vh] resize-y font-mono text-xs leading-relaxed"
                placeholder={'{ "bills": [ ... ] }'}
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                spellCheck={false}
              />
              <p className="text-[11px] text-muted-soft">
                รองรับ markdown fence · สูงสุด {MAX_IMPORT_BILLS} บิล
              </p>
            </div>
          )}
          {processing && (
            <div className="py-12 text-center space-y-3">
              <span className="spinner"/>
              <div className="text-sm text-muted">
                {importMode === 'text' ? 'กำลังตรวจสอบ JSON…' : 'กำลังตรวจสอบไฟล์…'}
              </div>
            </div>
          )}
          {preview && (
            <div className="space-y-3">
              <div className="rounded-xl border hairline bg-surface-soft p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Icon name="file" size={18} className="text-accent shrink-0"/>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">
                      {sourceKind === 'file' ? (file?.name || 'import.json') : 'วางจากข้อความ'}
                    </div>
                    <div className="text-[11px] text-muted-soft tabular-nums">{formatBytes(preview.sizeBytes)}{' · '}{preview.billCount} บิล · {preview.totalRows} แถว</div>
                  </div>
                  <button type="button" className="btn-ghost !p-1.5 shrink-0" onClick={clearInput} aria-label="ลบ"><Icon name="x" size={16}/></button>
                </div>
                <ul className="text-xs space-y-1 max-h-40 overflow-y-auto">
                  {preview.billMeta.map((meta, i) => (
                    <li key={i} className="flex items-center gap-2 tabular-nums">
                      <span className="ai-row-badge !w-5 !h-5 !text-[10px] shrink-0">{i + 1}</span>
                      <span className="font-mono truncate flex-1">{meta.inv}</span>
                      {meta.footerWarnings > 0 && <span className="text-[10px] text-warning shrink-0">footer {meta.footerWarnings}</span>}
                    </li>
                  ))}
                </ul>
              </div>
              {preview.footerWarningBills > 0 && (
                <div className="text-[11px] text-warning">{preview.footerWarningBills} บิลมี footer warning — ตรวจใน review ก่อนบันทึก</div>
              )}
              {preview.parseWarnings?.length > 0 && (
                <div className="text-[11px] text-warning space-y-0.5">
                  {preview.parseWarnings.map((w, i) => (
                    <div key={i}>{w}</div>
                  ))}
                </div>
              )}
              <div className="text-[11px] text-muted-soft">กดยืนยันเพื่อเข้าหน้า review · ยังไม่บันทึกเข้าระบบ</div>
            </div>
          )}
        </div>
        <footer className="px-5 py-4 border-t hairline bg-surface-soft flex items-center justify-between gap-2">
          <div>
            {importMode === 'file' && (
              <button type="button" className="btn-ghost text-sm" onClick={switchToTextMode}>
                <Icon name="file" size={14}/> วางข้อความ
              </button>
            )}
            {importMode === 'text' && (
              <button type="button" className="btn-ghost text-sm" onClick={switchToFileMode}>
                <Icon name="file" size={14}/> เลือกไฟล์
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-cancel-mesh btn-ai-mesh-wide !py-3 !px-6 !text-base"
              onClick={handleClose}
            >
              ยกเลิก
            </button>
            {importMode === 'text' && !preview ? (
              <button
                type="button"
                className="btn-json-mesh btn-ai-mesh-wide !py-3 !px-6 !text-base"
                onClick={parseText}
                disabled={!textDraft.trim() || processing}
              >
                <Icon name="check" size={18}/>
                ตรวจสอบ
              </button>
            ) : (
              <button
                type="button"
                className="btn-json-mesh btn-ai-mesh-wide !py-3 !px-6 !text-base"
                onClick={commit}
                disabled={!preview?.bills?.length || processing}
              >
                <Icon name="file" size={18}/>
                นำเข้า {preview ? `${preview.billCount} บิล` : ''}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
