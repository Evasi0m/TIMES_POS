import React, { useEffect, useRef } from 'react';

/**
 * macOS-style terminal window for activity logs.
 * Presentational only — parent owns lines + activeLine state.
 */
export default function MacTerminal({
  title = 'TIMES POS — AI Bill Scan',
  lines = [],
  activeLine = null,
  isActive = false,
  className = '',
}) {
  const bodyRef = useRef(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, activeLine, isActive]);

  return (
    <div className={`mac-terminal ${className}`.trim()} role="log" aria-live="polite" aria-relevant="additions">
      <div className="mac-terminal__titlebar">
        <div className="mac-terminal__dots" aria-hidden="true">
          <span className="mac-terminal__dot mac-terminal__dot--close" />
          <span className="mac-terminal__dot mac-terminal__dot--min" />
          <span className="mac-terminal__dot mac-terminal__dot--max" />
        </div>
        <div className="mac-terminal__title">{title}</div>
      </div>
      <div className="mac-terminal__body" ref={bodyRef}>
        {lines.map((line) => (
          <div
            key={line.id}
            className={`mac-terminal__line mac-terminal__line--${line.tone || 'info'}`}
          >
            {line.text}
          </div>
        ))}
        {(isActive || activeLine) && (
          <div className="mac-terminal__line mac-terminal__line--active">
            <span>{activeLine || ''}</span>
            {isActive && <span className="mac-terminal__cursor" aria-hidden="true">_</span>}
          </div>
        )}
      </div>
    </div>
  );

}
