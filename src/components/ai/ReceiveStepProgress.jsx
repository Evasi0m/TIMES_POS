import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '../ui/Icon.jsx';

/** Short labels for mobile step tabs (key-based — encoding-safe). */
export function shortStepLabel(step) {
  if (!step) return '';
  if (step.key === 'match') return 'จับคู่';
  if (step.key === 'qtycost') return 'จำนวน/ทุน';
  return step.label || '';
}

export default function ReceiveStepProgress({
  steps,
  activeStep,
  onGotoStep,
  variant = 'card',
  className = '',
}) {
  const trackRef = useRef(null);
  const tabRefs = useRef([]);
  const [indicator, setIndicator] = useState({ x: 0, y: 0, width: 0, height: 0, ready: false });

  const activeIndex = Math.max(0, steps.findIndex((s) => s.key === activeStep));
  const activeStepObj = steps[activeIndex] || steps[0];
  const stepKey = activeStep || 'match';

  const measureIndicator = useCallback(() => {
    const track = trackRef.current;
    const tab = tabRefs.current[activeIndex];
    if (!track || !tab) return;
    const tr = track.getBoundingClientRect();
    const tb = tab.getBoundingClientRect();
    setIndicator({
      x: tb.left - tr.left,
      y: tb.top - tr.top,
      width: tb.width,
      height: tb.height,
      ready: true,
    });
  }, [activeIndex]);

  useLayoutEffect(() => {
    measureIndicator();
  }, [measureIndicator, steps.length, activeStep]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => measureIndicator());
    ro.observe(track);
    return () => ro.disconnect();
  }, [measureIndicator]);

  if (!steps?.length) return null;

  const track = (
    <div
      ref={trackRef}
      className={'mrs-progress mrs-progress--glass mrs-progress--on-' + stepKey}
      style={{ '--mrs-steps': steps.length }}
      aria-label="ขั้นตอนตรวจรายการ"
    >
      <div
        className="mrs-progress__indicator"
        aria-hidden="true"
        style={{
          '--mrs-ind-x': indicator.x + 'px',
          '--mrs-ind-y': indicator.y + 'px',
          '--mrs-ind-w': indicator.width + 'px',
          '--mrs-ind-h': indicator.height + 'px',
          opacity: indicator.ready ? 1 : 0,
        }}
      />
      {steps.map((s, i) => {
        const isActive = s.key === activeStep;
        const isDone = s.done && !isActive;
        const isPending = !isActive && !s.done && !s.disabled;
        const canJump = !s.disabled && (s.done || isActive);
        const Tag = canJump && onGotoStep ? 'button' : 'span';
        const label = variant === 'inline' ? s.label : shortStepLabel(s);
        return (
          <Tag
            key={s.key}
            ref={(el) => { tabRefs.current[i] = el; }}
            type={Tag === 'button' ? 'button' : undefined}
            className={
              'mrs-progress__tab mrs-progress__tab--' + s.key +
              (isActive ? ' is-active' : '') +
              (isDone ? ' is-done' : '') +
              (isPending ? ' is-pending' : '') +
              (s.disabled ? ' is-disabled' : '') +
              (canJump && onGotoStep ? ' is-tappable' : '')
            }
            style={{ gridColumn: i + 1 }}
            disabled={Tag === 'button' ? !canJump : undefined}
            onClick={canJump && onGotoStep ? () => onGotoStep(s.key) : undefined}
            aria-current={isActive ? 'step' : undefined}
            aria-label={s.label}
          >
            <span className="mrs-progress__tab-icon" aria-hidden="true">
              {isDone ? <Icon name="check" size={13}/> : <Icon name={s.icon} size={14}/>}
            </span>
            <span className="mrs-progress__label">{label}</span>
          </Tag>
        );
      })}
    </div>
  );

  if (variant === 'inline') {
    return (
      <div className={'receive-step-progress receive-step-progress--inline shrink-0 ' + className}>
        {track}
      </div>
    );
  }

  return (
    <div className={'mrs-progress-card card-canvas mrs-progress-card--on-' + stepKey + ' ' + className}>
      <div className="mrs-progress-card__head">
        <span className="mrs-progress-card__title">ขั้นตอน</span>
        <span className="mrs-progress-card__active">{activeStepObj?.label}</span>
      </div>
      {track}
    </div>
  );
}
