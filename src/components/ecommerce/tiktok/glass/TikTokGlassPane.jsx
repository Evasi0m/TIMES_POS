import React from 'react';

/** Nested light glass card / row */
export default function TikTokGlassPane({
  children,
  className = '',
  as: Tag = 'div',
  ...props
}) {
  return (
    <Tag className={'tt-glass__pane ' + className} {...props}>
      {children}
    </Tag>
  );
}
