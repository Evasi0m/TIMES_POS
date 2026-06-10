import React from 'react';

const TONE_CLASS = {
  live: 'tt-glass__badge--live',
  expired: 'tt-glass__badge--expired',
  idle: 'tt-glass__badge--idle',
  ok: 'tt-glass__badge--ok',
  warn: 'tt-glass__badge--warn',
  bad: 'tt-glass__badge--bad',
};

/** Status pill — hero context (dark) or surface context (light glass) */
export default function TikTokGlassBadge({
  children,
  tone = 'idle',
  dot = true,
  context = 'hero',
  className = '',
}) {
  const toneCls = TONE_CLASS[tone] || TONE_CLASS.idle;
  const ctxCls = context === 'surface' ? ' tt-glass__badge--on-surface' : '';
  return (
    <span className={'tt-glass__badge ' + toneCls + ctxCls + (className ? ' ' + className : '')}>
      {dot && <span className="tt-glass__badge-dot" aria-hidden="true"/>}
      {children}
    </span>
  );
}
