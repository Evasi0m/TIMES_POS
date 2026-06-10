// TikTok ↔ POS stock reconciliation — scan, compare, apply (super admin).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mapError } from '../../lib/error-map.js';
import { getTikTokConnectionStatus, backfillMissingTikTokProductIds } from '../../lib/tiktok-inventory-sync.js';
import { formatTikTokApiError } from '../../lib/tiktok-mirror-helpers.js';
import {
  scanStockDiff,
  applyStockReconcile,
  filterRows,
  partitionRows,
  defaultSelectedIds,
  rowToApplyItem,
  buildApplyPreview,
  formatApplyToast,
  sourceLabel,
  sourceHint,
  FILTER_TABS,
  isRowApplicable,
} from '../../lib/tiktok-stock-reconcile.js';
import Icon from '../ui/Icon.jsx';
import Modal from '../ui/Modal.jsx';
import TikTokSection from './tiktok/TikTokSection.jsx';
import TikTokStatStrip from './tiktok/TikTokStatStrip.jsx';
import StockReconcileRow from './tiktok/StockReconcileRow.jsx';
import TikTokHealthCard from '../settings/TikTokHealthCard.jsx';
import { TikTokGlassBtn, TikTokGlassTabs, TikTokGlassPane } from './tiktok/glass/index.js';

const FILTER_OPTIONS = [
  { k: FILTER_TABS.all, label: 'ทั้งหมด' },
  { k: FILTER_TABS.mismatched, label: 'ไม่ตรงกัน' },
  { k: FILTER_TABS.matched, label: 'ตรงกัน' },
  { k: FILTER_TABS.problems, label: 'มีปัญหา' },
];

function fmtScanTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
}

export default function TikTokStockReconcile({ toast, setView }) {
  const [connected, setConnected] = useState(null);
  const [rows, setRows] = useState([]);
  const [scannedAt, setScannedAt] = useState(null);
  const [summary, setSummary] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState(null);

  const [source, setSource] = useState('pos');
  const [filterTab, setFilterTab] = useState(FILTER_TABS.mismatched);
  const [searchQ, setSearchQ] = useState('');
  const [selected, setSelected] = useState(new Set());

  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  const applyLockRef = useRef(false);

  useEffect(() => {
    getTikTokConnectionStatus()
      .then(st => setConnected(!!st?.connected))
      .catch(() => setConnected(false));
  }, []);

  const runScan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      const data = await scanStockDiff();
      setRows(data.rows || []);
      setSummary(data.summary || null);
      setScannedAt(data.scanned_at || new Date().toISOString());
      setSelected(defaultSelectedIds(data.rows || [], source));
    } catch (e) {
      const msg = formatTikTokApiError(mapError(e));
      setScanError(msg);
      toast?.push('สแกนสต็อกไม่สำเร็จ: ' + msg, 'error', { durationMs: 10000 });
    } finally {
      setScanning(false);
    }
  }, [source, toast]);

  useEffect(() => {
    if (connected) runScan();
  }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps -- scan once on connect

  useEffect(() => {
    if (rows.length) setSelected(defaultSelectedIds(rows, source));
  }, [source]); // eslint-disable-line react-hooks/exhaustive-deps -- reset selection on source change

  const filtered = useMemo(
    () => filterRows(rows, { tab: filterTab, query: searchQ }),
    [rows, filterTab, searchQ],
  );

  const parts = useMemo(() => partitionRows(rows), [rows]);

  const selectedRows = useMemo(
    () => rows.filter(r => selected.has(r.product_id) && isRowApplicable(r, source)),
    [rows, selected, source],
  );

  const statCards = useMemo(() => [
    { label: 'จับคู่แล้ว', value: summary?.total ?? '—', icon: 'link' },
    { label: 'ตรงกัน', value: summary?.matched ?? '—', icon: 'check', warn: false },
    {
      label: 'ไม่ตรงกัน',
      value: summary?.mismatched ?? '—',
      icon: 'alert',
      warn: (summary?.mismatched ?? 0) > 0,
    },
    {
      label: 'มีปัญหา',
      value: summary?.errors ?? '—',
      icon: 'alert',
      warn: (summary?.errors ?? 0) > 0,
    },
  ], [summary]);

  const toggleRow = (productId) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const selectAllMismatched = () => {
    setSelected(defaultSelectedIds(rows, source));
  };

  const clearSelection = () => setSelected(new Set());

  const runBackfill = async () => {
    setBackfilling(true);
    try {
      toast?.push('กำลังซ่อม mapping TikTok…', 'info', { durationMs: 8000 });
      const { healed, failed } = await backfillMissingTikTokProductIds({ limit: 50 });
      toast?.push(
        `ซ่อม mapping แล้ว ${healed} รายการ${failed ? ` (ไม่พบ ${failed})` : ''}`,
        healed > 0 ? 'success' : 'warning',
      );
      await runScan();
    } catch (e) {
      toast?.push('ซ่อม mapping ไม่สำเร็จ: ' + formatTikTokApiError(mapError(e)), 'error');
    } finally {
      setBackfilling(false);
    }
  };

  const openConfirm = () => {
    if (!selectedRows.length) {
      toast?.push('เลือกรายการที่จะปรับสต็อกก่อน', 'warning');
      return;
    }
    setConfirmOpen(true);
  };

  const runApply = async () => {
    if (applyLockRef.current || !selectedRows.length) return;
    applyLockRef.current = true;
    setConfirmOpen(false);
    setApplying(true);
    setApplyProgress({ done: 0, total: selectedRows.length });

    try {
      const items = selectedRows.map(r => rowToApplyItem(r, source));
      const { summary: applySummary } = await applyStockReconcile({
        source,
        items,
        onProgress: ({ done, total }) => setApplyProgress({ done, total }),
      });

      toast?.push(
        formatApplyToast(applySummary, source),
        applySummary.failed > 0 ? 'warning' : 'success',
        { durationMs: applySummary.failed > 0 ? 12000 : 6000 },
      );
      await runScan();
    } catch (e) {
      toast?.push('Apply ไม่สำเร็จ: ' + formatTikTokApiError(mapError(e)), 'error', { durationMs: 10000 });
    } finally {
      setApplying(false);
      setApplyProgress(null);
      applyLockRef.current = false;
    }
  };

  const previewLines = useMemo(
    () => buildApplyPreview(selectedRows.slice(0, 5), source),
    [selectedRows, source],
  );

  if (connected === false) {
    return (
      <TikTokSection
        title="เช็คสต็อก POS ↔ TikTok Shop"
        subtitle="เปรียบเทียบ SKU ที่จับคู่แล้ว · ปรับให้ตรงกันได้"
      >
        <div className="p-6 text-center space-y-3">
          <Icon name="alert" size={32} className="mx-auto text-warning"/>
          <p className="text-sm text-muted">ยังไม่ได้เชื่อมต่อ TikTok Shop — ไปที่ E-Commerce → TikTok → ออเดอร์ &amp; Label เพื่อเชื่อมต่อ</p>
        </div>
      </TikTokSection>
    );
  }

  return (
    <div className="space-y-4">
      <TikTokHealthCard toast={toast} />
      <TikTokSection
        title="เช็คสต็อก POS ↔ TikTok Shop"
        subtitle="เปรียบเทียบ SKU ที่จับคู่แล้ว · ปรับให้ตรงกันได้"
        actions={
          <TikTokGlassBtn variant="hero" onClick={runScan} disabled={scanning || applying}>
            {scanning ? <span className="spinner"/> : <Icon name="refresh" size={14}/>}
            สแกนใหม่
          </TikTokGlassBtn>
        }
      >
        <div className="p-4 lg:p-5 space-y-4">
          {scanning && !rows.length && (
            <div className="flex items-center justify-center gap-2 py-12 text-muted text-sm">
              <span className="spinner"/>
              กำลังอ่านสต็อก TikTok…
            </div>
          )}

          {scanError && !rows.length && (
            <div className="tt-glass__alert flex items-start gap-2">
              <Icon name="alert" size={16} className="mt-0.5 shrink-0"/>
              <div>{scanError}</div>
            </div>
          )}

          {rows.length > 0 && (
            <>
              <TikTokStatStrip cards={statCards}/>

              {summary?.matched === summary?.total && summary?.total > 0 && (
                <div className="tt-glass__notice text-success flex items-center gap-2">
                  <Icon name="check" size={16}/>
                  สต็อกตรงกันทั้งหมด ({summary.total} SKU)
                </div>
              )}

              {parts.problems.some(r => r.status === 'missing_product_id') && (
                <div className="tt-glass__notice flex flex-wrap items-center gap-3">
                  <span className="text-warning flex items-center gap-1.5">
                    <Icon name="alert" size={14}/>
                    มี mapping ที่ขาด tiktok_product_id
                  </span>
                  <TikTokGlassBtn variant="outline" onClick={runBackfill} disabled={backfilling || scanning || applying}>
                    {backfilling ? <span className="spinner"/> : <Icon name="refresh" size={13}/>}
                    ซ่อม mapping
                  </TikTokGlassBtn>
                </div>
              )}

              <TikTokGlassPane className="tt-glass__reconcile-source space-y-3 !p-3 lg:!p-4">
                <div className="tt-glass__reconcile-source-title">
                  แหล่งอ้างอิงเมื่อ Apply
                </div>
                <TikTokGlassTabs
                  tabs={[
                    { key: 'pos', label: 'POS → TikTok' },
                    { key: 'tiktok', label: 'TikTok → POS' },
                  ]}
                  activeKey={source}
                  onSelect={setSource}
                  disabled={applying}
                  className="tt-glass__tabs--toolbar w-full sm:w-auto"
                />
                <p className="text-xs text-muted-soft">{sourceHint(source)}</p>
                {source === 'tiktok' && (
                  <p className="text-xs text-warning flex items-start gap-1.5">
                    <Icon name="alert" size={12} className="mt-0.5 shrink-0"/>
                    TikTok อาจ stale ถ้ามีออเดอร์รอยืนยัน — แนะนำ sync ออเดอร์ก่อน หรือใช้ POS → TikTok เป็นค่าเริ่มต้น
                  </p>
                )}
              </TikTokGlassPane>

              <div className="tt-glass__reconcile-toolbar">
                <div className="tt-glass__reconcile-toolbar-row tt-glass__reconcile-toolbar-row--search">
                  <label className="tt-glass__reconcile-search-wrap">
                    <Icon name="search" size={16} className="tt-glass__reconcile-search-icon" aria-hidden="true"/>
                    <input
                      type="search"
                      className="tt-glass__input tt-glass__input--lg tt-glass__reconcile-search"
                      placeholder="ค้นหา SKU / ชื่อสินค้า"
                      value={searchQ}
                      onChange={e => setSearchQ(e.target.value)}
                      disabled={applying}
                      aria-label="ค้นหา SKU หรือชื่อสินค้า"
                    />
                  </label>
                </div>
                <div className="tt-glass__reconcile-toolbar-row tt-glass__reconcile-toolbar-row--controls">
                  <TikTokGlassTabs
                    tabs={FILTER_OPTIONS.map((opt) => ({ key: opt.k, label: opt.label }))}
                    activeKey={filterTab}
                    onSelect={setFilterTab}
                    disabled={applying}
                    className="tt-glass__tabs--toolbar tt-glass__reconcile-filter-tabs"
                  />
                  <div className="tt-glass__reconcile-toolbar-actions">
                    <TikTokGlassBtn
                      variant="outline"
                      className="tt-glass__btn--lg"
                      onClick={selectAllMismatched}
                      disabled={applying}
                    >
                      เลือกไม่ตรงกัน
                    </TikTokGlassBtn>
                    {selected.size > 0 && (
                      <TikTokGlassBtn
                        variant="outline"
                        className="tt-glass__btn--lg"
                        onClick={clearSelection}
                        disabled={applying}
                      >
                        ล้างการเลือก
                      </TikTokGlassBtn>
                    )}
                  </div>
                </div>
              </div>

              {scannedAt && (
                <div className="text-[10px] text-muted-soft text-right">
                  สแกนล่าสุด {fmtScanTime(scannedAt)}
                </div>
              )}

              <div className="tt-reconcile-table">
                <div className="tt-reconcile-table__head">
                  <span/>
                  <span>SKU / ชื่อ</span>
                  <span>POS</span>
                  <span>TikTok</span>
                  <span>±</span>
                  <span>สถานะ</span>
                </div>
                <div className="tt-reconcile-table__body">
                  {filtered.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted">ไม่มีรายการในตัวกรองนี้</div>
                  ) : filtered.map(row => (
                    <StockReconcileRow
                      key={row.product_id}
                      row={row}
                      selected={selected.has(row.product_id)}
                      onToggle={toggleRow}
                      disabled={applying}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {!scanning && rows.length === 0 && connected && !scanError && (
            <div className="p-8 text-center space-y-3">
              <p className="text-sm text-muted">ยังไม่มี SKU ที่จับคู่แล้ว</p>
              {setView && (
                <TikTokGlassBtn variant="outline" onClick={() => setView('ecommerce-tiktok-matching')}>
                  ไปหน้าจับคู่สินค้า
                </TikTokGlassBtn>
              )}
            </div>
          )}
        </div>
      </TikTokSection>

      {selectedRows.length > 0 && (
        <div className="sticky bottom-4 z-20 mx-4 lg:mx-0">
          <div className="tt-glass__sticky-bar flex flex-wrap items-center gap-3 max-w-4xl mx-auto">
            <span className="tt-glass__sticky-bar__label">
              เลือก {selectedRows.length} รายการ · {sourceLabel(source)}
            </span>
            {applying && applyProgress && (
              <span className="tt-glass__sticky-bar__meta">
                กำลัง Apply… {applyProgress.done}/{applyProgress.total}
              </span>
            )}
            <TikTokGlassBtn
              variant="coral"
              className="tt-glass__btn--lg ml-auto"
              disabled={applying || scanning}
              onClick={openConfirm}
            >
              {applying ? <span className="spinner"/> : <Icon name="check" size={16}/>}
              Apply
            </TikTokGlassBtn>
          </div>
        </div>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="ยืนยันปรับสต็อก"
        footer={
          <>
            <TikTokGlassBtn variant="outline" onClick={() => setConfirmOpen(false)}>
              ยกเลิก
            </TikTokGlassBtn>
            <TikTokGlassBtn variant="coral" onClick={runApply}>
              <Icon name="check" size={16}/> ยืนยัน Apply
            </TikTokGlassBtn>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>
            ปรับสต็อก <b>{selectedRows.length}</b> รายการ · แหล่งอ้างอิง: <b>{sourceLabel(source)}</b>
          </p>
          <ul className="space-y-1 text-xs text-muted font-mono tt-glass__pane max-h-40 overflow-y-auto !p-3">
            {previewLines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
            {selectedRows.length > 5 && (
              <li className="text-muted-soft">… และอีก {selectedRows.length - 5} รายการ</li>
            )}
          </ul>
          <p className="text-xs text-warning flex items-start gap-1.5">
            <Icon name="alert" size={12} className="mt-0.5 shrink-0"/>
            ขณะ Apply อาจมีการขาย/รับเข้าเกิดขึ้น — แนะนำทำนอกเวลาขายหนาแน่น
          </p>
        </div>
      </Modal>
    </div>
  );
}
