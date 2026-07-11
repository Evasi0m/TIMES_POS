import React, { useEffect, useState } from 'react';
import { sb } from '../../lib/supabase-client.js';
import { fmtDateTime } from '../../lib/date.js';
import { parseManualAdjustNotes } from '../../lib/stock-manual-adjust.js';
import {
  STOCK_HISTORY_UI,
  STOCK_REASON_LABELS,
  canShowMovementDetail,
} from '../../lib/stock-movement-detail.js';
import Icon from '../ui/Icon.jsx';
import StockMovementDetailSheet from './StockMovementDetailSheet.jsx';

function StockHistoryList({ rows, loading, onDetail }) {
  if (loading) {
    return (
      <div className="text-muted text-sm p-3 flex items-center gap-2">
        <span className="spinner" />
        {STOCK_HISTORY_UI.loading}
      </div>
    );
  }
  if (!rows || rows.length === 0) {
    return <div className="text-muted text-sm p-3">{STOCK_HISTORY_UI.empty}</div>;
  }
  return (
    <>
      {rows.map((m) => {
        const meta = STOCK_REASON_LABELS[m.reason] || { label: m.reason, tone: 'gray' };
        const isPos = m.qty_delta > 0;
        const manualMeta = m.reason === 'manual_adjust' ? parseManualAdjustNotes(m.notes) : null;
        const showDetail = canShowMovementDetail(m);
        return (
          <div key={m.id} className="pe-stock-history__row">
            <div className={`w-14 text-right font-mono font-medium tabular-nums shrink-0 ${isPos ? 'text-success' : 'text-error'}`}>
              {isPos ? '+' : ''}
              {m.qty_delta}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm flex items-center gap-2 flex-wrap">
                <span className={`badge-pill !text-xs ${meta.tone === 'red' ? '!bg-error/10 !text-error' : meta.tone === 'green' ? '!bg-success/15 !text-[#2c6b3a]' : ''}`}>
                  {meta.label}
                </span>
                {manualMeta?.subreasonLabel && (
                  <span className="badge-pill !text-xs !bg-surface-strong text-muted">
                    {manualMeta.subreasonLabel}
                  </span>
                )}
                {m.ref_table && m.ref_id && m.reason !== 'manual_adjust' && (
                  <span className="text-xs text-muted-soft font-mono">
                    {m.ref_table.replace('_orders', '')}
                    #
                    {m.ref_id}
                  </span>
                )}
              </div>
              {manualMeta?.note && (
                <div className="text-xs text-muted mt-0.5 leading-snug">{manualMeta.note}</div>
              )}
              <div className="text-xs text-muted mt-0.5">{fmtDateTime(m.created_at)}</div>
            </div>
            <div className="text-xs text-muted-soft tabular-nums shrink-0 hidden sm:block">
              &rarr;
              {' '}
              {m.balance_after}
            </div>
            {showDetail && (
              <button
                type="button"
                className="btn-ghost product-editor__icon-btn !p-0 shrink-0"
                title={STOCK_HISTORY_UI.viewDetail}
                aria-label={STOCK_HISTORY_UI.viewDetail}
                onClick={() => onDetail(m)}
              >
                <Icon name="info" size={18} className="text-muted" />
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

export default function StockHistoryPanel({ productId, reloadToken = 0, embedded = false }) {
  const [open, setOpen] = useState(embedded);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detailMovement, setDetailMovement] = useState(null);

  const load = async () => {
    setLoading(true);
    const { data } = await sb.from('stock_movements')
      .select('*').eq('product_id', productId)
      .order('created_at', { ascending: false }).limit(50);
    setRows(data || []);
    setLoading(false);
  };

  useEffect(() => {
    if (!productId) return;
    setRows(null);
  }, [productId, reloadToken]);

  useEffect(() => {
    if (!productId) return;
    if (embedded || open) load();
  }, [productId, reloadToken, open, embedded]);

  const toggle = () => {
    if (!open && rows === null) load();
    setOpen((o) => !o);
  };

  if (embedded) {
    return (
      <>
        <div className="pe-stock-history">
          <StockHistoryList
            rows={rows}
            loading={loading}
            onDetail={setDetailMovement}
          />
        </div>
        <StockMovementDetailSheet
          movement={detailMovement}
          productId={productId}
          open={!!detailMovement}
          onClose={() => setDetailMovement(null)}
        />
      </>
    );
  }

  return (
    <>
      <div className="border hairline rounded-xl bg-surface-strong/80">
        <button
          type="button"
          onClick={toggle}
          className="w-full flex items-center justify-between px-4 py-3 bg-surface-strong/80 hover:bg-surface-soft rounded-xl"
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <Icon name="trend-up" size={16} />
            {STOCK_HISTORY_UI.panelTitle}
            {rows && (
              <span className="badge-pill !text-xs">
                {rows.length}
                {' '}
                {STOCK_HISTORY_UI.itemCountSuffix}
              </span>
            )}
          </span>
          <Icon name={open ? 'chevron-d' : 'chevron-r'} size={16} className="text-muted" />
        </button>
        {open && (
          <div className="border-t hairline p-3 max-h-72 overflow-y-auto fade-in">
            <StockHistoryList
              rows={rows}
              loading={loading}
              productId={productId}
              onDetail={setDetailMovement}
            />
          </div>
        )}
      </div>

      <StockMovementDetailSheet
        movement={detailMovement}
        productId={productId}
        open={!!detailMovement}
        onClose={() => setDetailMovement(null)}
      />
    </>
  );
}
