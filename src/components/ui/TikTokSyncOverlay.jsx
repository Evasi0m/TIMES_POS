// Liquid-glass sync progress ring — shared by TikTok Shop + POS confirm panel.
import React, { useId } from 'react';

function MagSafeRing({ pct, gradId, glowId }) {
  const clamped = Math.min(100, Math.max(0, Math.round(pct)));
  const R = 52;
  const stroke = 9;
  const C = 2 * Math.PI * R;
  const filled = (C * clamped) / 100;

  return (
    <div className="ttc-magsafe" style={{ '--sync-pct': clamped }}>
      <div className="ttc-magsafe__halo" aria-hidden="true"/>
      <div className="ttc-magsafe__glass-disc" aria-hidden="true"/>
      <svg className="ttc-magsafe__svg" viewBox="0 0 128 128" aria-hidden="true">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#e8b4a2"/>
            <stop offset="35%" stopColor="#cc6f54"/>
            <stop offset="70%" stopColor="#a44c37"/>
            <stop offset="100%" stopColor="#8a3d2e"/>
          </linearGradient>
          <filter id={glowId} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.8" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <circle className="ttc-magsafe__track" cx="64" cy="64" r={R} fill="none" strokeWidth={stroke}/>
        <circle
          className="ttc-magsafe__fill"
          cx="64"
          cy="64"
          r={R}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${C}`}
          transform="rotate(-90 64 64)"
          filter={`url(#${glowId})`}
        />
      </svg>
      <div className="ttc-magsafe__label">
        <span className="ttc-magsafe__pct font-display tabular-nums">{clamped}%</span>
      </div>
    </div>
  );
}

export default function TikTokSyncOverlay({
  pct,
  caption = 'กำลังอัปเดตจาก TikTok…',
  className = '',
  phase = 'in',
  layout = 'cover',
  style,
}) {
  const gradId = useId().replace(/:/g, '');
  const glowId = `${gradId}-glow`;
  const clamped = Math.min(100, Math.max(0, Math.round(pct)));
  const phaseClass = phase === 'out' ? 'ttc-sync-overlay--out' : 'ttc-sync-overlay--in';

  if (layout === 'page') {
    return (
      <>
        <div
          className={`ttc-sync-overlay ttc-sync-overlay--page-backdrop ${phaseClass} ${className}`}
          style={style}
          aria-hidden="true"
        />
        <div
          className={`ttc-sync-overlay--page-ring ${phaseClass}`}
          style={style}
          aria-live="polite"
          aria-busy="true"
          aria-valuenow={clamped}
          aria-valuemin={0}
          aria-valuemax={100}
          role="progressbar"
        >
          <MagSafeRing pct={pct} gradId={gradId} glowId={glowId}/>
          <p className="ttc-magsafe__caption font-display">{caption}</p>
        </div>
      </>
    );
  }

  return (
    <div
      className={
        'absolute inset-0 z-40 ttc-sync-overlay flex flex-col items-center justify-center gap-3 ' +
        phaseClass + ' ' + className
      }
      style={style}
      aria-live="polite"
      aria-busy="true"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      role="progressbar"
    >
      <MagSafeRing pct={pct} gradId={gradId} glowId={glowId}/>
      <p className="ttc-magsafe__caption font-display">{caption}</p>
    </div>
  );
}
