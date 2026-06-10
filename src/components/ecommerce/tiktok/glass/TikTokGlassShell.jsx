import React from 'react';

/** L0–L2 shell: ambient → rim → frosted body */
export default function TikTokGlassShell({
  children,
  className = '',
  tone,
  loading = false,
  as: Tag = 'div',
  ...props
}) {
  const cls = [
    'tt-glass',
    className,
    tone && `tt-glass--${tone}`,
    loading && 'tt-glass--loading',
  ].filter(Boolean).join(' ');

  return (
    <Tag className={cls} {...props}>
      <div className="tt-glass__ambient" aria-hidden="true"/>
      <div className="tt-glass__shell">
        <div className="tt-glass__body">{children}</div>
      </div>
    </Tag>
  );
}
