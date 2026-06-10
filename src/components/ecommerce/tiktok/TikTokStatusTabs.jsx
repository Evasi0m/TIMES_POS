import React from 'react';
import { TikTokGlassBtn, TikTokGlassTabs } from './glass/index.js';

export default function TikTokStatusTabs({
  tabs,
  activeKey,
  tabCounts,
  onSelect,
  onSelectAll,
  selectableCount,
}) {
  const glassTabs = tabs.map((f) => ({
    key: f.k,
    label: f.label,
    count: tabCounts[f.k] ?? 0,
  }));

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 min-w-0">
      <TikTokGlassTabs
        variant="status"
        tabs={glassTabs}
        activeKey={activeKey}
        onSelect={onSelect}
        className="flex-1 min-w-0"
      />
      <TikTokGlassBtn
        type="button"
        variant="outline"
        className="tt-glass__btn--lg shrink-0 sm:ml-auto"
        onClick={onSelectAll}
      >
        เลือกทั้งหมด ({selectableCount})
      </TikTokGlassBtn>
    </div>
  );
}
