import React from 'react';

const VARIANT_CLASS = {
  coral: 'tt-glass__btn--coral',
  ghost: 'tt-glass__btn--ghost',
  glass: 'tt-glass__btn--glass',
  surface: 'tt-glass__btn--surface',
  outline: 'tt-glass__btn--outline',
  hero: 'tt-glass__btn--hero',
};

/** Glass button — coral primary, outline/surface on light, hero on dark band */
export default function TikTokGlassBtn({
  children,
  variant = 'glass',
  className = '',
  type = 'button',
  ...props
}) {
  const variantCls = VARIANT_CLASS[variant] || VARIANT_CLASS.glass;
  return (
    <button
      type={type}
      className={variantCls + (className ? ' ' + className : '')}
      {...props}
    >
      {children}
    </button>
  );
}
