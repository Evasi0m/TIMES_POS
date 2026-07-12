import React from 'react';
import useSlidingPill from '../../hooks/useSlidingPill.js';

/**
 * Tab switcher for Stock-In page (รับเข้า / รับเข้า ×10 / ส่งเคลม-คืน)
 * and Products view mode (การ์ด / รายการ).
 * Sliding pill animates behind the active tab.
 *
 * Props:
 *   tabs:    [{ k, label, shortLabel?, icon, hint?, ai?, divideBefore? }]
 *   current: string (active tab key)
 *   onChange:(k)=>void
 *   Icon:    Icon component
 *   ariaLabel, className
 */
export default function KindTabs({
  tabs,
  current,
  onChange,
  Icon,
  ariaLabel = 'ประเภทรับเข้า',
  className = '',
}) {
  const { trackRef, setBtnRef, pill } = useSlidingPill(current);
  const activeTab = tabs.find((t) => t.k === current);
  const pillAi = Boolean(activeTab?.ai);

  return (
    <div
      ref={trackRef}
      className={
        'kind-tabs sliding-pill-track glass-soft rounded-xl shadow-sm flex w-full p-1 gap-0 h-12 lg:inline-flex lg:w-auto lg:h-auto' +
        (className ? ' ' + className : '')
      }
      role="tablist"
      aria-label={ariaLabel}
    >
      <span
        aria-hidden="true"
        className={
          'sliding-pill' +
          (pill.ready ? ' sliding-pill--ready' : '') +
          (pillAi ? ' sliding-pill--ai' : '')
        }
        style={{
          left: pill.left,
          top: pill.top,
          width: pill.width,
          height: pill.height,
        }}
      />

      {tabs.map((t) => {
        const active = current === t.k;
        const mobileLabel = t.shortLabel || t.label;
        let cls;
        if (t.ai) {
          cls = active ? 'sliding-pill-tab--on-ai' : 'ai-tab-inactive';
        } else if (active) {
          cls = 'text-ink sliding-pill-tab--active';
        } else {
          cls = 'text-muted hover:text-ink hover:bg-surface-strong/40';
        }

        return (
          <React.Fragment key={t.k}>
            {t.divideBefore && (
              <span
                aria-hidden="true"
                className="kind-tabs__divide self-stretch w-px shrink-0 bg-hairline/70 lg:mx-0.5 lg:my-1.5"
              />
            )}
            <button
              ref={setBtnRef(t.k)}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={t.label}
              className={
                'kind-tabs__btn sliding-pill-tab flex-1 min-w-0 h-full rounded-[10px] text-sm font-medium transition-colors ' +
                'flex flex-col items-center justify-center gap-0 px-0 ' +
                'lg:flex-none lg:flex-row lg:items-center lg:gap-2 lg:w-auto lg:h-auto lg:px-4 lg:py-2 lg:whitespace-nowrap ' +
                cls
              }
              onClick={() => onChange(t.k)}
            >
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
