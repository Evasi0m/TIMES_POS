import React, { useEffect, useState } from 'react';
import TikTokStepProgress from './TikTokStepProgress.jsx';
import TikTokOrderSummaryCard from './TikTokOrderSummaryCard.jsx';
import TikTokItemNavigator from './TikTokItemNavigator.jsx';
import TikTokMatchSidePanel from './TikTokMatchSidePanel.jsx';
import TikTokOrderReviewPane from './TikTokOrderReviewPane.jsx';
import TikTokConfirmActionBar from './TikTokConfirmActionBar.jsx';
import {
  orderHasStockIssue,
  orderHasSubstitutionBlock,
  defaultSubstitutionMeta,
  isTikTokSkuMismatch,
} from './helpers.js';

export default function TikTokOrderConfirmPane({
  order,
  picks,
  setPicks,
  substitutionMeta,
  setSubstitutionMeta,
  net,
  setNet,
  deferNet,
  setDeferNet,
  saving,
  allMatched,
  netOk,
  onConfirm,
  catalog,
  catalogLoading,
  catalogError,
  onRetryCatalog,
}) {
  const [activeItemId, setActiveItemId] = useState(null);
  const [viewMode, setViewMode] = useState('match');

  const items = order?.items || [];

  useEffect(() => {
    if (!order?.id) return;
    const first = items.find(it => !picks[it.id]?.id);
    setActiveItemId(first?.id ?? items[0]?.id ?? null);
    setViewMode('match');
  }, [order?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!order) return null;

  const activeItem = items.find(it => it.id === activeItemId) ?? null;
  const activePick = activeItem ? picks[activeItem.id] : null;
  const activeMatched = Boolean(activePick?.id);
  const stockBlocked = orderHasStockIssue(items, picks, catalog);
  const substitutionBlocked = orderHasSubstitutionBlock(items, picks, substitutionMeta);

  const handlePick = (itemId, p) => {
    const item = items.find(it => it.id === itemId);
    setPicks(prev => ({
      ...prev,
      [itemId]: { id: p.id, name: p.name, current_stock: p.current_stock },
    }));
    if (item) {
      setSubstitutionMeta(prev => ({
        ...prev,
        [itemId]: defaultSubstitutionMeta(),
      }));
    }
    const next = items.find(it => it.id !== itemId && !picks[it.id]?.id);
    if (next) {
      setActiveItemId(next.id);
      setViewMode('match');
      return;
    }
    setActiveItemId(itemId);
    const mismatch = item && isTikTokSkuMismatch(item, { name: p.name });
    if (!mismatch) {
      setViewMode('review');
    } else {
      setViewMode('match');
    }
  };

  const handleClear = (itemId) => {
    setPicks(prev => {
      const n = { ...prev };
      delete n[itemId];
      return n;
    });
    setSubstitutionMeta(prev => {
      const n = { ...prev };
      delete n[itemId];
      return n;
    });
    setActiveItemId(itemId);
    setViewMode('match');
  };

  const handleSubstitutionChange = (itemId, patch) => {
    setSubstitutionMeta(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], ...patch },
    }));
  };

  const goToReview = () => setViewMode('review');

  const backToMatch = (itemId) => {
    setViewMode('match');
    if (itemId) setActiveItemId(itemId);
    else if (!activeItemId && items[0]) setActiveItemId(items[0].id);
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-surface-cream-strong">
      <TikTokStepProgress
        allMatched={allMatched}
        viewMode={viewMode}
        netOk={netOk}
        stockBlocked={stockBlocked}
        substitutionBlocked={substitutionBlocked}
      />

      <div className="px-4 pt-2.5 pb-1.5 shrink-0">
        <TikTokOrderSummaryCard order={order}/>
      </div>

      {viewMode === 'match' && items.length > 1 && (
        <div className="px-4 pb-1.5 shrink-0">
          <TikTokItemNavigator
            items={items}
            activeItemId={activeItemId}
            picks={picks}
            catalog={catalog}
            substitutionMeta={substitutionMeta}
            disabled={saving}
            onSelect={setActiveItemId}
            onClear={handleClear}
          />
        </div>
      )}

      <div className="ttc-match-side-panel-wrap flex-1 min-h-0 px-3 pb-2">
        {items.length ? (
          viewMode === 'review' ? (
            <TikTokOrderReviewPane
              items={items}
              picks={picks}
              catalog={catalog}
              substitutionMeta={substitutionMeta}
              disabled={saving}
              onSubstitutionChange={handleSubstitutionChange}
              onChangeProduct={backToMatch}
              onBackToMatch={() => backToMatch(null)}
            />
          ) : (
            <TikTokMatchSidePanel
              item={activeItem}
              picks={picks}
              matched={activeMatched}
              pick={activePick}
              disabled={saving}
              catalog={catalog}
              catalogLoading={catalogLoading}
              catalogError={catalogError}
              onRetryCatalog={onRetryCatalog}
              onPick={(p) => activeItem && handlePick(activeItem.id, p)}
              onClear={handleClear}
              onGoToReview={goToReview}
              allMatched={allMatched}
            />
          )
        ) : (
          <div className="glass-soft !bg-surface-strong/75 ring-1 ring-hairline shadow-sm rounded-lg p-6 text-sm text-muted text-center">
            ไม่มีรายการสินค้า
          </div>
        )}
      </div>

      <TikTokConfirmActionBar
        net={net}
        setNet={setNet}
        deferNet={deferNet}
        setDeferNet={setDeferNet}
        saving={saving}
        allMatched={allMatched}
        viewMode={viewMode}
        netOk={netOk}
        stockBlocked={stockBlocked}
        substitutionBlocked={substitutionBlocked}
        onConfirm={onConfirm}
      />
    </div>
  );
}
