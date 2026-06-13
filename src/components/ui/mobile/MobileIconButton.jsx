import React from 'react';
import Icon from '../Icon.jsx';

/** 44×44 touch target — icon-only with required aria-label. */
export default function MobileIconButton({
  icon,
  label,
  onClick,
  active = false,
  disabled = false,
  className = '',
  iconSize = 20,
  strokeWidth = 1.85,
  type = 'button',
  ...rest
}) {
  return (
    <button
      type={type}
      className={
        'icon-btn-44 btn-secondary !p-0 shrink-0 ' +
        (active ? '!border-primary !text-primary ' : '') +
        (disabled ? 'opacity-40 cursor-not-allowed ' : '') +
        className
      }
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} size={iconSize} strokeWidth={strokeWidth} />
    </button>
  );
}
