import React from 'react';

/**
 * Tab switcher for Stock-In page (รับเข้า / รับเข้า ×10 / ส่งเคลม-คืน).
 * Pure presentational — caller owns the active state.
 *
 * Props:
 *   tabs:    [{ k, label, icon, hint?, ai?, divideBefore? }]
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
    <div className="inline-flex glass-soft rounded-xl p-1 shadow-sm">
      {tabs.map(t => {
        const active = current === t.k;
        const cls = t.ai
          ? (active ? 'ai-tab-active' : 'ai-tab-inactive')
          : (active
              ? 'bg-white text-ink shadow-md ring-1 ring-hairline'
              : 'text-muted hover:text-ink hover:bg-white/40');
        return (
          <React.Fragment key={t.k}>
            {/* 1px hairline divider — inset vertically so it doesn't
                 touch the edges of the glass-soft strip. Purely
                 decorative (aria-hidden) — the tab labels already
                 convey the grouping to screen readers. */}
            {t.divideBefore && (
              <span
                aria-hidden="true"
                className="self-stretch w-px mx-1 my-1.5 bg-hairline/70"
              />
            )}
            <button
              type="button"
              className={
                'px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-all ' +
                cls
              }
              onClick={() => onChange(t.k)}
            >
              {/* Tiny "AI" badge — sits before the icon so the user
                   reads "AI · scan · รับเข้า ×10" as a phrase. Only
                   rendered on AI-flagged tabs; inherits colour from
                   the .ai-tab-active/-inactive parent via CSS. */}
              {t.ai && <span className="ai-tab-badge">AI</span>}
              <Icon name={t.icon} size={16} /> {t.label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}
