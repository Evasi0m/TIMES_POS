import React from 'react';

export default function TikTokStatusTabs({
  tabs,
  activeKey,
  tabCounts,
  onSelect,
  onSelectAll,
  selectableCount,
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="inline-flex glass-soft rounded-xl p-1 shadow-sm overflow-x-auto max-w-full">
        {tabs.map((f) => {
          const active = activeKey === f.k;
          return (
            <button
              key={f.k}
              type="button"
              onClick={() => onSelect(f.k)}
              className={
                'px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap shrink-0 ' +
                (active
                  ? 'bg-surface-strong text-ink shadow-md ring-1 ring-hairline'
                  : 'text-muted hover:text-ink hover:bg-surface-strong/40')
              }
            >
              {f.label}
              <span className={'ml-1.5 tabular-nums text-xs ' + (active ? 'text-ink' : 'text-muted-soft')}>
                {tabCounts[f.k] ?? 0}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="text-xs text-muted hover:text-ink sm:ml-auto shrink-0 min-h-[44px] px-2"
        onClick={onSelectAll}
      >
        เลือกทั้งหมด ({selectableCount})
      </button>
    </div>
  );
}
