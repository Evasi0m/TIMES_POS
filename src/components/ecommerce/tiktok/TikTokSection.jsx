// Section wrapper — matches InsightsView card-cream pattern.
import React from 'react';

export default function TikTokSection({ title, subtitle, actions, children, className = '' }) {
  return (
    <section className={'card-canvas rounded-xl overflow-hidden ' + className}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 lg:px-5 lg:py-4 border-b hairline bg-surface-soft/40">
          <div className="min-w-0">
            {title && (
              <h3 className="font-display text-lg lg:text-xl leading-tight text-ink">{title}</h3>
            )}
            {subtitle && <div className="text-xs text-muted mt-0.5">{subtitle}</div>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
