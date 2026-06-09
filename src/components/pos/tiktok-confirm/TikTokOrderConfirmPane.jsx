import React, { useEffect, useState } from 'react';
import TikTokStepProgress from './TikTokStepProgress.jsx';
import TikTokOrderSummaryCard from './TikTokOrderSummaryCard.jsx';
import TikTokItemNavigator from './TikTokItemNavigator.jsx';
import TikTokMatchSidePanel from './TikTokMatchSidePanel.jsx';
import TikTokConfirmActionBar from './TikTokConfirmActionBar.jsx';
import { orderHasStockIssue } from './helpers.js';

export default function TikTokOrderConfirmPane({
  order,
  picks,
  setPicks,
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

  const items = order?.items || [];

  useEffect(() => {
    if (!order?.id) return;
    const first = items.find(it => !picks[it.id]?.id);
    setActiveItemId(first?.id ?? items[0]?.id ?? null);
  }, [order?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!order) return null;

  const activeItem = items.find(it => it.id === activeItemId) ?? null;
  const activePick = activeItem ? picks[activeItem.id] : null;
  const activeMatched = Boolean(activePick?.id);
  const stockBlocked = orderHasStockIssue(items, picks, catalog);

  const handlePick = (itemId, p) => {
    setPicks(prev => ({
      ...prev,
      [itemId]: { id: p.id, name: p.name, current_stock: p.current_stock },
    }));
    const next = items.find(it => it.id !== itemId && !picks[it.id]?.id);
    setActiveItemId(next?.id ?? null);
  };

  const handleClear = (itemId) => {
    setPicks(prev => {
      const n = { ...prev };
      delete n[itemId];
      return n;
    });
    setActiveItemId(itemId);
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-surface-cream-strong">
      <TikTokStepProgress allMatched={allMatched} netOk={netOk}/>

      {/* Order strip — softened teal, compact */}
      <div className="px-4 pt-2.5 pb-1.5 shrink-0">
        <TikTokOrderSummaryCard order={order}/>
      </div>

      {/* Item navigator — switch focus between SKUs (multi-item only;
          for a single item the focus header already shows it). */}
      {items.length > 1 && (
        <div className="px-4 pb-1.5 shrink-0">
          <TikTokItemNavigator
            items={items}
            activeItemId={activeItemId}
            picks={picks}
            catalog={catalog}
            disabled={saving}
            onSelect={setActiveItemId}
            onClear={handleClear}
          />
        </div>
      )}

      {/* Focus matcher — full width, fills remaining height */}
      <div className="ttc-match-side-panel-wrap flex-1 min-h-0 px-3 pb-2">
        {items.length ? (
          <TikTokMatchSidePanel
            item={activeItem}
            items={items}
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
            onEditMatches={() => setActiveItemId(items[0]?.id ?? null)}
          />
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
        netOk={netOk}
        stockBlocked={stockBlocked}
        onConfirm={onConfirm}
      />
    </div>
  );
}
