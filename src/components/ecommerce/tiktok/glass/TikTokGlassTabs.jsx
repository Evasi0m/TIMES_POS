import React from 'react';

/** Tab strip — section nav + order status filters */
export default function TikTokGlassTabs({
  tabs,
  activeKey,
  onSelect,
  disabled = false,
  className = '',
  variant = 'default',
  renderTab,
}) {
  const VARIANT_CLASS = {
    nav: 'tt-glass__tabs--nav',
    toolbar: 'tt-glass__tabs--toolbar',
    status: 'tt-glass__tabs--nav tt-glass__tabs--toolbar tt-glass__tabs--status',
  };

  const rootCls = [
    'tt-glass__tabs',
    VARIANT_CLASS[variant] || '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={rootCls} role="tablist">
      {tabs.map((tab) => {
        const key = tab.key ?? tab.k ?? tab.id;
        const active = activeKey === key;
        const label = tab.label;
        const count = tab.count;

        if (renderTab) {
          return renderTab({ tab, key, active, disabled, onSelect });
        }

        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled || tab.disabled}
            onClick={() => onSelect(key)}
            className={'tt-glass__tab' + (active ? ' tt-glass__tab--active' : '')}
          >
            {label}
            {count != null && (
              <span className="tt-glass__tab-count">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
