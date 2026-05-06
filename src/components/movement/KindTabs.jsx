import React from 'react';

/**
 * Tab switcher for Stock-In page (รับเข้า / ส่งเคลม-คืน).
 * Pure presentational — caller owns the active state.
 *
 * Props:
 *   tabs:    [{ k, label, icon, hint? }]
 *   current: string (active tab key)
 *   onChange:(k)=>void
 *   Icon:    Icon component (passed in to avoid circular import on main.jsx)
 */
export default function KindTabs({ tabs, current, onChange, Icon }) {
  return (
    <div className="inline-flex glass-soft rounded-xl p-1 shadow-sm">
      {tabs.map(t => (
        <button
          key={t.k}
          type="button"
          className={
            "px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-all " +
            (current === t.k
              ? "bg-white text-ink shadow-md ring-1 ring-hairline"
              : "text-muted hover:text-ink hover:bg-white/40")
          }
          onClick={() => onChange(t.k)}
        >
          <Icon name={t.icon} size={16} /> {t.label}
        </button>
      ))}
    </div>
  );
}
