import React from 'react';

/**
 * Tab switcher for Stock-In page (รับเข้า / รับเข้า ×10 / ส่งเคลม-คืน).
 * Pure presentational — caller owns the active state.
 *
 * Props:
 *   tabs:    [{ k, label, shortLabel?, icon, hint?, ai?, divideBefore? }]
 *            `shortLabel` is shown under the icon on mobile (icon-first
 *            layout). Falls back to `label` when omitted.
 *            When `ai: true` the tab swaps its neutral chrome for the
 *            AI mesh palette — soft warm text-glow when inactive,
 *            tinted gradient panel with halo when active. Keeps the
 *            premium AI features visually distinct from the plain
 *            manual-entry tabs.
 *            When `divideBefore: true` a hairline vertical rule is
 *            rendered just before the tab — useful for separating
 *            conceptual groups (e.g. รับเข้า/รับเข้า×10 vs. ส่งเคลม/คืน).
 *   current: string (active tab key)
 *   onChange:(k)=>void
 *   Icon:    Icon component (passed in to avoid circular import on main.jsx)
 */
export default function KindTabs({ tabs, current, onChange, Icon }) {
  return (
    <div
      className="kind-tabs glass-soft rounded-xl shadow-sm flex w-full p-0 gap-px h-12 lg:inline-flex lg:w-auto lg:h-auto lg:p-1 lg:gap-0"
      role="tablist"
      aria-label="ประเภทรับเข้า"
    >
      {tabs.map(t => {
        const active = current === t.k;
        const mobileLabel = t.shortLabel || t.label;
        const cls = t.ai
          ? (active ? 'ai-tab-active' : 'ai-tab-inactive')
          : (active
              ? 'bg-surface-strong text-ink shadow-md ring-1 ring-hairline'
              : 'text-muted hover:text-ink hover:bg-surface-strong/40');
        return (
          <React.Fragment key={t.k}>
            {t.divideBefore && (
              <span
                aria-hidden="true"
                className="kind-tabs__divide self-stretch w-px shrink-0 bg-hairline/70 lg:mx-0.5 lg:my-1.5"
              />
            )}
            <button
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={t.label}
              className={
                'kind-tabs__btn flex-1 min-w-0 h-12 rounded-lg text-sm font-medium transition-all ' +
                'flex flex-col items-center justify-center gap-0 px-0 ' +
                'lg:flex-none lg:flex-row lg:items-center lg:gap-2 lg:w-auto lg:h-auto lg:px-4 lg:py-2.5 lg:whitespace-nowrap ' +
                cls
              }
              onClick={() => onChange(t.k)}
            >
              {/* Mobile: icon on top, short label below (bottom-tab pattern). */}
              <span className="lg:hidden flex flex-col items-center justify-center gap-0 min-w-0 w-full h-full">
                <span className="kind-tabs__icon-wrap relative flex items-center justify-center h-5 w-full shrink-0">
                  {t.ai && (
                    <span className="ai-tab-badge kind-tabs__ai-badge" aria-hidden="true">
                      AI
                    </span>
                  )}
                  <Icon name={t.icon} size={16} />
                </span>
                <span className="kind-tabs__label text-[9px] leading-none font-medium truncate max-w-full px-0.5">
                  {mobileLabel}
                </span>
              </span>

              {/* Desktop: horizontal pill with full label. */}
              <span className="hidden lg:flex items-center gap-2">
                {t.ai && <span className="ai-tab-badge">AI</span>}
                <Icon name={t.icon} size={16} /> {t.label}
              </span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}
