import React from 'react';
import Icon from '../Icon.jsx';

/** Standard mobile list row: meta left, amount right, optional chevron. */
export default function MobileDataCard({
  children,
  right,
  onClick,
  className = '',
  showChevron = true,
  disabled = false,
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={
        'card-canvas pressable p-3.5 flex items-center gap-3 w-full text-left ' +
        (disabled ? 'opacity-60 ' : '') +
        className
      }
      onClick={onClick}
      disabled={onClick ? disabled : undefined}
    >
      <div className="flex-1 min-w-0">{children}</div>
      {right ? <div className="text-right flex-shrink-0 tabular-nums">{right}</div> : null}
      {showChevron && onClick ? <Icon name="chevron-r" size={16} className="text-muted-soft shrink-0" /> : null}
    </Tag>
  );
}
