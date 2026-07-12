import React from 'react';
import useSlidingPill from '../../hooks/useSlidingPill.js';

/**
 * Glass chip segment bar with a sliding active pill (Overview tabs, etc.).
 *
 * tabs: [{ k, label, icon, superAdminOnly? }]
 * isTabDisabled?: (tab) => boolean
 */
export default function SlidingSegment({
  tabs,
  current,
  onChange,
  Icon,
  className = '',
  isTabDisabled,
  ariaLabel = '???????????',
}) {
  const { trackRef, setBtnRef, pill } = useSlidingPill(current);

  return (
    <div
      ref={trackRef}
      className={
        'sliding-pill-track inline-flex glass-soft rounded-xl p-1 shadow-sm ' + className
      }
      role="tablist"
      aria-label={ariaLabel}
    >
      <span
        aria-hidden="true"
        className={'sliding-pill' + (pill.ready ? ' sliding-pill--ready' : '')}
        style={{
          left: pill.left,
          top: pill.top,
          width: pill.width,
          height: pill.height,
        }}
      />
      {tabs.map((t) => {
        const active = current === t.k;
        const disabled = isTabDisabled ? isTabDisabled(t) : false;
        return (
          <button
            key={t.k}
            ref={setBtnRef(t.k)}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={disabled ? undefined : () => onChange(t.k)}
            title={disabled ? '????? super admin ????????' : undefined}
            aria-label={t.label}
            className={
              'sliding-pill-tab px-2.5 sm:px-4 py-2 rounded-[10px] text-sm font-medium flex items-center justify-center gap-1.5 transition-colors flex-1 sm:flex-none ' +
              (disabled
                ? 'text-muted-soft opacity-40 cursor-not-allowed'
                : active
                  ? 'sliding-pill-tab--active'
                  : 'text-muted hover:text-ink hover:bg-surface-strong/40')
            }
          >
            <Icon name={t.icon} size={18} />
            <span className="hidden sm:inline">{t.label}</span>
            {disabled && <Icon name="lock" size={11} className="opacity-70 hidden sm:inline" />}
          </button>
        );
      })}
    </div>
  );
}
