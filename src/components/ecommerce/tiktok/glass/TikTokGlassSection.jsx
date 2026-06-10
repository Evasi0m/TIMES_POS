import React from 'react';
import TikTokGlassShell from './TikTokGlassShell.jsx';
import TikTokGlassHero from './TikTokGlassHero.jsx';

/** Full glass section — replaces card-canvas TikTokSection */
export default function TikTokGlassSection({
  title,
  subtitle,
  eyebrow,
  icon,
  actions,
  children,
  className = '',
  heroClassName = '',
  bodyClassName = '',
  loading = false,
}) {
  const hasHero = title || eyebrow || icon || actions;

  return (
    <TikTokGlassShell as="section" className={'tt-glass__section ' + className} loading={loading}>
      {hasHero && (
        <TikTokGlassHero
          className={heroClassName}
          icon={icon}
          eyebrow={eyebrow}
          title={title}
          actions={actions}
        />
      )}
      <div className={'tt-glass__body-inner ' + bodyClassName}>
        {subtitle && !hasHero && (
          <p className="text-xs text-muted mb-3">{subtitle}</p>
        )}
        {subtitle && hasHero && (
          <p className="text-xs text-muted mb-3 -mt-1">{subtitle}</p>
        )}
        {children}
      </div>
    </TikTokGlassShell>
  );
}
