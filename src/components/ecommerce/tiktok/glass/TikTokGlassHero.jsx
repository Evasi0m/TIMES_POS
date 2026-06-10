import React from 'react';

/** Dark hero band with sheen, icon, title, and actions slot */
export default function TikTokGlassHero({
  icon,
  eyebrow,
  title,
  actions,
  children,
  className = '',
}) {
  return (
    <header className={'tt-glass__hero ' + className}>
      <div className="tt-glass__hero-pane">
        <span className="tt-glass__hero-sheen" aria-hidden="true"/>
        {(icon || eyebrow || title) && (
          <div className="tt-glass__identity">
            {icon && <div className="tt-glass__icon-wrap">{icon}</div>}
            <div className="tt-glass__titles">
              {eyebrow && <div className="tt-glass__eyebrow">{eyebrow}</div>}
              {title && <div className="tt-glass__heading">{title}</div>}
            </div>
          </div>
        )}
        {actions && <div className="tt-glass__hero-actions">{actions}</div>}
        {children}
      </div>
    </header>
  );
}
