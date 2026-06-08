import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import Icon from '../ui/Icon.jsx';
import TikTokSkuMatchRow, { TIKTOK_MIN_PCT_OPTIONS } from './TikTokSkuMatchRow.jsx';
import { isTikTokLineReady } from '../../lib/tiktok-inventory-sync.js';

/**
 * Full-screen match card for manual receive — match before add or re-match existing line.
 */
export default function TikTokReceiveMatchCard({
  open,
  onClose,
  product,
  lineIndex = null,
  quantity = 1,
  initialSkip = false,
  initialSku = null,
  initialMapping = null,
  previewStockAfter = null,
  catalog = [],
  catalogLoading = false,
  catalogError = null,
  onRetryCatalog,
  onSearchCatalog,
  minPct = 60,
  onMinPctChange,
  onConfirm,
  confirmLabel = 'ยืนยันเพิ่มเข้ารายการ',
}) {
  const [skipped, setSkipped] = useState(initialSkip);
  const [tiktokSku, setTiktokSku] = useState(initialSku);
  const [tiktokMapping, setTiktokMapping] = useState(initialMapping);

  useEffect(() => {
    if (!open) return;
    setSkipped(initialSkip);
    setTiktokSku(initialSku);
    setTiktokMapping(initialMapping);
  }, [open, initialSkip, initialSku, initialMapping, product?.id]);

  const draftLine = useMemo(() => ({
    product_id: product?.id,
    product_name: product?.name,
    barcode: product?.barcode,
    quantity,
    tiktok_skip: skipped,
    tiktok_sku: tiktokSku,
    tiktok_mapping: tiktokMapping,
  }), [product, quantity, skipped, tiktokSku, tiktokMapping]);

  const ready = isTikTokLineReady(draftLine);

  const handleChange = (patch) => {
    if ('tiktok_skip' in patch) setSkipped(!!patch.tiktok_skip);
    if ('tiktok_sku' in patch) {
      setTiktokSku(patch.tiktok_sku);
      if (patch.tiktok_sku) setTiktokMapping(null);
    }
    if ('tiktok_mapping' in patch) {
      setTiktokMapping(patch.tiktok_mapping);
      if (patch.tiktok_mapping) setTiktokSku(null);
    }
    if (patch.tiktok_sku === null && patch.tiktok_mapping === null) {
      setTiktokSku(null);
      setTiktokMapping(null);
    }
  };

  const handleConfirm = () => {
    if (!ready) return;
    onConfirm?.({
      tiktok_skip: skipped,
      tiktok_sku: tiktokSku,
      tiktok_mapping: tiktokMapping,
      tiktok_manual: true,
    });
  };

  if (!product) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={lineIndex != null ? 'แก้ไขจับคู่ TikTok' : 'จับคู่ TikTok SKU'}
      footer={(
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>ยกเลิก</button>
          <button
            type="button"
            className="btn-primary"
            disabled={!ready}
            onClick={handleConfirm}
          >
            <Icon name="check" size={16}/> {confirmLabel}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="rounded-xl border hairline bg-surface-soft/60 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wider text-muted mb-1">สินค้า POS</div>
          <div className="font-medium text-ink">{product.name}</div>
          {product.barcode && (
            <div className="text-xs text-muted font-mono mt-0.5">{product.barcode}</div>
          )}
          {previewStockAfter != null && (
            <div className="text-[11px] text-muted-soft mt-1 tabular-nums">
              POS หลังรับเข้า (preview): <span className="font-semibold text-ink">{previewStockAfter}</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[11px] text-muted shrink-0">candidate ≥</label>
          <select
            className="input !h-8 !w-auto !text-xs !py-0"
            value={minPct}
            onChange={e => onMinPctChange?.(Number(e.target.value))}
            disabled={catalogLoading}
          >
            {TIKTOK_MIN_PCT_OPTIONS.map(n => (
              <option key={n} value={n}>{n}%</option>
            ))}
          </select>
        </div>

        <TikTokSkuMatchRow
          line={draftLine}
          skipped={skipped}
          tiktokSku={tiktokSku}
          mapping={tiktokMapping}
          previewStockAfter={previewStockAfter}
          onChange={handleChange}
          catalog={catalog}
          catalogLoading={catalogLoading}
          catalogError={catalogError}
          onRetryCatalog={onRetryCatalog}
          onSearchCatalog={onSearchCatalog}
          minPct={minPct}
          compact={false}
          showLabel
        />

        {!ready && !skipped && (
          <p className="text-xs text-muted-soft">
            เลือก TikTok SKU หรือติ๊ก「ไม่ sync」ก่อนยืนยัน
          </p>
        )}
      </div>
    </Modal>
  );
}
